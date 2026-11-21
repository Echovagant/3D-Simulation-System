"""gym 动作审计：写行、回写结果、按归属查询。

只管落库，不碰物理。写库失败一律抛 503——调用方据此停止推进，
因为「物理推进了但没有审计行」是不允许的状态。
"""

from __future__ import annotations

import logging

from sqlalchemy import select
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import GymStepLog

logger = logging.getLogger(__name__)

AUDIT_PAGE_SIZE = 200


def record_step(
    session: Session,
    *,
    owner_token: str,
    session_id: str,
    round_index: int,
    step_index: int,
    force_x: float,
    force_z: float,
    force_limit: float,
    applied: bool,
    latency_ms: int,
    error_code: str | None = None,
) -> GymStepLog:
    """写一行审计并立即 commit。失败抛 503，调用方不得推进物理。"""
    row = GymStepLog(
        owner_token=owner_token,
        session_id=session_id,
        round_index=round_index,
        step_index=step_index,
        force_x=force_x,
        force_z=force_z,
        force_limit=force_limit,
        applied=applied,
        latency_ms=latency_ms,
        error_code=error_code,
    )
    session.add(row)
    try:
        session.commit()
    except (SQLAlchemyError, RuntimeError) as exc:
        session.rollback()
        raise ApiError(
            status_code=503,
            code="gym_audit_unavailable",
            message="审计不可用，仿真已停止推进",
        ) from exc
    session.refresh(row)
    return row


def finish_step(
    session: Session,
    log_id: int,
    *,
    applied: bool,
    error_code: str | None = None,
    distance: float | None = None,
    reward: float | None = None,
    terminated: bool = False,
    truncated: bool = False,
    latency_ms: int,
) -> None:
    """回写这一步的结果。物理推进失败时把 applied 改 false。"""
    row = session.get(GymStepLog, log_id)
    if row is None:
        return
    row.applied = applied
    row.error_code = error_code
    row.distance = distance
    row.reward = reward
    row.terminated = terminated
    row.truncated = truncated
    row.latency_ms = latency_ms
    try:
        session.commit()
    except (SQLAlchemyError, RuntimeError) as exc:
        # 行已存在，证据不丢；二次写失败退到日志告警，不再抛
        logger.warning("审计结果回写失败，log_id=%s：%s", log_id, exc)
        session.rollback()


def list_logs(
    session: Session,
    owner_token: str,
    session_id: str,
    *,
    round_index: int | None = None,
    limit: int = AUDIT_PAGE_SIZE,
) -> list[GymStepLog]:
    """按归属取日志，step_index 升序、同序按 id 升序。"""
    stmt = select(GymStepLog).where(
        GymStepLog.owner_token == owner_token, GymStepLog.session_id == session_id
    )
    if round_index is not None:
        stmt = stmt.where(GymStepLog.round_index == round_index)
    stmt = stmt.order_by(GymStepLog.step_index.asc(), GymStepLog.id.asc()).limit(limit)
    return list(session.scalars(stmt).all())
