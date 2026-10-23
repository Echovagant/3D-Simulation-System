"""服务端渲染：把一个场景变成一段视频。

这一层做四件事：

1. **前置检查**：场景能不能渲染（422）、环境齐不齐（503）。
   环境缺东西就说清楚缺什么、先做什么——不报 500，也不假装提交成功。
2. **落库**：``render_jobs`` 记任务状态、请求参数与产物路径。
3. **调录制器**：``node scripts/record-scene.mjs <输入> <输出.mp4> <摘要.json>``。
   这一步做成**可替换的进程调用**（``Recorder``），测试用替身，
   不需要真的开浏览器；真跑时按退出码与 stderr 判断成功失败。
4. **产物管理**：MP4 落在 ``backend/backend_data/renders/``，按 jobId 命名。

状态机：``queued → rendering → succeeded | failed``。
失败要把原因写进库里——失败也要留痕，不能悄悄消失。
"""

from __future__ import annotations

import json
import logging
import shutil
import subprocess
import time
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import settings
from app.db import SessionLocal
from app.errors import ApiError
from app.models import RenderJob, utcnow

logger = logging.getLogger(__name__)

# 状态机：queued -> rendering -> succeeded | failed
JOB_QUEUED = "queued"
JOB_RENDERING = "rendering"
JOB_SUCCEEDED = "succeeded"
JOB_FAILED = "failed"

# 错误码（规格 §3.2）
SCENE_INVALID = "render_scene_invalid"
BUILD_MISSING = "render_build_missing"
BROWSER_UNAVAILABLE = "render_browser_unavailable"
FFMPEG_UNAVAILABLE = "render_ffmpeg_unavailable"
RENDER_FAILED = "render_failed"
NOT_READY = "render_not_ready"
NOT_FOUND = "render_not_found"

# 可渲染的物体类型。**与仿真器一致**（cube / sphere）——
# 渲染页也只认这两种，后端不该比前端多认。
RENDERABLE_TYPES = ("cube", "sphere")

# 列表一次最多回多少条
JOB_LIST_LIMIT = 50

# 常见的 Chrome 安装位置（没显式配置时挨个找）
CHROME_CANDIDATES: tuple[str, ...] = (
    r"C:\Program Files\Google\Chrome\Application\chrome.exe",
    r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
)

# 常见的 ffmpeg 安装位置
FFMPEG_CANDIDATES: tuple[str, ...] = (
    r"C:\Tools\ffmpeg\bin\ffmpeg.exe",
    "/usr/local/bin/ffmpeg",
    "/opt/homebrew/bin/ffmpeg",
)


# --------------------------------------------------------------------------
# 路径
# --------------------------------------------------------------------------


def backend_dir() -> Path:
    """backend/ 目录（backend/app/services/render_service.py → 上两层）。"""
    return Path(__file__).resolve().parents[2]


def repo_root() -> Path:
    """仓库根目录。

    渲染要读 ``dist/`` 与 ``scripts/``，所以得知道仓库在哪。
    """
    configured = settings.render_repo_root.strip()
    if configured:
        return Path(configured)
    return Path(__file__).resolve().parents[3]


def dist_dir() -> Path:
    """生产产物目录（npm run build 的输出）。"""
    configured = settings.render_dist_dir.strip()
    if configured:
        return Path(configured)
    return repo_root() / "dist"


def recorder_script() -> Path:
    """录制器脚本（规格 §4）。"""
    configured = settings.render_script_path.strip()
    if configured:
        return Path(configured)
    return repo_root() / "scripts" / "record-scene.mjs"


def output_dir() -> Path:
    """产物落盘目录。"""
    configured = settings.render_output_dir.strip()
    if configured:
        return Path(configured)
    return backend_dir() / "backend_data" / "renders"


def artifact_url(job_id: str) -> str:
    """产物地址（相对路径，前端自己拼 API_BASE）。"""
    return f"/api/render/{job_id}/video.mp4"


# --------------------------------------------------------------------------
# 环境探测
# --------------------------------------------------------------------------


def _find_tool(configured: str, candidates: tuple[str, ...], names: tuple[str, ...]) -> Path | None:
    """找一个可执行文件。

    **显式配置了就只认它**：配错了要报错，不能悄悄换一台——
    「我以为在用 A，其实在用 B」比直接失败更难查。
    没配置才去常见位置里找。
    """
    if configured.strip():
        path = Path(configured.strip())
        return path if path.is_file() else None
    for candidate in candidates:
        path = Path(candidate)
        if path.is_file():
            return path
    for name in names:
        found = shutil.which(name)
        if found:
            return Path(found)
    return None


def find_chrome() -> Path | None:
    """找 Chrome（无头浏览器）。找不到返回 None。"""
    return _find_tool(
        settings.render_chrome_path, CHROME_CANDIDATES, ("google-chrome", "chrome", "chromium")
    )


def find_ffmpeg() -> Path | None:
    """找 ffmpeg。找不到返回 None。"""
    return _find_tool(settings.render_ffmpeg_path, FFMPEG_CANDIDATES, ("ffmpeg",))


def check_environment() -> None:
    """环境齐不齐。

    **缺东西一律 503**，并说清楚缺什么、先做什么：
    缺生产产物就说「先跑 npm run build」，别让人对着一句 ENOENT 发呆。
    """
    if not dist_dir().is_dir():
        raise ApiError(
            status_code=503,
            code=BUILD_MISSING,
            message=(
                f"找不到生产产物 {dist_dir()} —— 先跑 `npm run build` 生成它，再提交渲染任务。"
            ),
        )
    if find_chrome() is None:
        raise ApiError(
            status_code=503,
            code=BROWSER_UNAVAILABLE,
            message=(
                "找不到 Chrome（无头浏览器）—— 装好 Chrome，"
                "或用 BACKEND_RENDER_CHROME_PATH 指向 chrome.exe，再提交渲染任务。"
            ),
        )
    if find_ffmpeg() is None:
        raise ApiError(
            status_code=503,
            code=FFMPEG_UNAVAILABLE,
            message=(
                "找不到 ffmpeg —— 装好 ffmpeg，"
                "或用 BACKEND_RENDER_FFMPEG_PATH 指向 ffmpeg.exe，再提交渲染任务。"
            ),
        )


# --------------------------------------------------------------------------
# 场景校验
# --------------------------------------------------------------------------


def validate_scene(scene: Mapping[str, Any]) -> None:
    """这个场景能不能渲染。不能就 422 ``render_scene_invalid``。"""
    objects = scene.get("objects")
    if not isinstance(objects, list) or not objects:
        raise ApiError(
            status_code=422,
            code=SCENE_INVALID,
            message="场景是空的 —— 没有任何可渲染的物体。",
        )
    renderable = [
        obj
        for obj in objects
        if isinstance(obj, Mapping)
        and str(obj.get("type", "")) in RENDERABLE_TYPES
        and bool(obj.get("visible", True))
    ]
    if not renderable:
        raise ApiError(
            status_code=422,
            code=SCENE_INVALID,
            message=(
                "场景里没有可渲染的物体 —— "
                f"渲染页只认 {'/'.join(RENDERABLE_TYPES)} 这两种类型的物体。"
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
    scene: Mapping[str, Any],
    actions: list[dict[str, Any]],
    frames: int,
    fps: int,
    width: int,
    height: int,
) -> RenderJob:
    """建一行任务。状态从 queued 起步。

    提交之后**不要再 refresh**：那会重新查一次库、把连接攥在手里，
    而后台任务马上要用另一条连接写同一张表。
    """
    job = RenderJob(
        job_id=job_id,
        status=JOB_QUEUED,
        label=label,
        scene=dict(scene),
        actions=list(actions),
        frames=frames,
        fps=fps,
        width=width,
        height=height,
        progress=0,
        created_at=utcnow(),
        updated_at=utcnow(),
    )
    session.add(job)
    session.commit()
    return job


def get_job(session: Session, job_id: str) -> RenderJob | None:
    return session.get(RenderJob, job_id)


def list_jobs(session: Session, limit: int = JOB_LIST_LIMIT) -> list[RenderJob]:
    """最近的任务，最新的在前。"""
    stmt = select(RenderJob).order_by(RenderJob.created_at.desc()).limit(limit)
    return list(session.scalars(stmt).all())


def mark_rendering(session: Session, job_id: str) -> None:
    _update(session, job_id, status=JOB_RENDERING)


def mark_succeeded(
    session: Session,
    job_id: str,
    *,
    video_path: str,
    duration_ms: int,
) -> None:
    _update(
        session,
        job_id,
        status=JOB_SUCCEEDED,
        progress=100,
        video_path=video_path,
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
    error_code: str = RENDER_FAILED,
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
    job = session.get(RenderJob, job_id)
    if job is None:
        return
    for key, value in fields.items():
        setattr(job, key, value)
    job.updated_at = utcnow()
    session.commit()


def video_file(job: RenderJob) -> Path | None:
    """产物文件。还没有（或文件没了）返回 None。"""
    if not job.video_path:
        return None
    path = Path(job.video_path)
    return path if path.is_file() else None


# --------------------------------------------------------------------------
# 录制器
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class RecorderResult:
    """一次录制调用的结果。

    ``returncode`` 是录制器的退出码：0 成功，非 0 失败。
    ``stderr`` 原样留着——出错时最后几行最有用。
    """

    returncode: int
    stdout: str = ""
    stderr: str = ""
    summary: dict[str, Any] = field(default_factory=dict)


# 录制器执行器：给它三个路径，返回结果。
# **可替换**——测试用替身，不需要真的开浏览器。
Recorder = Callable[[Path, Path, Path], RecorderResult]


def recorder_command(request_path: Path, video_path: Path, summary_path: Path) -> list[str]:
    """录制器的命令行（规格 §4 的 CLI 契约）。

    ``node scripts/record-scene.mjs <输入JSON> <输出MP4> <输出摘要JSON>``
    """
    node = settings.render_node_path.strip() or "node"
    return [
        node,
        str(recorder_script()),
        str(request_path),
        str(video_path),
        str(summary_path),
    ]


def run_recorder(request_path: Path, video_path: Path, summary_path: Path) -> RecorderResult:
    """真的调 ``node scripts/record-scene.mjs``。

    退出码 0 算成功；非 0 算失败，stderr 原样带回去。
    """
    script = recorder_script()
    if not script.is_file():
        raise FileNotFoundError(f"找不到录制器脚本：{script}")

    command = recorder_command(request_path, video_path, summary_path)
    logger.info("渲染开始：%s", " ".join(command))
    try:
        completed = subprocess.run(
            command,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=settings.render_timeout_seconds,
            cwd=str(repo_root()),
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(f"录制超时（{settings.render_timeout_seconds} 秒）") from exc

    return RecorderResult(
        returncode=completed.returncode,
        stdout=completed.stdout or "",
        stderr=completed.stderr or "",
        summary=read_summary(summary_path),
    )


def read_summary(summary_path: Path) -> dict[str, Any]:
    """读录制器写的摘要。

    读不到就当没有——摘要只是额外信息（帧数、耗时），
    不该因为它坏了就让整个任务失败。
    """
    if not summary_path.is_file():
        return {}
    try:
        raw = json.loads(summary_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        logger.warning("录制摘要读不出来：%s", exc)
        return {}
    return raw if isinstance(raw, dict) else {}


def stderr_summary(stderr: str, *, limit: int = 8) -> str:
    """取 stderr 的最后几行。

    出错时最有用的是**最后一步**的输出（前面的往往是一堆无关日志）。
    """
    lines = [line.strip() for line in (stderr or "").splitlines() if line.strip()]
    if not lines:
        return ""
    return " / ".join(lines[-limit:])


def build_recorder_payload(job: RenderJob) -> dict[str, Any]:
    """喂给录制器的输入。

    形状就是请求体去掉 label：录制器只需要场景与动作。
    """
    return {
        "scene": job.scene,
        "actions": job.actions,
        "frames": job.frames,
        "fps": job.fps,
        "width": job.width,
        "height": job.height,
    }


# --------------------------------------------------------------------------
# 跑任务
# --------------------------------------------------------------------------


def execute_job(job_id: str, *, recorder: Recorder | None = None) -> None:
    """把一个任务从 queued 跑到 succeeded / failed。

    状态流转：``queued → rendering → succeeded | failed``。
    """
    run = recorder or run_recorder

    session = SessionLocal()
    try:
        job = get_job(session, job_id)
        if job is None:
            logger.warning("渲染任务不存在：%s", job_id)
            return
        if job.status != JOB_QUEUED:
            return

        mark_rendering(session, job_id)

        work_dir = output_dir()
        work_dir.mkdir(parents=True, exist_ok=True)
        video_path = work_dir / f"{job_id}.mp4"
        summary_path = work_dir / f"{job_id}.summary.json"
        request_path = work_dir / f"{job_id}.request.json"
        request_path.write_text(
            json.dumps(build_recorder_payload(job), ensure_ascii=False),
            encoding="utf-8",
        )

        started = time.monotonic()
        try:
            result = run(request_path, video_path, summary_path)
        except Exception as exc:  # noqa: BLE001 —— 失败原因要写进库里
            logger.exception("渲染任务失败：%s", job_id)
            mark_failed(
                session,
                job_id,
                error=f"录制失败：{exc}",
                error_code=RENDER_FAILED,
                detail=str(exc),
            )
            return
        duration_ms = int((time.monotonic() - started) * 1000)

        if result.returncode != 0 or not video_path.is_file():
            detail = stderr_summary(result.stderr) or stderr_summary(result.stdout)
            if not detail:
                detail = f"录制器退出码 {result.returncode}"
            logger.warning("渲染任务失败（%s）：%s", job_id, detail)
            mark_failed(
                session,
                job_id,
                error=f"录制失败：{detail}",
                error_code=RENDER_FAILED,
                detail=detail,
            )
            return

        # 帧数必须与请求一致——不一致说明这段视频的「第 N 帧」不对应「第 N 步」，
        # 拿它当成功交出去等于骗人。摘要里没有这个数就不查（不强求录制器给）。
        captured = result.summary.get("capturedFrames")
        if isinstance(captured, int) and captured != job.frames:
            detail = f"帧数与请求不一致：请求 {job.frames} 帧，实际 {captured} 帧"
            logger.warning("渲染任务失败（%s）：%s", job_id, detail)
            mark_failed(
                session,
                job_id,
                error=f"录制失败：{detail}",
                error_code=RENDER_FAILED,
                detail=detail,
            )
            return

        mark_succeeded(
            session,
            job_id,
            video_path=str(video_path),
            duration_ms=duration_ms,
        )
        logger.info("渲染完成：%s（%d ms）", job_id, duration_ms)
    finally:
        session.close()
