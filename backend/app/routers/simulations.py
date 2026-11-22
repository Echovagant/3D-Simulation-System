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
from collections.abc import Mapping

from fastapi import APIRouter, Depends, Path, Request, status
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.models import SimulationJob
from app.schemas import (
    SimulationCreateRequest,
    SimulationJobAccepted,
    SimulationJobStatus,
    SimulationParams,
    SimulationResultsResponse,
    SimulationRun,
    SimulationSummary,
)
from app.services import simulation_service, simulator

router = APIRouter(prefix="/simulations", tags=["simulations"])

# 顶层已知键 = SimulationCreateRequest 的字段（label / scene / params / sweep）。
# params 层的已知键以 simulator._KNOWN_PARAM_KEYS 为唯一真相源（仿真器读的就是
# 这些 camelCase 键）；再并上 API schema 的字段名——populate_by_name 让
# snake_case 拼写也能落进 schema 并真实生效，生效的键不能算「被忽略」。
_KNOWN_TOP_LEVEL_KEYS = frozenset({"label", "scene", "params", "sweep"})
_KNOWN_PARAM_KEYS = simulator._KNOWN_PARAM_KEYS | set(SimulationParams.model_fields)


def _collect_ignored_keys(raw_body: Mapping[str, object]) -> list[str]:
    """收集请求体里会被静默丢弃的未知键：顶层与 ``params`` 两个层级。

    对照上方的已知键口径，**宽容接收 + 如实上报**：未知键不拒绝请求
    （不 422），只进 202 响应的 ``ignoredKeys``。排序保证上报顺序稳定。
    """
    unknown: set[str] = {key for key in raw_body if key not in _KNOWN_TOP_LEVEL_KEYS}
    raw_params = raw_body.get("params")
    if isinstance(raw_params, Mapping):
        unknown |= {key for key in raw_params if key not in _KNOWN_PARAM_KEYS}
    return sorted(unknown)


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
    response_model_exclude_none=True,
    status_code=status.HTTP_202_ACCEPTED,
    summary="提交一次批量仿真",
)
async def create_simulation(
    request: Request, payload: SimulationCreateRequest, session: Session = Depends(get_session)
) -> SimulationJobAccepted:
    """提交任务并排队。

    先落库再排队：worker 拿到队列消息时，行必须已经在。
    排队失败（Redis 不通）时把任务标成 failed，并如实返回 503。
    请求体里的未知键（顶层与 params 两层）被宽容忽略——但会在响应的
    ``ignoredKeys`` 里如实上报，不让「发错的参数」无声消失。
    """
    # 原始请求体：Pydantic 解析时会把 schema 外的键丢掉，上报要以原始体为准。
    # 能走到这里说明 body 已被 FastAPI 成功解析过（否则早就 422 了），缓存可复用。
    raw_body = await request.json()
    ignored_keys = _collect_ignored_keys(raw_body) if isinstance(raw_body, Mapping) else []

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

    return SimulationJobAccepted(job_id=job.job_id, ignored_keys=ignored_keys or None)


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
