"""Gym 会话式环境的 HTTP 接口与回合状态机（M1）。

会话是内存态：测试直接打接口，验证建/步进/reset/销毁与
terminated / truncated / 409 的状态机。物理正确性归 simulator 的测试管。
"""

from fastapi.testclient import TestClient

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


def _create(client: TestClient, **overrides: object) -> dict:
    payload: dict = {
        "scene": SCENE,
        "target": {"x": 5.0, "z": 0.0},
        "maxSteps": 300,
    }
    payload.update(overrides)
    response = client.post("/api/gym/sessions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def test_create_returns_observation_with_agent(client: TestClient):
    body = _create(client)

    assert body["sessionId"]
    assert body["terminated"] is False
    obs = body["observation"]
    # 唯一的动态物体自动当选智能体
    assert obs["agent"]["uuid"] == "agent"
    assert obs["step"] == 0
    assert obs["target"] == {"x": 5.0, "z": 0.0}
    assert len(obs["objects"]) == 1


def test_step_moves_agent_and_counts(client: TestClient):
    session_id = _create(client)["sessionId"]

    body = client.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 20.0, "forceZ": 0.0}
    ).json()
    obs = body["observation"]
    assert obs["step"] == 1
    assert body["terminated"] is False
    assert body["truncated"] is False
    # 沿 +X 方向受力：x 位置应当前进
    assert obs["agent"]["position"]["x"] > 0

    detail = client.get("/api/gym/sessions").json()
    # 会话跨测试残留是常态（内存态字典）：按 id 找自己这条
    mine = next(item for item in detail if item["sessionId"] == session_id)
    assert mine["step"] == 1
    assert mine["agentUuid"] == "agent"


def test_determinism_same_force_same_positions(client: TestClient):
    """同一场景同一力序列 → 逐位相同的轨迹（frame=物理步的可复现）。"""
    first_id = _create(client)["sessionId"]
    for _ in range(5):
        client.post(f"/api/gym/sessions/{first_id}/step", json={"forceX": 8.0, "forceZ": -3.0})
    first_obs = client.post(
        f"/api/gym/sessions/{first_id}/step", json={"forceX": 0.0, "forceZ": 0.0}
    ).json()["observation"]

    second_id = _create(client)["sessionId"]
    for _ in range(5):
        client.post(f"/api/gym/sessions/{second_id}/step", json={"forceX": 8.0, "forceZ": -3.0})
    second_obs = client.post(
        f"/api/gym/sessions/{second_id}/step", json={"forceX": 0.0, "forceZ": 0.0}
    ).json()["observation"]

    assert first_obs["objects"] == second_obs["objects"]


def test_goal_entry_terminates_with_bonus(client: TestClient):
    """目标设在出生点：走一步就在圈内，terminated + 进入奖励。"""
    session_id = _create(client, target={"x": 0.0, "z": 0.0})["sessionId"]

    body = client.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0}
    ).json()
    assert body["terminated"] is True
    # 进步量（可正可负）+ 进入奖励 10
    assert body["reward"] > 9.0


def test_step_after_done_returns_409(client: TestClient):
    session_id = _create(client, target={"x": 0.0, "z": 0.0})["sessionId"]
    client.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0})

    response = client.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 1.0, "forceZ": 0.0}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "gym_episode_done"


def test_truncated_at_max_steps_then_reset(client: TestClient):
    session_id = _create(client, maxSteps=3)["sessionId"]
    for _ in range(3):
        body = client.post(
            f"/api/gym/sessions/{session_id}/step", json={"forceX": 2.0, "forceZ": 0.0}
        ).json()
    assert body["truncated"] is True
    assert body["terminated"] is False

    reset = client.post(f"/api/gym/sessions/{session_id}/reset").json()
    assert reset["observation"]["step"] == 0
    assert reset["terminated"] is False
    # reset 之后可以继续 step
    again = client.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 2.0, "forceZ": 0.0}
    ).json()
    assert again["observation"]["step"] == 1


def test_reset_restores_initial_positions(client: TestClient):
    session_id = _create(client)["sessionId"]
    initial = client.post(f"/api/gym/sessions/{session_id}/reset").json()["observation"]
    client.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 15.0, "forceZ": 0.0})
    client.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 0.0, "forceZ": 0.0})
    moved = client.post(f"/api/gym/sessions/{session_id}/reset").json()["observation"]

    assert moved["objects"] == initial["objects"]


def test_empty_scene_is_rejected(client: TestClient):
    response = client.post("/api/gym/sessions", json={"scene": {"id": "s", "objects": []}})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "gym_invalid_request"


def test_scene_without_dynamic_object_is_rejected(client: TestClient):
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
    response = client.post("/api/gym/sessions", json={"scene": scene})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "gym_invalid_request"
    assert "动态物体" in response.json()["error"]["message"]


def test_unknown_session_returns_404(client: TestClient):
    response = client.post("/api/gym/sessions/nope/step", json={"forceX": 1.0, "forceZ": 0.0})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "gym_session_not_found"

    delete = client.delete("/api/gym/sessions/nope")
    assert delete.status_code == 404


def test_delete_session(client: TestClient):
    session_id = _create(client)["sessionId"]

    assert client.delete(f"/api/gym/sessions/{session_id}").status_code == 204
    # 会话跨测试残留是常态：只断言自己的这条没了
    remaining = client.get("/api/gym/sessions").json()
    assert all(item["sessionId"] != session_id for item in remaining)
