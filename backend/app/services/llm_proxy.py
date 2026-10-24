"""LLM 代理：三族协议拼装 + 故障转移。

请求拼装与响应解析**逐字段对齐**前端 ``src/services/llm/client.ts``：
端点、鉴权头、system 放哪、输出上限字段名、回复取哪，一处都不能差。

- **openai 兼容**：`POST {base}/chat/completions`，``Authorization: Bearer``，
  ``messages[]``（含 system 角色），输出上限 ``max_completion_tokens``，
  回复在 ``choices[0].message.content``
- **anthropic**：`POST {base}/messages`，``x-api-key`` + ``anthropic-version``，
  system 是**顶层字段**不是消息角色，输出上限 ``max_tokens``，
  回复在 ``content[].text``
- **gemini**：`POST {base}/interactions`，``x-goog-api-key``，
  system 是 ``system_instruction``，对话压成 ``input`` 字符串，
  思考深度是 ``generation_config.thinking_level``，回复在 ``output_text``

OpenAI 兼容族里 ``reasoning_effort`` **只有清单里标注了的服务商才带**——
往不认识这个参数的接口上发，多半会被判成非法参数。
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from typing import Any, Literal

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import ApiError
from app.schemas import LlmCompleteRequest, LlmCompletionResponse, LlmMessage, LlmUsage
from app.services import key_vault, llm_audit

LlmProtocol = Literal["openai", "anthropic", "gemini"]

# 单条消息的上限，防止有人拿一个 10MB 的正文打过来。
_MAX_MESSAGE_CHARS = 100_000
# 默认输出上限。
_DEFAULT_MAX_TOKENS = 512
# 厂商错误摘要的长度上限（与前端一致）。
_MAX_ERROR_CHARS = 240


@dataclass(frozen=True)
class LlmProvider:
    """一个厂商的协议与默认参数。

    与前端 ``src/config/llmProviders.ts`` 同源：id / name / protocol / baseUrl /
    model / reasoningEffort / keyPrefix 一一对应。

    ⚠️ 一个 id 对应**一条接入线**，不是一家厂商：同一家厂商可能有多个端点、
    多种凭证，它们互不通用，各自占一个 id。
    """

    id: str
    name: str
    protocol: LlmProtocol
    base_url: str
    model: str
    reasoning_effort: str | None = None
    # 厂商的凭证前缀（用于认出用户贴的是哪一种）
    key_prefix: str | None = None
    # 厂商标识——同一家厂商的多条接入线共用它（与前端 keyFamily 同源）
    key_family: str | None = None
    # 这条线没有模型列表接口（百炼 Coding Plan 就是）
    models_supported: bool = True


PROVIDERS: tuple[LlmProvider, ...] = (
    LlmProvider(
        id="minimax",
        key_family="minimax",
        name="MiniMax",
        protocol="openai",
        base_url="https://api.minimax.io/v1",
        model="MiniMax-M3.1-Flash",
        reasoning_effort="low",
        key_prefix="sk-api-",
    ),
    LlmProvider(
        id="minimax-subscription",
        key_family="minimax",
        name="MiniMax（订阅）",
        protocol="openai",
        base_url="https://api.minimax.io/v1",
        model="MiniMax-M3.1-Flash",
        reasoning_effort="low",
        key_prefix="sk-cp-",
    ),
    LlmProvider(
        id="minimax-cn",
        key_family="minimax",
        name="MiniMax（api.minimaxi.com）",
        protocol="openai",
        base_url="https://api.minimaxi.com/v1",
        model="MiniMax-M3.1-Flash",
        reasoning_effort="low",
        key_prefix="sk-api-",
    ),
    LlmProvider(
        id="minimax-cn-subscription",
        key_family="minimax",
        name="MiniMax（api.minimaxi.com · 订阅）",
        protocol="openai",
        base_url="https://api.minimaxi.com/v1",
        model="MiniMax-M3.1-Flash",
        reasoning_effort="low",
        key_prefix="sk-cp-",
    ),
    LlmProvider(
        id="deepseek",
        key_family="deepseek",
        name="DeepSeek",
        protocol="openai",
        base_url="https://api.deepseek.com",
        model="deepseek-flash",
        reasoning_effort="high",
    ),
    LlmProvider(
        id="zhipu",
        key_family="zhipu",
        name="智谱 GLM",
        protocol="openai",
        base_url="https://open.bigmodel.cn/api/paas/v4",
        model="glm-5.3",
    ),
    LlmProvider(
        id="zhipu-coding",
        key_family="zhipu",
        name="智谱 GLM（编码套餐）",
        protocol="openai",
        base_url="https://open.bigmodel.cn/api/coding/paas/v4",
        model="glm-5.2",
    ),
    LlmProvider(
        id="qwen",
        key_family="qwen",
        name="通义千问 Qwen",
        protocol="openai",
        base_url="https://dashscope.aliyuncs.com/compatible-mode/v1",
        model="qwen3.8-max",
        reasoning_effort="low",
        key_prefix="sk-",
    ),
    LlmProvider(
        id="qwen-coding",
        key_family="qwen",
        name="通义千问 Qwen（编码套餐）",
        protocol="openai",
        base_url="https://coding.dashscope.aliyuncs.com/v1",
        model="qwen3.8-max",
        reasoning_effort="low",
        key_prefix="sk-sp-",
        models_supported=False,
    ),
    LlmProvider(
        id="ark",
        key_family="ark",
        name="火山方舟",
        protocol="openai",
        base_url="https://ark.cn-beijing.volces.com/api/v3",
        model="doubao-seed-2.1-pro",
    ),
    LlmProvider(
        id="ark-coding",
        key_family="ark",
        name="火山方舟（编码套餐）",
        protocol="openai",
        base_url="https://ark.cn-beijing.volces.com/api/coding/v3",
        model="Doubao-Seed-Code",
    ),
    LlmProvider(
        id="openai",
        name="OpenAI",
        protocol="openai",
        base_url="https://api.openai.com/v1",
        model="gpt-5.6-terra",
        reasoning_effort="low",
    ),
    LlmProvider(
        id="anthropic",
        name="Anthropic Claude",
        protocol="anthropic",
        base_url="https://api.anthropic.com/v1",
        model="claude-opus-5",
    ),
    LlmProvider(
        id="gemini",
        name="Google Gemini",
        protocol="gemini",
        base_url="https://generativelanguage.googleapis.com/v1beta",
        model="gemini-3.8-flash",
    ),
    LlmProvider(
        id="xai",
        name="xAI Grok",
        protocol="openai",
        base_url="https://api.x.ai/v1",
        model="grok-4.7",
    ),
)

_BY_ID = {provider.id: provider for provider in PROVIDERS}


def find_provider(provider_id: str) -> LlmProvider | None:
    """按 id 找厂商。不认识就是 None。"""
    return _BY_ID.get(provider_id)


def detect_key_prefix(api_key: str, family: str | None = None) -> str | None:
    """认出这把 key 属于哪条接入线的前缀。

    ⚠️ **按前缀长度从长到短匹配**：百炼的按量 key 是 `sk-` 开头、
    套餐 key 是 `sk-sp-` 开头——短的 `sk-` 正是长的 `sk-sp-` 的前缀。
    先匹配短的会把套餐 key 误判成按量 key。

    @param family 只在这个厂商内找。给了它就不会把别家厂商的 key 认成
        本家的——那属于「贴错了厂商」，是另一类问题。
    """
    trimmed = (api_key or "").strip()
    if not trimmed:
        return None
    candidates = sorted(
        (
            p
            for p in PROVIDERS
            if p.key_prefix and (family is None or _provider_family(p) == family)
        ),
        key=lambda p: (-len(p.key_prefix or ""), p.id),
    )
    for provider in candidates:
        if trimmed.startswith(provider.key_prefix or ""):
            return provider.key_prefix
    return None


def _provider_family(provider: LlmProvider) -> str:
    """厂商标识——同一家厂商的多条接入线共用它（与前端 keyFamily 同源）。"""
    return provider.key_family or provider.id.split("-")[0]


def key_prefix_mismatch(provider_id: str, api_key: str) -> str | None:
    """这把 key 与该接入线期望的凭证不匹配时，给出可读的原因。

    ⚠️ 只在**同一厂商内**判断：拿别家厂商的 key 贴进来是「贴错了厂商」，
    那要靠调用时的错误提示（换厂商要重新托管），不该在提交时就拦——
    用户可能正打算换厂商。

    ⚠️ 认不出前缀就返回 None——前缀规则可能过时，不能因此拦下用户。
    """
    provider = find_provider(provider_id)
    if provider is None or not provider.key_prefix:
        return None
    detected = detect_key_prefix(api_key, family=_provider_family(provider))
    if detected is None or detected == provider.key_prefix:
        return None
    return (
        f"这把 key 的前缀是 {detected}，而「{provider.name}」这条接入线要的是 "
        f"{provider.key_prefix}。同一家厂商的不同接入线的 key 不通用——请确认选对了接入线。"
    )


def get_transport() -> httpx.BaseTransport | None:
    """HTTP 传输层替身。

    生产返回 None（走真实网络）。测试用 FastAPI 的依赖覆盖注入
    ``httpx.MockTransport``，这样测试**不联网、也不碰任何真 key**。
    """
    return None


@dataclass
class ProviderAttempt:
    """一次对厂商的尝试的结果。"""

    provider_id: str
    model: str
    ok: bool
    latency_ms: int
    content: str = ""
    prompt_tokens: int | None = None
    completion_tokens: int | None = None
    # 厂商的结束原因。正文为空时它区分「输出预算被用光（正文被截断）」与「模型没给正文」。
    finish_reason: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    upstream_status: int | None = None
    # 换不换下一家：网络失败 / 429 / 5xx 才换；其它 4xx 是请求本身有问题。
    retryable: bool = False


def build_request(
    provider: LlmProvider,
    model: str,
    messages: list[LlmMessage],
    max_tokens: int,
    key: str,
) -> tuple[str, dict[str, str], dict[str, Any]]:
    """按协议拼出请求：返回 (地址, 头, 体)。

    与前端 ``buildRequest()`` 逐字段一致。
    """
    base = provider.base_url.rstrip("/")
    system = "\n\n".join(m.content for m in messages if m.role == "system")
    rest = [m for m in messages if m.role != "system"]

    if provider.protocol == "anthropic":
        body: dict[str, Any] = {"model": model, "max_tokens": max_tokens}
        if system:
            body["system"] = system
        body["messages"] = [{"role": m.role, "content": m.content} for m in rest]
        return (
            f"{base}/messages",
            {
                "Content-Type": "application/json",
                "x-api-key": key,
                "anthropic-version": "2023-06-01",
            },
            body,
        )

    if provider.protocol == "gemini":
        body = {"model": model, "input": "\n\n".join(f"{m.role}: {m.content}" for m in rest)}
        if system:
            body["system_instruction"] = system
        body["generation_config"] = {"thinking_level": "low"}
        return (
            f"{base}/interactions",
            {"Content-Type": "application/json", "x-goog-api-key": key},
            body,
        )

    # OpenAI 兼容：system 仍然是 messages 里的一个角色。
    body = {
        "model": model,
        "messages": [{"role": m.role, "content": m.content} for m in messages],
        "max_completion_tokens": max_tokens,
    }
    # 只有官方文档明确写了 reasoning_effort 的服务商才带这个字段
    if provider.reasoning_effort:
        body["reasoning_effort"] = provider.reasoning_effort
    return (
        f"{base}/chat/completions",
        {"Content-Type": "application/json", "Authorization": f"Bearer {key}"},
        body,
    )


def extract_content(protocol: LlmProtocol, payload: Any) -> str:
    """从各家响应里取出正文。与前端 ``extractContent()`` 一致。"""
    if not isinstance(payload, dict):
        return ""

    if protocol == "anthropic":
        anthropic_blocks = payload.get("content")
        if not isinstance(anthropic_blocks, list):
            return ""
        anthropic_parts = [
            block["text"]
            for block in anthropic_blocks
            if isinstance(block, dict) and isinstance(block.get("text"), str)
        ]
        return "\n".join(anthropic_parts).strip()

    if protocol == "gemini":
        output_text = payload.get("output_text")
        if isinstance(output_text, str):
            return output_text.strip()
        blocks = payload.get("output")
        if not isinstance(blocks, list):
            return ""
        parts: list[str] = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            text = block.get("text")
            content = block.get("content")
            parts.append(
                text if isinstance(text, str) else (content if isinstance(content, str) else "")
            )
        return "\n".join(part for part in parts if part).strip()

    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return ""
    first = choices[0]
    if not isinstance(first, dict):
        return ""
    message = first.get("message")
    if not isinstance(message, dict):
        return ""
    content = message.get("content")
    return content.strip() if isinstance(content, str) else ""


def extract_finish_reason(protocol: LlmProtocol, payload: Any) -> str | None:
    """取厂商的结束原因。与前端 ``extractFinishReason()`` 一致。

    ⚠️ 正文为空时它区分了两种情况：``length`` 表示**输出预算被用光**
    （推理 token 吃掉了预算、正文被截断），其余值表示模型确实没给正文。
    前端据此给出可执行的提示，而不是笼统的「无法解析」。
    """
    if not isinstance(payload, dict):
        return None
    if protocol == "openai":
        choices = payload.get("choices")
        if not isinstance(choices, list) or not choices:
            return None
        first = choices[0]
        if not isinstance(first, dict):
            return None
        reason = first.get("finish_reason")
        return reason if isinstance(reason, str) else None
    if protocol == "anthropic":
        reason = payload.get("stop_reason")
        return reason if isinstance(reason, str) else None
    if protocol == "gemini":
        reason = payload.get("finish_reason")
        return reason if isinstance(reason, str) else None
    return None


def extract_usage(payload: Any) -> tuple[int | None, int | None]:
    """取 token 用量。各家字段名不同：``prompt_tokens``/``input_tokens``。"""
    if not isinstance(payload, dict):
        return None, None
    usage = payload.get("usage")
    if not isinstance(usage, dict):
        return None, None
    return _pick_int(usage, "prompt_tokens", "input_tokens"), _pick_int(
        usage, "completion_tokens", "output_tokens"
    )


def _pick_int(usage: dict[str, Any], *keys: str) -> int | None:
    for key in keys:
        value = usage.get(key)
        if isinstance(value, int) and not isinstance(value, bool):
            return value
    return None


def _redact(text: str, secret: str | None = None) -> str:
    """去掉明文 key，再截断。"""
    if secret:
        text = text.replace(secret, "***")
    return text[:_MAX_ERROR_CHARS]


def _upstream_error_message(response: httpx.Response, secret: str) -> str:
    """从错误信封里挑出最有用的一句话（与前端 ``extractErrorMessage`` 一致）。"""
    raw = ""
    try:
        raw = response.text
    except Exception:  # noqa: BLE001 —— 读不到正文不是致命问题
        raw = ""

    parsed: Any = None
    if raw:
        try:
            parsed = json.loads(raw)
        except ValueError:
            parsed = None

    detail = ""
    if isinstance(parsed, dict):
        error = parsed.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            if isinstance(message, str):
                detail = message.strip()
        if not detail:
            message = parsed.get("message")
            if isinstance(message, str):
                detail = message.strip()

    if not detail:
        detail = raw[:160].strip() or response.reason_phrase
    return _redact(detail, secret)


def _error_code_for_status(status_code: int) -> str:
    if status_code == 429:
        return "upstream_rate_limited"
    if status_code >= 500:
        return "upstream_server_error"
    return "upstream_client_error"


def _is_retryable_status(status_code: int) -> bool:
    """只有 429 与 5xx 值得换一家。其它 4xx 是请求本身的问题。"""
    return status_code == 429 or status_code >= 500


def _elapsed_ms(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _call_provider(
    provider: LlmProvider,
    model: str,
    messages: list[LlmMessage],
    max_tokens: int,
    key: str,
    transport: httpx.BaseTransport | None,
) -> ProviderAttempt:
    """调一次厂商。**不抛异常**——失败也返回结果，让调用方决定要不要换一家。"""
    url, headers, body = build_request(provider, model, messages, max_tokens, key)
    started = time.perf_counter()

    try:
        with httpx.Client(
            timeout=settings.llm_upstream_timeout_ms / 1000,
            transport=transport,
        ) as client:
            response = client.post(url, headers=headers, json=body)
    except httpx.RequestError as exc:
        # 网络层失败：连不上、超时、DNS 挂了——换一家有用。
        return ProviderAttempt(
            provider_id=provider.id,
            model=model,
            ok=False,
            latency_ms=_elapsed_ms(started),
            error_code="upstream_unreachable",
            error_message=_redact(str(exc), key),
            retryable=True,
        )

    latency_ms = _elapsed_ms(started)

    if response.status_code >= 400:
        return ProviderAttempt(
            provider_id=provider.id,
            model=model,
            ok=False,
            latency_ms=latency_ms,
            error_code=_error_code_for_status(response.status_code),
            error_message=_upstream_error_message(response, key),
            upstream_status=response.status_code,
            retryable=_is_retryable_status(response.status_code),
        )

    try:
        payload = response.json()
    except ValueError:
        return ProviderAttempt(
            provider_id=provider.id,
            model=model,
            ok=False,
            latency_ms=latency_ms,
            error_code="upstream_invalid_response",
            error_message="厂商返回的不是合法 JSON",
            upstream_status=response.status_code,
            retryable=False,
        )

    prompt_tokens, completion_tokens = extract_usage(payload)
    return ProviderAttempt(
        provider_id=provider.id,
        model=model,
        ok=True,
        latency_ms=latency_ms,
        content=extract_content(provider.protocol, payload),
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        finish_reason=extract_finish_reason(provider.protocol, payload),
    )


def _validate(payload: LlmCompleteRequest) -> tuple[int, list[LlmMessage]]:
    """校验请求形状。**所有形状问题都用 llm_invalid_request**，前端只认一种码。"""
    if not payload.messages:
        raise ApiError(
            status_code=422,
            code="llm_invalid_request",
            message="messages 不能为空",
        )
    for message in payload.messages:
        if message.role not in ("system", "user", "assistant"):
            raise ApiError(
                status_code=422,
                code="llm_invalid_request",
                message=f"不支持的 role：{message.role}",
            )
        if len(message.content) > _MAX_MESSAGE_CHARS:
            raise ApiError(
                status_code=422,
                code="llm_invalid_request",
                message="单条消息过长",
            )

    max_tokens = _DEFAULT_MAX_TOKENS if payload.max_tokens is None else payload.max_tokens
    limit = settings.llm_max_tokens_limit
    if max_tokens < 1 or max_tokens > limit:
        raise ApiError(
            status_code=422,
            code="llm_invalid_request",
            message=f"maxTokens 必须在 1..{limit} 之间",
        )
    return max_tokens, list(payload.messages)


def _candidates(provider_id: str | None) -> list[str]:
    """候选厂商顺序。

    指定了 providerId 就它先来，后面接着故障转移顺序；
    没指定就用配置的默认顺序。
    """
    order = [pid for pid in settings.llm_fallback_order if find_provider(pid) is not None]
    if provider_id:
        if find_provider(provider_id) is None:
            raise ApiError(
                status_code=422,
                code="llm_invalid_request",
                message=f"不认识的 providerId：{provider_id}",
            )
        return [provider_id, *[pid for pid in order if pid != provider_id]]
    return order


def _attempt_detail(attempt: ProviderAttempt) -> dict[str, Any]:
    return {
        "providerId": attempt.provider_id,
        "model": attempt.model,
        "ok": attempt.ok,
        "latencyMs": attempt.latency_ms,
        "errorCode": attempt.error_code,
        "status": attempt.upstream_status,
        "message": attempt.error_message,
    }


def complete(
    session: Session,
    owner_token: str,
    payload: LlmCompleteRequest,
    transport: httpx.BaseTransport | None = None,
) -> LlmCompletionResponse:
    """托管调用的主流程：配额 → 取密钥 → 逐个候选试 → 记账。

    每次尝试都写一行审计；故障转移中换厂家的失败尝试**也各写一行**。
    """
    max_tokens, messages = _validate(payload)
    candidates = _candidates(payload.provider_id)

    limit = settings.llm_quota_per_day
    used = llm_audit.count_today(session, owner_token)
    if used >= limit:
        # 额度用满**不该**打厂商——省用户的钱。
        raise ApiError(
            status_code=429,
            code="llm_quota_exceeded",
            message="今天的托管调用额度用完了",
            detail={
                "limit": limit,
                "used": used,
                "remaining": 0,
                "resetAt": llm_audit.next_day_start().isoformat(),
            },
        )

    attempts: list[ProviderAttempt] = []
    for candidate in candidates:
        provider = find_provider(candidate)
        if provider is None:
            continue

        plaintext = key_vault.resolve_plaintext(session, owner_token, candidate, payload.passphrase)
        if plaintext is None:
            # 显式点名的那家没配 key，直接报 404——不偷偷换一家，那会花用户的钱。
            if payload.provider_id == candidate:
                raise ApiError(
                    status_code=404,
                    code="llm_key_missing",
                    message=f"该厂商还没有托管 key：{candidate}",
                )
            continue

        model = payload.model or provider.model
        attempt = _call_provider(provider, model, messages, max_tokens, plaintext, transport)
        llm_audit.record_attempt(
            session,
            owner_token,
            attempt.provider_id,
            attempt.model,
            attempt.ok,
            attempt.latency_ms,
            attempt.prompt_tokens,
            attempt.completion_tokens,
            attempt.error_code,
        )
        attempts.append(attempt)

        if attempt.ok:
            usage = None
            if attempt.prompt_tokens is not None or attempt.completion_tokens is not None:
                usage = LlmUsage(
                    prompt_tokens=attempt.prompt_tokens,
                    completion_tokens=attempt.completion_tokens,
                )
            return LlmCompletionResponse(
                content=attempt.content,
                usage=usage,
                provider_id=attempt.provider_id,
                model=attempt.model,
                finish_reason=attempt.finish_reason,
            )

        if not attempt.retryable:
            # 厂商回 4xx（除 429）：请求本身有问题，换家也一样错，不换。
            raise ApiError(
                status_code=502,
                code="llm_upstream_failed",
                message=f"厂商返回错误：{attempt.provider_id}",
                detail={"attempts": [_attempt_detail(attempt)]},
            )

    if not attempts:
        raise ApiError(
            status_code=404,
            code="llm_key_missing",
            message="没有可用的托管密钥",
        )

    raise ApiError(
        status_code=502,
        code="llm_provider_failed",
        message="所有候选厂商都失败",
        detail={"attempts": [_attempt_detail(attempt) for attempt in attempts]},
    )
