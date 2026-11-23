"""用户上传模型库（服务端持久化）的 HTTP 接口。

服务端只校验扩展名与大小，**不解析模型内容**——上传体用最小合法字节即可。
覆盖：上传成功（落盘+落库）、扩展名拒绝、超限拒绝（monkeypatch 上限）、
owner 隔离、列表倒序、删除（记录与文件一起消失）、文件端点的字节与类型。

落盘目录通过 monkeypatch 指向 tmp_path：测试不往真实 backend_data 里写文件。
"""

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.services import model_files

# 假 token（与真实 key 无关，只是软身份的测试替身）
OWNER = "owner-test-a"
OTHER_OWNER = "owner-test-b"

# 服务端不解析内容，任意非空字节都行；用 GLB magic 开头让文件名诚实一点
GLB_BYTES = b"glTF" + b"\x00" * 16
OBJ_BYTES = b"v 0 0 0\n"


@pytest.fixture
def models_client(client: TestClient, tmp_path, monkeypatch) -> TestClient:
    """带归属头、落盘目录指向临时目录的客户端。

    client 是函数级 fixture，改头不会漏给别的测试文件。
    """
    monkeypatch.setattr(settings, "model_uploads_output_dir", str(tmp_path / "models"))
    client.headers.update({"X-Owner-Token": OWNER})
    return client


def _upload(models_client: TestClient, *, filename: str, content: bytes, name: str):
    return models_client.post(
        "/api/models/upload",
        files={"file": (filename, content, "application/octet-stream")},
        data={"name": name, "category": "props"},
    )


def test_upload_persists_file_and_record(models_client, tmp_path):
    response = _upload(models_client, filename="demo.glb", content=GLB_BYTES, name="演示模型")
    assert response.status_code == 201, response.text

    body = response.json()
    assert len(body["id"]) == 32  # uuid4.hex
    assert body["name"] == "演示模型"
    assert body["category"] == "props"
    assert body["format"] == "glb"
    assert body["size"] == len(GLB_BYTES)
    assert body["modelUrl"] == f"/api/models/{body['id']}/file"
    assert body["createdAt"]
    # 几何信息服务端不解析：如实为 0 / False，不编造
    assert body["polyCount"] == 0
    assert body["materialCount"] == 0
    assert body["hasAnimation"] is False
    assert body["persisted"] is True

    path = tmp_path / "models" / model_files.owner_hash_of(OWNER) / f"{body['id']}.glb"
    assert path.is_file()
    assert path.read_bytes() == GLB_BYTES


def test_upload_rejects_unknown_extension(models_client):
    response = _upload(models_client, filename="note.txt", content=b"hello", name="文本")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "model_upload_invalid"


def test_upload_rejects_empty_file(models_client):
    response = _upload(models_client, filename="empty.glb", content=b"", name="空文件")
    assert response.status_code == 422, response.text
    assert response.json()["error"]["code"] == "model_upload_invalid"


def test_upload_rejects_oversize(models_client, monkeypatch):
    # 上限抽成模块常量：monkeypatch 成小值，不真造 51MB 文件
    monkeypatch.setattr("app.routers.models.MODEL_UPLOAD_MAX_BYTES", 4)
    response = _upload(models_client, filename="big.glb", content=GLB_BYTES, name="超大")
    assert response.status_code == 413, response.text
    assert response.json()["error"]["code"] == "model_upload_too_large"


def test_owner_isolation(models_client, tmp_path):
    created = _upload(models_client, filename="mine.glb", content=GLB_BYTES, name="我的")
    assert created.status_code == 201, created.text
    public_id = created.json()["id"]
    file_url = f"/api/models/{public_id}/file"

    other_headers = {"X-Owner-Token": OTHER_OWNER}

    # B 的列表里看不到 A 的模型
    other_list = models_client.get("/api/models", headers=other_headers).json()
    assert all(item["id"] != public_id for item in other_list["items"])

    # B 下载与删除 A 的模型：一律 404（越权与不存在统一口径）
    assert models_client.get(file_url, headers=other_headers).status_code == 404
    other_delete = models_client.delete(f"/api/models/{public_id}", headers=other_headers)
    assert other_delete.status_code == 404

    # A 自己看得见、下得动
    mine_list = models_client.get("/api/models").json()
    assert any(item["id"] == public_id for item in mine_list["items"])
    assert models_client.get(file_url).status_code == 200

    # 文件落在了 A 的目录里，而不是别人的
    assert (tmp_path / "models" / model_files.owner_hash_of(OWNER) / f"{public_id}.glb").is_file()


def test_list_orders_newest_first(models_client):
    first = _upload(models_client, filename="first.glb", content=GLB_BYTES, name="第一个")
    second = _upload(models_client, filename="second.glb", content=GLB_BYTES, name="第二个")
    assert first.status_code == 201 and second.status_code == 201

    items = models_client.get("/api/models").json()["items"]
    names = [item["name"] for item in items if item["name"] in ("第一个", "第二个")]
    assert names == ["第二个", "第一个"]


def test_delete_removes_record_and_file(models_client, tmp_path):
    created = _upload(models_client, filename="gone.glb", content=GLB_BYTES, name="要删的")
    public_id = created.json()["id"]
    path = tmp_path / "models" / model_files.owner_hash_of(OWNER) / f"{public_id}.glb"
    assert path.is_file()

    response = models_client.delete(f"/api/models/{public_id}")
    assert response.status_code == 204, response.text

    assert not path.exists()
    remaining = models_client.get("/api/models").json()["items"]
    assert all(item["id"] != public_id for item in remaining)
    assert models_client.get(f"/api/models/{public_id}/file").status_code == 404

    # 再删一次：已经不在 → 404
    assert models_client.delete(f"/api/models/{public_id}").status_code == 404


def test_file_endpoint_serves_bytes_and_content_type(models_client):
    glb = _upload(models_client, filename="a.glb", content=GLB_BYTES, name="GLB")
    glb_id = glb.json()["id"]

    glb_response = models_client.get(f"/api/models/{glb_id}/file")
    assert glb_response.status_code == 200
    assert glb_response.headers["content-type"].startswith("model/gltf-binary")
    assert glb_response.headers["content-disposition"].endswith(f'{glb_id}.glb"')
    assert glb_response.content == GLB_BYTES

    obj = _upload(models_client, filename="b.obj", content=OBJ_BYTES, name="OBJ")
    obj_response = models_client.get(f"/api/models/{obj.json()['id']}/file")
    assert obj_response.status_code == 200
    assert obj_response.headers["content-type"].startswith("text/plain")


def test_upload_requires_owner_token(client):
    response = client.post(
        "/api/models/upload",
        files={"file": ("a.glb", GLB_BYTES, "application/octet-stream")},
        data={"name": "匿名", "category": "props"},
    )
    assert response.status_code == 401, response.text
    assert response.json()["error"]["code"] == "owner_token_required"
