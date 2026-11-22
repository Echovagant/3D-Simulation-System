"""智能体记忆的 HTTP 接口。

覆盖：写入与默认值、kind / source 校验、importance 边界、检索（无 query
最近优先 / 有 query 关键词+时间衰减排序）、命中刷新 last_accessed_at、
关键词通配符转义、owner 隔离与删除、审计提炼（提炼 / 幂等更新 / 空结果 / 归属隔离）。

排序类断言用「可控时间差」：直接把 last_accessed_at 拨到若干小时前，
让衰减分数的差距远大于毫秒级噪声，次序才是确定性的。
"""

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from app.db import engine
from app.models import AgentMemory
from app.services import gym_audit

# 假 token（软身份的测试替身，与真实 key 无关）
OWNER = "owner-test-a"
OTHER_OWNER = "owner-test-b"

HEADERS_OTHER = {"X-Owner-Token": OTHER_OWNER}


@pytest.fixture
def memory_client(client: TestClient) -> TestClient:
    """带归属头的客户端。client 是函数级 fixture，改头不会漏给别的测试文件。"""
    client.headers.update({"X-Owner-Token": OWNER})
    return client


def _write(
    client: TestClient,
    content: str,
    *,
    kind: str = "semantic",
    importance: float | None = None,
    source: str | None = None,
):
    body: dict = {"kind": kind, "content": content}
    if importance is not None:
        body["importance"] = importance
    if source is not None:
        body["source"] = source
    return client.post("/api/memory", json=body)


def _set_accessed(memory_id: int, *, hours_ago: float) -> None:
    """把一条记忆的 last_accessed_at 拨到指定小时之前。"""
    with Session(engine) as db:
        row = db.get(AgentMemory, memory_id)
        assert row is not None
        row.last_accessed_at = datetime.now(UTC) - timedelta(hours=hours_ago)
        db.commit()


def _record_audit(
    *,
    owner: str = OWNER,
    session_id: str = "sess-1",
    step_index: int = 0,
    applied: bool = True,
    error_code: str | None = None,
) -> None:
    with Session(engine) as db:
        gym_audit.record_step(
            db,
            owner_token=owner,
            session_id=session_id,
            round_index=0,
            step_index=step_index,
            force_x=10.0,
            force_z=0.0,
            force_limit=30.0,
            applied=applied,
            latency_ms=2,
            error_code=error_code,
        )


# --------------------------------------------------------------------------
# 写入
# --------------------------------------------------------------------------


def test_create_returns_item_with_defaults(memory_client: TestClient):
    response = _write(memory_client, "项目里力上限默认 30N", kind="semantic")
    assert response.status_code == 201, response.text

    body = response.json()
    assert isinstance(body["id"], int)
    assert body["kind"] == "semantic"
    assert body["content"] == "项目里力上限默认 30N"
    assert body["source"] == "manual"
    assert body["importance"] == 0.5
    assert body["dedupeKey"] is None
    assert body["createdAt"]
    # 刚写入：上次访问就是创建那一刻
    assert body["lastAccessedAt"] == body["createdAt"]


def test_create_accepts_all_kinds_and_explicit_fields(memory_client: TestClient):
    for kind in ("episodic", "semantic", "procedural"):
        response = _write(
            memory_client,
            f"{kind} 记忆",
            kind=kind,
            importance=0.8,
            source="manual",
        )
        assert response.status_code == 201, response.text
        body = response.json()
        assert body["kind"] == kind
        assert body["importance"] == 0.8


def test_create_rejects_unknown_kind(memory_client: TestClient):
    response = _write(memory_client, "kind 打错了", kind="wrong")
    assert response.status_code == 422, response.text
    body = response.json()
    assert body["error"]["code"] == "memory_invalid_request"
    assert "kind" in body["error"]["message"]


def test_create_rejects_unknown_source(memory_client: TestClient):
    response = _write(memory_client, "source 打错了", source="auto")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "memory_invalid_request"


def test_create_rejects_out_of_range_importance(memory_client: TestClient):
    for importance in (1.5, -0.1):
        response = _write(memory_client, "重要性越界", importance=importance)
        assert response.status_code == 422, response.text
        assert response.json()["error"]["code"] == "validation_error"


def test_memory_endpoints_require_owner_token(client: TestClient):
    write = client.post("/api/memory", json={"kind": "semantic", "content": "匿名"})
    assert write.status_code == 401, write.text
    assert write.json()["error"]["code"] == "owner_token_required"
    read = client.get("/api/memory")
    assert read.status_code == 401, read.text


# --------------------------------------------------------------------------
# 检索
# --------------------------------------------------------------------------


def test_list_recent_orders_by_last_accessed(memory_client: TestClient):
    first = _write(memory_client, "最早写的").json()
    second = _write(memory_client, "中间写的").json()
    third = _write(memory_client, "最后写的").json()
    # 访问次序与写入次序错开：third 刚访问过，first 一小时前，second 五小时前
    _set_accessed(first["id"], hours_ago=1)
    _set_accessed(second["id"], hours_ago=5)
    _set_accessed(third["id"], hours_ago=0)

    items = memory_client.get("/api/memory").json()["items"]
    assert [item["id"] for item in items] == [third["id"], first["id"], second["id"]]


def test_list_respects_limit(memory_client: TestClient):
    for i in range(3):
        _write(memory_client, f"记忆 {i}")
    items = memory_client.get("/api/memory", params={"limit": 2}).json()["items"]
    assert len(items) == 2


def test_search_ranks_by_importance_and_decay(memory_client: TestClient):
    # 同一关键词三条记忆：高重要但一小时前、低重要但刚访问、高重要但一百小时前。
    # 分数 = importance / ln(e + hours)：
    #   1.0/ln(e+1)≈0.762 > 0.5/ln(e)=0.5 > 1.0/ln(e+100)≈0.216
    # 次序同时钉住两个因子——重要性占优、时间衰减拖后。
    top = _write(memory_client, "力上限 三十条", importance=1.0).json()
    middle = _write(memory_client, "力上限 记牢", importance=0.5).json()
    bottom = _write(memory_client, "力上限 老黄历", importance=1.0).json()
    _set_accessed(top["id"], hours_ago=1)
    _set_accessed(middle["id"], hours_ago=0)
    _set_accessed(bottom["id"], hours_ago=100)

    items = memory_client.get("/api/memory", params={"query": "力上限"}).json()["items"]
    assert [item["id"] for item in items] == [top["id"], middle["id"], bottom["id"]]


def test_search_refreshes_last_accessed(memory_client: TestClient):
    created = _write(memory_client, "关灯前检查碰撞体").json()
    old = datetime.now(UTC) - timedelta(hours=24)
    _set_accessed(created["id"], hours_ago=24)

    items = memory_client.get("/api/memory", params={"query": "关灯"}).json()["items"]
    assert len(items) == 1
    accessed = datetime.fromisoformat(items[0]["lastAccessedAt"])
    assert accessed.astimezone(UTC) > old  # 命中即刷新

    with Session(engine) as db:
        row = db.get(AgentMemory, created["id"])
        assert row is not None
        assert row.last_accessed_at.replace(tzinfo=UTC) > old  # 真实落库


def test_search_miss_returns_empty(memory_client: TestClient):
    _write(memory_client, "重力方向朝下")
    items = memory_client.get("/api/memory", params={"query": "不存在的词"}).json()["items"]
    assert items == []


def test_search_treats_percent_and_underscore_as_literals(memory_client: TestClient):
    hit = _write(memory_client, "完成 100% 的任务").json()
    _write(memory_client, "完成 100x 的任务")
    hit2 = _write(memory_client, "模式 a_b 示例").json()
    _write(memory_client, "模式 aXb 示例")

    items = memory_client.get("/api/memory", params={"query": "100%"}).json()["items"]
    assert [item["id"] for item in items] == [hit["id"]]
    items = memory_client.get("/api/memory", params={"query": "a_b"}).json()["items"]
    assert [item["id"] for item in items] == [hit2["id"]]


# --------------------------------------------------------------------------
# 删除与 owner 隔离
# --------------------------------------------------------------------------


def test_owner_isolation(memory_client: TestClient):
    mine = _write(memory_client, "只有我看得见", kind="episodic").json()

    # B 检索不到 A 的：列表与关键词两条路都不通
    other_list = memory_client.get("/api/memory", headers=HEADERS_OTHER).json()
    assert all(item["id"] != mine["id"] for item in other_list["items"])
    other_search = memory_client.get(
        "/api/memory", params={"query": "只有我"}, headers=HEADERS_OTHER
    ).json()
    assert other_search["items"] == []

    # B 删 A 的：404（越权与不存在统一口径）；A 自己删得动
    other_delete = memory_client.delete(
        f"/api/memory/{mine['id']}", headers=HEADERS_OTHER
    )
    assert other_delete.status_code == 404
    assert other_delete.json()["error"]["code"] == "memory_not_found"

    delete = memory_client.delete(f"/api/memory/{mine['id']}")
    assert delete.status_code == 204, delete.text

    # 删完就不在了；再删一次也是 404
    remaining = memory_client.get("/api/memory").json()["items"]
    assert all(item["id"] != mine["id"] for item in remaining)
    assert memory_client.delete(f"/api/memory/{mine['id']}").status_code == 404


def test_delete_rejects_unknown_id(memory_client: TestClient):
    response = memory_client.delete("/api/memory/99999")
    assert response.status_code == 404, response.text
    assert response.json()["error"]["code"] == "memory_not_found"


# --------------------------------------------------------------------------
# 审计提炼（consolidate）
# --------------------------------------------------------------------------


def test_consolidate_distills_repeated_failures(memory_client: TestClient):
    for i in range(3):
        _record_audit(
            step_index=i, applied=False, error_code="gym_force_out_of_range"
        )
    # 单次失败不成模式；成功动作也不算失败
    _record_audit(step_index=10, applied=False, error_code="gym_step_failed")
    _record_audit(step_index=11, applied=True)

    response = memory_client.post("/api/memory/consolidate")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["scannedLogs"] == 5
    assert body["created"] == 1
    assert body["updated"] == 0

    pattern = body["patterns"][0]
    assert pattern["sessionId"] == "sess-1"
    assert pattern["errorCode"] == "gym_force_out_of_range"
    assert pattern["occurrences"] == 3
    assert pattern["action"] == "created"

    # 提炼出来的记忆：procedural + audit_distilled，importance 按次数归一（3/10）
    items = memory_client.get("/api/memory").json()["items"]
    distilled = [item for item in items if item["id"] == pattern["memoryId"]]
    assert len(distilled) == 1
    memory = distilled[0]
    assert memory["kind"] == "procedural"
    assert memory["source"] == "audit_distilled"
    assert memory["importance"] == 0.3
    assert memory["dedupeKey"] == "sess-1:gym_force_out_of_range"
    assert "gym_force_out_of_range" in memory["content"]
    assert "3 次" in memory["content"]


def test_consolidate_is_idempotent_and_updates(memory_client: TestClient):
    for i in range(3):
        _record_audit(step_index=i, applied=False, error_code="gym_force_out_of_range")

    first = memory_client.post("/api/memory/consolidate").json()
    assert first["created"] == 1 and first["updated"] == 0

    # 没有新失败再跑一遍：更新同一条，不重复插入
    again = memory_client.post("/api/memory/consolidate").json()
    assert again["created"] == 0 and again["updated"] == 1
    assert again["patterns"][0]["action"] == "updated"
    items = memory_client.get("/api/memory").json()["items"]
    assert len([item for item in items if item["source"] == "audit_distilled"]) == 1

    # 失败次数涨到 5：同一条记忆被更新（次数与 importance 跟着涨），仍不重复
    for i in range(100, 102):
        _record_audit(step_index=i, applied=False, error_code="gym_force_out_of_range")
    third = memory_client.post("/api/memory/consolidate").json()
    assert third["created"] == 0 and third["updated"] == 1
    assert third["patterns"][0]["occurrences"] == 5

    items = memory_client.get("/api/memory").json()["items"]
    distilled = [item for item in items if item["source"] == "audit_distilled"]
    assert len(distilled) == 1
    assert distilled[0]["importance"] == 0.5
    assert "5 次" in distilled[0]["content"]


def test_consolidate_without_failure_patterns_is_empty(memory_client: TestClient):
    _record_audit(step_index=0, applied=True)
    _record_audit(step_index=1, applied=True)
    _record_audit(step_index=2, applied=False, error_code="gym_step_failed")  # 只失败一次

    body = memory_client.post("/api/memory/consolidate").json()
    assert body == {"scannedLogs": 3, "created": 0, "updated": 0, "patterns": []}
    assert memory_client.get("/api/memory").json()["items"] == []


def test_consolidate_isolates_owners(memory_client: TestClient):
    _record_audit(
        owner=OWNER, session_id="sess-a", applied=False, error_code="gym_force_out_of_range"
    )
    _record_audit(
        owner=OWNER, session_id="sess-a", applied=False, error_code="gym_force_out_of_range"
    )

    # B 的审计里没有这些行：提炼不出任何东西，也看不到 A 的记忆
    other = memory_client.post("/api/memory/consolidate", headers=HEADERS_OTHER).json()
    assert other["scannedLogs"] == 0
    assert other["created"] == 0
    assert memory_client.get("/api/memory", headers=HEADERS_OTHER).json()["items"] == []

    # A 自己提炼得出来
    mine = memory_client.post("/api/memory/consolidate").json()
    assert mine["created"] == 1
