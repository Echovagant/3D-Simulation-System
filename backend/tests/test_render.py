"""服务端渲染的 HTTP 接口与任务流转。

**不真的开浏览器**：调录制器这一步是可替换的进程调用，测试用替身
（固定摘要 + 假 MP4），真跑一次 Chrome + ffmpeg 留给端到端验收。
"""

import json
import shutil
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db import SessionLocal
from app.services import render_service

SCENE: dict[str, Any] = {
    "id": "s1",
    "name": "渲染测试场景",
    "createdAt": "2026-10-23T00:00:00.000Z",
    "updatedAt": "2026-10-23T00:00:00.000Z",
    "version": 1,
    "objects": [
        {
            "uuid": "o1",
            "type": "cube",
            "name": "立方体",
            "position": {"x": 0, "y": 3, "z": 0},
            "rotation": {"x": 0, "y": 0, "z": 0},
            "scale": {"x": 1, "y": 1, "z": 1},
            "visible": True,
        }
    ],
}

# 假 MP4：带个 ftyp 头，够验「返回的是视频字节」
FAKE_MP4 = b"\x00\x00\x00\x18ftypmp42" + b"fake-mp4-body"


class FakeRecorder:
    """录制器替身。

    写一个假 MP4 与固定摘要，并把「录制期间任务是什么状态」记下来——
    好让测试断言状态机真的走过 rendering。
    """

    def __init__(
        self,
        *,
        returncode: int = 0,
        stderr: str = "",
        summary: dict[str, Any] | None = None,
    ) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.summary = summary if summary is not None else {"frames": 180, "durationMs": 1234}
        self.calls: list[tuple[Path, Path, Path]] = []
        self.payloads: list[dict[str, Any]] = []
        self.statuses: list[str | None] = []

    def __call__(
        self, request_path: Path, video_path: Path, summary_path: Path
    ) -> render_service.RecorderResult:
        self.calls.append((Path(request_path), Path(video_path), Path(summary_path)))
        self.payloads.append(json.loads(Path(request_path).read_text(encoding="utf-8")))

        # 录制期间任务应该已经是 rendering
        job_id = Path(video_path).stem
        with SessionLocal() as session:
            job = render_service.get_job(session, job_id)
            self.statuses.append(job.status if job else None)

        if self.returncode == 0:
            Path(video_path).write_bytes(FAKE_MP4)
        Path(summary_path).write_text(json.dumps(self.summary), encoding="utf-8")
        return render_service.RecorderResult(
            returncode=self.returncode,
            stderr=self.stderr,
            summary=self.summary,
        )


@pytest.fixture
def fake_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """把环境指向 tmp 里的假文件。

    测试**不该依赖本机装没装 Chrome / ffmpeg**——那属于端到端验收的事。
    """
    dist = tmp_path / "dist"
    dist.mkdir()
    chrome = tmp_path / "chrome.exe"
    chrome.write_text("fake chrome", encoding="utf-8")
    ffmpeg = tmp_path / "ffmpeg.exe"
    ffmpeg.write_text("fake ffmpeg", encoding="utf-8")

    monkeypatch.setattr(settings, "render_dist_dir", str(dist))
    monkeypatch.setattr(settings, "render_chrome_path", str(chrome))
    monkeypatch.setattr(settings, "render_ffmpeg_path", str(ffmpeg))
    monkeypatch.setattr(settings, "render_output_dir", str(tmp_path / "renders"))
    return tmp_path


@pytest.fixture
def fake_recorder(monkeypatch: pytest.MonkeyPatch) -> FakeRecorder:
    """把录制器换成替身。"""
    recorder = FakeRecorder()
    monkeypatch.setattr(render_service, "run_recorder", recorder)
    return recorder


def _submit(client: TestClient, **overrides: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"scene": SCENE, "frames": 30, "fps": 24}
    payload.update(overrides)
    response = client.post("/api/render", json=payload)
    assert response.status_code == 202, response.text
    return response.json()


# --------------------------------------------------------------------------
# 提交与状态机
# --------------------------------------------------------------------------


def test_submit_returns_202_and_job_id(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    body = _submit(client)

    assert body["jobId"]
    assert len(fake_recorder.calls) == 1


def test_new_job_starts_as_queued(db_session: None, fake_env: Path):
    """刚建出来的任务是 queued —— 状态机从排队起步。"""
    with SessionLocal() as session:
        job = render_service.create_job(
            session,
            job_id="queued-job",
            label=None,
            scene=SCENE,
            actions=[],
            frames=180,
            fps=30,
            width=1280,
            height=720,
        )
        assert job.status == render_service.JOB_QUEUED
        assert job.progress == 0


def test_render_job_runs_to_succeeded(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    job_id = _submit(client, label="落球演示")["jobId"]

    detail = client.get(f"/api/render/{job_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["jobId"] == job_id
    assert body["status"] == "succeeded"
    assert body["progress"] == 100
    assert body["artifactUrl"] == f"/api/render/{job_id}/video.mp4"
    assert body["durationMs"] >= 0
    assert body["createdAt"]
    # 成功的任务没有错误信息（可选字段不返回）
    assert "error" not in body


def test_state_machine_passes_through_rendering(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    """queued → rendering → succeeded：录制期间任务确实是 rendering。"""
    _submit(client)

    assert fake_recorder.statuses == ["rendering"]


def test_recorder_receives_scene_actions_and_size(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    """喂给录制器的输入：场景、动作脚本、帧数与尺寸，一个都不能少。"""
    _submit(
        client,
        actions=[
            {"atFrame": 0, "type": "addCube", "params": {"position": {"x": 0, "y": 3, "z": 0}}}
        ],
        frames=90,
        fps=24,
        width=640,
        height=360,
    )

    payload = fake_recorder.payloads[0]
    assert payload["scene"]["id"] == "s1"
    assert payload["frames"] == 90
    assert payload["fps"] == 24
    assert payload["width"] == 640
    assert payload["height"] == 360
    # 动作按 camelCase 传（atFrame）——录制器读的是前端那套键
    assert payload["actions"][0]["atFrame"] == 0
    assert payload["actions"][0]["type"] == "addCube"


def test_unknown_action_type_is_rejected(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    """动作类型就那四种（规格 §2.3）——多一种就不认。"""
    response = client.post(
        "/api/render",
        json={"scene": SCENE, "actions": [{"atFrame": 0, "type": "addRocket"}]},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_odd_dimensions_are_rejected(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    """H.264 的 yuv420p 要求宽高都是偶数——现在拒掉，别等开浏览器才失败。"""
    response = client.post("/api/render", json={"scene": SCENE, "width": 641, "height": 360})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_frame_count_mismatch_is_a_failure(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """帧数与请求不一致 → 不能当成功交出去。"""
    recorder = FakeRecorder(summary={"capturedFrames": 7})
    monkeypatch.setattr(render_service, "run_recorder", recorder)

    job_id = _submit(client, frames=30)["jobId"]

    body = client.get(f"/api/render/{job_id}").json()
    assert body["status"] == "failed"
    assert "帧数与请求不一致" in body["error"]


# --------------------------------------------------------------------------
# 产物
# --------------------------------------------------------------------------


def test_video_download_returns_mp4_bytes(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    job_id = _submit(client)["jobId"]

    response = client.get(f"/api/render/{job_id}/video.mp4")

    assert response.status_code == 200
    assert response.headers["content-type"] == "video/mp4"
    assert response.content == FAKE_MP4


def test_video_before_completion_returns_409(client: TestClient, fake_env: Path):
    """还没跑完就要视频 → 409，别给一个空文件。"""
    with SessionLocal() as session:
        render_service.create_job(
            session,
            job_id="pending-job",
            label=None,
            scene=SCENE,
            actions=[],
            frames=180,
            fps=30,
            width=1280,
            height=720,
        )

    response = client.get("/api/render/pending-job/video.mp4")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "render_not_ready"


# --------------------------------------------------------------------------
# 失败
# --------------------------------------------------------------------------


def test_failed_render_records_the_reason(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """录制挂了：任务标 failed，错误写进库里，不悄悄消失。"""
    recorder = FakeRecorder(returncode=3, stderr="ffmpeg: invalid argument\nlast step failed")
    monkeypatch.setattr(render_service, "run_recorder", recorder)

    job_id = _submit(client)["jobId"]

    body = client.get(f"/api/render/{job_id}").json()
    assert body["status"] == "failed"
    assert "ffmpeg" in body["error"]
    assert body["progress"] == 0
    assert "artifactUrl" not in body


def test_failed_render_video_returns_500_with_stderr_detail(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """失败任务要视频 → 500 render_failed，detail 里是最后一步的 stderr 摘要。"""
    recorder = FakeRecorder(returncode=3, stderr="ffmpeg: invalid argument\nlast step failed")
    monkeypatch.setattr(render_service, "run_recorder", recorder)

    job_id = _submit(client)["jobId"]

    response = client.get(f"/api/render/{job_id}/video.mp4")
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "render_failed"
    assert "last step failed" in error["detail"]


def test_recorder_exception_marks_the_job_failed(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """录制器直接抛异常（脚本不存在等）也要如实标 failed。"""

    def boom(request_path: Path, video_path: Path, summary_path: Path) -> None:
        raise FileNotFoundError("找不到录制器脚本")

    monkeypatch.setattr(render_service, "run_recorder", boom)

    job_id = _submit(client)["jobId"]

    body = client.get(f"/api/render/{job_id}").json()
    assert body["status"] == "failed"
    assert "找不到录制器脚本" in body["error"]


# --------------------------------------------------------------------------
# 场景校验
# --------------------------------------------------------------------------


def test_empty_scene_is_rejected(client: TestClient, fake_env: Path, fake_recorder: FakeRecorder):
    response = client.post("/api/render", json={"scene": {"id": "s", "objects": []}})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "render_scene_invalid"


def test_scene_without_renderable_objects_is_rejected(
    client: TestClient, fake_env: Path, fake_recorder: FakeRecorder
):
    """场景里有物体，但没有渲染页认的类型 —— 一样是 422。"""
    scene = {
        "id": "s",
        "objects": [
            {
                "uuid": "o1",
                "type": "model",
                "name": "模型",
                "position": {"x": 0, "y": 0, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1},
                "visible": True,
            }
        ],
    }

    response = client.post("/api/render", json={"scene": scene})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "render_scene_invalid"


# --------------------------------------------------------------------------
# 环境缺失：一律 503，并说清楚缺什么
# --------------------------------------------------------------------------


def test_missing_dist_returns_503_with_build_hint(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """没有生产产物就说「先跑 npm run build」——别让人对着一句 ENOENT 发呆。"""
    monkeypatch.setattr(settings, "render_dist_dir", str(Path(fake_env) / "no-such-dist"))

    response = client.post("/api/render", json={"scene": SCENE})

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "render_build_missing"
    assert "npm run build" in error["message"]


def test_missing_chrome_returns_503(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "render_chrome_path", str(Path(fake_env) / "no-such-chrome.exe"))

    response = client.post("/api/render", json={"scene": SCENE})

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "render_browser_unavailable"
    assert "Chrome" in error["message"]


def test_missing_ffmpeg_returns_503(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    monkeypatch.setattr(settings, "render_ffmpeg_path", str(Path(fake_env) / "no-such-ffmpeg.exe"))

    response = client.post("/api/render", json={"scene": SCENE})

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "render_ffmpeg_unavailable"
    assert "ffmpeg" in error["message"]


# --------------------------------------------------------------------------
# 列表与查询
# --------------------------------------------------------------------------


def test_list_returns_recent_jobs(client: TestClient, fake_env: Path, fake_recorder: FakeRecorder):
    _submit(client, label="A")
    _submit(client, label="B")

    body = client.get("/api/render").json()

    assert len(body) == 2
    assert {item["label"] for item in body} == {"A", "B"}
    assert {item["status"] for item in body} == {"succeeded"}


def test_unknown_job_returns_404(client: TestClient, fake_env: Path):
    response = client.get("/api/render/nope")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "render_not_found"


# --------------------------------------------------------------------------
# 录制器 CLI 契约
# --------------------------------------------------------------------------


def test_recorder_command_matches_the_cli_contract(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """``node scripts/record-scene.mjs <输入> <输出.mp4> <摘要.json>`` —— 顺序不能错。"""
    monkeypatch.setattr(settings, "render_script_path", str(tmp_path / "record-scene.mjs"))

    command = render_service.recorder_command(
        tmp_path / "in.json", tmp_path / "out.mp4", tmp_path / "summary.json"
    )

    assert command[0] == "node"
    assert command[1].endswith("record-scene.mjs")
    assert command[2:] == [
        str(tmp_path / "in.json"),
        str(tmp_path / "out.mp4"),
        str(tmp_path / "summary.json"),
    ]


@pytest.mark.skipif(shutil.which("node") is None, reason="没装 node，跳过")
def test_run_recorder_invokes_node_with_the_three_paths(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """真的起一次 node 进程：参数顺序、退出码、摘要都要对。"""
    stub = tmp_path / "record-scene.mjs"
    stub.write_text(
        "import { writeFileSync } from 'node:fs'\n"
        "const [input, video, summary] = process.argv.slice(2)\n"
        "writeFileSync(video, 'fake-mp4')\n"
        "writeFileSync(summary, JSON.stringify({ frames: 7, argv: [input, video, summary] }))\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "render_script_path", str(stub))

    request = tmp_path / "in.json"
    request.write_text(json.dumps({"scene": SCENE}), encoding="utf-8")
    video = tmp_path / "out.mp4"
    summary = tmp_path / "summary.json"

    result = render_service.run_recorder(request, video, summary)

    assert result.returncode == 0
    assert result.summary["frames"] == 7
    assert result.summary["argv"] == [str(request), str(video), str(summary)]
    assert video.read_text(encoding="utf-8") == "fake-mp4"


@pytest.mark.skipif(shutil.which("node") is None, reason="没装 node，跳过")
def test_run_recorder_reports_nonzero_exit(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """退出码非 0 = 失败，stderr 原样带回去。"""
    stub = tmp_path / "record-scene.mjs"
    stub.write_text(
        "process.stderr.write('boom: chrome 起不来\\n'); process.exit(3)\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(settings, "render_script_path", str(stub))

    result = render_service.run_recorder(
        tmp_path / "in.json", tmp_path / "out.mp4", tmp_path / "summary.json"
    )

    assert result.returncode == 3
    assert "boom" in result.stderr
    assert render_service.stderr_summary(result.stderr) == "boom: chrome 起不来"


def test_run_recorder_without_script_raises(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """脚本不存在要说清楚，别抛一个没头没脑的异常。"""
    monkeypatch.setattr(settings, "render_script_path", str(tmp_path / "nope.mjs"))

    with pytest.raises(FileNotFoundError):
        render_service.run_recorder(
            tmp_path / "in.json", tmp_path / "out.mp4", tmp_path / "summary.json"
        )
