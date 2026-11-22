"""用户上传模型的 HTTP 接口。

四个端点，全部挂 ``require_owner_token``（与 LLM 托管同一套软身份约定）：

* ``POST /api/models/upload``             multipart 上传 → 201
* ``GET  /api/models``                    当前 owner 的列表（created_at 倒序）
* ``DELETE /api/models/{publicId}``       删记录 + 删文件 → 204
* ``GET  /api/models/{publicId}/file``    下载文件（越权与不存在统一 404）

服务端只校验**扩展名与大小**，不解析模型内容——能不能渲染归前端的三种
loader 管。列表与文件端点都按 ``owner_hash`` 过滤，别人的模型既看不见也下不动。
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, File, Form, Path, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_session
from app.errors import ApiError
from app.models import ModelUpload
from app.routers.llm import require_owner_token
from app.schemas import ModelUploadCreated, ModelUploadList
from app.services import model_files

router = APIRouter(prefix="/models", tags=["models"])

# 上传大小上限（字节）。模块常量：测试用 monkeypatch 换成小值，不真造 51MB 文件。
MODEL_UPLOAD_MAX_BYTES = 50 * 1024 * 1024

# 扩展名白名单（小写）。gltf 引用外部资源的场景服务端方案不覆盖，
# 但先收下来——前端上传处会对 .gltf 给出提示，不拦截。
ALLOWED_FORMATS = ("glb", "gltf", "obj", "fbx")

# 分类白名单，与前端 ModelLibrary 的三个 tab 一致。
ALLOWED_CATEGORIES = ("characters", "environments", "props")

# 下载时的 Content-Type，按格式映射（不猜 content_type 上传头自报的值）。
FORMAT_CONTENT_TYPES = {
    "glb": "model/gltf-binary",
    "gltf": "model/gltf+json",
    "obj": "text/plain",
    "fbx": "application/octet-stream",
}

NOT_FOUND = "model_not_found"
UPLOAD_INVALID = "model_upload_invalid"
UPLOAD_TOO_LARGE = "model_upload_too_large"


def _owner_hash(owner_token: str) -> str:
    return model_files.owner_hash_of(owner_token)


def _find_owned(session: Session, owner_token: str, public_id: str) -> ModelUpload | None:
    """按 public_id + owner 双条件查行——别人的行当它不存在。"""
    stmt = select(ModelUpload).where(
        ModelUpload.public_id == public_id,
        ModelUpload.owner_hash == _owner_hash(owner_token),
    )
    return session.scalars(stmt).first()


def _file_suffix(upload: UploadFile) -> str:
    """从原始文件名取扩展名（小写）。没有扩展名或不在白名单 → 422。"""
    name = upload.filename or ""
    suffix = name.rsplit(".", 1)[-1].lower() if "." in name else ""
    if suffix not in ALLOWED_FORMATS:
        allowed = " / ".join(ALLOWED_FORMATS)
        raise ApiError(
            status_code=422,
            code=UPLOAD_INVALID,
            message=(
                f"不支持的模型格式「{suffix or '无扩展名'}」——"
                f"只收 {allowed}，文件名要带对应扩展名。"
            ),
        )
    return suffix


def _check_category(category: str) -> str:
    if category not in ALLOWED_CATEGORIES:
        allowed = " / ".join(ALLOWED_CATEGORIES)
        raise ApiError(
            status_code=422,
            code=UPLOAD_INVALID,
            message=f"分类只能是 {allowed}，收到「{category}」。",
        )
    return category


@router.post(
    "/upload",
    response_model=ModelUploadCreated,
    status_code=status.HTTP_201_CREATED,
    summary="上传一个模型文件（multipart）",
)
def upload_model(
    file: UploadFile = File(...),
    name: str = Form(min_length=1, max_length=200),
    category: str = Form(),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> ModelUploadCreated:
    """落盘 + 落库，返回持久 URL。

    先校验（扩展名 / 分类 / 大小）再写任何东西——不收一个注定要拒的文件。
    文件先落盘、行后入库：入库失败磁盘上最多留一个孤儿文件，
    反过来则会留下一条指向不存在文件的记录。
    """
    fmt = _file_suffix(file)
    _check_category(category)

    payload = file.file.read()
    if not payload:
        raise ApiError(
            status_code=422,
            code=UPLOAD_INVALID,
            message="上传的文件是空的。",
        )
    if len(payload) > MODEL_UPLOAD_MAX_BYTES:
        raise ApiError(
            status_code=413,
            code=UPLOAD_TOO_LARGE,
            message=(
                f"模型文件太大：{len(payload)} 字节，上限 {MODEL_UPLOAD_MAX_BYTES} 字节。"
            ),
        )

    public_id = uuid.uuid4().hex
    owner_hash = _owner_hash(owner_token)
    model_files.save_model_file(owner_hash, public_id, fmt, payload)

    row = ModelUpload(
        public_id=public_id,
        name=name,
        category=category,
        format=fmt,
        size=len(payload),
        owner_hash=owner_hash,
    )
    session.add(row)
    session.commit()
    session.refresh(row)

    return ModelUploadCreated(
        id=row.public_id,
        name=row.name,
        category=row.category,
        format=row.format,
        size=row.size,
        model_url=f"/api/models/{row.public_id}/file",
        created_at=row.created_at,
        poly_count=row.poly_count,
        material_count=row.material_count,
        has_animation=row.has_animation,
        persisted=True,
    )


@router.get(
    "",
    response_model=ModelUploadList,
    summary="列出当前 owner 的上传模型（created_at 倒序）",
)
def list_models(
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> ModelUploadList:
    stmt = (
        select(ModelUpload)
        .where(ModelUpload.owner_hash == _owner_hash(owner_token))
        .order_by(ModelUpload.created_at.desc(), ModelUpload.id.desc())
    )
    rows = session.scalars(stmt).all()
    return ModelUploadList(
        items=[
            ModelUploadCreated(
                id=row.public_id,
                name=row.name,
                category=row.category,
                format=row.format,
                size=row.size,
                model_url=f"/api/models/{row.public_id}/file",
                created_at=row.created_at,
                poly_count=row.poly_count,
                material_count=row.material_count,
                has_animation=row.has_animation,
                persisted=True,
            )
            for row in rows
        ]
    )


@router.delete(
    "/{publicId}",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="删除一个上传模型（记录与文件一起删）",
)
def delete_model(
    public_id: str = Path(alias="publicId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> None:
    row = _find_owned(session, owner_token, public_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=NOT_FOUND,
            message=f"模型不存在：{public_id}",
        )

    model_files.delete_model_file(
        model_files.model_file_path(row.owner_hash, row.public_id, row.format)
    )
    session.delete(row)
    session.commit()


@router.get(
    "/{publicId}/file",
    response_class=FileResponse,
    summary="下载上传的模型文件",
)
def get_model_file(
    public_id: str = Path(alias="publicId"),
    owner_token: str = Depends(require_owner_token),
    session: Session = Depends(get_session),
) -> FileResponse:
    """按 owner 隔离的文件端点：越权与不存在统一 404，不泄露别的 owner 有什么。"""
    row = _find_owned(session, owner_token, public_id)
    if row is None:
        raise ApiError(
            status_code=status.HTTP_404_NOT_FOUND,
            code=NOT_FOUND,
            message=f"模型不存在：{public_id}",
        )

    path = model_files.model_file_path(row.owner_hash, row.public_id, row.format)
    if not path.is_file():
        raise ApiError(
            status_code=500,
            code=NOT_FOUND,
            message="文件不在了——磁盘上找不到那个文件。",
            detail=str(path),
        )

    return FileResponse(
        path,
        media_type=FORMAT_CONTENT_TYPES.get(row.format, "application/octet-stream"),
        filename=f"{row.public_id}.{row.format}",
    )
