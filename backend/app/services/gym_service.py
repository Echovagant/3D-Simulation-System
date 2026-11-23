"""Gymnasium 风格的会话式物理环境（多智能体）。

浏览器里的 AI 演武场跑在 three/Rapier 上；RL 研究要的是 Python 侧的
reset / step / observe。这一层把**同一套物理**（``simulator.build_world``，
与批量仿真同源同参）包成会话：

* ``POST   /api/gym/sessions``            建会话（建世界）→ 观测
* ``POST   /api/gym/sessions/{id}/reset`` 重建世界回到初始状态 → 观测
* ``POST   /api/gym/sessions/{id}/step``  施加水平冲量并推进一步 →
  观测 + reward + terminated/truncated
* ``GET    /api/gym/sessions``            列出在场的会话
* ``DELETE /api/gym/sessions/{id}``       销毁会话（WASM 世界跟着释放）

**任务定义**：一个或多个受控物体，每个物体有自己的目标点 (x, z)。
单智能体模式保持原口径（``agent`` / ``target`` / ``distance`` 是主智能体的兼容视图）；
多智能体模式在观测里给出 ``agents`` 数组，``step`` 用 ``actions`` 一次提交
每个物体各自的力，所有冲量施加完再统一推进一个物理步。

* ``terminated`` = **全部**受控物体都进入目标半径（成功）或坠出世界（失败）
* ``truncated``  = 步数到上限——时间到截断
* ``reward``     = 各智能体相邻两步的距离差分之和 + 终局奖励

会话是**内存态**（WASM 世界没法序列化进数据库），进程重启即清空——
这是刻意的：Gym 会话本来就是短命的，持久化只会制造第二份真相。
"""

from __future__ import annotations

import asyncio
import math
import time
import uuid
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from typing import Any

from sqlalchemy.orm import Session

from app.errors import ApiError
from app.models import GymStepLog
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
class GymAgentState:
    """一个受控物体的任务状态：目标点 + 是否已完成（进圈或坠落）。"""

    uuid: str
    target_x: float
    target_z: float
    done: bool = False


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
    # 主智能体（兼容单智能体视图）：agent / target / distance 都按它算
    agent_uuid: str
    target_x: float
    target_z: float
    # 全部受控物体（至少一个；单智能体模式只有主智能体）
    agents: list[GymAgentState] = field(default_factory=list)
    max_steps: int = 300
    step_count: int = 0
    round_index: int = 0
    terminated: bool = False
    truncated: bool = False

    @property
    def agent(self) -> simulator.ObjectBinding | None:
        return self._binding(self.agent_uuid)

    def _binding(self, agent_uuid: str) -> simulator.ObjectBinding | None:
        for binding in self.sim.simulated:
            if binding.uuid == agent_uuid:
                return binding
        return None

    def state_for(self, agent_uuid: str) -> GymAgentState | None:
        for state in self.agents:
            if state.uuid == agent_uuid:
                return state
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


def _validate_multi_agents(
    sim: SimulationWorld, specs: Sequence[tuple[str, float, float]]
) -> list[GymAgentState]:
    """校验多智能体规格：非空、uuid 不重复、都必须是场景里的动态物体。"""
    if not specs:
        raise simulator.SimulationError("agents 不能是空数组——至少给一个受控物体")
    seen: set[str] = set()
    states: list[GymAgentState] = []
    for agent_uuid, target_x, target_z in specs:
        if agent_uuid in seen:
            raise simulator.SimulationError(f"agents 里 uuid 重复：{agent_uuid}")
        seen.add(agent_uuid)
        binding = next((item for item in sim.simulated if item.uuid == agent_uuid), None)
        if binding is None:
            raise simulator.SimulationError(f"agents 指定的物体不存在：{agent_uuid}")
        if binding.is_static:
            raise simulator.SimulationError(f"agents 指定的物体是静态的，推不动：{agent_uuid}")
        states.append(GymAgentState(uuid=agent_uuid, target_x=target_x, target_z=target_z))
    return states


def _body_position(body: Any) -> dict[str, float]:
    pos = body.translation
    return {"x": pos.x, "y": pos.y, "z": pos.z}


def _body_velocity(body: Any) -> dict[str, float]:
    vel = body.linvel
    return {"x": vel.x, "y": vel.y, "z": vel.z}


def _distance_to(
    binding: simulator.ObjectBinding | None, target_x: float, target_z: float
) -> float:
    if binding is None or binding.body is None:
        return 0.0
    pos = binding.body.translation
    return ((pos.x - target_x) ** 2 + (pos.z - target_z) ** 2) ** 0.5


def _distance(session: GymSession) -> float:
    """主智能体到其目标点的水平距离（米），兼容单智能体视图。"""
    return _distance_to(session.agent, session.target_x, session.target_z)


def _agent_distance(session: GymSession, state: GymAgentState) -> float:
    return _distance_to(session._binding(state.uuid), state.target_x, state.target_z)


def observe(session: GymSession) -> dict[str, Any]:
    """当前观测：主智能体、全部受控智能体、全场景物体、目标、步数与距离。"""
    agent = session.agent
    agent_payload: dict[str, Any] | None = None
    if agent is not None and agent.body is not None:
        agent_payload = {
            "uuid": agent.uuid,
            "position": _body_position(agent.body),
            "velocity": _body_velocity(agent.body),
        }
    agents_payload: list[dict[str, Any]] = []
    for state in session.agents:
        binding = session._binding(state.uuid)
        if binding is None or binding.body is None:
            continue
        agents_payload.append(
            {
                "uuid": state.uuid,
                "position": _body_position(binding.body),
                "velocity": _body_velocity(binding.body),
                "target": {"x": state.target_x, "z": state.target_z},
                "distance": round(_agent_distance(session, state), 4),
                "done": state.done,
            }
        )
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
        "agents": agents_payload,
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
    agents: Sequence[tuple[str, float, float]] | None = None,
) -> GymSession:
    """建会话；``agents`` 非空时进入多智能体模式（主视图取第一个）。"""
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
        if agents:
            states = _validate_multi_agents(sim, agents)
            picked = states[0].uuid
            target_x, target_z = states[0].target_x, states[0].target_z
        else:
            picked = _pick_agent(sim, agent_uuid)
            states = [GymAgentState(uuid=picked, target_x=target_x, target_z=target_z)]
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
        agents=states,
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


def ensure_owned(session_id: str, owner_token: str) -> GymSession:
    """校验会话归属；越权与不存在都抛 404。"""
    return _get(session_id, owner_token)


def force_limit_for(mass: float) -> float:
    """力上限 = 加速度上限 × 运行时质量。公式只有这一份。"""
    return simulator.MAX_ACCELERATION * mass


def params_payload(session: GymSession) -> dict[str, Any]:
    """生效参数 + 被丢键 + 被回落键 + 力上限（主智能体 + 每个智能体）。

    键是 camelCase，router 直接 ``**`` 展开进响应模型（ApiModel 接受 alias）。
    """
    params, dropped, defaulted = SimulationParams.resolve(session.params_raw)
    primary = session.agent
    # rapier 0.36.1 的 mass 是 property 不是方法（与 step 同一取法）
    mass = primary.body.mass if primary is not None and primary.body is not None else 0.0
    force_limits: dict[str, float] = {}
    for state in session.agents:
        binding = session._binding(state.uuid)
        if binding is not None and binding.body is not None and binding.body.mass > 0:
            force_limits[state.uuid] = force_limit_for(binding.body.mass)
    return {
        "effectiveParams": {
            "gravityY": params.gravity_y,
            "friction": params.friction,
            "restitution": params.restitution,
            "dt": params.dt,
            "steps": params.steps,
            "trace": params.trace,
            "initialVelocityY": params.initial_velocity_y,
        },
        "droppedParamKeys": dropped,
        "defaultedParamKeys": defaulted,
        "forceLimit": force_limit_for(mass),
        "forceLimits": force_limits,
    }


def _resolve_actions(
    session: GymSession,
    force_x: float | None,
    force_z: float | None,
    actions: Sequence[tuple[str, float, float]] | None,
) -> list[tuple[GymAgentState, float, float]]:
    """把单动作 / 批量动作归一成「受控状态 + 力」列表，并做归属与状态校验。"""
    if actions is not None:
        if not actions:
            raise ApiError(
                status_code=422,
                code="gym_invalid_request",
                message="actions 不能是空数组——至少给一个智能体的动作",
            )
        resolved: list[tuple[GymAgentState, float, float]] = []
        seen: set[str] = set()
        for agent_uuid, fx, fz in actions:
            if agent_uuid in seen:
                raise ApiError(
                    status_code=422,
                    code="gym_invalid_request",
                    message=f"actions 里 agentUuid 重复：{agent_uuid}",
                )
            seen.add(agent_uuid)
            state = session.state_for(agent_uuid)
            if state is None:
                raise ApiError(
                    status_code=422,
                    code="gym_invalid_request",
                    message=f"agentUuid 不属于本会话：{agent_uuid}",
                )
            if state.done:
                raise ApiError(
                    status_code=422,
                    code="gym_agent_done",
                    message=f"智能体 {agent_uuid} 已完成（进圈或坠落），不能再施力",
                )
            resolved.append((state, fx, fz))
        return resolved

    if force_x is None or force_z is None:
        raise ApiError(
            status_code=422,
            code="gym_invalid_request",
            message="单智能体模式要给 forceX 与 forceZ；多智能体模式用 actions",
        )
    state = session.state_for(session.agent_uuid)
    if state is None:
        raise ApiError(status_code=500, code="gym_agent_missing", message="主智能体任务状态丢了")
    if state.done:
        raise ApiError(
            status_code=422,
            code="gym_agent_done",
            message=f"主智能体 {state.uuid} 已完成（进圈或坠落），不能再施力",
        )
    return [(state, force_x, force_z)]


async def step(
    db: Session,
    session_id: str,
    force_x: float | None,
    force_z: float | None,
    owner_token: str,
    *,
    actions: Sequence[tuple[str, float, float]] | None = None,
) -> dict[str, Any]:
    """施加一次或一批水平冲量（力 × dt），再统一推进一个物理步。"""
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
        resolved = _resolve_actions(session, force_x, force_z, actions)

        # 逐个校验质量与力上限；全部通过才动物理（批量动作是全有或全无）
        prepared: list[tuple[GymAgentState, simulator.ObjectBinding, float, float, float]] = []
        for state, fx, fz in resolved:
            binding = session._binding(state.uuid)
            if binding is None or binding.body is None:
                raise ApiError(
                    status_code=500,
                    code="gym_agent_missing",
                    message=f"智能体绑定丢了：{state.uuid}",
                )
            mass = binding.body.mass
            if mass <= 0:
                raise ApiError(
                    status_code=422,
                    code="gym_agent_invalid_mass",
                    message=f"智能体 {state.uuid} 质量非正，算不出力上限：{mass}",
                )
            limit = force_limit_for(mass)
            actual = math.hypot(fx, fz)
            # 用 not <= 而非 >：NaN 与任何数比较都是 False，这样 NaN/Inf 一并拦下
            if not actual <= limit:
                gym_audit.record_step(
                    db,
                    owner_token=owner_token,
                    session_id=session_id,
                    agent_uuid=state.uuid,
                    round_index=session.round_index,
                    step_index=session.step_count,
                    force_x=fx,
                    force_z=fz,
                    force_limit=limit,
                    applied=False,
                    error_code="gym_force_out_of_range",
                    latency_ms=int((time.perf_counter() - started) * 1000),
                )
                raise ApiError(
                    status_code=422,
                    code="gym_force_out_of_range",
                    message=(
                        f"智能体 {state.uuid} 的力上限 = 30 × 质量 {mass:.2f}kg = "
                        f"{limit:.2f}N，收到 {actual:.2f}N，请减小"
                    ),
                )
            prepared.append((state, binding, fx, fz, limit))

        # 审计先落库并 commit，再动物理：
        # 「物理推进了但没有审计行」不允许发生（写库失败会抛 503）
        logs: list[tuple[GymStepLog, GymAgentState, float]] = []
        for state, _binding, fx, fz, limit in prepared:
            log = gym_audit.record_step(
                db,
                owner_token=owner_token,
                session_id=session_id,
                agent_uuid=state.uuid,
                round_index=session.round_index,
                step_index=session.step_count,
                force_x=fx,
                force_z=fz,
                force_limit=limit,
                applied=True,
                latency_ms=int((time.perf_counter() - started) * 1000),
            )
            logs.append((log, state, _agent_distance(session, state)))

        # 力 × dt = 冲量：与前端「冲量推物体」同一口径
        try:
            for _state, binding, fx, fz, _limit in prepared:
                binding.body.apply_impulse((fx * session.params.dt, 0.0, fz * session.params.dt))
            session.sim.world.step()
        except Exception as exc:
            for log, _state, _before in logs:
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

        reward_total = 0.0
        agent_info: list[dict[str, Any]] = []
        outcomes: list[tuple[GymStepLog, GymAgentState, float, float]] = []
        for log, state, prev_distance in logs:
            binding = session._binding(state.uuid)
            distance = _agent_distance(session, state)
            delta = prev_distance - distance
            bonus = 0.0
            if distance <= GOAL_RADIUS:
                state.done = True
                bonus = GOAL_REWARD
            elif binding is not None and binding.body is not None:
                if binding.body.translation.y < FALL_OUT_Y:
                    state.done = True
                    bonus = FALL_REWARD
            reward_total += delta + bonus
            agent_info.append(
                {
                    "uuid": state.uuid,
                    "distance": round(distance, 4),
                    "done": state.done,
                    "reward": round(delta + bonus, 4),
                }
            )
            outcomes.append((log, state, distance, delta + bonus))

        terminated = all(state.done for state in session.agents)
        truncated = session.step_count >= session.max_steps
        if terminated:
            session.terminated = True
        if truncated:
            session.truncated = True

        # 审计回写：每个智能体自己的距离/奖励 + 整局终局标记
        for log, _state, distance, reward in outcomes:
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
            "reward": round(reward_total, 4),
            "terminated": terminated,
            "truncated": truncated,
            "info": {
                "step": session.step_count,
                "maxSteps": session.max_steps,
                "distance": round(_distance(session), 4),
                "agents": agent_info,
            },
        }


async def reset_session(session_id: str, owner_token: str) -> dict[str, Any]:
    """按留档的场景与参数重建世界——观测回到初始状态。"""
    async with _lock:
        session = _get(session_id, owner_token)
        sim = simulator.build_world(session.scene, session.params)
        # 同一个 uuid 必须还能找到：场景没变，找不到就是内部错误
        missing = [
            state.uuid
            for state in session.agents
            if next((item for item in sim.simulated if item.uuid == state.uuid), None) is None
        ]
        if missing:
            raise ApiError(
                status_code=500,
                code="gym_agent_missing",
                message=f"重建世界后智能体不见了：{', '.join(missing)}",
            )
        session.sim = sim
        for state in session.agents:
            state.done = False
        session.step_count = 0
        session.round_index += 1
        session.terminated = False
        session.truncated = False
        return {
            "observation": observe(session),
            "reward": 0.0,
            "terminated": False,
            "truncated": False,
            **params_payload(session),
        }


def list_sessions(owner_token: str) -> list[dict[str, Any]]:
    return [
        {
            "sessionId": session.session_id,
            "agentUuid": session.agent_uuid,
            "agentUuids": [state.uuid for state in session.agents],
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
        _sessions.pop(session_id, None)
