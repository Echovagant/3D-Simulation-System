from fastapi.testclient import TestClient

DOCUMENT = {
    "id": "s1",
    "name": "演示场景",
    "createdAt": "2026-10-22T00:00:00.000Z",
    "updatedAt": "2026-10-22T00:00:00.000Z",
    "version": 1,
    "gravity": {"x": 0, "y": -9.81, "z": 0},
    "objects": [
        {
            "uuid": "o1",
            "type": "cube",
            "name": "立方体",
            "position": {"x": 0, "y": 2, "z": 0},
            "rotation": {"x": 0, "y": 0, "z": 0},
            "scale": {"x": 1, "y": 1, "z": 1},
            "visible": True,
        }
    ],
}


def test_create_and_read_scene(client: TestClient):
    created = client.post("/api/scenes", json={"name": "演示场景", "document": DOCUMENT})
    assert created.status_code == 201
    body = created.json()
    assert body["name"] == "演示场景"
    assert body["objectCount"] == 1

    fetched = client.get("/api/scenes/s1")
    assert fetched.status_code == 200
    assert fetched.json()["document"]["objects"][0]["uuid"] == "o1"


def test_list_scenes_returns_summaries(client: TestClient):
    client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    client.post("/api/scenes", json={"name": "B", "document": {**DOCUMENT, "id": "b"}})
    body = client.get("/api/scenes").json()
    assert len(body) == 2
    assert {item["id"] for item in body} == {"a", "b"}
    # 列表里不返回完整 document（体积大且没人用）
    assert "document" not in body[0]


def test_update_scene_replaces_document(client: TestClient):
    client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    updated = client.put(
        "/api/scenes/a",
        json={"name": "改名了", "document": {**DOCUMENT, "id": "a", "objects": []}},
    )
    assert updated.status_code == 200
    assert updated.json()["name"] == "改名了"
    assert client.get("/api/scenes/a").json()["document"]["objects"] == []


def test_delete_scene(client: TestClient):
    client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    assert client.delete("/api/scenes/a").status_code == 204
    assert client.get("/api/scenes/a").status_code == 404


def test_missing_scene_returns_standard_error_shape(client: TestClient):
    response = client.get("/api/scenes/nope")
    assert response.status_code == 404
    body = response.json()
    assert body["error"]["code"] == "scene_not_found"
    assert "nope" in body["error"]["message"]
    assert body["error"]["detail"] is None


def test_scene_id_comes_from_document(client: TestClient):
    created = client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "xyz"}})
    assert created.json()["id"] == "xyz"


def test_duplicate_id_returns_conflict(client: TestClient):
    """id 重复时返回 409：前端的推送是幂等的，收到 409 就改走更新。"""
    client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    again = client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    assert again.status_code == 409
    assert again.json()["error"]["code"] == "scene_conflict"


def test_invalid_document_id_returns_422_in_standard_shape(client: TestClient):
    """document.id 缺失/为空时是 422，且错误体是统一形状。"""
    response = client.post("/api/scenes", json={"name": "A", "document": {"objects": []}})
    assert response.status_code == 422
    body = response.json()
    assert body["error"]["code"] == "validation_error"
    # detail 里必须能直接 JSON 序列化（错误体本身不能是坏的）
    assert isinstance(body["error"]["detail"], list)


def test_summary_uses_camel_case(client: TestClient):
    """对外字段一律 camelCase，和前端的 TS 类型对齐。"""
    client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    body = client.get("/api/scenes/a").json()
    assert set(body) == {"id", "name", "objectCount", "createdAt", "updatedAt", "document"}


def test_update_rejects_mismatched_document_id(client: TestClient):
    """路径 id 与 document.id 不一致时必须拒绝。

    照单全收的话，场景主键和文档自带的 id 会各说各话，之后再也找不回来。
    """
    client.post("/api/scenes", json={"name": "A", "document": {**DOCUMENT, "id": "a"}})
    response = client.put(
        "/api/scenes/a",
        json={"name": "A", "document": {**DOCUMENT, "id": "other"}},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "scene_id_mismatch"
    # 原场景没被动过
    assert client.get("/api/scenes/a").json()["document"]["id"] == "a"
