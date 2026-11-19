"""TripoSR 本地推理的 HTTP 接口。

四个端点：

* ``POST /api/triposr``                    提交一次单图生成 → 202
* ``GET  /api/triposr``                    最近 50 条任务
* ``GET  /api/triposr/{jobId}``            单个任务的状态
* ``GET  /api/triposr/{jobId}/model.glb``  下载产物（未完成 → 409）

与渲染同一套约定：**环境缺东西一律 503**（缺 venv / 缺 run.py / 缺权重），
并说清楚缺什么、先做什么——不报 500，也不假装提交成功。
输入图不合法是 422，图太大是 413 ``triposr_image_too_large``。

推理是本机 CPU 的分钟级任务，走 BackgroundTasks——
提交立刻返回，前端轮询状态、最后取产物。
"""

from __future__ import annotations

import uuid
from pathlib import Path as FsPath

from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Path, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.schemas import TripoJobAccepted, TripoJobDetail, TripoJobSummary
from app.services import triposr_service

router = APIRouter(prefix="/triposr", tags=["triposr"])


def _to_summary(job: triposr_service.TripoJob) -> TripoJobSummary:
    return TripoJobSummary(
        job_id=job.job_id,
        status=job.status,
        label=job.label,
        image_name=job.image_name,
        created_at=job.created_at,
        duration_ms=job.duration_ms,
    )


def _to_detail(job: triposr_service.TripoJob) -> TripoJobDetail:
    return TripoJobDetail(
        job_id=job.job_id,
        status=job.status,
        label=job.label,
        image_name=job.image_name,
        error=job.error,
        # 只有真的成了才有产物地址
        artifact_url=(
            triposr_service.artifact_url(job.job_id)
            if job.status == triposr_service.JOB_SUCCEEDED
            else None
        ),
        duration_ms=job.duration_ms,
        created_at=job.created_at,
    )


def _image_suffix(upload: UploadFile) -> str:
    """从文件名取扩展名；认不出的按内容类型兜底。

    PIL 按内容而不是按后缀读图，这里只是让落盘文件名诚实一点。
    """
    name = upload.filename or ""
    suffix = FsPath(name).suffix.lower()
    if suffix in triposr_service.ALLOWED_IMAGE_SUFFIXES:
        return suffix
    content_type = (upload.content_type or "").lower()
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(content_type, ".png")


@router.post(
    "",
    response_model=TripoJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="提交一次单图生成 3D",
)
def create_triposr_job(
    background_tasks: BackgroundTasks,
    image: UploadFile = File(...),
    label: str | None = Form(default=None, max_length=200),
    session: Session = Depends(get_session),
) -> TripoJobAccepted:
    """提交任务并排队。

    先落库再排队：后台任务拿到 jobId 时，行必须已经在。
    前置检查（环境 / 图片）在落库前做完——不能收下一个注定跑不动的任务，
    也不能假装提交成功。
    """
    triposr_service.check_environment()

    content_type = (image.content_type or "").lower()
    if content_type not in triposr_service.ALLOWED_IMAGE_TYPES:
        raise ApiError(
            status_code=422,
            code=triposr_service.IMAGE_INVALID,
            message=(
                "输入图类型不认识 —— 只收 png / jpeg / webp，"
                f"收到 Content-Type：{content_type or '空'}"
            ),
        )

    payload = image.file.read()
    if not payload:
        raise ApiError(
            status_code=422,
            code=triposr_service.IMAGE_INVALID,
            message="输入图是空的 —— 一张能看清主体的图片才生成得出来。",
        )
    max_bytes = settings.triposr_max_image_bytes
    if len(payload) > max_bytes:
        raise ApiError(
            status_code=413,
            code=triposr_service.IMAGE_TOO_LARGE,
            message=(f"输入图太大：{len(payload)} 字节，上限 {max_bytes} 字节 —— 压一压再传。"),
        )

    job_id = uuid.uuid4().hex
    workdir = triposr_service.job_dir(job_id)
    workdir.mkdir(parents=True, exist_ok=True)
    image_path = workdir / f"input{_image_suffix(image)}"
    image_path.write_bytes(payload)

    triposr_service.create_job(
        session,
        job_id=job_id,
        label=label,
        image_name=image.filename or "",
        image_path=str(image_path),
    )

    # 提交之后不再碰数据库：后台任务会另开一个 session，
    # 同一个连接上重入事务会打架。
    background_tasks.add_task(triposr_service.execute_job, job_id)
    return TripoJobAccepted(job_id=job_id)


@router.get(
    "",
    response_model=list[TripoJobSummary],
    response_model_exclude_none=True,
    summary="列出最近的 TripoSR 任务",
)
def list_triposr_jobs(session: Session = Depends(get_session)) -> list[TripoJobSummary]:
    return [_to_summary(job) for job in triposr_service.list_jobs(session)]


@router.get(
    "/{jobId}",
    response_model=TripoJobDetail,
    response_model_exclude_none=True,
    summary="读取一个 TripoSR 任务的状态",
)
def get_triposr_job(
    job_id: str = Path(alias="jobId"), session: Session = Depends(get_session)
) -> TripoJobDetail:
    job = triposr_service.get_job(session, job_id)
    if job is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=triposr_service.NOT_FOUND,
            message=f"TripoSR 任务不存在：{job_id}",
        )
    return _to_detail(job)


@router.get(
    "/{jobId}/model.glb",
    summary="下载生成的模型",
    response_class=FileResponse,
)
def get_triposr_model(
    job_id: str = Path(alias="jobId"), session: Session = Depends(get_session)
) -> FileResponse:
    """拿 GLB。

    * 还没跑完 → 409 ``tripo_not_ready``（稍后再来）
    * 跑挂了 → 500 ``triposr_inference_failed``，detail 里是最后一步的 stderr 摘要
    """
    job = triposr_service.get_job(session, job_id)
    if job is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=triposr_service.NOT_FOUND,
            message=f"TripoSR 任务不存在：{job_id}",
        )

    if job.status == triposr_service.JOB_SUCCEEDED:
        model = triposr_service.model_file(job)
        if model is not None:
            return FileResponse(
                model,
                media_type="model/gltf-binary",
                filename=f"{job_id}.glb",
            )
        raise ApiError(
            status_code=500,
            code=triposr_service.INFERENCE_FAILED,
            message="产物不在了——磁盘上找不到那个文件。",
            detail=job.model_path,
        )

    if job.status == triposr_service.JOB_FAILED:
        raise ApiError(
            status_code=500,
            code=triposr_service.INFERENCE_FAILED,
            message=job.error or "推理失败。",
            detail=job.error_detail or job.error,
        )

    raise ApiError(
        status_code=409,
        code=triposr_service.NOT_READY,
        message=f"推理还没完成（当前状态：{job.status}），CPU 推理是分钟级，稍后再来。",
    )
