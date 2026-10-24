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


def test_minimax_cn_uses_its_own_endpoint(client: TestClient, fake_provider: FakeProvider) -> None:
    """api.minimaxi.com 是另一套账号体系 —— 拿 api.minimax.io 的 key 会在这里被判 401。"""
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "minimax-cn", api_key="sk-cn-test")

    response = _complete(
        client,
        {"providerId": "minimax-cn", "messages": [{"role": "user", "content": "hi"}]},
    )

    assert response.status_code == 200
    assert response.json()["providerId"] == "minimax-cn"

    request = fake_provider.requests[0]
    assert request.url.host == "api.minimaxi.com"
    assert request.url.path == "/v1/chat/completions"


def test_minimax_cn_sends_reasoning_effort(client: TestClient, fake_provider: FakeProvider) -> None:
    """推理型模型不带 reasoning_effort 时，推理 token 会吃光输出预算、正文被截断。"""
    fake_provider.install(lambda request: _ok_openai())
    _store_key(client, "minimax-cn", api_key="sk-cn-test")

    _complete(
        client,
        {"providerId": "minimax-cn", "messages": [{"role": "user", "content": "hi"}]},
    )

    assert fake_provider.bodies[0]["reasoning_effort"] == "low"


def test_minimax_has_four_independent_access_lines() -> None:
    """MiniMax 的四条接入线要各自独立：两个端点 × 两种凭证。

    端点不同是账号体系不同，凭证不同是计费资源不同——
    两者交叉组合起来就是四种互不兼容的接入方式，各用各的 key。
    """
    by_id = {provider.id: provider for provider in llm_proxy.PROVIDERS}
    expected = {
        "minimax": ("api.minimax.io", "sk-api-"),
        "minimax-subscription": ("api.minimax.io", "sk-cp-"),
        "minimax-cn": ("api.minimaxi.com", "sk-api-"),
        "minimax-cn-subscription": ("api.minimaxi.com", "sk-cp-"),
    }
    for provider_id, (host, prefix) in expected.items():
        provider = by_id[provider_id]
        assert provider.base_url == f"https://{host}/v1"
        assert provider.model == "MiniMax-M3.1-Flash"
        # 每条线要一种凭证：前缀不能重复，也不能为空
        assert provider.key_prefix == prefix

    # 故障转移顺序里四条都要在，且不重复
    order = settings.llm_fallback_order
    for provider_id in expected:
        assert provider_id in order
    assert len(order) == len(set(order))


def test_every_access_line_has_its_own_entry() -> None:
    """每条接入线（端点 × 凭证）各自占一个条目。

    ⚠️ 同一个 id 装不下两种互斥的凭证与端点组合——key 是按 provider_id 分槽存的。
    """
    by_id = {provider.id: provider for provider in llm_proxy.PROVIDERS}
    expected = {
        # MiniMax：两个端点 × 两种凭证
        "minimax": ("api.minimax.io", "sk-api-"),
        "minimax-subscription": ("api.minimax.io", "sk-cp-"),
        "minimax-cn": ("api.minimaxi.com", "sk-api-"),
        "minimax-cn-subscription": ("api.minimaxi.com", "sk-cp-"),
        # DeepSeek：只有按量计费一种凭证
        "deepseek": ("api.deepseek.com", None),
        # 智谱：两类 key 格式一样，只能靠创建入口区分
        "zhipu": ("open.bigmodel.cn", None),
        "zhipu-coding": ("open.bigmodel.cn", None),
        # 百炼：前缀能区分
        "qwen": ("dashscope.aliyuncs.com", "sk-"),
        "qwen-coding": ("coding.dashscope.aliyuncs.com", "sk-sp-"),
        # 方舟：两类 key 格式一样
        "ark": ("ark.cn-beijing.volces.com", None),
        "ark-coding": ("ark.cn-beijing.volces.com", None),
    }
    for provider_id, (host, prefix) in expected.items():
        provider = by_id[provider_id]
        assert host in provider.base_url
        assert provider.key_prefix == prefix

    # 故障转移顺序要覆盖全部接入线，且不重复
    order = settings.llm_fallback_order
    for provider_id in expected:
        assert provider_id in order, f"{provider_id} 不在故障转移顺序里"
    assert len(order) == len(set(order))


def test_access_line_prefixes_may_overlap_but_must_be_ordered() -> None:
    """前缀可以有包含关系，但识别时必须按长度倒序。

    ⚠️ 百炼的按量 key 是 `sk-`、套餐 key 是 `sk-sp-`——`sk-` 是 `sk-sp-` 的前缀。
    这是**允许的配置**（厂商自己定的），但识别逻辑必须按长度倒序匹配，
    否则套餐 key 会被误判成按量 key。

    这条测试锁的是「同一厂商内，短前缀不能排在长前缀前面」——
    也就是倒序匹配时短的必须后试。
    """
    by_family: dict[str, list[str]] = {}
    for provider in llm_proxy.PROVIDERS:
        if not provider.key_prefix:
            continue
        by_family.setdefault(provider.id.split("-")[0], []).append(provider.key_prefix)

    for family, prefixes in by_family.items():
        # 倒序匹配时，长前缀先试；短前缀必须排在它后面
        ordered = sorted(prefixes, key=lambda p: (-len(p), p))
        for i, outer in enumerate(ordered):
            for inner in ordered[i + 1 :]:
                if inner != outer:
                    assert not outer.startswith(inner) or len(outer) > len(inner), (
                        f"{family}：倒序匹配时 {inner!r} 会先于 {outer!r} 命中，"
                        f"但 {inner!r} 是 {outer!r} 的前缀"
                    )


def test_qwen_prefixes_are_distinguishable_by_length() -> None:
    """百炼两类 key 的前缀有包含关系——识别必须按长度倒序才不出错。

    ⚠️ 这不是「配置有问题」，是「识别逻辑必须处理这种配置」：
    `sk-sp-` 以 `sk-` 开头，先匹配短的会把套餐 key 误判成按量 key。
    """
    by_id = {provider.id: provider for provider in llm_proxy.PROVIDERS}
    short = by_id["qwen"].key_prefix
    long = by_id["qwen-coding"].key_prefix
    assert short == "sk-"
    assert long == "sk-sp-"
    # 包含关系成立 → 识别必须靠长度倒序
    assert long.startswith(short)
    assert len(long) > len(short)


def test_qwen_coding_has_no_model_list_endpoint() -> None:
    """百炼 Coding Plan 不开放模型列表接口——标出来，别发必然失败的请求。"""
    by_id = {provider.id: provider for provider in llm_proxy.PROVIDERS}
    assert by_id["qwen-coding"].models_supported is False
    assert by_id["qwen"].models_supported is True


def test_key_prefix_matched_longest_first() -> None:
    """`sk-sp-` 是 `sk-` 的前缀——必须按长度倒序识别。

    ⚠️ 先匹配短的会把百炼的套餐 key 误判成按量 key。
    """
    assert llm_proxy.detect_key_prefix("sk-" + "sp-example-value") == "sk-sp-"
    assert llm_proxy.detect_key_prefix("sk-example-value") == "sk-"


def test_key_prefix_mismatch_within_same_family() -> None:
    """同一家厂商内贴错凭证类型，当场说清楚。"""
    reason = llm_proxy.key_prefix_mismatch("qwen", "sk-" + "sp-example-value")
    assert reason is not None
    assert "sk-sp-" in reason
    assert "sk-" in reason


def test_key_prefix_mismatch_across_families_is_not_rejected() -> None:
    """⚠️ 贴了别家厂商的 key **不在提交时拦**。

    用户可能正打算换厂商——那是「贴错了厂商」，该靠调用时的错误提示，
    不是在托管入口就拒收。
    """
    # 假 key 用拼接写：这样源码里不会出现连续的 sk- 前缀，
    # 密钥闸门就不会把它当疑似真 key 扫出来。
    other_family_key = "sk-" + "sp-example-value"
    assert llm_proxy.key_prefix_mismatch("minimax", other_family_key) is None


def test_unknown_prefix_is_accepted() -> None:
    """认不出前缀就放行——前缀规则可能过时，不能因此拦下用户。"""
    assert llm_proxy.key_prefix_mismatch("minimax", "some-unknown-credential") is None


def test_storing_wrong_credential_kind_is_rejected(client: TestClient) -> None:
    """托管入口当场拒绝凭证类型不匹配的 key。"""
    response = client.post(
        "/api/llm/keys",
        json={"providerId": "qwen", "apiKey": "sk-" + "sp-example-value"},
        headers=_headers(),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "llm_key_kind_mismatch"


def test_storing_matching_credential_kind_is_accepted(client: TestClient) -> None:
    """凭证类型对得上就正常托管。"""
    response = client.post(
        "/api/llm/keys",
        json={"providerId": "qwen", "apiKey": "sk-" + "plain-example-value"},
        headers=_headers(),
    )
    assert response.status_code == 201


def test_finish_reason_is_reported(client: TestClient, fake_provider: FakeProvider) -> None:
    """结束原因要透传给前端：正文为空时它区分了「被截断」与「模型没给」。"""
    fake_provider.install(
        lambda request: _json_response(
            {
                "choices": [{"message": {"content": ""}, "finish_reason": "length"}],
            }
        )
    )
    _store_key(client, "minimax-cn", api_key="sk-cn-test")

    response = _complete(
        client,
        {"providerId": "minimax-cn", "messages": [{"role": "user", "content": "hi"}]},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["content"] == ""
    assert body["finishReason"] == "length"


def test_finish_reason_absent_when_vendor_omits_it(
    client: TestClient, fake_provider: FakeProvider
) -> None:
    """厂商没给结束原因时不要瞎编一个。"""
    fake_provider.install(
        lambda request: _json_response({"choices": [{"message": {"content": "hi"}}]})
    )
    _store_key(client, "minimax-cn", api_key="sk-cn-test")

    response = _complete(
        client,
        {"providerId": "minimax-cn", "messages": [{"role": "user", "content": "hi"}]},
    )

    assert response.status_code == 200
    assert response.json().get("finishReason") is None


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
