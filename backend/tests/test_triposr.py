"""TripoSR 本地推理的 HTTP 接口与任务流转。

**不真的跑模型**：调推理器这一步是可替换的进程调用，测试用替身
（假 GLB），真跑一次 CPU 推理留给端到端验收。
"""

from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.db import SessionLocal
from app.services import triposr_service

# 假 GLB：带 glTF magic 头，够验「返回的是模型字节」
FAKE_GLB = b"glTF\x02\x00\x00\x00" + b"fake-glb-body"

PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"fake-png-body"


class FakeRunner:
    """推理器替身。

    写一个假 GLB，并把「推理期间任务是什么状态」记下来——
    好让测试断言状态机真的走过 running。
    """

    def __init__(
        self,
        *,
        returncode: int = 0,
        stderr: str = "",
        skip_glb: bool = False,
    ) -> None:
        self.returncode = returncode
        self.stderr = stderr
        self.skip_glb = skip_glb
        self.calls: list[tuple[Path, Path]] = []
        self.statuses: list[str | None] = []

    def __call__(self, image_path: Path, workdir: Path) -> triposr_service.RunnerResult:
        self.calls.append((Path(image_path), Path(workdir)))

        # 推理期间任务应该已经是 running
        with SessionLocal() as session:
            job = triposr_service.get_job(session, Path(workdir).name)
            self.statuses.append(job.status if job else None)

        if self.returncode == 0 and not self.skip_glb:
            out = Path(workdir) / "0"
            out.mkdir(parents=True, exist_ok=True)
            (out / "mesh.glb").write_bytes(FAKE_GLB)
        return triposr_service.RunnerResult(returncode=self.returncode, stderr=self.stderr)


@pytest.fixture
def fake_env(monkeypatch: pytest.MonkeyPatch, tmp_path: Path) -> Path:
    """把环境指向 tmp 里的假文件。

    测试**不该依赖本机装没装 TripoSR**——那属于端到端验收的事。
    venv 解释器把 win/posix 两个位置都补上，测试不挑平台。
    """
    home = tmp_path / "triposr"
    scripts = home / ".venv" / "Scripts"
    scripts.mkdir(parents=True)
    (scripts / "python.exe").write_text("fake python", encoding="utf-8")
    posix_bin = home / ".venv" / "bin"
    posix_bin.mkdir()
    (posix_bin / "python").write_text("fake python", encoding="utf-8")
    (home / "repo").mkdir()
    (home / "repo" / "run.py").write_text("# fake run.py", encoding="utf-8")
    weights = home / "weights"
    weights.mkdir()
    (weights / "model.ckpt").write_text("fake ckpt", encoding="utf-8")

    monkeypatch.setattr(settings, "triposr_home", str(home))
    monkeypatch.setattr(settings, "triposr_output_dir", str(tmp_path / "triposr-out"))
    return home


@pytest.fixture
def fake_runner(monkeypatch: pytest.MonkeyPatch) -> FakeRunner:
    """把推理器换成替身。"""
    runner = FakeRunner()
    monkeypatch.setattr(triposr_service, "run_inference", runner)
    return runner


def _submit(client: TestClient, *, label: str | None = None, **overrides: Any) -> dict[str, Any]:
    """提交一次单图生成；默认是一张合法的 PNG。"""
    image = ("subject.png", PNG_BYTES, "image/png")
    if "image" in overrides:
        image = overrides.pop("image")
    data = {"label": label} if label else {}
    response = client.post("/api/triposr", files={"image": image}, data=data)
    assert response.status_code == 202, response.text
    return response.json()


# --------------------------------------------------------------------------
# 提交与状态机
# --------------------------------------------------------------------------


def test_submit_returns_202_and_job_id(client: TestClient, fake_env: Path, fake_runner: FakeRunner):
    body = _submit(client)

    assert body["jobId"]
    assert len(fake_runner.calls) == 1


def test_new_job_starts_as_queued(db_session: None, fake_env: Path):
    """刚建出来的任务是 queued —— 状态机从排队起步。"""
    with SessionLocal() as session:
        job = triposr_service.create_job(
            session,
            job_id="queued-job",
            label=None,
            image_name="subject.png",
            image_path="nowhere/input.png",
        )
        assert job.status == triposr_service.JOB_QUEUED


def test_inference_job_runs_to_succeeded(
    client: TestClient, fake_env: Path, fake_runner: FakeRunner
):
    job_id = _submit(client, label="小恐龙")["jobId"]

    detail = client.get(f"/api/triposr/{job_id}")
    assert detail.status_code == 200
    body = detail.json()
    assert body["jobId"] == job_id
    assert body["status"] == "succeeded"
    assert body["label"] == "小恐龙"
    assert body["imageName"] == "subject.png"
    assert body["artifactUrl"] == f"/api/triposr/{job_id}/model.glb"
    assert body["durationMs"] >= 0
    assert body["createdAt"]
    # 成功的任务没有错误信息（可选字段不返回）
    assert "error" not in body


def test_state_machine_passes_through_running(
    client: TestClient, fake_env: Path, fake_runner: FakeRunner
):
    """queued → running → succeeded：推理期间任务确实是 running。"""
    _submit(client)

    assert fake_runner.statuses == ["running"]


def test_runner_receives_the_saved_input_image(
    client: TestClient, fake_env: Path, fake_runner: FakeRunner
):
    """喂给推理器的输入图：落在任务目录里、字节就是上传的那份。"""
    job_id = _submit(client)["jobId"]

    image_path, _ = fake_runner.calls[0]
    assert job_id in str(image_path)
    assert image_path.read_bytes() == PNG_BYTES
    assert image_path.suffix == ".png"


# --------------------------------------------------------------------------
# 输入校验
# --------------------------------------------------------------------------


def test_unknown_image_type_is_rejected(client: TestClient, fake_env: Path):
    """图片类型就那三种——多一种就不认。"""
    response = client.post(
        "/api/triposr",
        files={"image": ("payload.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "triposr_image_invalid"


def test_empty_image_is_rejected(client: TestClient, fake_env: Path):
    """空文件生成不出东西——现在拒掉，别等推理进程才失败。"""
    response = client.post(
        "/api/triposr",
        files={"image": ("subject.png", b"", "image/png")},
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "triposr_image_invalid"


def test_oversized_image_is_rejected(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """图太大直接 413——CPU 推理吃不动大图，早说早好。"""
    monkeypatch.setattr(settings, "triposr_max_image_bytes", 8)

    response = client.post(
        "/api/triposr",
        files={"image": ("subject.png", PNG_BYTES, "image/png")},
    )

    assert response.status_code == 413
    assert response.json()["error"]["code"] == "triposr_image_too_large"


# --------------------------------------------------------------------------
# 产物
# --------------------------------------------------------------------------


def test_glb_download_returns_model_bytes(
    client: TestClient, fake_env: Path, fake_runner: FakeRunner
):
    job_id = _submit(client)["jobId"]

    response = client.get(f"/api/triposr/{job_id}/model.glb")

    assert response.status_code == 200
    assert response.headers["content-type"] == "model/gltf-binary"
    assert response.content == FAKE_GLB


def test_glb_before_completion_returns_409(client: TestClient, fake_env: Path):
    """还没跑完就要模型 → 409，别给一个空文件。"""
    with SessionLocal() as session:
        triposr_service.create_job(
            session,
            job_id="pending-job",
            label=None,
            image_name="subject.png",
            image_path="nowhere/input.png",
        )

    response = client.get("/api/triposr/pending-job/model.glb")

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "tripo_not_ready"


def test_find_glb_picks_the_mesh(tmp_path: Path):
    """run.py 的输出布局是 <output>/0/mesh.glb —— 按 glob 找得到。"""
    out = tmp_path / "0"
    out.mkdir()
    glb = out / "mesh.glb"
    glb.write_bytes(FAKE_GLB)

    assert triposr_service.find_glb(tmp_path) == glb
    assert triposr_service.find_glb(tmp_path / "nope") is None


# --------------------------------------------------------------------------
# 失败
# --------------------------------------------------------------------------


def test_failed_inference_records_the_reason(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """推理挂了：任务标 failed，错误写进库里，不悄悄消失。"""
    runner = FakeRunner(returncode=3, stderr="torch: out of memory\nlast step failed")
    monkeypatch.setattr(triposr_service, "run_inference", runner)

    job_id = _submit(client)["jobId"]

    body = client.get(f"/api/triposr/{job_id}").json()
    assert body["status"] == "failed"
    assert "torch" in body["error"]
    assert "artifactUrl" not in body


def test_failed_inference_model_returns_500_with_stderr_detail(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """失败任务要模型 → 500 triposr_inference_failed，detail 里是 stderr 摘要。"""
    runner = FakeRunner(returncode=3, stderr="torch: out of memory\nlast step failed")
    monkeypatch.setattr(triposr_service, "run_inference", runner)

    job_id = _submit(client)["jobId"]

    response = client.get(f"/api/triposr/{job_id}/model.glb")
    assert response.status_code == 500
    error = response.json()["error"]
    assert error["code"] == "triposr_inference_failed"
    assert "last step failed" in error["detail"]


def test_exit_zero_without_glb_is_a_failure(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """退出码 0 但没有产物 = 失败——不能把「什么都没生成」当成功交出去。"""
    runner = FakeRunner(returncode=0, skip_glb=True)
    monkeypatch.setattr(triposr_service, "run_inference", runner)

    job_id = _submit(client)["jobId"]

    body = client.get(f"/api/triposr/{job_id}").json()
    assert body["status"] == "failed"


def test_runner_exception_marks_the_job_failed(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """推理器直接抛异常（超时等）也要如实标 failed。"""

    def boom(image_path: Path, workdir: Path) -> None:
        raise TimeoutError("推理超时（1800 秒）")

    monkeypatch.setattr(triposr_service, "run_inference", boom)

    job_id = _submit(client)["jobId"]

    body = client.get(f"/api/triposr/{job_id}").json()
    assert body["status"] == "failed"
    assert "推理超时" in body["error"]


# --------------------------------------------------------------------------
# 环境缺失：一律 503，并说清楚缺什么
# --------------------------------------------------------------------------


def test_missing_home_returns_503_with_setup_hint(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """没有环境就说「按交接文档装好」——别让人对着一句 ENOENT 发呆。"""
    monkeypatch.setattr(settings, "triposr_home", str(tmp_path / "no-such-triposr"))

    response = client.post("/api/triposr", files={"image": ("subject.png", PNG_BYTES, "image/png")})

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "triposr_env_missing"
    assert "BACKEND_TRIPOSR_HOME" in error["message"]


def test_missing_weights_returns_503_with_download_hint(
    client: TestClient, fake_env: Path, monkeypatch: pytest.MonkeyPatch
):
    """缺权重就给出 hf-mirror 下载指引。"""
    (Path(fake_env) / "weights" / "model.ckpt").unlink()

    response = client.post("/api/triposr", files={"image": ("subject.png", PNG_BYTES, "image/png")})

    assert response.status_code == 503
    error = response.json()["error"]
    assert error["code"] == "triposr_env_missing"
    assert "hf-mirror.com" in error["message"]


# --------------------------------------------------------------------------
# 列表与查询
# --------------------------------------------------------------------------


def test_list_returns_recent_jobs(client: TestClient, fake_env: Path, fake_runner: FakeRunner):
    _submit(client, label="A")
    _submit(client, label="B")

    body = client.get("/api/triposr").json()

    assert len(body) == 2
    assert {item["label"] for item in body} == {"A", "B"}
    assert {item["status"] for item in body} == {"succeeded"}


def test_unknown_job_returns_404(client: TestClient, fake_env: Path):
    response = client.get("/api/triposr/nope")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "tripo_not_found"


# --------------------------------------------------------------------------
# 推理器 CLI 契约
# --------------------------------------------------------------------------


def test_inference_command_matches_the_cli_contract(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
):
    """``python run.py <输入图> --device cpu --model-save-format glb …`` —— 参数不能错。"""
    home = tmp_path / "triposr"
    monkeypatch.setattr(settings, "triposr_home", str(home))
    monkeypatch.setattr(settings, "triposr_bake_texture", True)

    command = triposr_service.inference_command(tmp_path / "input.png", tmp_path / "workdir")

    assert command[0].endswith(("python.exe", "python"))
    assert command[1].endswith("run.py")
    assert command[2] == str(tmp_path / "input.png")
    assert "--device" in command and command[command.index("--device") + 1] == "cpu"
    assert (
        "--model-save-format" in command
        and command[command.index("--model-save-format") + 1] == "glb"
    )
    assert "--output-dir" in command and command[command.index("--output-dir") + 1] == str(
        tmp_path / "workdir"
    )
    assert "--pretrained-model-name-or-path" in command and command[
        command.index("--pretrained-model-name-or-path") + 1
    ] == str(home / "weights")
    assert "--bake-texture" in command


def test_bake_texture_flag_follows_settings(monkeypatch: pytest.MonkeyPatch, tmp_path: Path):
    """机器缺 OpenGL 上下文时关掉烘焙——退回无纹理网格，而不是让任务全军覆没。"""
    monkeypatch.setattr(settings, "triposr_home", str(tmp_path / "triposr"))
    monkeypatch.setattr(settings, "triposr_bake_texture", False)

    command = triposr_service.inference_command(tmp_path / "input.png", tmp_path / "workdir")

    assert "--bake-texture" not in command


# --------------------------------------------------------------------------
# 烘焙产物转换（上游 quirk：pyxatlas.export 把 OBJ 字节写进 mesh.glb）
# --------------------------------------------------------------------------


def test_baked_obj_bytes_are_converted_to_real_glb(tmp_path: Path):
    """OBJ 字节 + texture.png → 真正的 glTF 头 GLB。"""
    out = tmp_path / "0"
    out.mkdir()
    fake = out / "mesh.glb"
    fake.write_text(
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n",
        encoding="utf-8",
    )

    glb = triposr_service._ensure_real_glb(fake)

    assert glb is not None
    assert glb.read_bytes()[:4] == b"glTF"
    # OBJ 原件改名留档，转换产物占回 mesh.glb 的名字
    assert (out / "mesh.obj").is_file()


def test_gltf_headed_file_passes_through(tmp_path: Path):
    """本来就是真 GLB 的产物原样放行，不做多余转换。"""
    out = tmp_path / "0"
    out.mkdir()
    real = out / "mesh.glb"
    real.write_bytes(b"glTF\x02\x00\x00\x00fake-body")

    glb = triposr_service._ensure_real_glb(real)

    assert glb == real
    assert glb.read_bytes()[:4] == b"glTF"


def test_stale_obj_original_does_not_break_conversion(tmp_path: Path):
    """喂进来的是 OBJ 原件（上次转换的残件）也要能转出真 GLB，不能写回 OBJ。"""
    out = tmp_path / "0"
    out.mkdir()
    # 残件场景：mesh.obj 是 OBJ 原件，调用方拿它当 candidate
    stale = out / "mesh.obj"
    stale.write_text(
        "v 0 0 0\nv 1 0 0\nv 0 1 0\nvt 0 0\nvt 1 0\nvt 0 1\nf 1/1 2/2 3/3\n",
        encoding="utf-8",
    )

    glb = triposr_service._ensure_real_glb(stale)

    assert glb is not None
    # 产物必须落到 .glb 名且头部是 glTF——写回 .obj 名等于白转
    assert glb.read_bytes()[:4] == b"glTF"
    assert glb.suffix == ".glb"
