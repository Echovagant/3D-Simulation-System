"""LLM 托管服务的后端用例。

**不联网、不碰真 key**：所有对厂商的请求都打到 ``httpx.MockTransport`` 装的
假端点上（FastAPI 依赖覆盖注入）。测试里出现的 key 全是假的。
"""

from __future__ import annotations

import json
import logging
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, inspect
from sqlalchemy.orm import Session

from app.config import settings
from app.db import Base, SessionLocal
from app.models import LlmCallAudit, LlmKeyVault
from app.services import key_vault, llm_proxy

OWNER = "owner-token-under-test"
OTHER_OWNER = "owner-token-other"
BACKEND_DIR = Path(__file__).resolve().parent.parent


class FakeProvider:
    """假厂商端点。

    接住所有对厂商的请求，把地址、头与请求体记下来，按剧本回响应。
    """

    def __init__(self, client: TestClient) -> None:
        self._client = client
        self.requests: list[httpx.Request] = []
        self.bodies: list[dict[str, Any]] = []

    def install(self, handler: Any) -> FakeProvider:
        def wrapped(request: httpx.Request) -> httpx.Response:
            self.requests.append(request)
            try:
                self.bodies.append(json.loads(request.content.decode("utf-8")))
            except ValueError:
                self.bodies.append({})
            return handler(request)

        transport = httpx.MockTransport(wrapped)
        self._client.app.dependency_overrides[llm_proxy.get_transport] = lambda: transport
        return self

    @property
    def count(self) -> int:
        return len(self.requests)


def _json_response(payload: dict[str, Any], status_code: int = 200) -> httpx.Response:
    return httpx.Response(status_code, json=payload)


def _ok_openai(content: str = "ok") -> httpx.Response:
    return _json_response({"choices": [{"message": {"content": content}}]})


@pytest.fixture(autouse=True)
def _isolate(monkeypatch: pytest.MonkeyPatch) -> Any:
    """每个用例从干净的 KEK 缓存与 host 模式开始。"""
    key_vault.clear_kek_cache()
    monkeypatch.setattr(settings, "llm_key_master_key", "unit-test-master-key")
    yield
    key_vault.clear_kek_cache()


@pytest.fixture
def fake_provider(client: TestClient) -> Any:
    provider = FakeProvider(client)
    yield provider
    client.app.dependency_overrides.clear()


def _headers(owner: str = OWNER) -> dict[str, str]:
    return {"X-Owner-Token": owner}


def _store_key(
    client: TestClient,
    provider_id: str = "minimax",
    api_key: str = "sk-unit-test",
    passphrase: str | None = None,
) -> None:
    body: dict[str, Any] = {"providerId": provider_id, "apiKey": api_key}
    if passphrase is not None:
        body["passphrase"] = passphrase
    response = client.post("/api/llm/keys", json=body, headers=_headers())
    assert response.status_code == 201, response.text


def _complete(client: TestClient, payload: dict[str, Any], owner: str = OWNER) -> httpx.Response:
    return client.post("/api/llm/complete", json=payload, headers=_headers(owner))


# --------------------------------------------------------------------------
# 健康与配置读取
# --------------------------------------------------------------------------


def test_health_endpoint_ok(client: TestClient) -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_keys_list_reports_configured_state(client: TestClient) -> None:
    response = client.get("/api/llm/keys", headers=_headers())
    assert response.status_code == 200
    entries = {entry["providerId"]: entry for entry in response.json()}
    assert set(entries) == {provider.id for provider in llm_proxy.PROVIDERS}
    assert all(entry["configured"] is False for entry in entries.values())

    _store_key(client, "minimax")

    entries = {
        entry["providerId"]: entry
        for entry in client.get("/api/llm/keys", headers=_headers()).json()
    }
    assert entries["minimax"]["configured"] is True
    assert entries["minimax"]["updatedAt"] is not None
    assert entries["zhipu"]["configured"] is False
    assert entries["zhipu"]["updatedAt"] is None


def test_quota_endpoint_reports_limit_and_reset(client: TestClient) -> None:
    body = client.get("/api/llm/quota", headers=_headers()).json()
    assert body["limit"] == settings.llm_quota_per_day
    assert body["used"] == 0
    assert body["remaining"] == body["limit"]
    assert body["resetAt"]


# --------------------------------------------------------------------------
# 错误形状与软身份
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("GET", "/api/llm/keys", None),
        ("POST", "/api/llm/keys", {"providerId": "minimax", "apiKey": "sk-x"}),
        ("DELETE", "/api/llm/keys/minimax", None),
        ("POST", "/api/llm/complete", {"messages": [{"role": "user", "content": "hi"}]}),
        ("GET", "/api/llm/quota", None),
        ("GET", "/api/llm/audit", None),
    ],
)
def test_owner_token_required(
    client: TestClient, method: str, path: str, body: dict[str, Any] | None
) -> None:
    response = client.request(method, path, json=body)
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "owner_token_required"


def test_error_shape_is_uniform(client: TestClient) -> None:
    body = client.get("/api/llm/keys").json()
    assert set(body) == {"error"}
    assert set(body["error"]) == {"code", "message", "detail"}


# --------------------------------------------------------------------------
# 密钥托管
# --------------------------------------------------------------------------


def test_unknown_provider_is_rejected(client: TestClient) -> None:
    response = client.post(
        "/api/llm/keys",
        json={"providerId": "not-a-provider", "apiKey": "sk-x"},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "llm_invalid_request"


def test_passphrase_required_without_master_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_key_master_key", "")
    response = client.post(
        "/api/llm/keys",
        json={"providerId": "minimax", "apiKey": "sk-x"},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "passphrase_required"


def test_passphrase_accepted_without_master_key(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_key_master_key", "")
    response = client.post(
        "/api/llm/keys",
        json={"providerId": "minimax", "apiKey": "sk-x", "passphrase": "correct horse"},
        headers=_headers(),
    )
    assert response.status_code == 201
    assert response.json() == {"providerId": "minimax", "configured": True}


def test_host_mode_needs_no_passphrase(client: TestClient) -> None:
    response = client.post(
        "/api/llm/keys",
        json={"providerId": "minimax", "apiKey": "sk-x"},
        headers=_headers(),
    )
    assert response.status_code == 201


def test_delete_key_then_missing(client: TestClient) -> None:
    _store_key(client, "minimax")

    response = client.delete("/api/llm/keys/minimax", headers=_headers())
    assert response.status_code == 204

    response = client.delete("/api/llm/keys/minimax", headers=_headers())
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "llm_key_missing"


# --------------------------------------------------------------------------
# 三族协议
# --------------------------------------------------------------------------


def test_complete_openai_success(client: TestClient, fake_provider: FakeProvider) -> None:
    fake_provider.install(
        lambda request: _json_response(
            {
                "choices": [{"message": {"content": "  hello  "}}],
                "usage": {"prompt_tokens": 11, "completion_tokens": 7},
            }
        )
    )
    _store_key(client, "minimax", api_key="sk-openai-test")

    response = _complete(
        client,
        {
            "providerId": "minimax",
            "model": "MiniMax-M3.1-Flash",
            "messages": [
                {"role": "system", "content": "be terse"},
                {"role": "user", "content": "hi"},
            ],
            "maxTokens": 256,
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "hello"
    assert body["providerId"] == "minimax"
    assert body["model"] == "MiniMax-M3.1-Flash"
    assert body["usage"] == {"promptTokens": 11, "completionTokens": 7}

    request = fake_provider.requests[0]
    assert request.url.host == "api.minimax.io"
    assert request.url.path == "/v1/chat/completions"
    assert request.headers["authorization"] == "Bearer sk-openai-test"

    sent = fake_provider.bodies[0]
    assert sent["model"] == "MiniMax-M3.1-Flash"
    assert sent["max_completion_tokens"] == 256
    assert sent["messages"] == [
        {"role": "system", "content": "be terse"},
        {"role": "user", "content": "hi"},
    ]


def test_reasoning_effort_only_for_flagged_providers(
    client: TestClient, fake_provider: FakeProvider
) -> None:
    """只有清单里标注了 reasoning_effort 的厂商才带这个字段。"""
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "minimax")
    assert (
        _complete(
            client,
            {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
        ).status_code
        == 200
    )
    assert fake_provider.bodies[0]["reasoning_effort"] == "low"

    fake_provider.bodies.clear()
    _store_key(client, "zhipu")
    assert (
        _complete(
            client,
            {"providerId": "zhipu", "messages": [{"role": "user", "content": "hi"}]},
        ).status_code
        == 200
    )
    assert "reasoning_effort" not in fake_provider.bodies[0]


def test_complete_anthropic_success(client: TestClient, fake_provider: FakeProvider) -> None:
    fake_provider.install(
        lambda request: _json_response(
            {
                "content": [
                    {"type": "text", "text": "part one"},
                    {"type": "text", "text": "part two"},
                ],
                "usage": {"input_tokens": 5, "output_tokens": 9},
            }
        )
    )
    _store_key(client, "anthropic", api_key="sk-anthropic-test")  # secret-scan: allow

    response = _complete(
        client,
        {
            "providerId": "anthropic",
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hi"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "part one\npart two"
    assert body["providerId"] == "anthropic"
    assert body["usage"] == {"promptTokens": 5, "completionTokens": 9}

    request = fake_provider.requests[0]
    assert request.url.path == "/v1/messages"
    assert request.headers["x-api-key"] == "sk-anthropic-test"
    assert request.headers["anthropic-version"] == "2023-06-01"

    sent = fake_provider.bodies[0]
    assert sent["max_tokens"] == 512
    assert sent["system"] == "sys"
    assert sent["messages"] == [{"role": "user", "content": "hi"}]


def test_complete_gemini_success(client: TestClient, fake_provider: FakeProvider) -> None:
    fake_provider.install(lambda request: _json_response({"output_text": "  gem says hi  "}))
    _store_key(client, "gemini", api_key="sk-gemini-test")

    response = _complete(
        client,
        {
            "providerId": "gemini",
            "messages": [
                {"role": "system", "content": "sys"},
                {"role": "user", "content": "hi"},
            ],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == "gem says hi"
    assert body["providerId"] == "gemini"

    request = fake_provider.requests[0]
    assert request.url.path == "/v1beta/interactions"
    assert request.headers["x-goog-api-key"] == "sk-gemini-test"

    sent = fake_provider.bodies[0]
    assert sent["input"] == "user: hi"
    assert sent["system_instruction"] == "sys"
    assert sent["generation_config"] == {"thinking_level": "low"}


# --------------------------------------------------------------------------
# 校验、缺 key、配额
# --------------------------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [
        {"messages": []},
        {"messages": [{"role": "user", "content": "hi"}], "maxTokens": 999999},
        {"providerId": "not-a-provider", "messages": [{"role": "user", "content": "hi"}]},
        {"messages": [{"role": "wizard", "content": "hi"}]},
    ],
)
def test_invalid_request(client: TestClient, payload: dict[str, Any]) -> None:
    response = _complete(client, payload)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "llm_invalid_request"


def test_complete_without_key_is_404(client: TestClient, fake_provider: FakeProvider) -> None:
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "deepseek")

    response = _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "llm_key_missing"
    # 点名的厂商没配 key 不该偷偷换一家——那会花用户的钱。
    assert fake_provider.count == 0


def test_quota_exceeded_does_not_call_provider(
    client: TestClient, fake_provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_quota_per_day", 1)
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "minimax")

    first = _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert first.status_code == 200
    assert fake_provider.count == 1

    second = _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "again"}]},
    )
    assert second.status_code == 429
    error = second.json()["error"]
    assert error["code"] == "llm_quota_exceeded"
    assert error["detail"]["limit"] == 1
    assert error["detail"]["used"] == 1
    assert error["detail"]["remaining"] == 0
    assert error["detail"]["resetAt"]
    # 额度用满**不该**打厂商。
    assert fake_provider.count == 1


# --------------------------------------------------------------------------
# 故障转移
# --------------------------------------------------------------------------


def test_failover_to_next_provider(
    client: TestClient, fake_provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_fallback_order", ["minimax", "deepseek"])

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.minimax.io":
            return _json_response({"error": {"message": "boom"}}, status_code=500)
        return _ok_openai("from deepseek")

    fake_provider.install(handler)
    _store_key(client, "minimax")
    _store_key(client, "deepseek")

    response = _complete(client, {"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 200
    body = response.json()
    # 响应里的 providerId 是**实际答上那家**
    assert body["providerId"] == "deepseek"
    assert body["content"] == "from deepseek"
    assert fake_provider.count == 2

    calls = client.get("/api/llm/audit", headers=_headers()).json()["calls"]
    assert len(calls) == 2
    assert {call["providerId"] for call in calls} == {"minimax", "deepseek"}
    assert {call["ok"] for call in calls} == {True, False}


def test_client_error_does_not_fail_over(
    client: TestClient, fake_provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_fallback_order", ["minimax", "deepseek"])
    fake_provider.install(
        lambda request: _json_response({"error": {"message": "bad request"}}, status_code=400)
    )
    _store_key(client, "minimax")
    _store_key(client, "deepseek")

    response = _complete(client, {"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 502
    assert response.json()["error"]["code"] == "llm_upstream_failed"
    # 厂商回 4xx（除 429）是请求本身的问题，换家也一样错。
    assert fake_provider.count == 1


def test_rate_limit_fails_over(
    client: TestClient, fake_provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_fallback_order", ["minimax", "deepseek"])

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "api.minimax.io":
            return _json_response({"error": {"message": "slow down"}}, status_code=429)
        return _ok_openai("second")

    fake_provider.install(handler)
    _store_key(client, "minimax")
    _store_key(client, "deepseek")

    response = _complete(client, {"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 200
    assert response.json()["providerId"] == "deepseek"
    assert fake_provider.count == 2


def test_all_candidates_fail(
    client: TestClient, fake_provider: FakeProvider, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(settings, "llm_fallback_order", ["minimax", "deepseek"])
    fake_provider.install(
        lambda request: _json_response({"error": {"message": "boom"}}, status_code=503)
    )
    _store_key(client, "minimax")
    _store_key(client, "deepseek")

    response = _complete(client, {"messages": [{"role": "user", "content": "hi"}]})
    assert response.status_code == 502
    error = response.json()["error"]
    assert error["code"] == "llm_provider_failed"
    attempts = error["detail"]["attempts"]
    assert len(attempts) == 2
    assert {attempt["providerId"] for attempt in attempts} == {"minimax", "deepseek"}
    assert fake_provider.count == 2


# --------------------------------------------------------------------------
# 审计
# --------------------------------------------------------------------------


def test_audit_lists_only_own_calls(client: TestClient, fake_provider: FakeProvider) -> None:
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "minimax")
    _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
    )

    calls = client.get("/api/llm/audit", headers=_headers()).json()["calls"]
    assert len(calls) == 1
    assert calls[0]["providerId"] == "minimax"
    assert calls[0]["model"] == "MiniMax-M3.1-Flash"
    assert calls[0]["ok"] is True
    assert calls[0]["errorCode"] is None
    assert calls[0]["latencyMs"] >= 0
    assert calls[0]["ts"]

    other = client.get("/api/llm/audit", headers=_headers(OTHER_OWNER)).json()["calls"]
    assert other == []


# --------------------------------------------------------------------------
# 服务端不持明文 key
# --------------------------------------------------------------------------


def test_plaintext_key_absent_from_responses_and_logs(
    client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    secret = "sk-live-SUPERSECRET-0123456789abcdef"  # secret-scan: allow

    with caplog.at_level(logging.DEBUG):
        _store_key(client, "minimax", api_key=secret)
        listing = client.get("/api/llm/keys", headers=_headers())
        assert secret not in listing.text

    assert secret not in caplog.text


def test_plaintext_key_absent_from_database_file(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """把库文件整个翻一遍，搜不到明文 key。

    表里也**根本没有**明文列——不是约定，是列不存在。
    """
    monkeypatch.setattr(settings, "llm_key_master_key", "")
    secret = "sk-live-SUPERSECRET-0123456789abcdef"  # secret-scan: allow

    db_path = tmp_path / "vault.db"
    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    Base.metadata.create_all(bind=engine)
    try:
        with Session(engine) as session:
            row = key_vault.store_key(session, OWNER, "minimax", secret, passphrase="pw")
            assert row.kdf == "argon2id"
            assert row.ciphertext != secret
    finally:
        engine.dispose()

    assert secret.encode("utf-8") not in db_path.read_bytes()

    columns = {column.name for column in Base.metadata.tables["llm_key_vault"].columns}
    assert columns == {
        "provider_id",
        "owner_token",
        "ciphertext",
        "nonce",
        "salt",
        "kdf",
        "created_at",
        "updated_at",
    }
    assert "api_key" not in columns


def test_upstream_error_echoing_key_is_redacted(
    client: TestClient, fake_provider: FakeProvider
) -> None:
    secret = "sk-live-SUPERSECRET-0123456789abcdef"  # secret-scan: allow
    fake_provider.install(
        lambda request: _json_response(
            {"error": {"message": f"invalid api key {secret}"}}, status_code=400
        )
    )
    _store_key(client, "minimax", api_key=secret)

    response = _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
    )
    assert response.status_code == 502
    assert secret not in response.text


def test_audit_rows_hold_no_secret(client: TestClient, fake_provider: FakeProvider) -> None:
    secret = "sk-live-SUPERSECRET-0123456789abcdef"  # secret-scan: allow
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "minimax", api_key=secret)
    _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
    )

    listing = client.get("/api/llm/audit", headers=_headers())
    assert secret not in listing.text

    with SessionLocal() as session:
        rows = session.query(LlmCallAudit).all()
        assert rows
        for row in rows:
            assert secret not in repr(row.__dict__)


# --------------------------------------------------------------------------
# 迁移与模型一致
# --------------------------------------------------------------------------


def test_migration_creates_the_new_tables(tmp_path: Path) -> None:
    db_path = tmp_path / "migrated.db"
    env = dict(os.environ)
    env["BACKEND_DATABASE_URL"] = f"sqlite:///{db_path.as_posix()}"
    env["PYTHONUTF8"] = "1"
    subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env=env,
        check=True,
        capture_output=True,
    )

    engine = create_engine(f"sqlite:///{db_path.as_posix()}")
    try:
        inspector = inspect(engine)
        tables = set(inspector.get_table_names())
        assert {"llm_key_vault", "llm_call_audit"} <= tables
        for model in (LlmKeyVault, LlmCallAudit):
            migrated = {column["name"] for column in inspector.get_columns(model.__tablename__)}
            modeled = set(model.__table__.columns.keys())
            assert migrated == modeled, f"{model.__tablename__} 的列对不上"
    finally:
        engine.dispose()


def test_two_owners_do_not_overwrite_each_others_key(
    client: TestClient, fake_provider: FakeProvider
) -> None:
    """同一家厂商、不同 owner：两把 key 互不覆盖。

    密钥表的主键是 (provider_id, owner_token)。若只按 provider_id 找行，
    B 托管时会命中 A 那一行——A 的密钥被覆盖，归属也被改成 B。
    """
    fake_provider.install(lambda request: _ok_openai())

    body_a = {"providerId": "minimax", "apiKey": "sk-owner-a"}
    body_b = {"providerId": "minimax", "apiKey": "sk-owner-b"}
    assert client.post("/api/llm/keys", json=body_a, headers=_headers("owner-a")).status_code == 201
    assert client.post("/api/llm/keys", json=body_b, headers=_headers("owner-b")).status_code == 201

    with SessionLocal() as session:
        rows = session.query(LlmKeyVault).all()

    assert len(rows) == 2
    assert {row.owner_token for row in rows} == {"owner-a", "owner-b"}
    assert {row.provider_id for row in rows} == {"minimax"}

    # A 用的仍然是自己那把 key——说明 A 那一行没被动过
    fake_provider.requests.clear()
    response = _complete(
        client,
        {"providerId": "minimax", "messages": [{"role": "user", "content": "hi"}]},
        owner="owner-a",
    )
    assert response.status_code == 200
    assert fake_provider.requests[0].headers["authorization"] == "Bearer sk-owner-a"
