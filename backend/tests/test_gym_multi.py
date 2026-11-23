"""Gym 多智能体的接口与状态机。

覆盖：多智能体建会话与兼容视图、批量动作、单动作兼容、逐智能体力上限、
重复/未知 uuid、单智能体完成后的行为、全完成才 terminated、reset、审计归属。
"""

import pytest
from fastapi.testclient import TestClient

from app.services import gym_service

OWNER = "gym-multi-owner"

CUBE = {
    "type": "cube",
    "rotation": {"x": 0, "y": 0, "z": 0},
    "scale": {"x": 1, "y": 1, "z": 1},
    "physics": {
        "type": "dynamic",
        "shape": "cube",
        "halfExtents": {"x": 0.5, "y": 0.5, "z": 0.5},
        "mass": 1,
        "friction": 0.5,
        "restitution": 0.2,
    },
}

SCENE = {
    "id": "multi-1",
    "name": "双智能体",
    "objects": [
        {"uuid": "a", "name": "甲", "position": {"x": 0, "y": 1, "z": 0}, **CUBE},
        {"uuid": "b", "name": "乙", "position": {"x": 0, "y": 1, "z": 2}, **CUBE},
    ],
}


@pytest.fixture
def gym(client: TestClient) -> TestClient:
    client.headers.update({"X-Owner-Token": OWNER})
    return client


@pytest.fixture(autouse=True)
def _clean_sessions():
    """会话是模块级内存态：本文件每个用例前清空，避免撞 32 个上限。"""
    gym_service._sessions.clear()
    yield
    gym_service._sessions.clear()


def _create(
    gym: TestClient, *, agents: list[dict] | None = None, scene: dict | None = None
) -> dict:
    payload = {
        "scene": scene or SCENE,
        "agents": agents
        or [
            {"uuid": "a", "target": {"x": 3.0, "z": 0.0}},
            {"uuid": "b", "target": {"x": -3.0, "z": 2.0}},
        ],
        "maxSteps": 300,
    }
    response = gym.post("/api/gym/sessions", json=payload)
    assert response.status_code == 201, response.text
    return response.json()


def _obs(body: dict) -> dict:
    return body["observation"]


def _agent_obs(body: dict, uuid: str) -> dict:
    return next(item for item in _obs(body)["agents"] if item["uuid"] == uuid)


def test_create_multi_agent_observation_and_limits(gym: TestClient):
    body = _create(gym)

    obs = _obs(body)
    assert obs["agent"]["uuid"] == "a"  # 主视图 = 第一个
    assert obs["target"] == {"x": 3.0, "z": 0.0}
    assert len(obs["agents"]) == 2
    assert [item["uuid"] for item in obs["agents"]] == ["a", "b"]
    assert all(item["done"] is False for item in obs["agents"])
    assert _agent_obs(body, "b")["target"] == {"x": -3.0, "z": 2.0}
    # 两个 1kg 立方体：力上限都应是 30N
    assert body["forceLimits"] == {"a": 30.0, "b": 30.0}

    summary = next(
        item
        for item in gym.get("/api/gym/sessions").json()
        if item["sessionId"] == body["sessionId"]
    )
    assert summary["agentUuids"] == ["a", "b"]


def test_batch_step_moves_all_agents(gym: TestClient):
    session_id = _create(gym)["sessionId"]

    body = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={
            "actions": [
                {"agentUuid": "a", "forceX": 12.0, "forceZ": 0.0},
                {"agentUuid": "b", "forceX": 0.0, "forceZ": -12.0},
            ]
        },
    ).json()

    assert _obs(body)["step"] == 1
    assert _agent_obs(body, "a")["position"]["x"] > 0
    assert _agent_obs(body, "b")["position"]["z"] < 2
    assert body["reward"] > 0
    assert [item["uuid"] for item in body["info"]["agents"]] == ["a", "b"]


def test_legacy_force_applies_to_primary_only(gym: TestClient):
    session_id = _create(gym)["sessionId"]

    body = gym.post(
        f"/api/gym/sessions/{session_id}/step", json={"forceX": 10.0, "forceZ": 0.0}
    ).json()

    assert _agent_obs(body, "a")["position"]["x"] > 0
    # 乙没收到动作，z 不应被推动
    assert _agent_obs(body, "b")["position"]["z"] == pytest.approx(2, abs=1e-3)


def test_unknown_and_duplicate_uuid_rejected(gym: TestClient):
    session_id = _create(gym)["sessionId"]

    unknown = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={"actions": [{"agentUuid": "nope", "forceX": 1.0, "forceZ": 0.0}]},
    )
    assert unknown.status_code == 422
    assert unknown.json()["error"]["code"] == "gym_invalid_request"

    duplicate = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={
            "actions": [
                {"agentUuid": "a", "forceX": 1.0, "forceZ": 0.0},
                {"agentUuid": "a", "forceX": 2.0, "forceZ": 0.0},
            ]
        },
    )
    assert duplicate.status_code == 422
    assert duplicate.json()["error"]["code"] == "gym_invalid_request"

    session = next(
        item for item in gym.get("/api/gym/sessions").json() if item["sessionId"] == session_id
    )
    assert session["step"] == 0


def test_per_agent_force_limit_all_or_nothing(gym: TestClient):
    session_id = _create(gym)["sessionId"]

    over = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={
            "actions": [
                {"agentUuid": "a", "forceX": 5.0, "forceZ": 0.0},
                {"agentUuid": "b", "forceX": 999.0, "forceZ": 0.0},
            ]
        },
    )
    assert over.status_code == 422
    assert over.json()["error"]["code"] == "gym_force_out_of_range"
    assert "b" in over.json()["error"]["message"]

    # 全有或全无：世界没推进，审计只留下 b 的失败行
    session = next(
        item for item in gym.get("/api/gym/sessions").json() if item["sessionId"] == session_id
    )
    assert session["step"] == 0
    logs = gym.get(f"/api/gym/sessions/{session_id}/logs").json()
    assert len(logs) == 1
    assert logs[0]["agentUuid"] == "b"
    assert logs[0]["applied"] is False


def test_partial_goal_does_not_end_episode(gym: TestClient):
    # 甲一开始就在目标上，乙还远
    body = _create(
        gym,
        agents=[
            {"uuid": "a", "target": {"x": 0.0, "z": 0.0}},
            {"uuid": "b", "target": {"x": 5.0, "z": 2.0}},
        ],
    )
    session_id = body["sessionId"]

    stepped = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={
            "actions": [
                {"agentUuid": "a", "forceX": 0.0, "forceZ": 0.0},
                {"agentUuid": "b", "forceX": 5.0, "forceZ": 0.0},
            ]
        },
    ).json()

    assert _agent_obs(stepped, "a")["done"] is True
    assert _agent_obs(stepped, "b")["done"] is False
    assert stepped["terminated"] is False

    # 已完成（进圈）的智能体不能再施力
    again = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={"actions": [{"agentUuid": "a", "forceX": 1.0, "forceZ": 0.0}]},
    )
    assert again.status_code == 422
    assert again.json()["error"]["code"] == "gym_agent_done"


def test_all_agents_done_terminates_episode(gym: TestClient):
    body = _create(
        gym,
        agents=[
            {"uuid": "a", "target": {"x": 0.0, "z": 0.0}},
            {"uuid": "b", "target": {"x": 0.0, "z": 2.0}},
        ],
    )
    session_id = body["sessionId"]

    stepped = gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={
            "actions": [
                {"agentUuid": "a", "forceX": 0.0, "forceZ": 0.0},
                {"agentUuid": "b", "forceX": 0.0, "forceZ": 0.0},
            ]
        },
    ).json()

    assert stepped["terminated"] is True
    assert all(item["done"] for item in _obs(stepped)["agents"])
    # 两个智能体各拿一次目标奖励
    assert stepped["reward"] == pytest.approx(20.0, rel=1e-6)

    done = gym.post(f"/api/gym/sessions/{session_id}/step", json={"forceX": 0.0, "forceZ": 0.0})
    assert done.status_code == 409
    assert done.json()["error"]["code"] == "gym_episode_done"


def test_reset_clears_done_flags(gym: TestClient):
    body = _create(
        gym,
        agents=[
            {"uuid": "a", "target": {"x": 0.0, "z": 0.0}},
            {"uuid": "b", "target": {"x": 5.0, "z": 2.0}},
        ],
    )
    session_id = body["sessionId"]
    gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={
            "actions": [
                {"agentUuid": "a", "forceX": 0.0, "forceZ": 0.0},
                {"agentUuid": "b", "forceX": 5.0, "forceZ": 0.0},
            ]
        },
    )

    reset = gym.post(f"/api/gym/sessions/{session_id}/reset").json()

    assert _obs(reset)["step"] == 0
    assert all(item["done"] is False for item in _obs(reset)["agents"])
    assert _agent_obs(reset, "a")["position"]["x"] == pytest.approx(0, abs=1e-6)
    assert reset["forceLimits"] == {"a": 30.0, "b": 30.0}


def test_audit_rows_carry_agent_uuid(gym: TestClient):
    session_id = _create(gym)["sessionId"]
    gym.post(
        f"/api/gym/sessions/{session_id}/step",
        json={"forceX": 3.0, "forceZ": 0.0},
    )

    logs = gym.get(f"/api/gym/sessions/{session_id}/logs").json()
    assert len(logs) == 1
    assert logs[0]["agentUuid"] == "a"
