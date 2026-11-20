"""TripoSR 本地推理：单张图片 → 3D 模型（GLB）。

这一层与 render_service 同构：

1. **前置检查**：环境齐不齐（503）——venv 解释器、run.py、本地权重。
   环境缺东西就说清楚缺什么、先做什么——不报 500，也不假装提交成功。
2. **落库**：``tripo_jobs`` 记任务状态、输入与产物路径。
3. **调推理**：TripoSR venv 的 python 跑 ``run.py``（子进程，CPU 分钟级）。
   与录制器一样是**可替换的进程调用**（``Runner``），测试用替身，
   不需要真的跑模型；真跑时按退出码与 stderr 判断成功失败。
4. **产物管理**：GLB 落在 ``backend/backend_data/triposr/<job_id>/``，按 jobId 归档。

状态机：``queued → running → succeeded | failed``。
失败要把原因写进库里——失败也要留痕，不能悄悄消失。

推理跑在**本机**：不依赖任何第三方云 API，输入图不出本机。
权重用本地目录（``<home>/weights``），子进程里关掉 HF 的联网
（``HF_HUB_OFFLINE``）——后端不该悄悄往外发请求。
"""

from __future__ import annotations

import logging
import os
import subprocess
import sys
import time
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import ApiError
from app.models import TripoJob, utcnow

logger = logging.getLogger(__name__)

# 状态机：queued -> running -> succeeded | failed
JOB_QUEUED = "queued"
JOB_RUNNING = "running"
JOB_SUCCEEDED = "succeeded"
JOB_FAILED = "failed"

# 错误码
ENV_MISSING = "triposr_env_missing"
IMAGE_INVALID = "triposr_image_invalid"
IMAGE_TOO_LARGE = "triposr_image_too_large"
INFERENCE_FAILED = "triposr_inference_failed"
NOT_READY = "tripo_not_ready"
NOT_FOUND = "tripo_not_found"

# 列表一次最多回多少条
JOB_LIST_LIMIT = 50

# TripoSR 环境的常见位置（没显式配置时挨个找）。
# 环境部署在仓库外（本机自备），真实位置用 BACKEND_TRIPOSR_HOME 指过去。
TRIPOSR_HOME_CANDIDATES: tuple[str, ...] = (r"D:\Projects\3dsim-triposr",)

# 允许的输入图类型
ALLOWED_IMAGE_TYPES = ("image/png", "image/jpeg", "image/webp")
ALLOWED_IMAGE_SUFFIXES = (".png", ".jpg", ".jpeg", ".webp")


# --------------------------------------------------------------------------
# 路径
# --------------------------------------------------------------------------


def backend_dir() -> Path:
    """backend/ 目录（backend/app/services/triposr_service.py → 上两层）。"""
    return Path(__file__).resolve().parents[2]


def home() -> Path:
    """TripoSR 环境根目录（内含 .venv/ 与 repo/）。

    **显式配置了就只认它**：配错了要报错，不能悄悄换一台——
    「我以为在用 A，其实在用 B」比直接失败更难查。
    """
    configured = settings.triposr_home.strip()
    if configured:
        return Path(configured)
    for candidate in TRIPOSR_HOME_CANDIDATES:
        path = Path(candidate)
        if path.is_dir():
            return path
    return Path(TRIPOSR_HOME_CANDIDATES[0])


def python_path() -> Path:
    """TripoSR venv 的解释器。"""
    if sys.platform == "win32":
        return home() / ".venv" / "Scripts" / "python.exe"
    return home() / ".venv" / "bin" / "python"


def run_script() -> Path:
    """TripoSR 的推理入口脚本。"""
    return home() / "repo" / "run.py"


def weights_dir() -> Path:
    """本地权重目录（stabilityai/TripoSR 的快照）。"""
    return home() / "weights"


def output_dir() -> Path:
    """输入图与产物的落盘根目录。"""
    configured = settings.triposr_output_dir.strip()
    if configured:
        return Path(configured)
    return backend_dir() / "backend_data" / "triposr"


def job_dir(job_id: str) -> Path:
    """一个任务的独立目录：输入图与产物都在里面。"""
    return output_dir() / job_id


def artifact_url(job_id: str) -> str:
    """产物地址（相对路径，前端自己拼 API_BASE）。"""
    return f"/api/triposr/{job_id}/model.glb"


# --------------------------------------------------------------------------
# 环境探测
# --------------------------------------------------------------------------


def check_environment() -> None:
    """环境齐不齐。

    **缺东西一律 503**，并说清楚缺什么、先做什么：
    缺权重就给出下载命令，别让人对着一句 ENOENT 发呆。
    """
    if not home().is_dir():
        raise ApiError(
            status_code=503,
            code=ENV_MISSING,
            message=(
                f"找不到 TripoSR 环境 {home()} —— "
                "按交接文档装好（repo 浅克隆 + .venv + weights），"
                "或用 BACKEND_TRIPOSR_HOME 指向环境根目录，再提交任务。"
            ),
        )
    venv_python = python_path()
    if not venv_python.is_file():
        raise ApiError(
            status_code=503,
            code=ENV_MISSING,
            message=(
                f"TripoSR venv 缺解释器 {venv_python} —— "
                "环境只装了一半，先把 .venv 补齐再提交任务。"
            ),
        )
    if not run_script().is_file():
        raise ApiError(
            status_code=503,
            code=ENV_MISSING,
            message=f"找不到推理入口 {run_script()} —— TripoSR 仓库不完整，重新克隆。",
        )
    if not (weights_dir() / "model.ckpt").is_file():
        raise ApiError(
            status_code=503,
            code=ENV_MISSING,
            message=(
                f"缺本地权重 {weights_dir()}/model.ckpt —— "
                "先用 HF_ENDPOINT=https://hf-mirror.com 把 stabilityai/TripoSR "
                "下载到该目录，再提交任务。"
            ),
        )


# --------------------------------------------------------------------------
# 落库
# --------------------------------------------------------------------------


def create_job(
    session: Session,
    *,
    job_id: str,
    label: str | None,
    image_name: str,
    image_path: str,
) -> TripoJob:
    """建一行任务。状态从 queued 起步。

    提交之后**不要再 refresh**：那会重新查一次库、把连接攥在手里，
    而后台任务马上要用另一条连接写同一张表。
    """
    job = TripoJob(
        job_id=job_id,
        status=JOB_QUEUED,
        label=label,
        image_name=image_name,
        image_path=image_path,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(job)
    session.commit()
    return job


def get_job(session: Session, job_id: str) -> TripoJob | None:
    return session.get(TripoJob, job_id)


def list_jobs(session: Session, limit: int = JOB_LIST_LIMIT) -> list[TripoJob]:
    """最近的任务，最新的在前。"""
    stmt = select(TripoJob).order_by(TripoJob.created_at.desc()).limit(limit)
    return list(session.scalars(stmt).all())


def mark_running(session: Session, job_id: str) -> None:
    _update(session, job_id, status=JOB_RUNNING)


def mark_succeeded(
    session: Session,
    job_id: str,
    *,
    model_path: str,
    duration_ms: int,
) -> None:
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
    error_code: str = INFERENCE_FAILED,
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


def _update(session: Session, job_id: str, **fields: Any) -> None:
    job = session.get(TripoJob, job_id)
    if job is None:
        return
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = utcnow()
    session.commit()


def model_file(job: TripoJob) -> Path | None:
    """产物文件。还没有（或文件没了）返回 None。"""
    if not job.model_path:
        return None
    path = Path(job.model_path)
    return path if path.is_file() else None


# --------------------------------------------------------------------------
# 推理器
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RunnerResult:
    """一次推理调用的结果。

    ``returncode`` 是 run.py 的退出码：0 成功，非 0 失败。
    ``stderr`` 原样留着——出错时最后几行最有用。
    """

    returncode: int
    stdout: str = ""
    stderr: str = ""


# 推理执行器：给它输入图与工作目录，返回结果。
# **可替换**——测试用替身，不需要真的跑模型。
Runner = Callable[[Path, Path], RunnerResult]


def inference_command(image_path: Path, workdir: Path) -> list[str]:
    """run.py 的命令行。

    ``python run.py <输入图> --device cpu --model-save-format glb
    [--bake-texture] --output-dir <工作目录> --pretrained-model-name-or-path <本地权重>``
    """
    command = [
        str(python_path()),
        str(run_script()),
        str(image_path),
        "--device",
        "cpu",
        "--model-save-format",
        "glb",
        "--output-dir",
        str(workdir),
        "--pretrained-model-name-or-path",
        str(weights_dir()),
    ]
    if settings.triposr_bake_texture:
        command.append("--bake-texture")
    return command


def run_inference(image_path: Path, workdir: Path) -> RunnerResult:
    """真的调 run.py（CPU 推理，分钟级）。

    退出码 0 算成功；非 0 算失败，stderr 原样带回去。
    子进程里关掉 HF 的联网——权重是本地目录，不该悄悄往外发请求。
    """
    script = run_script()
    if not script.is_file():
        raise FileNotFoundError(f"找不到推理入口：{script}")

    env = {**os.environ, "HF_HUB_OFFLINE": "1", "TRANSFORMERS_OFFLINE": "1"}
    command = inference_command(image_path, workdir)
    logger.info("TripoSR 推理开始：%s", " ".join(command))
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=settings.triposr_timeout_seconds,
            cwd=str(home() / "repo"),
            env=env,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(f"推理超时（{settings.triposr_timeout_seconds} 秒）") from exc

    return RunnerResult(
        returncode=completed.returncode,
        stdout=completed.stdout or "",
        stderr=completed.stderr or "",
    )


def stderr_summary(stderr: str, *, limit: int = 8) -> str:
    """取 stderr 的最后几行。

    出错时最有用的是**最后一步**的输出（前面的往往是一堆无关日志）。
    """
    lines = [line.strip() for line in (stderr or "").splitlines() if line.strip()]
    if not lines:
        return ""
    return " / ".join(lines[-limit:])


def find_glb(workdir: Path) -> Path | None:
    """在任务目录里找产物 GLB。

    run.py 对单张图的输出布局是 ``<output-dir>/0/mesh.glb``；
    按 glob 找而不是写死路径——上游换输出名时这里不跟着炸。
    """
    glb_files = sorted(workdir.glob("**/*.glb"))
    return glb_files[0] if glb_files else None


def _ensure_real_glb(candidate: Path) -> Path | None:
    """把 run.py 的产物转成真正的 GLB。

    上游 quirk（2026-11-20 实测）：``--bake-texture`` 路径下 pyxatlas.export
    **不看扩展名**，mesh.glb 里写的是 OBJ 字节（v x y z 行）。这里：
    有 glTF 头 → 原样放行；否则把 OBJ 原件挪到 .obj，用 trimesh 装上
    烘焙的 texture.png 转出真正的 GLB（纹理内嵌）。

    ⚠️ 导出目标恒为 ``.glb`` 后缀——trimesh 按扩展名选导出格式，
    写回 .obj 名会得到又一份 OBJ（踩过）。
    """
    # GLB 目标恒为 .glb 后缀（残件场景下 candidate 是 OBJ 原件，产物落在旁边
    # 的 mesh.glb）；trimesh 按扩展名选 loader/导出格式，OBJ 原件必须留在
    # .obj 名上、导出必须写 .glb 名——两边都不能混（踩过）
    glb_path = candidate.with_suffix(".glb")
    if candidate.read_bytes()[:4] == b"glTF":
        return glb_path

    obj_src = candidate.with_suffix(".obj")
    if obj_src == candidate:
        pass  # candidate 本身就是 .obj 名（残件场景），OBJ 原件原地不动
    else:
        # 常规场景 candidate 就是 glb 名：OBJ 字节正躺在 glb 名上，
        # rename 前不需要删任何东西；只有「残件 + 假 GLB 并存」才要清
        if glb_path != candidate and glb_path.is_file():
            glb_path.unlink()
        candidate.rename(obj_src)
    texture = obj_src.parent / "texture.png"

    # trimesh 是后端轻量依赖（纯 Python），懒加载避免拖慢模块导入
    import trimesh
    from PIL import Image

    mesh = trimesh.load(obj_src, process=False)
    if not isinstance(mesh, trimesh.Trimesh):
        logger.error("OBJ 转出来不是三角网格（%s），无法烘焙纹理", type(mesh))
        return None
    visual = mesh.visual
    uvs = visual.uv if isinstance(visual, trimesh.visual.TextureVisuals) else None
    if uvs is not None and texture.is_file():
        mesh.visual = trimesh.visual.TextureVisuals(uv=uvs, image=Image.open(texture))
    mesh.export(glb_path)
    if glb_path.read_bytes()[:4] != b"glTF":
        logger.error("GLB 转换后头部仍不是 glTF：%s", glb_path)
        return None
    return glb_path


# --------------------------------------------------------------------------
# 跑任务
# --------------------------------------------------------------------------


def execute_job(job_id: str, *, runner: Runner | None = None) -> None:
    """把一个任务从 queued 跑到 succeeded / failed。

    状态流转：``queued → running → succeeded | failed``。
    """
    run = runner or run_inference

    session = SessionLocal()
    try:
        job = get_job(session, job_id)
        if job is None:
            logger.warning("TripoSR 任务不存在：%s", job_id)
            return
        if job.status != JOB_QUEUED:
            return

        mark_running(session, job_id)

        workdir = job_dir(job_id)
        workdir.mkdir(parents=True, exist_ok=True)
        image_path = Path(job.image_path)

        started = time.monotonic()
        try:
            result = run(image_path, workdir)
        except Exception as exc:  # noqa: BLE001 —— 失败原因要写进库里
            logger.exception("TripoSR 任务失败：%s", job_id)
            mark_failed(
                session,
                job_id,
                error=f"推理失败：{exc}",
                error_code=INFERENCE_FAILED,
                detail=str(exc),
            )
            return
        duration_ms = int((time.monotonic() - started) * 1000)

        glb = find_glb(workdir)
        if result.returncode != 0 or glb is None:
            detail = stderr_summary(result.stderr) or stderr_summary(result.stdout)
            if not detail:
                detail = f"推理进程退出码 {result.returncode}"
            logger.warning("TripoSR 任务失败（%s）：%s", job_id, detail)
            mark_failed(
                session,
                job_id,
                error=f"推理失败：{detail}",
                error_code=INFERENCE_FAILED,
                detail=detail,
            )
            return

        # 上游烘焙路径写的是 OBJ 字节，这里转成真 GLB；转不出来如实判失败
        glb = _ensure_real_glb(glb)
        if glb is None:
            mark_failed(
                session,
                job_id,
                error="推理失败：产物转换成 GLB 时失败（详见日志）",
                error_code=INFERENCE_FAILED,
                detail="GLB 头部校验未通过",
            )
            return

        mark_succeeded(
            session,
            job_id,
            model_path=str(glb),
            duration_ms=duration_ms,
        )
        logger.info("TripoSR 完成：%s（%d ms）→ %s", job_id, duration_ms, glb)
    finally:
        session.close()
