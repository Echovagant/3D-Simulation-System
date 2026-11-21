"""ArenaEnv 的回归网：不依赖真后端，用 httpx.MockTransport 当替身。

契约对齐 backend/app/routers/gym.py——后端改字段名，这里会红。
"""

import json

import httpx
import numpy as np
import pytest

from threesim_gym import ArenaEnv, DEFAULT_SCENE


def _make_env_with_fake_api(max_steps: int = 300):
    """一个内存里的假后端：会话字典 + 步进计数，形状与真后端一致。"""
    sessions: dict[str, dict] = {}
    counter = {"n": 0}

    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path

        if path == "/api/gym/sessions" and request.method == "POST":
            counter["n"] += 1
            session_id = f"sess-{counter['n']}"
            sessions[session_id] = {
                "step": 0,
                "maxSteps": json.loads(request.content.decode())["maxSteps"],
                "done": False,
            }
            return httpx.Response(
                201,
                json={
                    "sessionId": session_id,
                    "observation": _observation(session_id, sessions[session_id]["step"]),
                    "reward": 0.0,
                    "terminated": False,
                    "truncated": False,
                },
            )

        parts = path.strip("/").split("/")  # ["api", "gym", "sessions", <id>, ...]
        if len(parts) >= 4 and parts[2] == "sessions":
            session_id = parts[3]
            session = sessions.get(session_id)
            if session is None:
                return httpx.Response(
                    404,
                    json={"error": {"code": "gym_session_not_found", "message": "nope"}},
                )

            if len(parts) == 4 and request.method == "DELETE":
                sessions.pop(session_id)
                return httpx.Response(204)

            if len(parts) == 5 and parts[4] == "step" and request.method == "POST":
                if session["done"]:
                    return httpx.Response(
                        409,
                        json={"error": {"code": "gym_episode_done", "message": "done"}},
                    )
                session["step"] += 1
                if session["step"] >= session["maxSteps"]:
                    session["done"] = True
                    truncated = True
                else:
                    truncated = False
                body = json.loads(request.content.decode())
                return httpx.Response(
                    200,
                    json={
                        "observation": _observation(
                            session_id, session["step"], x_offset=0.01 * session["step"]
                        ),
                        "reward": 0.5,
                        "terminated": False,
                        "truncated": truncated,
                        "info": {
                            "step": session["step"],
                            "maxSteps": session["maxSteps"],
                            "distance": 4.9,
                        },
                    },
                )

            if len(parts) == 5 and parts[4] == "reset" and request.method == "POST":
                session["step"] = 0
                session["done"] = False
                return httpx.Response(
                    200,
                    json={
                        "observation": _observation(session_id, 0),
                        "reward": 0.0,
                        "terminated": False,
                        "truncated": False,
                    },
                )

        return httpx.Response(404, json={"error": {"code": "not_found", "message": path}})

    def _observation(session_id: str, step: int, x_offset: float = 0.0) -> dict:
        return {
            "agent": {
                "uuid": "agent",
                "position": {"x": x_offset, "y": 0.5, "z": 0.0},
                "velocity": {"x": 0.0, "y": 0.0, "z": 0.0},
            },
            "objects": [
                {
                    "uuid": "agent",
                    "position": {"x": x_offset, "y": 0.5, "z": 0.0},
                    "velocity": {"x": 0.0, "y": 0.0, "z": 0.0},
                }
            ],
            "target": {"x": 5.0, "z": 0.0},
            "step": step,
            "maxSteps": 10,
            "distance": 5.0 - x_offset,
        }

    env = ArenaEnv(base_url="http://fake", max_steps=max_steps, transport=httpx.MockTransport(handler))
    return env, sessions


def test_reset_returns_six_dim_observation():
    env, _ = _make_env_with_fake_api()
    observation, info = env.reset(seed=0)

    assert observation.shape == (6,)
    assert observation.dtype == np.float32
    assert info["objects"][0]["uuid"] == "agent"
    assert info["distance"] == pytest.approx(5.0)
    env.close()


def test_step_returns_farama_five_tuple():
    env, _ = _make_env_with_fake_api()
    env.reset(seed=0)

    action = np.array([10.0, -2.0], dtype=np.float32)
    assert env.action_space.contains(action)

    observation, reward, terminated, truncated, info = env.step(action)

    assert observation.shape == (6,)
    assert observation[0] == pytest.approx(0.01, abs=1e-6)  # 假后端每步推 0.01
    assert reward == pytest.approx(0.5)
    assert terminated is False
    assert truncated is False
    assert info["step"] == 1
    env.close()


def test_step_rejects_wrong_action_shape():
    env, _ = _make_env_with_fake_api()
    env.reset(seed=0)

    with pytest.raises(ValueError):
        env.step(np.array([1.0, 2.0, 3.0], dtype=np.float32))
    env.close()


def test_step_before_reset_raises():
    env, _ = _make_env_with_fake_api()
    with pytest.raises(RuntimeError):
        env.step(np.array([1.0, 0.0], dtype=np.float32))


def test_truncated_then_reset_allows_stepping_again():
    env, _ = _make_env_with_fake_api(max_steps=10)
    env.reset(seed=0)

    result = None
    for _ in range(10):
        result = env.step(np.array([1.0, 0.0], dtype=np.float32))
    assert result[3] is True  # truncated

    with pytest.raises(RuntimeError):
        env.step(np.array([1.0, 0.0], dtype=np.float32))

    observation, info = env.reset(seed=1)
    assert info["objects"][0]["position"]["x"] == pytest.approx(0.0)
    assert observation[0] == pytest.approx(0.0)
    env.close()


def test_close_deletes_the_server_session():
    env, sessions = _make_env_with_fake_api()
    env.reset(seed=0)
    assert len(sessions) == 1

    env.close()
    assert len(sessions) == 0
    assert env._session_id is None


def test_default_scene_is_a_valid_minimal_scene():
    """默认场景自带一个动态物体——没有后端也能看出结构合法。"""
    objects = DEFAULT_SCENE["objects"]
    assert any(obj["physics"]["type"] == "dynamic" for obj in objects)
