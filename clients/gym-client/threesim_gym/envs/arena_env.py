"""导航到目标点的 Gymnasium 环境（M2）。

把后端的 Gym 会话 HTTP 接口（``backend/app/routers/gym.py``）包成
``gymnasium.Env``，与 Farama 规范对齐：

* ``reset(seed=...) -> (obs, info)``
* ``step(action)   -> (obs, reward, terminated, truncated, info)``
* ``close()``      销毁服务端会话

* **动作** ``Box(-force_limit, +force_limit, (2,))``：施加在智能体上的水平力 (fx, fz)。
  服务端按「冲量 = 力 × dt」换算，与浏览器同一口径。
* **观测** ``Box(-inf, +inf, (6,))``：智能体的位置与速度 [x, y, z, vx, vy, vz]。
  全场景物体的位姿放 ``info["objects"]``——观测空间必须固定形状，
  物体数量随场景变的东西不能进观测空间。
* **任务**：把智能体推到目标点；进入目标半径 terminated=True（服务端判），
  步数到上限 truncated=True。
"""

from __future__ import annotations

from typing import Any

import gymnasium as gym
import httpx
import numpy as np

# 开箱即用的最小场景：一颗球落在系统地面上，就是可推动的智能体。
# 更复杂的场景由调用方传 scene=（形状与前端 SceneDocument 一致）。
DEFAULT_SCENE: dict[str, Any] = {
    "id": "threesim-gym-default",
    "name": "Gym 默认场景",
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


class ArenaEnv(gym.Env):
    """3D-Simulation-System 的导航环境（HTTP 客户端形态）。"""

    metadata = {"render_modes": []}

    def __init__(
        self,
        base_url: str = "http://127.0.0.1:8021",
        scene: dict[str, Any] | None = None,
        params: dict[str, Any] | None = None,
        agent_uuid: str | None = None,
        target: tuple[float, float] = (5.0, 0.0),
        max_steps: int = 300,
        force_limit: float = 50.0,
        timeout: float = 10.0,
        transport: httpx.BaseTransport | None = None,
    ) -> None:
        super().__init__()
        # transport 主要是给测试用的替身入口；业务调用保持默认
        self._client = httpx.Client(base_url=base_url, timeout=timeout, transport=transport)
        self._create_payload: dict[str, Any] = {
            "scene": scene if scene is not None else DEFAULT_SCENE,
            "params": params or {},
            "agentUuid": agent_uuid,
            "target": {"x": target[0], "z": target[1]},
            "maxSteps": max_steps,
        }
        self._session_id: str | None = None

        self.action_space = gym.spaces.Box(
            low=-force_limit, high=force_limit, shape=(2,), dtype=np.float32
        )
        # 观测恒为智能体的 6 元组（位置 + 速度）——形状固定才配得上 Box
        self.observation_space = gym.spaces.Box(
            low=-np.inf, high=np.inf, shape=(6,), dtype=np.float32
        )

    def reset(
        self, *, seed: int | None = None, options: dict[str, Any] | None = None
    ) -> tuple[np.ndarray, dict[str, Any]]:
        super().reset(seed=seed)

        if self._session_id is None:
            response = self._client.post("/api/gym/sessions", json=self._create_payload)
            response.raise_for_status()
            payload = response.json()
            # 只有建会话的应答带 sessionId；reset 应答不带（会话没变）
            self._session_id = payload["sessionId"]
        else:
            response = self._client.post(f"/api/gym/sessions/{self._session_id}/reset")
            response.raise_for_status()
            payload = response.json()

        observation_payload = payload["observation"]
        info = {
            "objects": observation_payload["objects"],
            "distance": observation_payload["distance"],
            "target": observation_payload["target"],
        }
        return self._to_observation(observation_payload), info

    def step(
        self, action: np.ndarray | list[float]
    ) -> tuple[np.ndarray, float, bool, bool, dict[str, Any]]:
        if self._session_id is None:
            raise RuntimeError("环境还没 reset——先 reset() 再 step()（Farama 规范）")

        action_array = np.asarray(action, dtype=np.float32).reshape(-1)
        if action_array.shape != (2,):
            raise ValueError(f"动作必须是 (2,) 的水平力 [fx, fz]，收到形状 {action_array.shape}")
        fx, fz = float(action_array[0]), float(action_array[1])

        response = self._client.post(
            f"/api/gym/sessions/{self._session_id}/step",
            json={"forceX": fx, "forceZ": fz},
        )
        if response.status_code == 409:
            raise RuntimeError(
                "回合已结束（terminated/truncated）——先 reset() 再 step()，"
                "Gym 规范不允许对 done 的环境继续 step。"
            )
        response.raise_for_status()
        payload = response.json()

        observation_payload = payload["observation"]
        info = {
            "objects": observation_payload["objects"],
            "distance": observation_payload["distance"],
            "step": payload["info"]["step"],
            "maxSteps": payload["info"]["maxSteps"],
        }
        return (
            self._to_observation(observation_payload),
            float(payload["reward"]),
            bool(payload["terminated"]),
            bool(payload["truncated"]),
            info,
        )

    def close(self) -> None:
        """销毁服务端会话。

        会话本来就是服务端内存态：删不掉就随进程清空，这里不重试。
        """
        if self._session_id is not None:
            try:
                self._client.delete(f"/api/gym/sessions/{self._session_id}")
            except httpx.HTTPError:
                pass
            self._session_id = None
        self._client.close()

    @staticmethod
    def _to_observation(observation_payload: dict[str, Any]) -> np.ndarray:
        agent = observation_payload["agent"]
        position, velocity = agent["position"], agent["velocity"]
        return np.array(
            [
                position["x"],
                position["y"],
                position["z"],
                velocity["x"],
                velocity["y"],
                velocity["z"],
            ],
            dtype=np.float32,
        )
