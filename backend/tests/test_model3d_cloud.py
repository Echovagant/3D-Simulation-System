"""云端「生成 3D」适配器的后端用例。

**不联网、不碰真 key**：所有对供应商的请求都打到 ``httpx.MockTransport`` 装的
假端点上（FastAPI 依赖覆盖注入）。测试里出现的 SecretId/SecretKey/API Key 全是假的。
"""

from __future__ import annotations

import io
import json
import zipfile
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.services import key_vault, model3d_cloud

OWNER = "owner-token-under-test"
OTHER_OWNER = "owner-token-other"

# 假密钥（只用于断言脱敏与签名形状；sk- 后缀压在扫描阈值内）
SECRET_ID = "unit-secret-id"
SECRET_KEY = "unit-secret-key-value-123"
BAILIAN_KEY = "sk-unit-test"


class FakeCloud:
    """假供应商端点：接住所有请求，按剧本回响应。"""

    def __init__(self, client: TestClient) -> None:
        self._client = client
        self.requests: list[httpx.Request] = []
        self.bodies: list[dict[str, Any]] = []

    def install(self, handler: Any) -> FakeCloud:
        def wrapped(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            try:
                self.bodies.append(json.loads(request.content.decode("utf-8")))
            except ValueError:
                self.bodies.append({})
            return handler(request)

        transport = httpx.MockTransport(wrapped)
        self._client.app.dependency_overrides[model3d_cloud.get_transport] = lambda: transport
        return self


@pytest.fixture(autouse=True)
def _isolate(monkeypatch: pytest.MonkeyPatch) -> Any:
    """每个用例从干净的 KEK 缓存与 host 模式开始（与 LLM 托管测试同一约定）。"""
    key_vault.clear_kek_cache()
    monkeypatch.setattr(settings, "llm_key_master_key", "unit-test-master-key")
    yield
    key_vault.clear_kek_cache()


@pytest.fixture
def fake_cloud(client: TestClient) -> Any:
    cloud = FakeCloud(client)
    yield cloud
    client.app.dependency_overrides.clear()


def _headers(owner: str = OWNER) -> dict[str, str]:
    return {"X-Owner-Token": owner}


def _store_hunyuan_key(client: TestClient) -> None:
    response = client.post(
        "/api/model3d/keys",
        json={"providerId": "hunyuan3d", "secretId": SECRET_ID, "secretKey": SECRET_KEY},
        headers=_headers(),
    )
    assert response.status_code == 201, response.text


def _store_bailian_key(client: TestClient, workspace_id: str | None = None) -> None:
    body: dict[str, Any] = {"providerId": "bailian-tripo", "apiKey": BAILIAN_KEY}
    if workspace_id:
        body["workspaceId"] = workspace_id
    response = client.post("/api/model3d/keys", json=body, headers=_headers())
    assert response.status_code == 201, response.text


def _submit_job(client: TestClient, **data: Any) -> Any:
    """提交一个任务；files/data 由调用方给。"""
    return client.post("/api/model3d/cloud/jobs", data=data, headers=_headers())


def _job_detail(client: TestClient, job_id: str, owner: str = OWNER) -> dict[str, Any]:
    response = client.get(f"/api/model3d/cloud/jobs/{job_id}", headers=_headers(owner))
    assert response.status_code == 200, response.text
    return response.json()


# 混元的假端点剧本（提交 → 查询 → 下载全在一个 handler 里路由）


def _hunyuan_handler(
    query_status: str,
    files: Any,
    *,
    query_extra: dict[str, Any] | None = None,
) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        action = request.headers.get("x-tc-action")
        if action == model3d_cloud.HUNYUAN_SUBMIT_ACTION:
            return httpx.Response(
                200,
                json={"Response": {"JobId": "hy-job-123", "RequestId": "req-1"}},
            )
        if action == model3d_cloud.HUNYUAN_QUERY_ACTION:
            payload: dict[str, Any] = {
                "Status": query_status,
                "ErrorCode": "" if query_status == "DONE" else "OperationFailed",
                "ErrorMessage": ""
                if query_status == "DONE"
                else f"生成失败，密钥 {SECRET_KEY} 不对",
                "RequestId": "req-2",
            }
            if files is not None and query_status == "DONE":
                payload["ResultFile3Ds"] = files
            if query_extra:
                payload.update(query_extra)
            return httpx.Response(200, json={"Response": payload})
        # 产物下载
        return httpx.Response(200, content=b"glTF-fake-bytes")

    return handler


def _bailian_handler(task_status: str, results: Any) -> Any:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/3d-generation"):
            return httpx.Response(
                200,
                json={
                    "output": {
                        "task_id": "ds-task-1",
                        "task_status": "PENDING",
                    },
                    "request_id": "r1",
                },
            )
        if "/api/v1/tasks/" in request.url.path:
            payload: dict[str, Any] = {"task_id": "ds-task-1", "task_status": task_status}
            if task_status == "FAILED":
                payload["code"] = "InvalidParameter"
                payload["message"] = f"参数不对，key {BAILIAN_KEY} 无效"
            if results is not None and task_status == "SUCCEEDED":
                payload["results"] = results
            return httpx.Response(200, json={"request_id": "r2", "output": payload})
        return httpx.Response(200, content=b"glTF-fake-bytes")

    return handler


# --------------------------------------------------------------------------
# 目录与密钥
# --------------------------------------------------------------------------


def test_providers_catalog_is_honest(client: TestClient) -> None:
    response = client.get("/api/model3d/providers", headers=_headers())
    assert response.status_code == 200
    entries = {entry["providerId"]: entry for entry in response.json()}

    assert set(entries) == {"hunyuan3d", "bailian-tripo", "rodin"}
    assert entries["hunyuan3d"]["available"] is True
    assert entries["hunyuan3d"]["supportsImageUpload"] is True
    assert entries["hunyuan3d"]["configured"] is False
    # 百炼不收上传文件——这是调研验证过的硬限制，必须如实标出
    assert entries["bailian-tripo"]["supportsImageUpload"] is False
    assert "未验证" in (entries["bailian-tripo"]["licenseNote"] or "")
    # Rodin 免费档没有 API——条目保留作对比，但不可用
    assert entries["rodin"]["available"] is False
    assert entries["rodin"]["freeTier"]


def test_keys_list_reports_configured_state(client: TestClient) -> None:
    assert client.get("/api/model3d/keys", headers=_headers()).status_code == 200
    _store_hunyuan_key(client)
    response = client.get("/api/model3d/keys", headers=_headers())
    entries = {entry["providerId"]: entry for entry in response.json()}
    assert entries["hunyuan3d"]["configured"] is True
    assert entries["bailian-tripo"]["configured"] is False
    assert entries["rodin"]["configured"] is False
    # 绝不回任何密钥材料
    assert "ciphertext" not in json.dumps(response.json())


def test_hunyuan_key_requires_the_pair(client: TestClient) -> None:
    response = client.post(
        "/api/model3d/keys",
        json={"providerId": "hunyuan3d", "secretId": SECRET_ID},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == model3d_cloud.KEY_INVALID


def test_bailian_key_rejects_non_sk_credentials(client: TestClient) -> None:
    response = client.post(
        "/api/model3d/keys",
        json={"providerId": "bailian-tripo", "apiKey": "AKID-legacy-dashscope"},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert "sk-" in response.json()["error"]["message"]


def test_bailian_key_accepts_workspace_id(client: TestClient) -> None:
    _store_bailian_key(client, workspace_id="ws-example-1")
    entries = {
        entry["providerId"]: entry
        for entry in client.get("/api/model3d/keys", headers=_headers()).json()
    }
    assert entries["bailian-tripo"]["configured"] is True


def test_rodin_key_is_rejected_with_a_reason(client: TestClient) -> None:
    response = client.post(
        "/api/model3d/keys",
        json={"providerId": "rodin", "apiKey": "rodin-example"},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == model3d_cloud.PROVIDER_UNAVAILABLE


def test_delete_key_then_report_missing(client: TestClient) -> None:
    _store_hunyuan_key(client)
    assert client.delete("/api/model3d/keys/hunyuan3d", headers=_headers()).status_code == 204
    response = client.delete("/api/model3d/keys/hunyuan3d", headers=_headers())
    assert response.status_code == 404


# --------------------------------------------------------------------------
# 混元生 3D：签名形状与任务流
# --------------------------------------------------------------------------


def test_hunyuan_tc3_signature_and_full_flow(client: TestClient, fake_cloud: FakeCloud) -> None:
    fake_cloud.install(
        _hunyuan_handler(
            "DONE",
            [
                {"Type": "OBJ", "Url": "https://cos.example.com/mesh.zip"},
                {"Type": "GLB", "Url": "https://cos.example.com/mesh.glb"},
            ],
        )
    )
    _store_hunyuan_key(client)

    response = _submit_job(client, providerId="hunyuan3d", prompt="一只小猫")
    assert response.status_code == 202, response.text
    job_id = response.json()["jobId"]

    detail = _job_detail(client, job_id)
    assert detail["status"] == "succeeded"
    assert detail["remoteTaskId"] == "hy-job-123"
    assert detail["artifactUrl"] == f"/api/model3d/cloud/jobs/{job_id}/model.glb"

    submit, query, download = fake_cloud.requests
    # TC3 签名的形状：凭据串、签名头清单、Action/Version/Region 全部就位
    assert submit.url.host == "ai3d.tencentcloudapi.com"
    assert submit.headers["X-TC-Action"] == "SubmitHunyuanTo3DProJob"
    assert submit.headers["X-TC-Version"] == "2025-05-13"
    assert submit.headers["X-TC-Region"] == "ap-guangzhou"
    auth = submit.headers["Authorization"]
    assert auth.startswith(f"TC3-HMAC-SHA256 Credential={SECRET_ID}/")
    assert "/ai3d/tc3_request" in auth
    assert "SignedHeaders=content-type;host;x-tc-action" in auth
    assert fake_cloud.bodies[0] == {"Prompt": "一只小猫"}
    assert query.headers["X-TC-Action"] == "QueryHunyuanTo3DProJob"
    assert fake_cloud.bodies[1] == {"JobId": "hy-job-123"}
    # 产物下载不带任何密钥材料
    assert "authorization" not in {k.lower() for k in download.headers}

    model = client.get(f"/api/model3d/cloud/jobs/{job_id}/model.glb", headers=_headers())
    assert model.status_code == 200
    assert model.content.startswith(b"glTF")


def test_hunyuan_image_upload_goes_as_base64(client: TestClient, fake_cloud: FakeCloud) -> None:
    fake_cloud.install(
        _hunyuan_handler("DONE", [{"Type": "GLB", "Url": "https://cos.example.com/mesh.glb"}])
    )
    _store_hunyuan_key(client)

    png = b"\x89PNG-fake-image-bytes"
    response = client.post(
        "/api/model3d/cloud/jobs",
        data={"providerId": "hunyuan3d", "label": "椅子"},
        files={"image": ("chair.png", png, "image/png")},
        headers=_headers(),
    )
    assert response.status_code == 202, response.text
    job_id = response.json()["jobId"]

    assert _job_detail(client, job_id)["status"] == "succeeded"
    import base64 as b64

    assert fake_cloud.bodies[0] == {"ImageBase64": b64.b64encode(png).decode("ascii")}


def test_hunyuan_zip_artifact_is_unpacked_and_converted(
    client: TestClient, fake_cloud: FakeCloud
) -> None:
    """混元的产物是 ZIP（官方示例就是 .zip）——抽 OBJ 转 GLB 也要走得通。"""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("mesh.obj", "v 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n")
    zip_bytes = buffer.getvalue()

    def handler(request: httpx.Request) -> httpx.Response:
        action = request.headers.get("x-tc-action")
        if action == model3d_cloud.HUNYUAN_SUBMIT_ACTION:
            return httpx.Response(200, json={"Response": {"JobId": "hy-zip-1"}})
        if action == model3d_cloud.HUNYUAN_QUERY_ACTION:
            return httpx.Response(
                200,
                json={
                    "Response": {
                        "Status": "DONE",
                        "ResultFile3Ds": [
                            {"Type": "OBJ", "Url": "https://cos.example.com/mesh.zip"}
                        ],
                    }
                },
            )
        return httpx.Response(200, content=zip_bytes)

    fake_cloud.install(handler)
    _store_hunyuan_key(client)

    response = _submit_job(client, providerId="hunyuan3d", prompt="一个方块")
    job_id = response.json()["jobId"]
    assert _job_detail(client, job_id)["status"] == "succeeded"

    model = client.get(f"/api/model3d/cloud/jobs/{job_id}/model.glb", headers=_headers())
    assert model.status_code == 200
    assert model.content.startswith(b"glTF")


def test_hunyuan_fail_status_marks_job_failed_and_redacts(
    client: TestClient, fake_cloud: FakeCloud
) -> None:
    fake_cloud.install(_hunyuan_handler("FAIL", None))
    _store_hunyuan_key(client)

    response = _submit_job(client, providerId="hunyuan3d", prompt="一只小猫")
    job_id = response.json()["jobId"]
    detail = _job_detail(client, job_id)
    assert detail["status"] == "failed"
    assert detail["errorCode"] == model3d_cloud.GENERATION_FAILED
    # 明文 SecretKey 绝不出现在任何错误信息里
    assert SECRET_KEY not in detail["error"]


def test_hunyuan_missing_key_fails_honestly(client: TestClient, fake_cloud: FakeCloud) -> None:
    fake_cloud.install(_hunyuan_handler("DONE", None))

    response = _submit_job(client, providerId="hunyuan3d", prompt="一只小猫")
    job_id = response.json()["jobId"]
    detail = _job_detail(client, job_id)
    assert detail["status"] == "failed"
    assert detail["errorCode"] == model3d_cloud.KEY_MISSING


# --------------------------------------------------------------------------
# 百炼 Tripo：异步任务流与输入限制
# --------------------------------------------------------------------------


def test_bailian_prompt_job_full_flow(client: TestClient, fake_cloud: FakeCloud) -> None:
    fake_cloud.install(
        _bailian_handler(
            "SUCCEEDED",
            [
                {
                    "pbr_model_url": "https://openapi.cdn.tripo3d.com/mesh.glb",
                    "rendered_image_url": "x.webp",
                }
            ],
        )
    )
    _store_bailian_key(client)

    response = _submit_job(client, providerId="bailian-tripo", prompt="一只可爱的猫")
    assert response.status_code == 202, response.text
    job_id = response.json()["jobId"]

    assert _job_detail(client, job_id)["status"] == "succeeded"

    create_request = fake_cloud.requests[0]
    assert create_request.url.host == "dashscope.aliyuncs.com"
    assert create_request.headers["x-dashscope-async"] == "enable"
    assert create_request.headers["authorization"] == f"Bearer {BAILIAN_KEY}"
    assert fake_cloud.bodies[0]["model"] == "Tripo/Tripo-H3.1"
    assert fake_cloud.bodies[0]["input"] == {"prompt": "一只可爱的猫"}


def test_bailian_image_url_flow(client: TestClient, fake_cloud: FakeCloud) -> None:
    fake_cloud.install(
        _bailian_handler(
            "SUCCEEDED", [{"pbr_model_url": "https://openapi.cdn.tripo3d.com/mesh.glb"}]
        )
    )
    _store_bailian_key(client)

    response = _submit_job(
        client,
        providerId="bailian-tripo",
        imageUrl="https://example.com/cat.jpg",
    )
    job_id = response.json()["jobId"]
    assert _job_detail(client, job_id)["status"] == "succeeded"
    assert fake_cloud.bodies[0]["input"] == {"image": "https://example.com/cat.jpg"}


def test_bailian_image_upload_is_rejected_up_front(client: TestClient) -> None:
    _store_bailian_key(client)
    response = client.post(
        "/api/model3d/cloud/jobs",
        data={"providerId": "bailian-tripo"},
        files={"image": ("cat.png", b"\x89PNG", "image/png")},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == model3d_cloud.IMAGE_UPLOAD_UNSUPPORTED


def test_bailian_failed_task_marks_job_failed_and_redacts(
    client: TestClient, fake_cloud: FakeCloud
) -> None:
    fake_cloud.install(_bailian_handler("FAILED", None))
    _store_bailian_key(client)

    response = _submit_job(client, providerId="bailian-tripo", prompt="一只猫")
    job_id = response.json()["jobId"]
    detail = _job_detail(client, job_id)
    assert detail["status"] == "failed"
    assert BAILIAN_KEY not in detail["error"]


# --------------------------------------------------------------------------
# 提交入口的通用校验
# --------------------------------------------------------------------------


def test_input_must_be_exactly_one(client: TestClient) -> None:
    _store_hunyuan_key(client)
    both = _submit_job(
        client,
        providerId="hunyuan3d",
        prompt="一只小猫",
        imageUrl="https://example.com/cat.jpg",
    )
    assert both.status_code == 422
    assert both.json()["error"]["code"] == model3d_cloud.INPUT_INVALID

    none = _submit_job(client, providerId="hunyuan3d")
    assert none.status_code == 422


def test_image_url_must_be_http(client: TestClient) -> None:
    _store_hunyuan_key(client)
    response = _submit_job(client, providerId="hunyuan3d", imageUrl="ftp://example.com/cat.jpg")
    assert response.status_code == 422


def test_unknown_provider_is_rejected(client: TestClient) -> None:
    response = _submit_job(client, providerId="meshy", prompt="一只猫")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == model3d_cloud.PROVIDER_UNKNOWN


def test_owner_cannot_see_anothers_job(client: TestClient, fake_cloud: FakeCloud) -> None:
    fake_cloud.install(
        _hunyuan_handler("DONE", [{"Type": "GLB", "Url": "https://cos.example.com/m.glb"}])
    )
    _store_hunyuan_key(client)
    job_id = _submit_job(client, providerId="hunyuan3d", prompt="一只小猫").json()["jobId"]

    other_detail = client.get(f"/api/model3d/cloud/jobs/{job_id}", headers=_headers(OTHER_OWNER))
    assert other_detail.status_code == 404

    other_list = client.get("/api/model3d/cloud/jobs", headers=_headers(OTHER_OWNER))
    assert other_list.json() == []

    other_model = client.get(
        f"/api/model3d/cloud/jobs/{job_id}/model.glb",
        headers=_headers(OTHER_OWNER),
    )
    assert other_model.status_code == 404


def test_daily_quota_blocks_the_burn(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(settings, "model3d_max_jobs_per_day", 0)
    _store_hunyuan_key(client)
    response = _submit_job(client, providerId="hunyuan3d", prompt="一只小猫")
    assert response.status_code == 429
    assert response.json()["error"]["code"] == model3d_cloud.QUOTA_EXCEEDED


def test_owner_token_is_required(client: TestClient) -> None:
    response = client.get("/api/model3d/providers")
    assert response.status_code == 401
