"""批量仿真的 HTTP 接口。

四个端点：

* ``POST /api/simulations``            提交一次批量仿真 → 202
* ``GET  /api/simulations``            最近 50 条任务
* ``GET  /api/simulations/{jobId}``    单个任务的状态
* ``GET  /api/simulations/{jobId}/results``  这个任务的全部运行结果

**队列不通时返回 503 ``simulation_queue_unavailable``**——
不假装排队成功（队列不通就说队列不通）。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, Path, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.models import SimulationJob
from app.schemas import (
    SimulationCreateRequest,
    SimulationJobAccepted,
    SimulationJobStatus,
    SimulationResultsResponse,
    SimulationRun,
    SimulationSummary,
)
from app.services import simulation_service, simulator

router = APIRouter(prefix="/simulations", tags=["simulations"])


def _to_status(job: SimulationJob) -> SimulationJobStatus:
    return SimulationJobStatus(
        job_id=job.job_id,
        status=job.status,
        total=job.total,
        done=job.done,
        error=job.error,
        created_at=job.created_at,
        label=job.label,
    )


@router.post(
    "",
    response_model=SimulationJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="提交一次批量仿真",
)
async def create_simulation(
    payload: SimulationCreateRequest, session: Session = Depends(get_session)
) -> SimulationJobAccepted:
    """提交任务并排队。

    先落库再排队：worker 拿到队列消息时，行必须已经在。
    排队失败（Redis 不通）时把任务标成 failed，并如实返回 503。
    """
    # 按别名导出（camelCase）：仿真器读的也是 camelCase 的键
    params = payload.params.model_dump(by_alias=True, exclude_none=True) if payload.params else {}
    sweep = payload.sweep.model_dump(by_alias=True) if payload.sweep else None

    simulation_service.check_daily_quota(session)

    try:
        parsed = simulator.SimulationParams.from_mapping(params)
    except simulator.SimulationError as exc:
        raise ApiError(
            status_code=422,
            code="simulation_invalid_params",
            message=str(exc),
        ) from exc

    if parsed.steps > settings.simulation_max_steps:
        raise ApiError(
            status_code=422,
            code="simulation_invalid_params",
            message=(f"单次运行最多 {settings.simulation_max_steps} 步，收到 {parsed.steps} 步"),
        )

    total = simulation_service.plan_runs(sweep)
    if total > settings.simulation_max_runs_per_job:
        raise ApiError(
            status_code=422,
            code="simulation_invalid_params",
            message=(f"单次任务最多跑 {settings.simulation_max_runs_per_job} 次，收到 {total} 次"),
        )

    job_id = uuid.uuid4().hex
    job = simulation_service.create_job(
        session,
        job_id=job_id,
        label=payload.label,
        scene=payload.scene,
        params=params,
        sweep=sweep,
    )

    try:
        await simulation_service.enqueue(job.job_id)
    except ApiError:
        # 队列不通：任务留在库里并标成 failed，如实告诉调用方。
        simulation_service.mark_finished(
            session, job.job_id, simulation_service.JOB_FAILED, "队列不可用"
        )
        raise

    return SimulationJobAccepted(job_id=job.job_id)


@router.get(
    "",
    response_model=list[SimulationJobStatus],
    response_model_exclude_none=True,
    summary="列出最近的批量仿真",
)
def list_simulations(
    session: Session = Depends(get_session),
) -> list[SimulationJobStatus]:
    return [_to_status(job) for job in simulation_service.list_jobs(session)]


@router.get(
    "/{jobId}",
    response_model=SimulationJobStatus,
    response_model_exclude_none=True,
    summary="读取一个批量仿真任务的状态",
)
def get_simulation(
    job_id: str = Path(alias="jobId"), session: Session = Depends(get_session)
) -> SimulationJobStatus:
    job = simulation_service.get_job(session, job_id)
    if job is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="simulation_not_found",
            message=f"仿真任务不存在：{job_id}",
        )
    return _to_status(job)


@router.get(
    "/{jobId}/results",
    response_model=SimulationResultsResponse,
    response_model_exclude_none=True,
    summary="读取一个批量仿真的全部结果",
)
def get_simulation_results(
    job_id: str = Path(alias="jobId"), session: Session = Depends(get_session)
) -> SimulationResultsResponse:
    job = simulation_service.get_job(session, job_id)
    if job is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code="simulation_not_found",
            message=f"仿真任务不存在：{job_id}",
        )

    rows = simulation_service.list_results(session, job_id)
    runs = [SimulationRun.model_validate(row.payload) for row in rows]
    summary = simulator.summarize([row.payload for row in rows])
    return SimulationResultsResponse(
        runs=runs,
        summary=SimulationSummary.model_validate(summary),
    )
