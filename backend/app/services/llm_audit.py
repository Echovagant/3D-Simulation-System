"""调用审计与配额计数。

配额**不另建计数表**：从 ``llm_call_audit`` 数当天的条数。
再建一张计数表就多了一个会漂移的真相源。

每一次对厂商的尝试都写一行——包括故障转移中换厂家的失败尝试。
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import LlmCallAudit, utcnow

# 审计列表一次最多回多少条。
AUDIT_PAGE_SIZE = 50


def day_start(now: datetime | None = None) -> datetime:
    """当天 UTC 零点。"""
    moment = now or utcnow()
    return moment.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def next_day_start(now: datetime | None = None) -> datetime:
    """次日 UTC 零点（额度重置的时刻）。"""
    return day_start(now) + timedelta(days=1)


def count_today(session: Session, owner_token: str) -> int:
    """今天（UTC 日历日）这个 owner 的调用条数。

    失败的那几次尝试也算数——它们同样花掉了厂商的额度。
    """
    since = day_start()
    stmt = (
        select(func.count())
        .select_from(LlmCallAudit)
        .where(
            LlmCallAudit.owner_token == owner_token,
            LlmCallAudit.ts >= since,
        )
    )
    return int(session.scalar(stmt) or 0)


def record_attempt(
    session: Session,
    owner_token: str,
    provider_id: str,
    model: str,
    ok: bool,
    latency_ms: int,
    prompt_tokens: int | None = None,
    completion_tokens: int | None = None,
    error_code: str | None = None,
) -> LlmCallAudit:
    """写一行审计。

    只写「发生了什么」，**不写**任何 key、请求正文或厂商返回的原文。
    """
    row = LlmCallAudit(
        ts=utcnow(),
        owner_token=owner_token,
        provider_id=provider_id,
        model=model,
        ok=ok,
        latency_ms=latency_ms,
        prompt_tokens=prompt_tokens,
        completion_tokens=completion_tokens,
        error_code=error_code,
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def recent_calls(
    session: Session, owner_token: str, limit: int = AUDIT_PAGE_SIZE
) -> list[LlmCallAudit]:
    """这个 owner 自己最近的调用，最新的在前。"""
    stmt = (
        select(LlmCallAudit)
        .where(LlmCallAudit.owner_token == owner_token)
        .order_by(LlmCallAudit.ts.desc(), LlmCallAudit.id.desc())
        .limit(limit)
    )
    return list(session.scalars(stmt).all())
