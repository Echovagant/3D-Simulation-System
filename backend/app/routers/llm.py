"""LLM 托管的 HTTP 接口。

所有端点都吃一个头：**X-Owner-Token**。它是「软身份」——不是密码学意义上的
认证，只是配额、审计与密钥库的归属键。
"""

from __future__ import annotations

import httpx
from fastapi import APIRouter, Depends, Header, Path, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.schemas import (
    LlmAuditEntry,
    LlmAuditResponse,
    LlmCompleteRequest,
    LlmCompletionResponse,
    LlmKeyCreated,
    LlmKeyStatus,
    LlmKeyUpsertRequest,
    LlmQuotaStatus,
    LlmUsage,
)
from app.services import key_vault, llm_audit, llm_proxy

router = APIRouter(prefix="/llm", tags=["llm"])

_OWNER_TOKEN_MAX = 128


def require_owner_token(
    x_owner_token: str | None = Header(default=None, alias="X-Owner-Token"),
) -> str:
    """取软身份。

    缺失就是 401 owner_token_required——没有它就分不出配额与密钥归谁。
    """
    token = (x_owner_token or "").strip()
    if not token:
        raise ApiError(
            status_code=status.HTTP_401_UNAUTHORIZED,
            code="owner_token_required",
            message="缺少 X-Owner-Token",
        )
    if len(token) > _OWNER_TOKEN_MAX:
        raise ApiError(
            status_code=422,
            code="llm_invalid_request",
            message="X-Owner-Token 过长",
        )
    return token


@router.get("/keys", response_model=list[LlmKeyStatus], summary="查各厂商密钥配没配")
def list_keys(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> list[LlmKeyStatus]:
    """只回「配没配」——绝不回 key、密文、盐或口令。"""
    rows = {row.provider_id: row for row in key_vault.list_keys(session, owner_token)}
    return [
        LlmKeyStatus(
            provider_id=provider.id,
            configured=provider.id in rows,
            updated_at=rows[provider.id].updated_at if provider.id in rows else None,
        )
        for provider in llm_proxy.PROVIDERS
    ]


@router.post(
    "/keys",
    response_model=LlmKeyCreated,
    status_code=status.HTTP_201_CREATED,
    summary="托管一把厂商密钥",
)
def upsert_key(
    payload: LlmKeyUpsertRequest,
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> LlmKeyCreated:
    """托管（或覆盖）一把厂商密钥。

    服务端只存密文。明文 key 这一行之后就再也不出现。
    """
    if llm_proxy.find_provider(payload.provider_id) is None:
        raise ApiError(
            status_code=422,
            code="llm_invalid_request",
            message=f"不认识的 providerId：{payload.provider_id}",
        )
    # 凭证类型当场核对：贴错类型的 key 存进去，只会在调用时返回一个
    # 指不到真正原因上的错（401 像 key 错了，「模型不存在」像模型名错了）。
    mismatch = llm_proxy.key_prefix_mismatch(payload.provider_id, payload.api_key)
    if mismatch:
        raise ApiError(
            status_code=422,
            code="llm_key_kind_mismatch",
            message=mismatch,
        )
    row = key_vault.store_key(
        session,
        owner_token,
        payload.provider_id,
        payload.api_key,
        payload.passphrase,
    )
    return LlmKeyCreated(provider_id=row.provider_id, configured=True)


@router.delete(
    "/keys/{providerId}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删掉一把托管密钥",
)
def delete_key(
    provider_id: str = Path(alias="providerId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> None:
    if not key_vault.delete_key(session, owner_token, provider_id):
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="llm_key_missing",
            message=f"没有托管 key：{provider_id}",
        )


@router.post("/complete", response_model=LlmCompletionResponse, summary="托管调用")
def complete(
    payload: LlmCompleteRequest,
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
    transport: httpx.BaseTransport | None = Depends(llm_proxy.get_transport),
) -> LlmCompletionResponse:
    """归一化的调用：前端只说「要什么」，三家协议全在后端。"""
    return llm_proxy.complete(session, owner_token, payload, transport)


@router.get("/quota", response_model=LlmQuotaStatus, summary="查今天的托管额度")
def quota(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> LlmQuotaStatus:
    limit = settings.llm_quota_per_day
    used = llm_audit.count_today(session, owner_token)
    return LlmQuotaStatus(
        limit=limit,
        used=used,
        remaining=max(0, limit - used),
        reset_at=llm_audit.next_day_start(),
    )


@router.get("/audit", response_model=LlmAuditResponse, summary="查自己最近的托管调用")
def audit(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> LlmAuditResponse:
    """只回**该 owner 自己**最近的调用。"""
    rows = llm_audit.recent_calls(session, owner_token)
    return LlmAuditResponse(
        calls=[
            LlmAuditEntry(
                ts=row.ts,
                provider_id=row.provider_id,
                model=row.model,
                ok=row.ok,
                latency_ms=row.latency_ms,
                tokens=(
                    LlmUsage(
                        prompt_tokens=row.prompt_tokens,
                        completion_tokens=row.completion_tokens,
                    )
                    if row.prompt_tokens is not None or row.completion_tokens is not None
                    else None
                ),
                error_code=row.error_code,
            )
            for row in rows
        ]
    )
