"""云端「生成 3D」适配器（B-1 主线）：腾讯混元生 3D 专业版 + 阿里百炼 Tripo。

架构与既有套路一致（llm_proxy / triposr_service）：

1. **目录表**：每家一条，字段里写清计费、授权与限制——界面上如实
   展示，不替供应商说好话。目录结论全部来自
   ``D:\\Projects\\_audit-archive\\3dsim\\.tmp\\b1-providers.md``
   （2026-11-20 调研，官方文档逐页验证 + 本机直连实测）。
2. **最小客户端**：每家一个提交 / 查询函数，HTTP 传输层可注入
   （``httpx.BaseTransport``），测试不联网、不碰真 key。
3. **密钥**：复用 ``key_vault``（库里只有密文；明文只在内存）。
   混元存 ``{"secretId","secretKey"}``、百炼存 ``{"apiKey","workspaceId"?}``，
   都是按 provider_id 分槽的 JSON 密文。
4. **任务状态机**：``queued → running → succeeded | failed``，
   与本地 TripoSR 同一口径；轮询 → 下载产物 → 校验 GLB 头部 → 落盘，
   全程在后端，key 不出后端进程。

供应商清单（2026-11-20 状态）：

- **腾讯混元生 3D（专业版）**：``ai3d.tencentcloudapi.com``，
  API 3.0（TC3 签名），Version ``2025-05-13``，Region 必填；
  专业版 100 积分免费额度（控制台领取）；《大模型服务条款》4.3：
  生成内容的权利归用户所有（已验证）。
- **阿里百炼 Tripo**：``dashscope.aliyuncs.com``（北京地域），
  ``X-DashScope-Async: enable`` 异步任务；3D 无免费额度
  （新人额度不含 Tripo）；**图生 3D 只收公网图片 URL**
  （不收上传文件）——界面上必须如实说明；商用授权条款公开渠道
  未验证，开通时要在控制台弹窗逐字核对。
- **Rodin Hyper3D**：免费档**没有 API 权限**（Creator $30/月起）——
  目录里保留条目作对比基准，但 key 与任务一律拒绝
  （发一个必然失败的请求比不给入口更糟，这是 kit 的纪律）。

关于解密时机：后台任务用 ``passphrase=None`` 取明文——argon2id 模式下
KEK 在「托管 key」那一次请求里已进进程内存缓存；进程重启后缓存消失，
任务会失败并如实报 ``passphrase_required``（让用户重存 key），
绝不落盘任何明文。
"""

from __future__ import annotations

import base64
import hashlib
import hmac as hmac_mod
import io
import json
import logging
import time
import zipfile
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import ApiError
from app.models import Model3dCloudJob, utcnow
from app.services import key_vault, triposr_service

logger = logging.getLogger(__name__)

# 状态机：与 TripoSR / 渲染同一套口径
JOB_QUEUED = "queued"
JOB_RUNNING = "running"
JOB_SUCCEEDED = "succeeded"
JOB_FAILED = "failed"

# 错误码
PROVIDER_UNKNOWN = "model3d_provider_unknown"
PROVIDER_UNAVAILABLE = "model3d_provider_unavailable"
KEY_INVALID = "model3d_key_invalid"
KEY_MISSING = "model3d_key_missing"
KEY_UNAVAILABLE = "model3d_key_unavailable"
INPUT_INVALID = "model3d_input_invalid"
IMAGE_TOO_LARGE = "model3d_image_too_large"
IMAGE_UPLOAD_UNSUPPORTED = "model3d_image_upload_unsupported"
NOT_READY = "model3d_not_ready"
NOT_FOUND = "model3d_job_not_found"
GENERATION_FAILED = "model3d_generation_failed"
UPSTREAM_FAILED = "model3d_upstream_failed"
QUOTA_EXCEEDED = "model3d_quota_exceeded"

# 允许的输入图类型（与本地 TripoSR 同一口径）
ALLOWED_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
ALLOWED_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")

# 混元 Prompt 上限（官方文档：≤1024 个 utf-8 字符）
MAX_PROMPT_CHARS = 1024

# 任务列表一次最多回多少条
JOB_LIST_LIMIT = 50

# 混元生 3D 的固定端点参数（官方文档 2026-05-11 版，已验证）
HUNYUAN_HOST = "ai3d.tencentcloudapi.com"
HUNYUAN_SERVICE = "ai3d"
HUNYUAN_VERSION = "2025-05-13"
HUNYUAN_SUBMIT_ACTION = "SubmitHunyuanTo3DProJob"
HUNYUAN_QUERY_ACTION = "QueryHunyuanTo3DProJob"

# 百炼（北京地域）
BAILIAN_CREATE_URL = (
    "https://dashscope.aliyuncs.com/api/v1/services/aigc/video-generation/3d-generation"
)
BAILIAN_DEFAULT_TASK_HOST = "dashscope.aliyuncs.com"
BAILIAN_MODEL = "Tripo/Tripo-H3.1"

# 产物目录名（backend/backend_data/<name>/）
OUTPUT_DIR_NAME = "model3d"


# --------------------------------------------------------------------------
# 目录表
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Model3dProvider:
    """一家云端 3D 供应商的目录条目。

    与 LLM 的 ``LlmProvider`` 同一设计哲学：一条条目 = 一个可调用的
    端点组合，计费 / 授权 / 限制逐条如实标注，界面上原样展示。
    """

    provider_id: str
    name: str
    # "tc3"（SecretId+SecretKey，腾讯云 API 3.0）或 "bearer"（单把 API Key）
    auth_kind: str
    # 这家当前能不能调 API（Rodin 免费档无 API → False）
    available: bool
    supports_prompt: bool
    # 能不能收**上传的本地文件**（False = 只收公网 URL，比如百炼）
    supports_image_upload: bool
    free_tier: str | None
    cost_note: str | None
    license_note: str | None
    note: str | None
    docs_url: str | None


MODEL3D_PROVIDERS: tuple[Model3dProvider, ...] = (
    Model3dProvider(
        provider_id="hunyuan3d",
        name="腾讯混元生 3D（专业版）",
        auth_kind="tc3",
        available=True,
        supports_prompt=True,
        supports_image_upload=True,
        free_tier="专业版 100 积分/用户（控制台领取，1 年有效）",
        cost_note=("普通贴图 20 积分/次，PBR +10、多视角/FaceCount 另加；生成失败不扣积分"),
        license_note=("生成内容的权利归您所有（《大模型服务条款》4.3，2026-11-20 已验证）"),
        note=("并发默认 3；输出默认 OBJ+GLB 双格式；平台功能将逐步迁移至 TokenHub（关注迁移节奏）"),
        docs_url="https://cloud.tencent.com/document/api/1804/123447",
    ),
    Model3dProvider(
        provider_id="bailian-tripo",
        name="阿里百炼 Tripo-H3.1",
        auth_kind="bearer",
        available=True,
        supports_prompt=True,
        # 图生 3D 只收公网 URL——本地文件没有公网可达地址，收了也生成不了
        supports_image_upload=False,
        free_tier=None,
        cost_note=("0.07 元/积分：文生白模 10 积分 ≈ 0.7 元，带 2K 贴图另加 10 积分"),
        license_note=(
            "生成物商用授权条款公开渠道未验证——开通服务时请在控制台弹窗逐字核对（2026-11-20 调研）"
        ),
        note=("图生 3D 只收公网图片 URL（JPEG/PNG，建议边长 >256px，≤20MB）；结果链接 2 小时有效"),
        docs_url=("https://help.aliyun.com/zh/model-studio/tripo-3d-generation-api-reference"),
    ),
    Model3dProvider(
        provider_id="rodin",
        name="Rodin Hyper3D",
        auth_kind="bearer",
        # 免费档没有 API 权限——条目保留作对比基准，key 与任务一律拒绝
        available=False,
        supports_prompt=False,
        supports_image_upload=False,
        free_tier="免费档无 API 权限（仅网页端预览）",
        cost_note=("API 最低 Creator $30/月；默认 tier（Gen-2.5-Medium）需 Business $120/月"),
        license_note=("Rodin 输出用途不设限（付费档）；ChatAvatar 产品线的输出是非商用的，别混淆"),
        note="免费档连 API 都没有——本端不开放这条线，仅作对比基准",
        docs_url="https://docs.hyper3d.ai/en/get-started/quick-start",
    ),
)

_BY_ID = {provider.provider_id: provider for provider in MODEL3D_PROVIDERS}


def find_provider(provider_id: str) -> Model3dProvider | None:
    """按 id 找供应商条目。不认识就是 None。"""
    return _BY_ID.get(provider_id)


def get_transport() -> httpx.BaseTransport | None:
    """HTTP 传输层替身（与 ``llm_proxy.get_transport`` 同一套约定）。

    生产返回 None（走真实网络）。测试用依赖覆盖注入 ``httpx.MockTransport``。
    """
    return None


# --------------------------------------------------------------------------
# 密钥：校验与解析
# --------------------------------------------------------------------------


def validate_key_payload(provider_id: str, payload: dict[str, Any]) -> str:
    """校验一把云端密钥的形状，返回**规范化 JSON**（进密文的那一份）。

    形状不对当场 422——存进去一把必然调不通的 key，
    用户只会在几分钟后的任务失败里看到一个指不到原因的错。
    """
    if provider_id == "hunyuan3d":
        secret_id = payload.get("secretId")
        secret_key = payload.get("secretKey")
        if not isinstance(secret_id, str) or not secret_id.strip():
            raise ApiError(
                status_code=422,
                code=KEY_INVALID,
                message="混元生 3D 需要 SecretId（云 API 密钥控制台创建）",
            )
        if not isinstance(secret_key, str) or not secret_key.strip():
            raise ApiError(
                status_code=422,
                code=KEY_INVALID,
                message="混元生 3D 需要 SecretKey（与 SecretId 同一对密钥）",
            )
        if set(payload) - {"secretId", "secretKey"}:
            raise ApiError(
                status_code=422,
                code=KEY_INVALID,
                message="混元生 3D 只接受 secretId 与 secretKey 两个字段",
            )
        return json.dumps({"secretId": secret_id.strip(), "secretKey": secret_key.strip()})

    if provider_id == "bailian-tripo":
        api_key = payload.get("apiKey")
        if not isinstance(api_key, str) or not api_key.strip():
            raise ApiError(
                status_code=422,
                code=KEY_INVALID,
                message="百炼需要 API Key（百炼控制台创建，sk- 开头）",
            )
        api_key = api_key.strip()
        # 前缀有官方文档背书就拦：贴错类型（如传统 AK）只会在调用时 401
        if not api_key.startswith("sk-"):
            raise ApiError(
                status_code=422,
                code=KEY_INVALID,
                message=(
                    "百炼 API Key 以 sk- 开头——贴的这把不是百炼的 sk- Key（传统 AK/SK 体系不通用）"
                ),
            )
        workspace_id = payload.get("workspaceId")
        if workspace_id is not None:
            if not isinstance(workspace_id, str) or not workspace_id.strip():
                raise ApiError(
                    status_code=422,
                    code=KEY_INVALID,
                    message="workspaceId 要么不给，要么给非空串",
                )
            workspace_id = workspace_id.strip()
            if len(workspace_id) > 64 or not all(c.isalnum() or c in "-_" for c in workspace_id):
                raise ApiError(
                    status_code=422,
                    code=KEY_INVALID,
                    message="workspaceId 只能含字母、数字、- 与 _",
                )
        data: dict[str, str] = {"apiKey": api_key}
        if workspace_id:
            data["workspaceId"] = workspace_id
        return json.dumps(data)

    raise ApiError(
        status_code=422,
        code=PROVIDER_UNAVAILABLE,
        message=f"不认识的 3D 供应商：{provider_id}",
    )


def resolve_secrets(session: Session, owner_token: str, provider_id: str) -> dict[str, str]:
    """取这家的明文密钥（JSON），只在内存里流转。

    KEK 缓存冷掉（进程重启）时 argon2id 模式会抛 passphrase_required——
    让上层如实失败，不重试、不落盘。
    """
    provider = find_provider(provider_id)
    if provider is None:
        raise ApiError(
            status_code=422,
            code=PROVIDER_UNKNOWN,
            message=f"不认识的 3D 供应商：{provider_id}",
        )
    plaintext = key_vault.resolve_plaintext(session, owner_token, provider_id, None)
    if plaintext is None:
        raise ApiError(
            status_code=404,
            code=KEY_MISSING,
            message=f"还没有托管 {provider.name} 的密钥",
        )
    try:
        data = json.loads(plaintext)
    except ValueError as exc:
        raise ApiError(
            status_code=422,
            code=KEY_UNAVAILABLE,
            message="托管的密钥内容不是合法 JSON——请删除后重新托管",
        ) from exc
    if not isinstance(data, dict):
        raise ApiError(
            status_code=422,
            code=KEY_UNAVAILABLE,
            message="托管的密钥内容形状不对——请删除后重新托管",
        )
    return {str(k): str(v) for k, v in data.items()}


def _redact(text: str, *secrets: str | None) -> str:
    """错误信息出进程前的最后一道防线：抹掉明文密钥再截断。"""
    out = text or ""
    for secret in secrets:
        if secret and len(secret) >= 8:
            out = out.replace(secret, "***")
    return out[:240]


# --------------------------------------------------------------------------
# 腾讯云 API 3.0（TC3-HMAC-SHA256 签名，纯 hashlib/hmac 实现）
# --------------------------------------------------------------------------


def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _hmac_sha256(key: bytes, message: str) -> bytes:
    return hmac_mod.new(key, message.encode(), hashlib.sha256).digest()


def tc3_headers(
    secret_id: str,
    secret_key: str,
    *,
    host: str,
    service: str,
    action: str,
    version: str,
    region: str,
    payload_json: str,
    now: datetime | None = None,
) -> dict[str, str]:
    """拼 TC3 签名请求头（官方签名方法 v3，2026-11-20 按文档逐段实现）。

    签名只覆盖 ``content-type;host;x-tc-action`` 三个头——请求体必须以
    **签名时的同一份字节**发出去，所以调用方要拿返回的 headers +
    原样 ``content=payload_json`` 发送（不能让 httpx 再序列化一遍）。
    """
    timestamp = int((now or datetime.now(UTC)).timestamp())
    date = datetime.fromtimestamp(timestamp, UTC).strftime("%Y-%m-%d")

    canonical_headers = (
        f"content-type:application/json; charset=utf-8\nhost:{host}\nx-tc-action:{action.lower()}\n"
    )
    signed_headers = "content-type;host;x-tc-action"
    canonical_request = f"POST\n/\n\n{canonical_headers}{signed_headers}\n" + _sha256_hex(
        payload_json.encode()
    )
    string_to_sign = f"TC3-HMAC-SHA256\n{timestamp}\n{date}/{service}/tc3_request\n" + _sha256_hex(
        canonical_request.encode()
    )
    k_date = _hmac_sha256(f"TC3{secret_key}".encode(), date)
    k_service = _hmac_sha256(k_date, service)
    k_signing = _hmac_sha256(k_service, "tc3_request")
    signature = hmac_mod.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        f"TC3-HMAC-SHA256 Credential={secret_id}/{date}/{service}/tc3_request, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "Content-Type": "application/json; charset=utf-8",
        "Host": host,
        "X-TC-Action": action,
        "X-TC-Version": version,
        "X-TC-Region": region,
        "Authorization": authorization,
    }


def _tc3_call(
    transport: httpx.BaseTransport | None,
    *,
    action: str,
    payload: dict[str, Any],
    secret_id: str,
    secret_key: str,
    redact_secrets: list[str],
) -> dict[str, Any]:
    """调一次混元生 3D 接口。

    成功返回 ``Response`` 内层；失败抛 ApiError（错误已脱敏）。
    """
    payload_json = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    headers = tc3_headers(
        secret_id,
        secret_key,
        host=HUNYUAN_HOST,
        service=HUNYUAN_SERVICE,
        action=action,
        version=HUNYUAN_VERSION,
        region=settings.model3d_hunyuan_region,
        payload_json=payload_json,
    )
    try:
        with httpx.Client(
            timeout=settings.llm_upstream_timeout_ms / 1000, transport=transport
        ) as client:
            # 用 content= 原样发签名时的字节——json= 会再序列化一次，
            # 签名就对不上了
            response = client.post(
                f"https://{HUNYUAN_HOST}/", content=payload_json, headers=headers
            )
    except httpx.RequestError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(f"连不上混元生 3D（{HUNYUAN_HOST}）：{exc}", *redact_secrets),
        ) from exc

    try:
        raw = response.json()
    except ValueError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(
                f"混元生 3D 返回的不是合法 JSON（HTTP {response.status_code}）",
                *redact_secrets,
            ),
        ) from exc

    inner = raw.get("Response") if isinstance(raw, dict) else None
    if not isinstance(inner, dict):
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(
                f"混元生 3D 的响应形状不对（HTTP {response.status_code}）",
                *redact_secrets,
            ),
        )
    error = inner.get("Error")
    if isinstance(error, dict):
        code = str(error.get("Code") or "Unknown")
        message = str(error.get("Message") or "")
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(f"混元生 3D 返回 {code}：{message}", *redact_secrets),
        )
    return inner


# --------------------------------------------------------------------------
# 百炼 Tripo 客户端
# --------------------------------------------------------------------------


def _bailian_headers(api_key: str) -> dict[str, str]:
    return {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}",
        # 官方文档：缺这个头直接报
        # "current user api does not support synchronous calls"
        "X-DashScope-Async": "enable",
    }


def _bailian_task_host(workspace_id: str | None) -> str:
    """轮询端点的主机名。

    官方 API 参考的轮询示例用
    ``{WorkspaceId}.cn-beijing.maas.aliyuncs.com``；
    未提供 workspaceId 时退回通用网关 ``dashscope.aliyuncs.com``
    （管理异步任务的通用端点）。
    """
    if workspace_id:
        return f"{workspace_id}.cn-beijing.maas.aliyuncs.com"
    return BAILIAN_DEFAULT_TASK_HOST


def bailian_submit(
    transport: httpx.BaseTransport | None,
    api_key: str,
    *,
    input_obj: dict[str, Any],
    parameters: dict[str, Any] | None = None,
) -> str:
    """创建一次 3D 生成任务，返回 task_id。"""
    body: dict[str, Any] = {"model": BAILIAN_MODEL, "input": input_obj}
    if parameters:
        body["parameters"] = parameters
    try:
        with httpx.Client(
            timeout=settings.llm_upstream_timeout_ms / 1000, transport=transport
        ) as client:
            response = client.post(BAILIAN_CREATE_URL, json=body, headers=_bailian_headers(api_key))
    except httpx.RequestError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(f"连不上百炼（{BAILIAN_CREATE_URL}）：{exc}", api_key),
        ) from exc

    try:
        raw = response.json()
    except ValueError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(
                f"百炼返回的不是合法 JSON（HTTP {response.status_code}）",
                api_key,
            ),
        ) from exc

    if response.status_code >= 400 or "code" in raw:
        code = str(raw.get("code") or response.status_code)
        message = str(raw.get("message") or "")
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(f"百炼返回 {code}：{message}", api_key),
        )
    output = raw.get("output")
    task_id = output.get("task_id") if isinstance(output, dict) else None
    if not isinstance(task_id, str) or not task_id:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message="百炼创建任务成功但没回 task_id",
        )
    return task_id


def bailian_query(
    transport: httpx.BaseTransport | None,
    api_key: str,
    task_id: str,
    workspace_id: str | None = None,
) -> dict[str, Any]:
    """查一次任务状态，返回 ``output`` 内层。"""
    host = _bailian_task_host(workspace_id)
    url = f"https://{host}/api/v1/tasks/{task_id}"
    try:
        with httpx.Client(
            timeout=settings.llm_upstream_timeout_ms / 1000, transport=transport
        ) as client:
            response = client.get(url, headers={"Authorization": f"Bearer {api_key}"})
    except httpx.RequestError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(f"连不上百炼任务查询：{exc}", api_key),
        ) from exc

    try:
        raw = response.json()
    except ValueError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(
                f"百炼任务查询返回的不是合法 JSON（HTTP {response.status_code}）",
                api_key,
            ),
        ) from exc
    output = raw.get("output")
    if not isinstance(output, dict):
        message = str(raw.get("message") or "")
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(
                f"百炼任务查询的响应形状不对：{message or response.status_code}",
                api_key,
            ),
        )
    return output


def _download(transport: httpx.BaseTransport | None, url: str, redact_secrets: list[str]) -> bytes:
    """把产物 URL 拉回内存（混元 24h、百炼 2 小时有效——拿到就下）。"""
    try:
        with httpx.Client(timeout=120.0, transport=transport, follow_redirects=True) as client:
            response = client.get(url)
    except httpx.RequestError as exc:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=_redact(f"下载产物失败：{exc}", *redact_secrets),
        ) from exc
    if response.status_code >= 400:
        raise ApiError(
            status_code=502,
            code=UPSTREAM_FAILED,
            message=f"下载产物失败：HTTP {response.status_code}",
        )
    return response.content


def _materialize_glb(payload: bytes, dest: Path, workdir: Path) -> Path | None:
    """把厂商给的产物字节落成**真 GLB**。

    三种形态都见过（官方文档示例 + 上游 quirk）：

    - 裸 GLB（``glTF`` 头）→ 直接写；
    - ZIP（``PK`` 头，混元的 ResultFile3Ds 示例就是 .zip）→ 挑里面的
      .glb，没有就抽 .obj（连同贴图）走 trimesh 转 GLB；
    - 裸 OBJ → 同样走 trimesh 转换。

    转不出真 GLB 返回 None——如实判失败，不给前端一个假产物。
    """
    if payload[:4] == b"glTF":
        dest.write_bytes(payload)
        return dest
    if payload[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(payload)) as archive:
            names = archive.namelist()
            glb_names = [n for n in names if n.lower().endswith(".glb")]
            if glb_names:
                dest.write_bytes(archive.read(glb_names[0]))
                return dest
            obj_names = [n for n in names if n.lower().endswith(".obj")]
            if not obj_names:
                logger.warning("混元产物压缩包里既没有 GLB 也没有 OBJ：%s", names)
                return None
            obj_dest = workdir / "model.obj"
            obj_dest.write_bytes(archive.read(obj_names[0]))
            for name in names:
                if name.lower().endswith((".png", ".jpg", ".jpeg", ".mtl")):
                    target = workdir / Path(name).name
                    if not target.exists():
                        target.write_bytes(archive.read(name))
            return _convert_obj_to_glb(obj_dest)
    # 裸 OBJ 字节
    obj_dest = workdir / "model.obj"
    obj_dest.write_bytes(payload)
    return _convert_obj_to_glb(obj_dest)


def _convert_obj_to_glb(obj_src: Path) -> Path | None:
    """OBJ → GLB（复用本地 TripoSR 的转换逻辑：trimesh + 同目录贴图）。

    ``_ensure_real_glb`` 的导出目标恒为 ``candidate.with_suffix('.glb')``——
    这里的 OBJ 固定叫 ``model.obj``，导出正好落在 ``model.glb``。
    """
    return triposr_service._ensure_real_glb(obj_src)


# --------------------------------------------------------------------------
# 落盘与产物
# --------------------------------------------------------------------------


def backend_dir() -> Path:
    """backend/ 目录。"""
    return Path(__file__).resolve().parents[2]


def output_dir() -> Path:
    """输入图与产物的落盘根目录。留空 = <backend>/backend_data/model3d"""
    configured = settings.model3d_cloud_output_dir.strip()
    if configured:
        return Path(configured)
    return backend_dir() / "backend_data" / OUTPUT_DIR_NAME


def job_dir(job_id: str) -> Path:
    """一个任务的独立目录。"""
    return output_dir() / job_id


def artifact_url(job_id: str) -> str:
    """产物地址（相对路径，前端自己拼 API_BASE）。"""
    return f"/api/model3d/cloud/jobs/{job_id}/model.glb"


# --------------------------------------------------------------------------
# 落库（与 triposr_service 同一套状态流转）
# --------------------------------------------------------------------------


def create_job(
    session: Session,
    *,
    job_id: str,
    provider_id: str,
    owner_token: str,
    label: str | None,
    prompt: str | None,
    image_name: str,
    image_path: str,
    image_url: str | None,
) -> Model3dCloudJob:
    """建一行任务（queued 起步）。

    提交之后不再 refresh：后台任务另开 session，
    同一条连接上重入事务会打架。
    """
    job = Model3dCloudJob(
        job_id=job_id,
        provider_id=provider_id,
        owner_token=owner_token,
        status=JOB_QUEUED,
        label=label,
        prompt=prompt,
        image_name=image_name,
        image_path=image_path,
        image_url=image_url,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(job)
    session.commit()
    return job


def get_job(session: Session, job_id: str) -> Model3dCloudJob | None:
    return session.get(Model3dCloudJob, job_id)


def get_job_model_file(job: Model3dCloudJob) -> Path | None:
    """产物文件。还没有（或文件没了）返回 None。"""
    if not job.model_path:
        return None
    path = Path(job.model_path)
    return path if path.is_file() else None


def list_jobs(
    session: Session,
    owner_token: str,
    limit: int = JOB_LIST_LIMIT,
) -> list[Model3dCloudJob]:
    """某个 owner 最近的任务，最新的在前。别人的任务不在这个列表里。"""
    stmt = (
        select(Model3dCloudJob)
        .where(Model3dCloudJob.owner_token == owner_token)
        .order_by(Model3dCloudJob.created_at.desc())
        .limit(limit)
    )
    return list(session.scalars(stmt).all())


def count_today(session: Session, owner_token: str) -> int:
    """这个 owner 今天（UTC 日界）已经提交了多少次云端生成。"""
    day_start = datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)
    stmt = select(Model3dCloudJob).where(
        Model3dCloudJob.owner_token == owner_token,
        Model3dCloudJob.created_at >= day_start,
    )
    return len(list(session.scalars(stmt).all()))


def mark_running(session: Session, job_id: str) -> None:
    _update(session, job_id, status=JOB_RUNNING)


def mark_succeeded(session: Session, job_id: str, *, model_path: str, duration_ms: int) -> None:
    _update(
        session,
        job_id,
        status=JOB_SUCCEEDED,
        model_path=model_path,
        duration_ms=duration_ms,
        error=None,
        error_code=None,
        error_detail=None,
    )


def mark_failed(
    session: Session,
    job_id: str,
    *,
    error: str,
    error_code: str = GENERATION_FAILED,
    detail: str | None = None,
) -> None:
    _update(
        session,
        job_id,
        status=JOB_FAILED,
        error=error,
        error_code=error_code,
        error_detail=detail,
    )


def set_remote_task(session: Session, job_id: str, remote_task_id: str) -> None:
    _update(session, job_id, remote_task_id=remote_task_id)


def _update(session: Session, job_id: str, **fields: Any) -> None:
    job = session.get(Model3dCloudJob, job_id)
    if job is None:
        return
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = utcnow()
    session.commit()


# --------------------------------------------------------------------------
# 跑任务：提交 → 轮询 → 下载 → 落盘
# --------------------------------------------------------------------------

# 执行期允许原样透传给前端展示的错误码
_KNOWN_FAILURE_CODES = {
    KEY_MISSING,
    KEY_UNAVAILABLE,
    INPUT_INVALID,
    IMAGE_TOO_LARGE,
    PROVIDER_UNAVAILABLE,
    UPSTREAM_FAILED,
}


def _hunyuan_input(job: Model3dCloudJob) -> dict[str, Any]:
    """混元的输入体：Prompt / ImageBase64 / ImageUrl 三选一且互斥。"""
    if job.prompt:
        return {"Prompt": job.prompt}
    if job.image_path:
        raw = Path(job.image_path).read_bytes()
        # ImageBase64 ≤6MB（base64 后会再大 30% 左右）——
        # 提交入口已限过一次，这里再限
        if len(raw) > settings.model3d_max_image_bytes:
            raise ApiError(
                status_code=413,
                code=IMAGE_TOO_LARGE,
                message=(
                    f"输入图太大：{len(raw)} 字节，"
                    f"混元 ImageBase64 上限 {settings.model3d_max_image_bytes} 字节"
                ),
            )
        return {"ImageBase64": base64.b64encode(raw).decode("ascii")}
    if job.image_url:
        return {"ImageUrl": job.image_url}
    raise ApiError(
        status_code=422,
        code=INPUT_INVALID,
        message="混元生 3D 需要 Prompt / 图片 / 图片 URL 之一",
    )


def _bailian_input(job: Model3dCloudJob) -> dict[str, Any]:
    """百炼的输入体：prompt / image（公网 URL）互斥。

    上传文件在这条线不支持（提交入口已拦，这里再兜一层）。
    """
    if job.prompt:
        return {"prompt": job.prompt}
    if job.image_url:
        return {"image": job.image_url}
    raise ApiError(
        status_code=422,
        code=INPUT_INVALID,
        message=("百炼图生 3D 只收公网图片 URL——用 image_url 提交，或改用本地 TripoSR / 混元"),
    )


def execute_job(job_id: str, *, transport: httpx.BaseTransport | None = None) -> None:
    """把一个云端生成任务从 queued 跑到 succeeded / failed。

    与 ``triposr_service.execute_job`` 同构：另开 session、
    状态流转写库、失败原因落库。区别是产物来自
    「提交 → 轮询 → 下载」，key 从 key_vault 现取（只在内存）。
    """
    session = SessionLocal()
    try:
        job = get_job(session, job_id)
        if job is None:
            logger.warning("云端 3D 任务不存在：%s", job_id)
            return
        if job.status != JOB_QUEUED:
            return

        provider = find_provider(job.provider_id)
        if provider is None or not provider.available:
            mark_failed(
                session,
                job_id,
                error=f"供应商不可用：{job.provider_id}",
                error_code=PROVIDER_UNAVAILABLE,
            )
            return

        mark_running(session, job_id)
        workdir = job_dir(job_id)
        workdir.mkdir(parents=True, exist_ok=True)

        started = time.monotonic()
        try:
            secrets = resolve_secrets(session, job.owner_token, job.provider_id)
            model_path = _run_provider(session, job, provider, secrets, transport, workdir)
        except ApiError as exc:
            error_code = exc.code if exc.code in _KNOWN_FAILURE_CODES else GENERATION_FAILED
            mark_failed(
                session,
                job_id,
                error=str(exc.message),
                error_code=error_code,
                detail=str(getattr(exc, "detail", "") or ""),
            )
            return
        except Exception as exc:  # noqa: BLE001 —— 失败原因要写进库里
            logger.exception("云端 3D 任务失败：%s", job_id)
            mark_failed(
                session,
                job_id,
                error=f"生成失败：{exc}",
                error_code=GENERATION_FAILED,
            )
            return

        duration_ms = int((time.monotonic() - started) * 1000)
        mark_succeeded(session, job_id, model_path=str(model_path), duration_ms=duration_ms)
        logger.info(
            "云端 3D 完成：%s（%s，%d ms）→ %s",
            job_id,
            provider.name,
            duration_ms,
            model_path,
        )
    finally:
        session.close()


def _run_provider(
    session: Session,
    job: Model3dCloudJob,
    provider: Model3dProvider,
    secrets: dict[str, str],
    transport: httpx.BaseTransport | None,
    workdir: Path,
) -> Path:
    """按供应商跑完「提交 → 轮询 → 下载 → 落 GLB」，返回产物路径。"""
    redact = list(secrets.values())

    if job.provider_id == "hunyuan3d":
        secret_id = secrets.get("secretId", "")
        secret_key = secrets.get("secretKey", "")
        submitted = _tc3_call(
            transport,
            action=HUNYUAN_SUBMIT_ACTION,
            payload=_hunyuan_input(job),
            secret_id=secret_id,
            secret_key=secret_key,
            redact_secrets=redact,
        )
        remote_id = str(submitted.get("JobId") or "")
        if not remote_id:
            raise ApiError(
                status_code=502,
                code=UPSTREAM_FAILED,
                message="混元生 3D 提交成功但没回 JobId",
            )
        set_remote_task(session, job.job_id, remote_id)

        status = _poll(
            lambda: _tc3_call(
                transport,
                action=HUNYUAN_QUERY_ACTION,
                payload={"JobId": remote_id},
                secret_id=secret_id,
                secret_key=secret_key,
                redact_secrets=redact,
            ),
            terminal=lambda inner: str(inner.get("Status") or "") in ("DONE", "FAIL"),
        )
        if str(status.get("Status")) != "DONE":
            message = str(status.get("ErrorMessage") or "生成失败（官方未给原因）")
            raise ApiError(
                status_code=502,
                code=GENERATION_FAILED,
                message=_redact(message, *redact),
            )
        files = status.get("ResultFile3Ds")
        if not isinstance(files, list) or not files:
            raise ApiError(
                status_code=502,
                code=GENERATION_FAILED,
                message="混元生 3D 成功但没回产物文件",
            )
        pick = next(
            (f for f in files if isinstance(f, dict) and str(f.get("Type") or "").upper() == "GLB"),
            files[0],
        )
        url = str(pick.get("Url") or "") if isinstance(pick, dict) else ""
        if not url:
            raise ApiError(
                status_code=502,
                code=GENERATION_FAILED,
                message="混元生 3D 的产物条目没有 Url",
            )
        return _save_artifact(transport, url, workdir, redact)

    if job.provider_id == "bailian-tripo":
        api_key = secrets.get("apiKey", "")
        workspace_id = secrets.get("workspaceId") or None
        remote_id = bailian_submit(transport, api_key, input_obj=_bailian_input(job))
        set_remote_task(session, job.job_id, remote_id)

        status = _poll(
            lambda: bailian_query(transport, api_key, remote_id, workspace_id),
            terminal=lambda output: (
                str(output.get("task_status") or "")
                in ("SUCCEEDED", "FAILED", "CANCELED", "UNKNOWN")
            ),
        )
        task_status = str(status.get("task_status") or "")
        if task_status != "SUCCEEDED":
            code = str(status.get("code") or task_status or "FAILED")
            message = str(status.get("message") or "生成失败（官方未给原因）")
            raise ApiError(
                status_code=502,
                code=GENERATION_FAILED,
                message=_redact(f"{code}：{message}", api_key),
            )
        results = status.get("results")
        if not isinstance(results, list) or not results:
            raise ApiError(
                status_code=502,
                code=GENERATION_FAILED,
                message="百炼任务成功但没回结果",
            )
        first = results[0] if isinstance(results[0], dict) else {}
        url = str(first.get("pbr_model_url") or first.get("base_model_url") or "")
        if not url:
            raise ApiError(
                status_code=502,
                code=GENERATION_FAILED,
                message="百炼的结果里没有模型下载地址",
            )
        return _save_artifact(transport, url, workdir, redact)

    raise ApiError(
        status_code=422,
        code=PROVIDER_UNAVAILABLE,
        message=f"这条线没有实现：{provider.provider_id}",
    )


def _poll(fetch: Any, *, terminal: Any) -> dict[str, Any]:
    """轮询到终态或超时。

    超时抛 ApiError——不让任务挂着假装还在跑。
    """
    interval = max(2, settings.model3d_poll_interval_seconds)
    deadline = time.monotonic() + settings.model3d_cloud_timeout_seconds
    last: dict[str, Any] = {}
    while time.monotonic() < deadline:
        last = fetch()
        if terminal(last):
            return last
        time.sleep(interval)
    raise ApiError(
        status_code=504,
        code=GENERATION_FAILED,
        message=(
            f"生成超时（{settings.model3d_cloud_timeout_seconds} 秒）——"
            "任务可能还在厂商侧跑，稍后可重试"
        ),
    )


def _save_artifact(
    transport: httpx.BaseTransport | None, url: str, workdir: Path, redact: list[str]
) -> Path:
    """下载产物并落成真 GLB；转不出来如实失败。"""
    payload = _download(transport, url, redact)
    dest = workdir / "model.glb"
    glb = _materialize_glb(payload, dest, workdir)
    if glb is None or not glb.is_file() or glb.read_bytes()[:4] != b"glTF":
        raise ApiError(
            status_code=502,
            code=GENERATION_FAILED,
            message="产物下载了，但转成 GLB 失败（详见日志）",
        )
    return glb
