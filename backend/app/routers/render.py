"""服务端渲染的 HTTP 接口。

四个端点（规格 §3）：

* ``POST /api/render``                  提交一次渲染 → 202
* ``GET  /api/render``                  最近 50 条任务
* ``GET  /api/render/{jobId}``          单个任务的状态
* ``GET  /api/render/{jobId}/video.mp4``  下载产物（未完成 → 409）

**环境缺东西一律 503**（缺 dist / 缺 Chrome / 缺 ffmpeg），
并说清楚缺什么、先做什么——不报 500，也不假装提交成功。
场景本身不能渲染是 422 ``render_scene_invalid``。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, BackgroundTasks, Depends, Path, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.schemas import (
    RenderCreateRequest,
    RenderJobAccepted,
    RenderJobDetail,
    RenderJobSummary,
)
from app.services import render_service

router = APIRouter(prefix="/render", tags=["render"])


def _to_summary(job: render_service.RenderJob) -> RenderJobSummary:
    return RenderJobSummary(
        job_id=job.job_id,
        status=job.status,
        label=job.label,
        created_at=job.created_at,
        duration_ms=job.duration_ms,
    )


def _to_detail(job: render_service.RenderJob) -> RenderJobDetail:
    return RenderJobDetail(
        job_id=job.job_id,
        status=job.status,
        progress=job.progress,
        error=job.error,
        # 只有真的成了才有产物地址
        artifact_url=(
            render_service.artifact_url(job.job_id)
            if job.status == render_service.JOB_SUCCEEDED
            else None
        ),
        duration_ms=job.duration_ms,
        created_at=job.created_at,
    )


@router.post(
    "",
    response_model=RenderJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="提交一次服务端渲染",
)
def create_render(
    payload: RenderCreateRequest,
    background_tasks: BackgroundTasks,
    session: Session = Depends(get_session),
) -> RenderJobAccepted:
    """提交任务并排队。

    先落库再排队：后台任务拿到 jobId 时，行必须已经在。
    前置检查（场景 / 环境）在落库前做完——不能收下一个注定跑不动的任务，
    也不能假装提交成功。
    """
    render_service.validate_scene(payload.scene)
    render_service.check_environment()

    if payload.frames > settings.render_max_frames:
        raise ApiError(
            status_code=422,
            code="validation_error",
            message=(f"单次渲染最多 {settings.render_max_frames} 帧，收到 {payload.frames} 帧"),
        )

    # H.264 的 yuv420p 要求宽高都是偶数——现在拒掉，
    # 比等录制器开着浏览器跑起来再失败快得多。
    if payload.width % 2 != 0 or payload.height % 2 != 0:
        raise ApiError(
            status_code=422,
            code="validation_error",
            message=(f"宽高必须是偶数（yuv420p 要求），收到 {payload.width}×{payload.height}"),
        )

    job_id = uuid.uuid4().hex
    job = render_service.create_job(
        session,
        job_id=job_id,
        label=payload.label,
        scene=payload.scene,
        actions=[action.model_dump(by_alias=True, exclude_none=True) for action in payload.actions],
        frames=payload.frames,
        fps=payload.fps,
        width=payload.width,
        height=payload.height,
    )

    # 提交之后不再碰数据库：后台任务会另开一个 session，
    # 同一个连接上重入事务会打架。
    background_tasks.add_task(render_service.execute_job, job.job_id)
    return RenderJobAccepted(job_id=job.job_id)


@router.get(
    "",
    response_model=list[RenderJobSummary],
    response_model_exclude_none=True,
    summary="列出最近的服务端渲染",
)
def list_renders(session: Session = Depends(get_session)) -> list[RenderJobSummary]:
    return [_to_summary(job) for job in render_service.list_jobs(session)]


@router.get(
    "/{jobId}",
    response_model=RenderJobDetail,
    response_model_exclude_none=True,
    summary="读取一个渲染任务的状态",
)
def get_render(
    job_id: str = Path(alias="jobId"), session: Session = Depends(get_session)
) -> RenderJobDetail:
    job = render_service.get_job(session, job_id)
    if job is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=render_service.NOT_FOUND,
            message=f"渲染任务不存在：{job_id}",
        )
    return _to_detail(job)


@router.get(
    "/{jobId}/video.mp4",
    summary="下载渲染产物",
    response_class=FileResponse,
)
def get_render_video(
    job_id: str = Path(alias="jobId"), session: Session = Depends(get_session)
) -> FileResponse:
    """拿视频。

    * 还没跑完 → 409 ``render_not_ready``（稍后再来）
    * 跑挂了 → 500 ``render_failed``，detail 里是最后一步的 stderr 摘要
    """
    job = render_service.get_job(session, job_id)
    if job is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=render_service.NOT_FOUND,
            message=f"渲染任务不存在：{job_id}",
        )

    if job.status == render_service.JOB_SUCCEEDED:
        video = render_service.video_file(job)
        if video is not None:
            return FileResponse(video, media_type="video/mp4", filename=f"{job_id}.mp4")
        raise ApiError(
            status_code=500,
            code=render_service.RENDER_FAILED,
            message="渲染产物不在了——磁盘上找不到那个文件。",
            detail=job.video_path,
        )

    if job.status == render_service.JOB_FAILED:
        raise ApiError(
            status_code=500,
            code=render_service.RENDER_FAILED,
            message=job.error or "渲染失败。",
            detail=job.error_detail or job.error,
        )

    raise ApiError(
        status_code=409,
        code=render_service.NOT_READY,
        message=f"渲染还没完成（当前状态：{job.status}）。",
    )
