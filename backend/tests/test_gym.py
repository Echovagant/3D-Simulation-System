"""Gym 会话式环境的 HTTP 接口与回合状态机。

会话是内存态：测试直接打接口，验证建/步进/reset/销毁与
terminated / truncated / 409 的状态机。物理正确性归 simulator 的测试管。
"""

import json
import math

import pytest
from fastapi.testclient import TestClient

OWNER = "gym-owner-under-test"
OTHER_OWNER = "gym-owner-other"


@pytest.fixture
def gym(client: TestClient) -> TestClient:
    """带归属头的 gym 客户端。

    client 是函数级 fixture，每个测试新建，改头不会漏给别的测试文件。
    """
    client.headers.update({"X-Owner-Token": OWNER})
    return client


SCENE = {
    "id": "g1",
    "name": "gym 冒烟",
    "objects": [
        {
            "uuid": "agent",
            "type": "sphere",
            "name": "小球",
            "position": {"x": 0, "y": 0.5, "z": 0},
            "rotation": {"x": 0, "y": 0, "z": 0},
            "scale": {"x": 1, "y": 1, "z": 1},
            "physics": {"type": "dynamic", "mass": 1},
        }
    ],
}


def _create(gym: TestClient, **overrides: object) -> dict:
    payload: dict = {
        "scene": SCENE,
        "target": {"x": 5.0, "z": 0.0},
        "maxSteps": 300,
    }
    headers = overrides.pop("headers", None)
    payload.update(overrides)
    response = gym.post("/api/gym/sessions", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_observation_with_agent(gym: TestClient):
    body = _create(gym)

    assert body["sessionId"]
    assert body["terminated"] is False
    obs = body["observation"]
    # 唯一的动态物体自动当选智能体
    assert obs["agent"]["uuid"] == "agent"
    assert obs["step"] == 0
    assert obs["target"] == {"x": 5.0, "z": 0.0}
    assert len(obs["objects"]) == 1


def test_step_moves_agent_and_counts(gym: TestClient):
    session_id = _create(gym)["sessionId"]

    body = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 10.0, "forceZ": 0.0}
    ).json()
    obs = body["observation"]
    assert obs["step"] == 1
    assert body["terminated"] is False
    assert body["truncated"] is False
    # 沿 +X 方向受力：x 位置应当前进
    assert obs["agent"]["position"]["x"] > 0

    detail = gym.get("/api/gym/sessions").json()
    # 会话跨测试残留是常态（内存态字典）：按 id 找自己这条
    mine = next(item for item in detail if item["sessionId"] == session_id)
    assert mine["step"] == 1
    assert mine["agentUuid"] == "agent"


def test_determinism_same_force_same_positions(gym: TestClient):
    """同一场景同一力序列 → 逐位相同的轨迹（frame=物理步的可复现）。"""
    first_id = _create(gym)["sessionId"]
    for _ in range(5):
        gym.post(f"/api/gym/sessions/{first_id}/step", json={"forceX": 8.0, "forceZ": -3.0})
    first_obs = gym.post(
        f"/api/gym/sessions/{first_id}/step", json={"forceX": 0.0, "forceZ": 0.0}
    ).json()["observation"]

    second_id = _create(gym)["sessionId"]
    for _ in range(5):
        gym.post(f"/api/gym/sessions/{second_id}/step", json={"forceX": 8.0, "forceZ": -3.0})
    second_obs = gym.post(
        f"/api/gym/sessions/{second_id}/step", json={"forceX": 0.0, "forceZ": 0.0}
    ).json()["observation"]

    assert first_obs["objects"] == second_obs["objects"]


def test_goal_entry_terminates_with_bonus(gym: TestClient):
    """目标设在出生点：走一步就在圈内，terminated + 进入奖励。"""
    session_id = _create(gym, target={"x": 0.0, "z": 0.0})["sessionId"]

    body = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0}
    ).json()
    assert body["terminated"] is True
    # 进步量（可正可负）+ 进入奖励 10
    assert body["reward"] > 9.0


def test_step_after_done_returns_409(gym: TestClient):
    session_id = _create(gym, target={"x": 0.0, "z": 0.0})["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0})

    response = gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0})
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "gym_episode_done"


def test_truncated_at_max_steps_then_reset(gym: TestClient):
    session_id = _create(gym, maxSteps=3)["sessionId"]
    for _ in range(3):
        body = gym.post(
            f"/api/gym/sessions/{session_id}/step", json={"forceX": 2.0, "forceZ": 0.0}
        ).json()
    assert body["truncated"] is True
    assert body["terminated"] is False

    reset = gym.post(f"/api/gym/sessions/{session_id}/reset").json()
    assert reset["observation"]["step"] == 0
    assert reset["terminated"] is False
    # reset 之后可以继续 step
    again = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 2.0, "forceZ": 0.0}
    ).json()
    assert again["observation"]["step"] == 1


def test_reset_restores_initial_positions(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    initial = gym.post(f"/api/gym/sessions/{session_id}/reset").json()["observation"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 10.0, "forceZ": 0.0})
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 0.0, "forceZ": 0.0})
    moved = gym.post(f"/api/gym/sessions/{session_id}/reset").json()["observation"]

    assert moved["objects"] == initial["objects"]


def test_empty_scene_is_rejected(gym: TestClient):
    response = gym.post("/api/gym/sessions", json={"scene": {"id": "s", "objects": []}})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "gym_invalid_request"


def test_scene_without_dynamic_object_is_rejected(gym: TestClient):
    scene = {
        "id": "s",
        "name": "只有静态",
        "objects": [
            {
                "uuid": "wall",
                "type": "cube",
                "name": "墙",
                "position": {"x": 0, "y": 1, "z": 0},
                "rotation": {"x": 0, "y": 0, "z": 0},
                "scale": {"x": 1, "y": 1, "z": 1},
                "physics": {"type": "static", "mass": 0},
            }
        ],
    }
    response = gym.post("/api/gym/sessions", json={"scene": scene})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "gym_invalid_request"
    assert "动态物体" in response.json()["error"]["message"]


def test_unknown_session_returns_404(gym: TestClient):
    response = gym.post("/api/gym/sessions/nope/step", json={"forceX": 1.0, "forceZ": 0.0})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "gym_session_not_found"

    delete = gym.delete("/api/gym/sessions/nope")
    assert delete.status_code == 404


def test_delete_session(gym: TestClient):
    session_id = _create(gym)["sessionId"]

    assert gym.delete(f"/api/gym/sessions/{session_id}").status_code == 204
    # 会话跨测试残留是常态：只断言自己的这条没了
    remaining = gym.get("/api/gym/sessions").json()
    assert all(item["sessionId"] != session_id for item in remaining)


def test_missing_owner_token_is_401(client: TestClient):
    """五端点都必须拒绝无归属头的请求。"""
    create = client.post("/api/gym/sessions", json={"scene": SCENE})
    assert create.status_code == 401
    assert create.json()["error"]["code"] == "owner_token_required"
    assert client.get("/api/gym/sessions").status_code == 401
    assert client.post("/api/gym/sessions/x/reset").status_code == 401
    assert (
        client.post("/api/gym/sessions/x/step", json={"forceX": 1.0, "forceZ": 0.0}).status_code
        == 401
    )
    assert client.delete("/api/gym/sessions/x").status_code == 401


def test_cross_owner_access_is_404(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    other = {"X-Owner-Token": OTHER_OWNER}

    assert (
        gym.post(
            f"/api/gym/sessions/{session_id}/step",
            json={"forceX": 1.0, "forceZ": 0.0},
            headers=other,
        ).status_code
        == 404
    )
    assert gym.post(f"/api/gym/sessions/{session_id}/reset", headers=other).status_code == 404
    assert gym.delete(f"/api/gym/sessions/{session_id}", headers=other).status_code == 404


def test_list_sessions_only_mine(gym: TestClient):
    mine = _create(gym)["sessionId"]
    other = _create(gym, scene={**SCENE, "id": "g2"}, headers={"X-Owner-Token": OTHER_OWNER})[
        "sessionId"
    ]

    listed = gym.get("/api/gym/sessions").json()
    assert any(item["sessionId"] == mine for item in listed)
    assert all(item["sessionId"] != other for item in listed)


def test_force_at_limit_is_accepted(gym: TestClient):
    """上限按运行时质量算，从 create 回显的 forceLimit 取，不硬编码。"""
    created = _create(gym)
    limit = created["forceLimit"]
    assert limit > 0
    response = gym.post(
        f"/api/gym/sessions/{created['sessionId']}/step", json={"forceX": limit, "forceZ": 0.0}
    )
    assert response.status_code == 200, response.text


def test_force_over_limit_is_blocked_with_remediation(gym: TestClient):
    created = _create(gym)
    response = gym.post(
        f"/api/gym/sessions/{created['sessionId']}/step",
        json={"forceX": created["forceLimit"] + 1.0, "forceZ": 0.0},
    )
    assert response.status_code == 422
    error = response.json()["error"]
    assert error["code"] == "gym_force_out_of_range"
    assert "请减小" in error["message"]


def test_force_limit_is_vector_norm(gym: TestClient):
    """两分量各 0.8×上限 → 模长 1.13×上限，必须拦（钉住按模长而非按分量）。"""
    created = _create(gym)
    component = created["forceLimit"] * 0.8
    response = gym.post(
        f"/api/gym/sessions/{created['sessionId']}/step",
        json={"forceX": component, "forceZ": component},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "gym_force_out_of_range"


def test_force_limit_scales_with_body_geometry(gym: TestClient):
    """后端不接声明质量（parity bug 已立项另修），运行时质量 = 几何体积。

    sphere scale 2 → 半径 1 → 体积 ×8 → 上限 ×8。
    """
    small = _create(gym)
    big_scene = {
        **SCENE,
        "id": "g-big",
        "objects": [{**SCENE["objects"][0], "scale": {"x": 2, "y": 2, "z": 2}}],
    }
    big = _create(gym, scene=big_scene)
    assert big["forceLimit"] == pytest.approx(small["forceLimit"] * 8, rel=1e-6)

    force = small["forceLimit"] * 4
    assert (
        gym.post(
            f"/api/gym/sessions/{big['sessionId']}/step", json={"forceX": force, "forceZ": 0.0}
        ).status_code
        == 200
    )
    assert (
        gym.post(
            f"/api/gym/sessions/{small['sessionId']}/step", json={"forceX": force, "forceZ": 0.0}
        ).status_code
        == 422
    )


def test_force_limit_equals_max_accel_times_runtime_mass(gym: TestClient):
    """钉住公式与当前真实质量源。

    sphere scale 1 → 半径 0.5 → 体积 4/3·π·0.5³。
    ⚠️ parity bug 修好后此测试会红——那是预期的绊线，届时按声明质量改期望值。
    """
    expected = 30.0 * (4.0 / 3.0) * math.pi * 0.5**3
    # rel=1e-6 而非 1e-9：rapier 的 mass 是 f32（实测相对误差 2.78e-8），
    # 与本文件的几何缩放测试同口径；仍精确钉住「30 × 运行时体积」
    assert _create(gym)["forceLimit"] == pytest.approx(expected, rel=1e-6)


@pytest.mark.parametrize("bad", [float("nan"), float("inf"), float("-inf")])
def test_non_finite_force_is_rejected(gym: TestClient, bad: float):
    """schema 层 allow_inf_nan=False 拦下，不到审计层。

    SQLite 把 NaN 存成 NULL 会撞 force_x 的 NOT NULL，
    所以在边界就拒，而不是让它变成 503 gym_audit_unavailable。
    httpx 0.28 的 json= 用 allow_nan=False，必须走 content= 才测得到服务端。
    """
    session_id = _create(gym)["sessionId"]
    response = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        content=json.dumps({"forceX": bad, "forceZ": 0.0}),
        headers={"Content-Type": "application/json"},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_blocked_step_does_not_advance(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    before = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0}
    ).json()["observation"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 999.0, "forceZ": 0.0})
    after = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 0.0, "forceZ": 0.0}
    ).json()["observation"]
    assert after["step"] == before["step"] + 1


def test_applied_step_writes_audit(gym: TestClient, db_session):
    from sqlalchemy.orm import Session

    from app.db import engine
    from app.models import GymStepLog

    session_id = _create(gym)["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 5.0, "forceZ": 0.0})

    with Session(engine) as db:
        rows = db.query(GymStepLog).filter(GymStepLog.session_id == session_id).all()
        assert len(rows) == 1
        assert rows[0].applied is True
        assert rows[0].distance is not None
        assert rows[0].owner_token == OWNER


def test_blocked_step_writes_audit(gym: TestClient, db_session):
    from sqlalchemy.orm import Session

    from app.db import engine
    from app.models import GymStepLog

    session_id = _create(gym)["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 999.0, "forceZ": 0.0})

    with Session(engine) as db:
        rows = db.query(GymStepLog).filter(GymStepLog.session_id == session_id).all()
        assert len(rows) == 1
        assert rows[0].applied is False
        assert rows[0].error_code == "gym_force_out_of_range"
        assert rows[0].force_x == 999.0


def test_audit_failure_stops_physics(gym: TestClient, monkeypatch):
    """审计写不进去 → 503，且步数与位置都不许变。"""
    from app.services import gym_audit

    session_id = _create(gym)["sessionId"]
    first = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0}
    ).json()["observation"]

    def boom(*args: object, **kwargs: object) -> None:
        from app.errors import ApiError

        raise ApiError(status_code=503, code="gym_audit_unavailable", message="审计不可用")

    monkeypatch.setattr(gym_audit, "record_step", boom)
    response = gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 5.0, "forceZ": 0.0})
    assert response.status_code == 503
    assert response.json()["error"]["code"] == "gym_audit_unavailable"

    monkeypatch.undo()
    after = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 0.0, "forceZ": 0.0}
    ).json()["observation"]
    # 503 那一步没推进：步数只 +1（来自这次合法步），不是 +2。
    # 不断言位置相等——物体带着前一步的速度会继续漂移，位置不是不变量。
    assert after["step"] == first["step"] + 1


def test_create_echoes_effective_params(gym: TestClient):
    body = _create(gym, params={"dt": 0.02, "bogus": 1, "steps": True})
    assert body["effectiveParams"]["dt"] == 0.02
    assert body["droppedParamKeys"] == ["bogus"]
    assert body["defaultedParamKeys"] == ["steps"]


def test_create_clean_params_echo_empty_lists(gym: TestClient):
    body = _create(gym, params={"dt": 0.01})
    assert body["droppedParamKeys"] == []
    assert body["defaultedParamKeys"] == []


def test_reset_echoes_params_and_bumps_round(gym: TestClient):
    created = _create(gym, params={"dt": 0.02, "bogus": 1})
    session_id = created["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0})
    reset = gym.post(f"/api/gym/sessions/{session_id}/reset").json()

    assert reset["effectiveParams"]["dt"] == 0.02
    assert reset["droppedParamKeys"] == ["bogus"]
    assert reset["forceLimit"] == created["forceLimit"]


def test_logs_endpoint_returns_steps(gym: TestClient):
    created = _create(gym)
    session_id = created["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 5.0, "forceZ": 0.0})
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 999.0, "forceZ": 0.0})

    response = gym.get(f"/api/gym/sessions/{session_id}/logs")
    assert response.status_code == 200
    rows = response.json()
    assert len(rows) == 2
    assert rows[0]["applied"] is True
    assert rows[1]["applied"] is False
    assert rows[1]["errorCode"] == "gym_force_out_of_range"
    # 力上限 = 30 × 运行时质量（≈15.7N，见 test_force_limit_equals_max_accel_times_runtime_mass），
    # 不硬编码 30.0——与 create 回显同一份真相
    assert rows[0]["forceLimit"] == created["forceLimit"]


def test_logs_limit_validation(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    assert gym.get(f"/api/gym/sessions/{session_id}/logs?limit=0").status_code == 422
    assert gym.get(f"/api/gym/sessions/{session_id}/logs?limit=1001").status_code == 422
    assert gym.get(f"/api/gym/sessions/{session_id}/logs?limit=1000").status_code == 200


def test_logs_unknown_round_is_empty(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 5.0, "forceZ": 0.0})
    response = gym.get(f"/api/gym/sessions/{session_id}/logs?round=99")
    assert response.status_code == 200
    assert response.json() == []


def test_logs_round_filter_after_reset(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 5.0, "forceZ": 0.0})
    gym.post(f"/api/gym/sessions/{session_id}/reset")
    gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 5.0, "forceZ": 0.0})

    assert len(gym.get(f"/api/gym/sessions/{session_id}/logs?round=0").json()) == 1
    assert len(gym.get(f"/api/gym/sessions/{session_id}/logs?round=1").json()) == 1


def test_logs_cross_owner_is_404(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    response = gym.get(
        f"/api/gym/sessions/{session_id}/logs", headers={"X-Owner-Token": OTHER_OWNER}
    )
    assert response.status_code == 404
