"""云端「生成 3D」的 HTTP 接口（混元生 3D / 百炼 Tripo）。

端点（全部吃 ``X-Owner-Token`` 软身份，与 LLM 托管同一约定）：

* ``GET    /api/model3d/providers``                     供应商目录 + 这个 owner 配没配 key
* ``GET    /api/model3d/keys``                          各家配没配
* ``POST   /api/model3d/keys``                          托管一把密钥（形状当场核）
* ``DELETE /api/model3d/keys/{providerId}``             删掉一把
* ``POST   /api/model3d/cloud/jobs``                    提交生成任务 → 202
* ``GET    /api/model3d/cloud/jobs``                    自己最近的任务
* ``GET    /api/model3d/cloud/jobs/{jobId}``            任务详情
* ``GET    /api/model3d/cloud/jobs/{jobId}/model.glb``  下载产物

任务跑在**供应商侧**：输入（文本 / 图片）要出本机——界面上如实说明；
key 只在后端进程内解密使用，绝不回传前端。
"""

from __future__ import annotations

import uuid
from pathlib import Path as FsPath

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, File, Form, Path, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_session
from app.errors import ApiError
from app.routers.llm import require_owner_token
from app.schemas import (
    Model3dJobAccepted,
    Model3dJobDetail,
    Model3dJobSummary,
    Model3dKeyCreated,
    Model3dKeyStatus,
    Model3dKeyUpsertRequest,
    Model3dProviderInfo,
)
from app.services import key_vault, model3d_cloud

router = APIRouter(prefix="/model3d", tags=["model3d"])


def _to_summary(job: model3d_cloud.Model3dCloudJob) -> Model3dJobSummary:
    return Model3dJobSummary(
        job_id=job.job_id,
        provider_id=job.provider_id,
        status=job.status,
        label=job.label,
        prompt=job.prompt,
        image_name=job.image_name,
        created_at=job.created_at,
        duration_ms=job.duration_ms,
    )


def _to_detail(job: model3d_cloud.Model3dCloudJob) -> Model3dJobDetail:
    return Model3dJobDetail(
        job_id=job.job_id,
        provider_id=job.provider_id,
        status=job.status,
        label=job.label,
        prompt=job.prompt,
        image_name=job.image_name,
        remote_task_id=job.remote_task_id,
        error=job.error,
        error_code=job.error_code,
        artifact_url=(
            model3d_cloud.artifact_url(job.job_id)
            if job.status == model3d_cloud.JOB_SUCCEEDED
            else None
        ),
        duration_ms=job.duration_ms,
        created_at=job.created_at,
    )


def _own_job(session: Session, job_id: str, owner_token: str) -> model3d_cloud.Model3dCloudJob:
    """取**自己的**任务。别人的任务与不存在的任务一律 404——不外泄存在性。"""
    job = model3d_cloud.get_job(session, job_id)
    if job is None or job.owner_token != owner_token:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=model3d_cloud.NOT_FOUND,
            message=f"云端 3D 任务不存在：{job_id}",
        )
    return job


# --------------------------------------------------------------------------
# 目录与密钥
# --------------------------------------------------------------------------


@router.get(
    "/providers",
    response_model=list[Model3dProviderInfo],
    response_model_exclude_none=True,
    summary="云端 3D 供应商目录（计费 / 授权 / 限制如实标注）",
)
def list_providers(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> list[Model3dProviderInfo]:
    configured = {row.provider_id for row in key_vault.list_keys(session, owner_token)}
    return [
        Model3dProviderInfo(
            provider_id=provider.provider_id,
            name=provider.name,
            auth_kind=provider.auth_kind,
            available=provider.available,
            supports_prompt=provider.supports_prompt,
            supports_image_upload=provider.supports_image_upload,
            free_tier=provider.free_tier,
            cost_note=provider.cost_note,
            license_note=provider.license_note,
            note=provider.note,
            docs_url=provider.docs_url,
            configured=provider.provider_id in configured,
        )
        for provider in model3d_cloud.MODEL3D_PROVIDERS
    ]


@router.get(
    "/keys",
    response_model=list[Model3dKeyStatus],
    summary="查各供应商密钥配没配",
)
def list_keys(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> list[Model3dKeyStatus]:
    """只回「配没配」——绝不回 key、密文、盐或口令。"""
    rows = {row.provider_id: row for row in key_vault.list_keys(session, owner_token)}
    return [
        Model3dKeyStatus(
            provider_id=provider.provider_id,
            configured=provider.provider_id in rows,
            updated_at=(
                rows[provider.provider_id].updated_at if provider.provider_id in rows else None
            ),
        )
        for provider in model3d_cloud.MODEL3D_PROVIDERS
    ]


@router.post(
    "/keys",
    response_model=Model3dKeyCreated,
    status_code=status.HTTP_201_CREATED,
    summary="托管一把云端 3D 密钥",
)
def upsert_key(
    payload: Model3dKeyUpsertRequest,
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> Model3dKeyCreated:
    """托管（或覆盖）一把云端 3D 密钥。服务端只存密文。

    形状按供应商分：混元要 SecretId + SecretKey（TC3 签名是一对），
    百炼要 sk- 开头的 API Key（可选 workspaceId）。形状不对当场 422——
    存一把必然调不通的 key，用户只会在几分钟后的任务失败里看到指不到原因的错。
    """
    provider = model3d_cloud.find_provider(payload.provider_id)
    if provider is None:
        raise ApiError(
            status_code=422,
            code=model3d_cloud.PROVIDER_UNKNOWN,
            message=f"不认识的 3D 供应商：{payload.provider_id}",
        )
    if not provider.available:
        raise ApiError(
            status_code=422,
            code=model3d_cloud.PROVIDER_UNAVAILABLE,
            message=f"{provider.name} 当前不能调 API——{provider.note}",
        )

    raw: dict[str, str] = {}
    if payload.provider_id == "hunyuan3d":
        if payload.secret_id is not None:
            raw["secretId"] = payload.secret_id
        if payload.secret_key is not None:
            raw["secretKey"] = payload.secret_key
    elif payload.provider_id == "bailian-tripo":
        if payload.api_key is not None:
            raw["apiKey"] = payload.api_key
        if payload.workspace_id is not None:
            raw["workspaceId"] = payload.workspace_id

    canonical = model3d_cloud.validate_key_payload(payload.provider_id, raw)
    key_vault.store_key(session, owner_token, payload.provider_id, canonical, payload.passphrase)
    return Model3dKeyCreated(provider_id=payload.provider_id, configured=True)


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
            code=model3d_cloud.KEY_MISSING,
            message=f"没有托管 key：{provider_id}",
        )


# --------------------------------------------------------------------------
# 生成任务
# --------------------------------------------------------------------------


def _image_suffix(upload: UploadFile) -> str:
    """从文件名取扩展名；认不出的按内容类型兜底（与本地 TripoSR 同一规则）。"""
    name = upload.filename or ""
    suffix = FsPath(name).suffix.lower()
    if suffix in model3d_cloud.ALLOWED_IMAGE_SUFFIXES:
        return suffix
    content_type = (upload.content_type or "").lower()
    return {
        "image/png": ".png",
        "image/jpeg": ".jpg",
        "image/webp": ".webp",
    }.get(content_type, ".png")


@router.post(
    "/cloud/jobs",
    response_model=Model3dJobAccepted,
    status_code=status.HTTP_202_ACCEPTED,
    summary="提交一次云端生成 3D（混元 / 百炼）",
)
def create_cloud_job(
    background_tasks: BackgroundTasks,
    provider_id: str = Form(..., alias="providerId"),
    prompt: str | None = Form(
        default=None,
        max_length=model3d_cloud.MAX_PROMPT_CHARS,
        alias="prompt",
    ),
    image_url: str | None = Form(default=None, max_length=2048, alias="imageUrl"),
    label: str | None = Form(default=None, max_length=200, alias="label"),
    image: UploadFile | None = File(default=None),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
    transport: httpx.BaseTransport | None = Depends(model3d_cloud.get_transport),
) -> Model3dJobAccepted:
    """提交任务并排队。

    输入三选一且互斥（Prompt / 上传图片 / 公网图片 URL），
    每家支持什么由目录决定——不收的输入当场 422，不收了再失败。
    先落库再排队：后台任务拿到 jobId 时，行必须已经在。
    """
    provider = model3d_cloud.find_provider(provider_id)
    if provider is None:
        raise ApiError(
            status_code=422,
            code=model3d_cloud.PROVIDER_UNKNOWN,
            message=f"不认识的 3D 供应商：{provider_id}",
        )
    if not provider.available:
        raise ApiError(
            status_code=422,
            code=model3d_cloud.PROVIDER_UNAVAILABLE,
            message=f"{provider.name} 当前不能调 API——{provider.note}",
        )

    quota_limit = settings.model3d_max_jobs_per_day
    used = model3d_cloud.count_today(session, owner_token)
    if used >= quota_limit:
        # key 是用户自己的——额度管着别让一次误操作烧穿额度
        raise ApiError(
            status_code=429,
            code=model3d_cloud.QUOTA_EXCEEDED,
            message=f"今天的云端生成额度用完了（{quota_limit} 次/天，key 烧的是你自己的钱）",
        )

    prompt_text = prompt.strip() if prompt else None
    image_url_text = image_url.strip() if image_url else None
    given = [
        name
        for name, value in (
            ("prompt", prompt_text),
            ("image", image),
            ("image_url", image_url_text),
        )
        if value
    ]
    if len(given) != 1:
        raise ApiError(
            status_code=422,
            code=model3d_cloud.INPUT_INVALID,
            message="Prompt / 图片文件 / 图片 URL 三选一（互斥）——多给、少给都不收",
        )
    if prompt_text and not provider.supports_prompt:
        raise ApiError(
            status_code=422,
            code=model3d_cloud.INPUT_INVALID,
            message=f"{provider.name} 不支持文生 3D",
        )
    if image is not None:
        if not provider.supports_image_upload:
            raise ApiError(
                status_code=422,
                code=model3d_cloud.IMAGE_UPLOAD_UNSUPPORTED,
                message=f"{provider.name} 不收上传的文件——{provider.note}",
            )
        content_type = (image.content_type or "").lower()
        if content_type not in model3d_cloud.ALLOWED_IMAGE_TYPES:
            raise ApiError(
                status_code=422,
                code=model3d_cloud.INPUT_INVALID,
                message=(
                    "输入图类型不认识——只收 png / jpeg / webp，"
                    f"收到 Content-Type：{content_type or '空'}"
                ),
            )
    if image_url_text and not image_url_text.lower().startswith(("http://", "https://")):
        raise ApiError(
            status_code=422,
            code=model3d_cloud.INPUT_INVALID,
            message="图片 URL 要是 http(s) 地址",
        )

    job_id = uuid.uuid4().hex
    workdir = model3d_cloud.job_dir(job_id)
    workdir.mkdir(parents=True, exist_ok=True)

    image_name = ""
    image_path = ""
    if image is not None:
        image_payload = image.file.read()
        if not image_payload:
            raise ApiError(
                status_code=422,
                code=model3d_cloud.INPUT_INVALID,
                message="输入图是空的",
            )
        max_bytes = settings.model3d_max_image_bytes
        if len(image_payload) > max_bytes:
            raise ApiError(
                status_code=413,
                code=model3d_cloud.IMAGE_TOO_LARGE,
                message=f"输入图太大：{len(image_payload)} 字节，上限 {max_bytes} 字节——压一压再传",
            )
        image_name = image.filename or ""
        image_path = str(workdir / f"input{_image_suffix(image)}")
        FsPath(image_path).write_bytes(image_payload)

    model3d_cloud.create_job(
        session,
        job_id=job_id,
        provider_id=provider_id,
        owner_token=owner_token,
        label=label,
        prompt=prompt_text,
        image_name=image_name,
        image_path=image_path,
        image_url=image_url_text,
    )

    # 提交之后不再碰数据库：后台任务会另开一个 session（与本地推理同一约定）
    background_tasks.add_task(model3d_cloud.execute_job, job_id, transport=transport)
    return Model3dJobAccepted(job_id=job_id)


@router.get(
    "/cloud/jobs",
    response_model=list[Model3dJobSummary],
    response_model_exclude_none=True,
    summary="列出自己最近的云端生成任务",
)
def list_cloud_jobs(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> list[Model3dJobSummary]:
    return [_to_summary(job) for job in model3d_cloud.list_jobs(session, owner_token)]


@router.get(
    "/cloud/jobs/{jobId}",
    response_model=Model3dJobDetail,
    response_model_exclude_none=True,
    summary="读取一个云端生成任务的状态",
)
def get_cloud_job(
    job_id: str = Path(alias="jobId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> Model3dJobDetail:
    return _to_detail(_own_job(session, job_id, owner_token))


@router.get(
    "/cloud/jobs/{jobId}/model.glb",
    summary="下载生成的模型",
    response_class=FileResponse,
)
def get_cloud_model(
    job_id: str = Path(alias="jobId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> FileResponse:
    """拿 GLB。还没跑完 → 409；跑挂了 → 500（语义与本地推理一致）。"""
    job = _own_job(session, job_id, owner_token)

    if job.status == model3d_cloud.JOB_SUCCEEDED:
        model = model3d_cloud.get_job_model_file(job)
        if model is not None:
            return FileResponse(
                model,
                media_type="model/gltf-binary",
                filename=f"{job_id}.glb",
            )
        raise ApiError(
            status_code=500,
            code=model3d_cloud.GENERATION_FAILED,
            message="产物不在了——磁盘上找不到那个文件。",
            detail=job.model_path,
        )

    if job.status == model3d_cloud.JOB_FAILED:
        raise ApiError(
            status_code=500,
            code=model3d_cloud.GENERATION_FAILED,
            message=job.error or "生成失败。",
            detail=job.error_detail or job.error,
        )

    raise ApiError(
        status_code=409,
        code=model3d_cloud.NOT_READY,
        message=f"生成还没完成（当前状态：{job.status}），云端任务通常秒级到分钟级，稍后再来。",
    )
