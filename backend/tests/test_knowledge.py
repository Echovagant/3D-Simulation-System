"""领域资料索引的 HTTP 接口。

覆盖：写入与默认值、标签归一化、空白字段校验、importance 边界、
无 query 列表排序、关键词检索（标题/正文/标签、多词 OR）、
命中刷新 last_accessed_at、时间衰减排序、通配符转义、owner 隔离与删除。
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import engine
from app.models import KnowledgeEntry

# 假 token（软身份的测试替身，与真实 key 无关）
OWNER = "owner-knowledge-a"
OTHER_OWNER = "owner-knowledge-b"

HEADERS_OTHER = {"X-Owner-Token": OTHER_OWNER}


@pytest.fixture
def knowledge_client(client: TestClient) -> TestClient:
    """带归属头的客户端。client 是函数级 fixture，改头不会漏给别的测试文件。"""
    client.headers.update({"X-Owner-Token": OWNER})
    return client


def _write(
    client: TestClient,
    *,
    title: str = "资料",
    content: str = "内容",
    tags: str = "",
    importance: float | None = None,
):
    body: dict = {"title": title, "content": content, "tags": tags}
    if importance is not None:
        body["importance"] = importance
    return client.post("/api/knowledge/entries", json=body)


def _set_accessed(entry_id: int, *, hours_ago: float) -> None:
    """把一条资料的 last_accessed_at 拨到指定小时之前。"""
    with Session(engine) as db:
        row = db.get(KnowledgeEntry, entry_id)
        assert row is not None
        row.last_accessed_at = datetime.now(UTC) - timedelta(hours=hours_ago)
        db.commit()


# --------------------------------------------------------------------------
# 写入
# --------------------------------------------------------------------------


def test_create_returns_item_with_defaults(knowledge_client: TestClient):
    response = _write(
        knowledge_client,
        title="力控经验",
        content="接近目标时减小力度，避免冲过头。",
        tags="gym",
    )
    assert response.status_code == 201, response.text

    body = response.json()
    assert isinstance(body["id"], int)
    assert body["title"] == "力控经验"
    assert body["content"] == "接近目标时减小力度，避免冲过头。"
    assert body["tags"] == "gym"
    assert body["importance"] == 0.5
    assert body["createdAt"]
    assert body["updatedAt"]
    assert body["lastAccessedAt"]


def test_tags_are_normalized_and_deduped(knowledge_client: TestClient):
    response = _write(
        knowledge_client,
        title="标签归一",
        content="逗号、分号与空白都认。",
        tags=" gym，力控; gym  control ",
    )
    assert response.status_code == 201, response.text
    assert response.json()["tags"] == "gym, 力控, control"


def test_blank_title_or_content_is_rejected(knowledge_client: TestClient):
    for payload in (
        {"title": "   ", "content": "有内容"},
        {"title": "有标题", "content": "  "},
    ):
        response = knowledge_client.post("/api/knowledge/entries", json=payload)
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "knowledge_invalid_request"


def test_importance_out_of_range_is_rejected(knowledge_client: TestClient):
    response = _write(knowledge_client, importance=1.5)
    assert response.status_code == 422, response.text


# --------------------------------------------------------------------------
# 列表
# --------------------------------------------------------------------------


def test_list_without_query_sorts_by_importance(knowledge_client: TestClient):
    _write(knowledge_client, title="低权重", importance=0.2)
    _write(knowledge_client, title="高权重", importance=0.9)
    _write(knowledge_client, title="中权重", importance=0.5)

    response = knowledge_client.get("/api/knowledge/entries")
    assert response.status_code == 200, response.text
    titles = [item["title"] for item in response.json()["items"]]
    assert titles == ["高权重", "中权重", "低权重"]


# --------------------------------------------------------------------------
# 检索
# --------------------------------------------------------------------------


def test_search_matches_title_content_and_tags(knowledge_client: TestClient):
    title_hit = _write(knowledge_client, title="推力上限", content="与目标无关").json()
    content_hit = _write(knowledge_client, title="无关", content="摩擦系数取 0.5").json()
    tag_hit = _write(knowledge_client, title="无关", content="无关", tags="gym, 控制").json()
    _write(knowledge_client, title="无关", content="无关", tags="渲染")

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "推力"})
    assert [item["id"] for item in response.json()["items"]] == [title_hit["id"]]

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "摩擦"})
    assert [item["id"] for item in response.json()["items"]] == [content_hit["id"]]

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "gym"})
    assert [item["id"] for item in response.json()["items"]] == [tag_hit["id"]]


def test_search_multiple_terms_are_or(knowledge_client: TestClient):
    first = _write(knowledge_client, title="力控", content="无关").json()
    second = _write(knowledge_client, title="无关", content="摩擦").json()

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "力控, 摩擦"})
    assert response.status_code == 200, response.text
    ids = [item["id"] for item in response.json()["items"]]
    assert set(ids) == {first["id"], second["id"]}


def test_search_refreshes_last_accessed_at(knowledge_client: TestClient):
    created = _write(knowledge_client, title="会被命中", content="检索刷新时间").json()
    _set_accessed(created["id"], hours_ago=48)

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "检索刷新"})
    assert response.status_code == 200, response.text
    item = response.json()["items"][0]
    assert item["id"] == created["id"]
    assert item["lastAccessedAt"] != created["lastAccessedAt"]


def test_search_sorts_by_importance_and_decay(knowledge_client: TestClient):
    old_important = _write(
        knowledge_client, title="旧但重要", content="检索排序", importance=1.0
    ).json()
    fresh_moderate = _write(
        knowledge_client, title="新且中等", content="检索排序", importance=0.5
    ).json()
    _set_accessed(old_important["id"], hours_ago=720)

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "检索排序"})
    ids = [item["id"] for item in response.json()["items"]]
    # 旧条目 importance/log(e+720)≈0.152 < 新条目 0.5/1=0.5
    assert ids == [fresh_moderate["id"], old_important["id"]]


def test_search_escapes_wildcards(knowledge_client: TestClient):
    with_percent = _write(knowledge_client, title="命中率", content="准确率 100%").json()
    _write(knowledge_client, title="无关", content="没有任何符号")

    response = knowledge_client.get("/api/knowledge/entries", params={"query": "%"})
    assert [item["id"] for item in response.json()["items"]] == [with_percent["id"]]


# --------------------------------------------------------------------------
# 归属与删除
# --------------------------------------------------------------------------


def test_owner_isolation(knowledge_client: TestClient):
    created = _write(knowledge_client, title="我的资料", content="别人看不到").json()

    other = knowledge_client.get("/api/knowledge/entries", headers=HEADERS_OTHER)
    assert other.status_code == 200
    assert other.json()["items"] == []

    cross_delete = knowledge_client.delete(
        f"/api/knowledge/entries/{created['id']}",
        headers=HEADERS_OTHER,
    )
    assert cross_delete.status_code == 404
    assert cross_delete.json()["error"]["code"] == "knowledge_not_found"


def test_delete_own_entry(knowledge_client: TestClient):
    created = _write(knowledge_client, title="待删", content="删掉").json()

    response = knowledge_client.delete(f"/api/knowledge/entries/{created['id']}")
    assert response.status_code == 204

    listing = knowledge_client.get("/api/knowledge/entries")
    assert listing.json()["items"] == []

    again = knowledge_client.delete(f"/api/knowledge/entries/{created['id']}")
    assert again.status_code == 404
