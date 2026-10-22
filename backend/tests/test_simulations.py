"""批量仿真的 HTTP 接口与任务流转。

**不碰真 Redis**：队列用替身（FakePool），连不上队列的路径也用替身制造。
"""

import asyncio

import pytest
from fastapi.testclient import TestClient

from app.services import simulation_service
from app.workers.simulation import run_simulation

SCENE = {
    "id": "s1",
    "name": "测试场景",
    "createdAt": "2026-10-23T00:00:00.000Z",
    "updatedAt": "2026-10-23T00:00:00.000Z",
    "version": 1,
    "objects": [
        {
            "uuid": "o1",
            "type": "cube",
            "name": "立方体",
            "position": {"x": 0, "y": 2, "z": 0},
            "rotation": {"x": 0, "y": 0, "z": 0},
            "scale": {"x": 1, "y": 1, "z": 1},
            "visible": True,
        }
    ],
}


class FakePool:
    """ARQ 连接池的替身。"""

    def __init__(self) -> None:
        self.enqueued: list[tuple[str, tuple[object, ...], dict[str, object]]] = []
        self.closed = False

    async def enqueue_job(self, function, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        self.enqueued.append((function, args, kwargs))
        return "fake-job-id"

    async def aclose(self) -> None:
        self.closed = True


@pytest.fixture
def fake_queue(monkeypatch: pytest.MonkeyPatch) -> FakePool:
    """把队列换成替身：测试不连真 Redis。"""
    pool = FakePool()

    async def _create_pool(settings_, **kwargs):  # noqa: ANN001, ANN003
        return pool

    monkeypatch.setattr(simulation_service, "create_pool", _create_pool)
    return pool


def _submit(client: TestClient, **overrides: object) -> dict[str, object]:
    payload: dict[str, object] = {
        "label": "摩擦扫描",
        "scene": SCENE,
        "params": {"steps": 60},
    }
    payload.update(overrides)
    return client.post("/api/simulations", json=payload).json()


# --------------------------------------------------------------------------
# 提交与排队
# --------------------------------------------------------------------------


def test_submit_returns_202_and_job_id(client: TestClient, fake_queue: FakePool):
    response = client.post("/api/simulations", json={"scene": SCENE, "params": {"steps": 60}})

    assert response.status_code == 202
    body = response.json()
    assert body["jobId"]
    assert fake_queue.enqueued[0][0] == "run_simulation"
    assert fake_queue.enqueued[0][1] == (body["jobId"],)
    assert fake_queue.closed is True


def test_submitted_job_is_persisted_as_queued(client: TestClient, fake_queue: FakePool):
    job_id = _submit(client)["jobId"]

    status = client.get(f"/api/simulations/{job_id}")
    assert status.status_code == 200
    body = status.json()
    assert body["status"] == "queued"
    assert body["total"] == 1
    assert body["done"] == 0
    assert body["label"] == "摩擦扫描"
    assert "createdAt" in body


def test_sweep_job_reports_total_runs(client: TestClient, fake_queue: FakePool):
    job_id = _submit(
        client,
        sweep={"param": "friction", "values": [0.1, 0.5, 0.9]},
    )["jobId"]

    body = client.get(f"/api/simulations/{job_id}").json()
    assert body["total"] == 3


def test_queue_unavailable_returns_503(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Redis 连不上时要如实报错，不能假装排队成功。"""

    async def _boom(settings_, **kwargs):  # noqa: ANN001, ANN003
        raise ConnectionError("redis 连不上")

    monkeypatch.setattr(simulation_service, "create_pool", _boom)

    response = client.post("/api/simulations", json={"scene": SCENE})

    assert response.status_code == 503
    body = response.json()
    assert body["error"]["code"] == "simulation_queue_unavailable"


def test_failed_enqueue_marks_the_job_failed(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """排队失败的任务要留在库里并标成 failed——失败也要留痕。"""

    async def _boom(settings_, **kwargs):  # noqa: ANN001, ANN003
        raise ConnectionError("redis 连不上")

    monkeypatch.setattr(simulation_service, "create_pool", _boom)

    response = client.post("/api/simulations", json={"scene": SCENE})
    assert response.status_code == 503

    from app.db import SessionLocal
    from app.models import SimulationJob

    with SessionLocal() as session:
        rows = list(session.query(SimulationJob).all())

    assert len(rows) == 1
    assert rows[0].status == "failed"
    assert rows[0].error


# --------------------------------------------------------------------------
# 列表与查询
# --------------------------------------------------------------------------


def test_list_returns_recent_jobs(client: TestClient, fake_queue: FakePool):
    _submit(client, label="A")
    _submit(client, label="B")

    body = client.get("/api/simulations").json()
    assert len(body) == 2
    assert {item["label"] for item in body} == {"A", "B"}


def test_unknown_job_returns_404(client: TestClient):
    response = client.get("/api/simulations/nope")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "simulation_not_found"


# --------------------------------------------------------------------------
# 任务流转与结果读取
# --------------------------------------------------------------------------


def test_job_flows_from_queued_to_succeeded(client: TestClient, fake_queue: FakePool):
    job_id = _submit(client)["jobId"]

    asyncio.run(run_simulation({}, job_id))

    body = client.get(f"/api/simulations/{job_id}").json()
    assert body["status"] == "succeeded"
    assert body["done"] == body["total"] == 1
    # 成功的任务没有错误信息（可选字段不返回）
    assert "error" not in body


def test_results_endpoint_returns_runs_and_summary(client: TestClient, fake_queue: FakePool):
    job_id = _submit(client, sweep={"param": "friction", "values": [0.1, 0.5]})["jobId"]

    asyncio.run(run_simulation({}, job_id))

    response = client.get(f"/api/simulations/{job_id}/results")
    assert response.status_code == 200
    body = response.json()

    assert len(body["runs"]) == 2
    assert body["runs"][0]["index"] == 0
    assert body["runs"][0]["params"]["friction"] == 0.1
    assert body["runs"][0]["objects"][0]["uuid"] == "o1"
    assert body["runs"][0]["objects"][0]["resting"] is True
    # 默认不返回 trace
    assert "trace" not in body["runs"][0]["objects"][0]

    assert body["summary"]["runs"] == 2
    assert body["summary"]["settledRuns"] == 2
    assert body["summary"]["maxPenetration"] == 0.0


def test_trace_is_returned_when_asked_for(client: TestClient, fake_queue: FakePool):
    """params.trace = true 时结果里要带完整轨迹。"""
    job_id = _submit(client, params={"steps": 10, "trace": True})["jobId"]

    asyncio.run(run_simulation({}, job_id))

    body = client.get(f"/api/simulations/{job_id}/results").json()
    trace = body["runs"][0]["objects"][0]["trace"]
    assert len(trace) == 11
    assert trace[0]["frame"] == 0
    assert trace[-1]["frame"] == 10


def test_results_are_empty_before_the_job_runs(client: TestClient, fake_queue: FakePool):
    job_id = _submit(client)["jobId"]

    body = client.get(f"/api/simulations/{job_id}/results").json()
    assert body["runs"] == []
    assert body["summary"]["runs"] == 0


def test_failed_job_records_the_reason(client: TestClient, fake_queue: FakePool):
    """跑挂的任务要标成 failed 并写明原因。

    这里的坏参数是**绕过 API 校验**直接写进库里的——
    真实世界里的坏参数来自旧版本的任务、或者手工改过的库。
    """
    from app.db import SessionLocal

    with SessionLocal() as session:
        job = simulation_service.create_job(
            session,
            job_id="broken-job",
            label=None,
            scene=SCENE,
            params={"dt": -1},
            sweep=None,
        )

    asyncio.run(run_simulation({}, job.job_id))

    body = client.get(f"/api/simulations/{job.job_id}").json()
    assert body["status"] == "failed"
    assert body["error"]


def test_invalid_params_are_rejected(client: TestClient, fake_queue: FakePool):
    response = client.post("/api/simulations", json={"scene": SCENE, "params": {"dt": 0}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "simulation_invalid_params"


def test_unknown_sweep_dimension_is_rejected(client: TestClient, fake_queue: FakePool):
    response = client.post(
        "/api/simulations",
        json={"scene": SCENE, "sweep": {"param": "dt", "values": [0.1, 0.2]}},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_too_many_steps_are_rejected(
    client: TestClient, fake_queue: FakePool, monkeypatch: pytest.MonkeyPatch
):
    """步数上限是防止有人一次把机器跑满。"""
    from app.config import settings

    monkeypatch.setattr(settings, "simulation_max_steps", 10)

    response = client.post("/api/simulations", json={"scene": SCENE, "params": {"steps": 1000}})
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "simulation_invalid_params"


def test_too_many_sweep_values_are_rejected(
    client: TestClient, fake_queue: FakePool, monkeypatch: pytest.MonkeyPatch
):
    """单个任务的运行次数也要有上限。"""
    from app.config import settings

    monkeypatch.setattr(settings, "simulation_max_runs_per_job", 2)

    response = client.post(
        "/api/simulations",
        json={
            "scene": SCENE,
            "sweep": {"param": "friction", "values": [0.1, 0.5, 0.9]},
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "simulation_invalid_params"


def test_daily_quota_is_counted_from_the_results_table(
    client: TestClient, fake_queue: FakePool, monkeypatch: pytest.MonkeyPatch
):
    """配额从 simulation_results 的行数数出来——不另建计数表。"""
    from app.config import settings
    from app.db import SessionLocal
    from app.services import simulation_service as svc

    monkeypatch.setattr(settings, "simulation_max_runs_per_day", 1)

    job_id = _submit(client)["jobId"]
    asyncio.run(run_simulation({}, job_id))

    with SessionLocal() as session:
        assert svc.count_runs_since(session, svc.day_start()) == 1
        with pytest.raises(Exception) as excinfo:
            svc.check_daily_quota(session)
    assert getattr(excinfo.value, "code", None) == "simulation_quota_exceeded"
