"""Gymnasium 风格的会话式物理环境。

浏览器里的 AI 演武场跑在 three/Rapier 上；RL 研究要的是 Python 侧的
reset / step / observe。这一层把**同一套物理**（``simulator.build_world``，
与批量仿真同源同参）包成会话：

* ``POST   /api/gym/sessions``            建会话（建世界）→ 观测
* ``POST   /api/gym/sessions/{id}/reset`` 重建世界回到初始状态 → 观测
* ``POST   /api/gym/sessions/{id}/step``  施加水平冲量并推进一步 →
  观测 + reward + terminated/truncated
* ``GET    /api/gym/sessions``            列出在场的会话
* ``DELETE /api/gym/sessions/{id}``       销毁会话（WASM 世界跟着释放）

**任务定义**：指定一个智能体物体（默认第一个动态物体）与目标点 (x, z)。
* ``terminated`` = 智能体进入目标半径（成功）或坠出世界（失败）——回合天然结束
* ``truncated``  = 步数到上限——时间到截断
* ``reward``     = 相邻两步的目标距离差分（靠近为正）+ 终局奖励

会话是**内存态**（WASM 世界没法序列化进数据库），进程重启即清空——
这是刻意的：Gym 会话本来就是短命的，持久化只会制造第二份真相。
"""

from __future__ import annotations

import asyncio
import math
import time
import uuid
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.errors import ApiError
from app.services import gym_audit, simulator
from app.services.simulator import SimulationParams, SimulationWorld

# 会话上限：内存里挂着 WASM 世界，不设上限会把内存吃穿
MAX_SESSIONS = 32
# 智能体坠出世界（y 低于此值）算 terminated——掉下平台
FALL_OUT_Y = -10.0
# 目标圈半径（米）：进入即 terminated
GOAL_RADIUS = 0.5
# 进入目标圈的奖励
GOAL_REWARD = 10.0
# 坠出世界的惩罚
FALL_REWARD = -10.0

_sessions: dict[str, GymSession] = {}
# 全局锁：同一时刻只推进一个会话——确定性优先于吞吐
_lock = asyncio.Lock()


@dataclass
class GymSession:
    """一个 Gym 会话：一个活着的物理世界 + 任务定义 + 步数账。"""

    session_id: str
    owner_token: str
    # 场景与参数留档：reset 要按它们重建世界并重解析
    scene: Mapping[str, Any]
    params_raw: Mapping[str, Any]
    params: SimulationParams
    sim: SimulationWorld
    agent_uuid: str
    target_x: float
    target_z: float
    max_steps: int
    step_count: int = 0
    round_index: int = 0
    terminated: bool = False
    truncated: bool = False

    @property
    def agent(self) -> simulator.ObjectBinding | None:
        for binding in self.sim.simulated:
            if binding.uuid == self.agent_uuid:
                return binding
        return None


def _pick_agent(sim: SimulationWorld, agent_uuid: str | None) -> str:
    """选智能体：显式指定优先；否则取第一个动态物体；没有动态物体就报错。"""
    simulated = sim.simulated
    if agent_uuid:
        for binding in simulated:
            if binding.uuid == agent_uuid:
                return binding.uuid
        raise simulator.SimulationError(f"agentUuid 指定的物体不存在：{agent_uuid}")
    for binding in simulated:
        if not binding.is_static:
            return binding.uuid
    raise simulator.SimulationError("场景里没有动态物体——Gym 需要一个可以被推动的智能体")


def _body_position(body: Any) -> dict[str, float]:
    pos = body.translation
    return {"x": pos.x, "y": pos.y, "z": pos.z}


def _body_velocity(body: Any) -> dict[str, float]:
    vel = body.linvel
    return {"x": vel.x, "y": vel.y, "z": vel.z}


def _distance(session: GymSession) -> float:
    """智能体到目标点的水平距离（米）。"""
    agent = session.agent
    if agent is None or agent.body is None:
        return 0.0
    pos = agent.body.translation
    return ((pos.x - session.target_x) ** 2 + (pos.z - session.target_z) ** 2) ** 0.5


def observe(session: GymSession) -> dict[str, Any]:
    """当前观测：智能体、全场景物体、目标、步数与距离。"""
    agent = session.agent
    agent_payload: dict[str, Any] | None = None
    if agent is not None and agent.body is not None:
        agent_payload = {
            "uuid": agent.uuid,
            "position": _body_position(agent.body),
            "velocity": _body_velocity(agent.body),
        }
    objects = [
        {
            "uuid": binding.uuid,
            "position": _body_position(binding.body),
            "velocity": _body_velocity(binding.body),
        }
        for binding in session.sim.simulated
        if binding.body is not None
    ]
    return {
        "agent": agent_payload,
        "objects": objects,
        "target": {"x": session.target_x, "z": session.target_z},
        "step": session.step_count,
        "maxSteps": session.max_steps,
        "distance": round(_distance(session), 4),
    }


def _validate_scene(scene: Mapping[str, Any]) -> None:
    objects = scene.get("objects")
    if not isinstance(objects, list) or not objects:
        raise simulator.SimulationError("场景是空的——至少要有一个动态物体当智能体")


def create_session(
    scene: Mapping[str, Any],
    params_raw: Mapping[str, Any] | None,
    *,
    owner_token: str,
    agent_uuid: str | None,
    target_x: float,
    target_z: float,
    max_steps: int,
) -> GymSession:
    """建会话并返回初始观测载荷（不含 reward/terminated——还没开始）。"""
    if len(_sessions) >= MAX_SESSIONS:
        raise ApiError(
            status_code=503,
            code="gym_session_limit",
            message=f"会话数已达上限 {MAX_SESSIONS}——先 DELETE 旧的会话再建新的。",
        )
    try:
        _validate_scene(scene)
        params = SimulationParams.from_mapping(params_raw)
        sim = simulator.build_world(scene, params)
        picked = _pick_agent(sim, agent_uuid)
    except simulator.SimulationError as exc:
        raise ApiError(status_code=422, code="gym_invalid_request", message=str(exc)) from exc

    session = GymSession(
        session_id=uuid.uuid4().hex,
        owner_token=owner_token,
        scene=dict(scene),
        params_raw=dict(params_raw or {}),
        params=params,
        sim=sim,
        agent_uuid=picked,
        target_x=target_x,
        target_z=target_z,
        max_steps=max_steps,
    )
    _sessions[session.session_id] = session
    return session


def _get(session_id: str, owner_token: str) -> GymSession:
    session = _sessions.get(session_id)
    # 不属于该 owner 与不存在返回同一个码：不泄露会话存在性
    if session is None or session.owner_token != owner_token:
        raise ApiError(
            status_code=404,
            code="gym_session_not_found",
            message=f"Gym 会话不存在（进程重启会清空全部会话）：{session_id}",
        )
    return session


def force_limit_for(mass: float) -> float:
    """力上限 = 加速度上限 × 运行时质量。公式只有这一份。"""
    return simulator.MAX_ACCELERATION * mass


async def step(
    db: Session,
    session_id: str,
    force_x: float,
    force_z: float,
    owner_token: str,
) -> dict[str, Any]:
    """施加一次水平冲量（力 × dt）并推进一步。"""
    async with _lock:
        started = time.perf_counter()
        session = _get(session_id, owner_token)
        if session.terminated or session.truncated:
            # Farama 规范：done 之后继续 step 是未定义行为——这里如实拒绝
            raise ApiError(
                status_code=409,
                code="gym_episode_done",
                message="本回合已结束（terminated/truncated），先 reset 再继续。",
            )
        agent = session.agent
        if agent is None or agent.body is None:
            raise ApiError(status_code=500, code="gym_agent_missing", message="智能体绑定丢了")

        mass = agent.body.mass
        if mass <= 0:
            raise ApiError(
                status_code=422,
                code="gym_agent_invalid_mass",
                message=f"智能体质量非正，算不出力上限：{mass}",
            )

        limit = force_limit_for(mass)
        actual = math.hypot(force_x, force_z)
        # 用 not <= 而非 >：NaN 与任何数比较都是 False，这样 NaN/Inf 一并拦下
        if not actual <= limit:
            gym_audit.record_step(
                db,
                owner_token=owner_token,
                session_id=session_id,
                round_index=session.round_index,
                step_index=session.step_count,
                force_x=force_x,
                force_z=force_z,
                force_limit=limit,
                applied=False,
                error_code="gym_force_out_of_range",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
            raise ApiError(
                status_code=422,
                code="gym_force_out_of_range",
                message=(
                    f"力上限 = 30 × 质量 {mass:.2f}kg = {limit:.2f}N，收到 {actual:.2f}N，请减小"
                ),
            )

        # 审计先落库并 commit，再动物理：
        # 「物理推进了但没有审计行」不允许发生（写库失败会抛 503）
        log = gym_audit.record_step(
            db,
            owner_token=owner_token,
            session_id=session_id,
            round_index=session.round_index,
            step_index=session.step_count,
            force_x=force_x,
            force_z=force_z,
            force_limit=limit,
            applied=True,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

        prev_distance = _distance(session)
        # 力 × dt = 冲量：与前端「冲量推物体」同一口径
        try:
            agent.body.apply_impulse(
                (force_x * session.params.dt, 0.0, force_z * session.params.dt)
            )
            session.sim.world.step()
        except Exception as exc:
            gym_audit.finish_step(
                db,
                log.id,
                applied=False,
                error_code="gym_step_failed",
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
            raise ApiError(
                status_code=500, code="gym_step_failed", message=f"物理推进失败：{exc}"
            ) from exc
        session.step_count += 1

        distance = _distance(session)
        reward = prev_distance - distance
        terminated = False
        if distance <= GOAL_RADIUS:
            reward += GOAL_REWARD
            terminated = True
        elif agent.body.translation.y < FALL_OUT_Y:
            reward += FALL_REWARD
            terminated = True
        truncated = session.step_count >= session.max_steps
        if terminated:
            session.terminated = True
        if truncated:
            session.truncated = True

        gym_audit.finish_step(
            db,
            log.id,
            applied=True,
            distance=round(distance, 4),
            reward=round(reward, 4),
            terminated=terminated,
            truncated=truncated,
            latency_ms=int((time.perf_counter() - started) * 1000),
        )

        return {
            "observation": observe(session),
            "reward": round(reward, 4),
            "terminated": terminated,
            "truncated": truncated,
            "info": {
                "step": session.step_count,
                "maxSteps": session.max_steps,
                "distance": round(distance, 4),
            },
        }


async def reset_session(session_id: str, owner_token: str) -> dict[str, Any]:
    """按留档的场景与参数重建世界——观测回到初始状态。"""
    async with _lock:
        session = _get(session_id, owner_token)
        sim = simulator.build_world(session.scene, session.params)
        # 同一个 agentUuid 必须还能找到：场景没变，找不到就是内部错误
        if _pick_agent(sim, session.agent_uuid) != session.agent_uuid:
            raise ApiError(
                status_code=500, code="gym_agent_missing", message="重建世界后智能体不见了"
            )
        session.sim = sim
        session.step_count = 0
        session.terminated = False
        session.truncated = False
        return {
            "observation": observe(session),
            "reward": 0.0,
            "terminated": False,
            "truncated": False,
        }


def list_sessions(owner_token: str) -> list[dict[str, Any]]:
    return [
        {
            "sessionId": session.session_id,
            "agentUuid": session.agent_uuid,
            "step": session.step_count,
            "maxSteps": session.max_steps,
            "terminated": session.terminated,
            "truncated": session.truncated,
        }
        for session in _sessions.values()
        if session.owner_token == owner_token
    ]


async def delete_session(session_id: str, owner_token: str) -> None:
    async with _lock:
        # 归属校验只走 _get 这一处：越权与不存在同样回 404
        _get(session_id, owner_token)
        _sessions.pop(session_id)
