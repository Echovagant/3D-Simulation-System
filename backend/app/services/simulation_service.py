"""批量仿真的落库与排队。

这一层做三件事：

1. **任务落库**：``simulation_jobs`` 记任务状态，``simulation_results`` 记每次运行。
2. **排队**：把任务推进 Redis 队列（ARQ worker 取出来跑）。
3. **配额**：每天最多跑多少次——**从 ``simulation_results`` 的行数数出来**，
   不另建计数表（多一个真相源就会漂移，与 LLM 那边从审计表数配额是同一个思路）。

**队列不通就诚实报错**：Redis 连不上时 ``POST /api/simulations`` 返回
503 ``simulation_queue_unavailable``，不假装排队成功。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

from arq.connections import RedisSettings, create_pool
from redis.exceptions import RedisError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import settings
from app.errors import ApiError
from app.models import SimulationJob, SimulationResult, utcnow

# 任务状态机：queued -> running -> succeeded | failed
JOB_QUEUED = "queued"
JOB_RUNNING = "running"
JOB_SUCCEEDED = "succeeded"
JOB_FAILED = "failed"

# 列表一次最多回多少条
JOB_LIST_LIMIT = 50

# ARQ worker 里注册的函数名。API 端与 worker 必须一致。
WORKER_FUNCTION = "run_simulation"

QUEUE_UNAVAILABLE = "simulation_queue_unavailable"
QUOTA_EXCEEDED = "simulation_quota_exceeded"


def redis_settings() -> RedisSettings:
    """队列用的 Redis 连接参数。"""
    base = RedisSettings.from_dsn(settings.simulation_redis_url)
    return replace(base, conn_timeout=settings.simulation_redis_timeout)


def queue_name() -> str:
    return settings.simulation_queue_name


def day_start(now: datetime | None = None) -> datetime:
    """当天 UTC 零点。"""
    moment = now or utcnow()
    return moment.astimezone(UTC).replace(hour=0, minute=0, second=0, microsecond=0)


def count_runs_since(session: Session, since: datetime) -> int:
    """从 ``since`` 起已经跑过多少次仿真。

    配额从这里数——**不另建计数表**。
    """
    stmt = (
        select(func.count())
        .select_from(SimulationResult)
        .where(SimulationResult.created_at >= since)
    )
    return int(session.scalar(stmt) or 0)


def plan_runs(sweep: Mapping[str, Any] | None) -> int:
    """这个任务一共要跑几次。

    没有扫描就是 1 次；扫描几次就是几次（扫描只扫一个维度）。
    """
    if not sweep:
        return 1
    values = sweep.get("values")
    if not isinstance(values, list) or not values:
        return 1
    return len(values)


def create_job(
    session: Session,
    *,
    job_id: str,
    label: str | None,
    scene: Mapping[str, Any],
    params: Mapping[str, Any] | None,
    sweep: Mapping[str, Any] | None,
) -> SimulationJob:
    """建一行任务。状态从 queued 起步。"""
    job = SimulationJob(
        job_id=job_id,
        status=JOB_QUEUED,
        label=label,
        scene=dict(scene),
        params=dict(params or {}),
        sweep=dict(sweep) if sweep else None,
        total=plan_runs(sweep),
        done=0,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(job)
    session.commit()
    session.refresh(job)
    return job


def get_job(session: Session, job_id: str) -> SimulationJob | None:
    return session.get(SimulationJob, job_id)


def list_jobs(session: Session, limit: int = JOB_LIST_LIMIT) -> list[SimulationJob]:
    """最近的任务，最新的在前。"""
    stmt = select(SimulationJob).order_by(SimulationJob.created_at.desc()).limit(limit)
    return list(session.scalars(stmt).all())


def record_run(
    session: Session,
    job_id: str,
    run_index: int,
    params: Mapping[str, Any],
    payload: Mapping[str, Any],
    duration_ms: int,
) -> SimulationResult:
    """记一次运行的明细。"""
    row = SimulationResult(
        job_id=job_id,
        run_index=run_index,
        params=dict(params),
        payload=dict(payload),
        duration_ms=duration_ms,
        created_at=utcnow(),
    )
    session.add(row)
    session.commit()
    session.refresh(row)
    return row


def list_results(session: Session, job_id: str) -> list[SimulationResult]:
    """一个任务的全部运行结果，按运行序号排。"""
    stmt = (
        select(SimulationResult)
        .where(SimulationResult.job_id == job_id)
        .order_by(SimulationResult.run_index.asc())
    )
    return list(session.scalars(stmt).all())


def mark_running(session: Session, job_id: str) -> None:
    _set_status(session, job_id, JOB_RUNNING)


def mark_progress(session: Session, job_id: str, done: int) -> None:
    """更新「已经跑完几次」。"""
    job = session.get(SimulationJob, job_id)
    if job is None:
        return
    job.done = done
    job.updated_at = utcnow()
    session.commit()


def mark_finished(session: Session, job_id: str, status: str, error: str | None = None) -> None:
    _set_status(session, job_id, status, error)


def _set_status(session: Session, job_id: str, status: str, error: str | None = None) -> None:
    job = session.get(SimulationJob, job_id)
    if job is None:
        return
    job.status = status
    job.error = error
    job.updated_at = utcnow()
    session.commit()


async def enqueue(job_id: str) -> None:
    """把任务推进 Redis 队列。

    Redis 连不上 → 抛 503 ``simulation_queue_unavailable``。
    **不假装排队成功**：队列不通就说队列不通。
    """
    pool = None
    try:
        pool = await create_pool(redis_settings(), default_queue_name=queue_name())
        await pool.enqueue_job(WORKER_FUNCTION, job_id, _queue_name=queue_name())
    except (RedisError, OSError) as exc:
        raise ApiError(
            status_code=503,
            code=QUEUE_UNAVAILABLE,
            message=f"仿真队列不可用：{exc}",
        ) from exc
    finally:
        if pool is not None:
            await pool.aclose()


def check_daily_quota(session: Session) -> None:
    """今天的仿真次数用完了就拒掉。

    次数从 ``simulation_results`` 数出来——不另建计数表。
    """
    used = count_runs_since(session, day_start())
    if used >= settings.simulation_max_runs_per_day:
        raise ApiError(
            status_code=429,
            code=QUOTA_EXCEEDED,
            message=(f"今天的仿真次数已用完（{used}/{settings.simulation_max_runs_per_day}）"),
        )
