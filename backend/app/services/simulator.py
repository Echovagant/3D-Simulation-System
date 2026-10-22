"""离线批量仿真器：场景 → 物理世界 → 步进 → 采样。

这一层**只管物理**：不碰数据库、不碰队列（那是 ``simulation_service`` 的事）。

参数逐项对齐前端（``src/composables/useSceneEditor.ts``）：

============================  ==========================================
项                             值
============================  ==========================================
世界重力                       ``(0, gravityY, 0)``，默认 ``-9.81``
步长                           ``1/60`` 秒（前端是固定步长累加器，步长与帧率无关）
地面                           固定刚体平移 ``(0, -0.1, 0)`` + ``cuboid(5, 0.1, 5)``
                               → 碰撞体顶面在 ``y=0``，与可见地面齐平
立方体                         动态刚体 + ``cuboid(halfExtents)``，
                               ``halfExtents = (size/2) * |scale|``
球体                           动态刚体 + ``ball(radius)``，
                               ``radius = (size/2) * 三轴 scale 均值``
模型等类型                      **不支持**（后端没有模型文件）→ 跳过并标注原因
============================  ==========================================

⚠️ **摩擦/弹性只在被覆盖时才下发**（前端修过一次这个 bug）。
默认就是 Rapier 的默认值（0.5 / 0.0）——后端不擅自设，
否则与浏览器对不上。基准测试 ``tests/test_consistency.py`` 锁的就是这件事。
"""

from __future__ import annotations

import math
import time
from collections.abc import Mapping
from dataclasses import dataclass, field
from typing import Any

import rapier3d as rp

# ---- 默认值（与前端一致） ------------------------------------------------

DEFAULT_GRAVITY_Y = -9.81
DEFAULT_DT = 1.0 / 60.0
DEFAULT_STEPS = 240

# 地面：固定刚体下移 0.1，碰撞体顶面因此落在 y=0
GROUND_TRANSLATION = (0.0, -0.1, 0.0)
GROUND_HALF_EXTENTS = (5.0, 0.1, 5.0)
GROUND_TOP_Y = 0.0

# 落地静止判定：速度低于 0.05 m/s 且与地面有接触
RESTING_SPEED = 0.05

# 穿透容差：位置低于「半高 - 0.01」才算真的穿进地面了。
# Rapier 允许一点点下沉（基准里静止高度是 0.4987，比半高低 1.3mm），
# 那不是穿透，是求解器的正常误差。
PENETRATION_TOLERANCE = 0.01

# trace 关闭时的采样间隔：每 10 步 + 最后一步
SAMPLE_INTERVAL = 10

SUPPORTED_TYPES = ("cube", "sphere")

# 前端立方体是 BoxGeometry(1,1,1)、球体是 SphereGeometry(0.5)，
# 基准尺寸都是 1（碰撞体半长/半径 = size/2）。
DEFAULT_SIZE = 1.0

SKIP_UNSUPPORTED_TYPE = "unsupported_type"
SKIP_MISSING_POSITION = "missing_position"


class SimulationError(Exception):
    """仿真跑不起来（参数非法、场景格式不对等）。"""


@dataclass(frozen=True)
class SimulationParams:
    """一次运行的物理参数。

    ``friction`` / ``restitution`` 是 ``None`` 表示**不下发**——
    用 Rapier 的默认值（0.5 / 0.0），与前端「只在被覆盖时才下发」一致。
    """

    gravity_y: float = DEFAULT_GRAVITY_Y
    friction: float | None = None
    restitution: float | None = None
    dt: float = DEFAULT_DT
    steps: int = DEFAULT_STEPS
    trace: bool = False
    initial_velocity_y: float = 0.0

    @classmethod
    def from_mapping(cls, raw: Mapping[str, Any] | None) -> SimulationParams:
        """从请求体里的 ``params`` 解析参数。

        未知键直接忽略：请求体是前端拼的，多一个键不该让整个任务失败。
        """
        if not raw:
            return cls()

        gravity_y = _as_float(raw.get("gravityY"), DEFAULT_GRAVITY_Y)
        friction = _as_optional_float(raw.get("friction"))
        restitution = _as_optional_float(raw.get("restitution"))
        dt = _as_float(raw.get("dt"), DEFAULT_DT)
        steps = _as_int(raw.get("steps"), DEFAULT_STEPS)
        trace = bool(raw.get("trace", False))
        initial_velocity_y = _as_float(raw.get("initialVelocityY"), 0.0)

        if dt <= 0:
            raise SimulationError(f"dt 必须大于 0，收到 {dt}")
        if steps <= 0:
            raise SimulationError(f"steps 必须大于 0，收到 {steps}")

        return cls(
            gravity_y=gravity_y,
            friction=friction,
            restitution=restitution,
            dt=dt,
            steps=steps,
            trace=trace,
            initial_velocity_y=initial_velocity_y,
        )


@dataclass
class ObjectBinding:
    """一个场景物体在物理世界里的绑定。"""

    uuid: str
    type: str
    body: Any = None
    collider: Any = None
    half_height: float = 0.0
    initial_y: float = 0.0
    skipped: str | None = None
    reason: str | None = None


@dataclass
class SimulationWorld:
    """建好的物理世界。

    留着它是为了让测试能直接检查「场景到底被映射成了什么」，
    而不是只能看最终结果反推。
    """

    world: Any
    ground_collider: Any
    objects: list[ObjectBinding] = field(default_factory=list)
    skipped: list[ObjectBinding] = field(default_factory=list)

    @property
    def simulated(self) -> list[ObjectBinding]:
        return [obj for obj in self.objects if obj.skipped is None]


def _as_float(value: Any, fallback: float) -> float:
    if isinstance(value, bool) or value is None:
        return fallback
    try:
        return float(value)
    except (TypeError, ValueError):
        return fallback


def _as_optional_float(value: Any) -> float | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _as_int(value: Any, fallback: int) -> int:
    if value is None or isinstance(value, bool):
        return fallback
    try:
        return int(value)
    except (TypeError, ValueError):
        return fallback


def _vector(raw: Any, fallback: tuple[float, float, float]) -> tuple[float, float, float]:
    """读 ``{x, y, z}``，缺字段就用兜底值。"""
    if not isinstance(raw, Mapping):
        return fallback
    return (
        _as_float(raw.get("x"), fallback[0]),
        _as_float(raw.get("y"), fallback[1]),
        _as_float(raw.get("z"), fallback[2]),
    )


def _scale_factors(raw: Any) -> tuple[float, float, float]:
    """缩放取绝对值；0 视为 1（不允许把物体压成零体积）。

    与前端 ``applyScaleToCollider`` 的处理完全一致。
    """
    scale = _vector(raw, (1.0, 1.0, 1.0))
    factors = tuple(abs(value) or 1.0 for value in scale)
    return factors  # type: ignore[return-value]


def euler_xyz_to_quaternion(x: float, y: float, z: float) -> tuple[float, float, float, float]:
    """Three.js 的 ``Euler(x, y, z)``（默认 XYZ 序）→ 四元数 ``(qx, qy, qz, qw)``。

    前端写回刚体时走的就是这条路（``setFromEuler``），
    后端必须用同一套约定，否则旋转过的物体会躺在另一个朝向上。
    """
    cx, sx = math.cos(x / 2), math.sin(x / 2)
    cy, sy = math.cos(y / 2), math.sin(y / 2)
    cz, sz = math.cos(z / 2), math.sin(z / 2)

    # R = Rx * Ry * Rz（Three.js 'XYZ' 序的含义）
    m00 = cy * cz
    m01 = -cy * sz
    m02 = sy
    m10 = sx * sy * cz + cx * sz
    m11 = -sx * sy * sz + cx * cz
    m12 = -sx * cy
    m20 = -cx * sy * cz + sx * sz
    m21 = cx * sy * sz + sx * cz
    m22 = cx * cy

    trace = m00 + m11 + m22
    if trace > 0.0:
        s = math.sqrt(trace + 1.0) * 2
        qw = 0.25 * s
        qx = (m21 - m12) / s
        qy = (m02 - m20) / s
        qz = (m10 - m01) / s
    elif m00 > m11 and m00 > m22:
        s = math.sqrt(1.0 + m00 - m11 - m22) * 2
        qw = (m21 - m12) / s
        qx = 0.25 * s
        qy = (m01 + m10) / s
        qz = (m02 + m20) / s
    elif m11 > m22:
        s = math.sqrt(1.0 + m11 - m00 - m22) * 2
        qw = (m02 - m20) / s
        qx = (m01 + m10) / s
        qy = 0.25 * s
        qz = (m12 + m21) / s
    else:
        s = math.sqrt(1.0 + m22 - m00 - m11) * 2
        qw = (m10 - m01) / s
        qx = (m02 + m20) / s
        qy = (m12 + m21) / s
        qz = 0.25 * s
    return qx, qy, qz, qw


def _collider_builder(
    shape: str, params: SimulationParams, half_extents: tuple[float, float, float], radius: float
) -> Any:
    """建碰撞体。**摩擦/弹性只在被覆盖时才下发。**"""
    if shape == "cube":
        builder = rp.Collider.cuboid(*half_extents)
    else:
        builder = rp.Collider.ball(radius)

    if params.friction is not None:
        builder = builder.friction(params.friction)
    if params.restitution is not None:
        builder = builder.restitution(params.restitution)
    return builder


def build_world(scene: Mapping[str, Any], params: SimulationParams) -> SimulationWorld:
    """把场景文档映射成物理世界。

    这是「后端算出来的和浏览器一样」的关键一步：
    每一个参数都必须与前端一致，差一点都不行。
    """
    world = rp.PhysicsWorld(gravity=(0.0, params.gravity_y, 0.0))
    world.integration_parameters.dt = params.dt

    # 地面：固定刚体 + 碰撞体，顶面落在 y=0
    ground_handle = world.add_body(
        rp.RigidBody.fixed(translation=GROUND_TRANSLATION),
        colliders=[rp.Collider.cuboid(*GROUND_HALF_EXTENTS)],
    )
    ground_body = world.rigid_bodies[ground_handle]
    ground_collider = list(ground_body.colliders)[0]

    built = SimulationWorld(world=world, ground_collider=ground_collider)

    objects = scene.get("objects") if isinstance(scene, Mapping) else None
    if not isinstance(objects, list):
        objects = []

    for raw in objects:
        if not isinstance(raw, Mapping):
            continue
        binding = _add_object(world, raw, params)
        built.objects.append(binding)
        if binding.skipped is not None:
            built.skipped.append(binding)

    return built


def _add_object(world: Any, raw: Mapping[str, Any], params: SimulationParams) -> ObjectBinding:
    """把一个场景物体放进物理世界；不支持的类型跳过并写明原因。"""
    uuid = str(raw.get("uuid", ""))
    obj_type = str(raw.get("type", ""))

    if obj_type not in SUPPORTED_TYPES:
        return ObjectBinding(
            uuid=uuid,
            type=obj_type,
            skipped=SKIP_UNSUPPORTED_TYPE,
            reason=f"后端只支持 {'/'.join(SUPPORTED_TYPES)}；'{obj_type}' 没有对应的碰撞体",
        )

    position = raw.get("position")
    if not isinstance(position, Mapping):
        return ObjectBinding(
            uuid=uuid,
            type=obj_type,
            skipped=SKIP_MISSING_POSITION,
            reason="物体没有 position，无法确定初始位置",
        )

    translation = _vector(position, (0.0, 0.0, 0.0))
    rotation = _vector(raw.get("rotation"), (0.0, 0.0, 0.0))
    sx, sy, sz = _scale_factors(raw.get("scale"))
    size = _as_float(raw.get("size"), DEFAULT_SIZE)

    if obj_type == "cube":
        half_extents = (size / 2 * sx, size / 2 * sy, size / 2 * sz)
        builder = _collider_builder("cube", params, half_extents, 0.0)
        half_height = half_extents[1]
    else:
        radius = size / 2 * (sx + sy + sz) / 3
        builder = _collider_builder("sphere", params, (0.0, 0.0, 0.0), radius)
        half_height = radius

    handle = world.add_body(
        rp.RigidBody.dynamic(
            translation=translation,
            linvel=(0.0, params.initial_velocity_y, 0.0),
        ),
        colliders=[builder],
    )
    body = world.rigid_bodies[handle]

    # 旋转：Rapier 的 builder 只收缩放轴角，前端给的是欧拉角，
    # 这里自己转成四元数再写回（与前端的 setFromEuler 同一套约定）。
    if any(rotation):
        qx, qy, qz, qw = euler_xyz_to_quaternion(*rotation)
        body.rotation = rp.Quaternion(qx, qy, qz, qw)

    collider = list(body.colliders)[0]
    return ObjectBinding(
        uuid=uuid,
        type=obj_type,
        body=body,
        collider=collider,
        half_height=half_height,
        initial_y=translation[1],
    )


def _is_touching_ground(sim: SimulationWorld, binding: ObjectBinding) -> bool:
    """物体与地面是否有接触（用 Rapier 的窄相位，不靠位置猜）。"""
    if binding.collider is None:
        return False
    pair = sim.world.narrow_phase.contact_pair(sim.ground_collider, binding.collider)
    return bool(pair is not None and pair.has_any_active_contact)


def _speed(body: Any) -> float:
    vel = body.linvel
    return math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)


def _position_dict(body: Any) -> dict[str, float]:
    pos = body.translation
    return {"x": pos.x, "y": pos.y, "z": pos.z}


def _velocity_dict(body: Any) -> dict[str, float]:
    vel = body.linvel
    return {"x": vel.x, "y": vel.y, "z": vel.z}


def _sample_frames(steps: int, trace: bool) -> list[int]:
    """要记录哪些帧。

    ``trace`` 打开 → 每一步都记；关掉 → 每 10 步 + 最后一步。
    """
    if trace:
        return list(range(steps + 1))
    frames = list(range(0, steps + 1, SAMPLE_INTERVAL))
    if frames[-1] != steps:
        frames.append(steps)
    return frames


def run_once(
    scene: Mapping[str, Any],
    params: SimulationParams,
    *,
    index: int = 0,
    run_params: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    """跑一次仿真，返回结果载荷（形状见后端计划的 §2.2）。

    ``run_params`` 是这次运行**实际生效**的参数（扫描时是被扫的那个值）。
    """
    started = time.perf_counter()
    sim = build_world(scene, params)

    steps = params.steps
    sampled = set(_sample_frames(steps, params.trace))

    traces: dict[str, list[dict[str, Any]]] = {}
    resting_since: dict[str, int | None] = {}
    max_penetration: dict[str, float] = {}
    settled_at: int | None = None

    for binding in sim.simulated:
        traces[binding.uuid] = []
        resting_since[binding.uuid] = None
        max_penetration[binding.uuid] = 0.0

    def _record(frame: int) -> None:
        for binding in sim.simulated:
            if frame in sampled:
                traces[binding.uuid].append(
                    {"frame": frame, "position": _position_dict(binding.body)}
                )

    _record(0)

    for frame in range(1, steps + 1):
        sim.world.step()
        _record(frame)

        everyone_settled = True
        for binding in sim.simulated:
            depth = binding.half_height - binding.body.translation.y
            if depth > PENETRATION_TOLERANCE:
                max_penetration[binding.uuid] = max(max_penetration[binding.uuid], depth)

            if resting_since[binding.uuid] is None:
                slow = _speed(binding.body) < RESTING_SPEED
                if slow and _is_touching_ground(sim, binding):
                    resting_since[binding.uuid] = frame
            if resting_since[binding.uuid] is None:
                everyone_settled = False

        if settled_at is None and everyone_settled and sim.simulated:
            settled_at = frame

    objects: list[dict[str, Any]] = []
    for binding in sim.objects:
        if binding.skipped is not None:
            objects.append(
                {
                    "uuid": binding.uuid,
                    "type": binding.type,
                    "skipped": binding.skipped,
                    "reason": binding.reason,
                }
            )
            continue

        # resting 说的是**最终状态**：速度够低且仍然贴着地面。
        # 中间某一步静止过不算——弹起来的物体最后并没有落地。
        at_rest = _speed(binding.body) < RESTING_SPEED and _is_touching_ground(sim, binding)

        entry: dict[str, Any] = {
            "uuid": binding.uuid,
            "type": binding.type,
            "resting": at_rest,
            "settledAtFrame": resting_since[binding.uuid],
            "finalPosition": _position_dict(binding.body),
            "finalVelocity": _velocity_dict(binding.body),
            "penetrationDepth": max_penetration[binding.uuid],
        }
        if params.trace:
            entry["trace"] = traces[binding.uuid]
        objects.append(entry)

    fall_distance = 0.0
    for binding in sim.simulated:
        fall_distance = max(fall_distance, binding.initial_y - binding.body.translation.y)

    duration_ms = int((time.perf_counter() - started) * 1000)
    return {
        "index": index,
        "params": dict(run_params or {}),
        "durationMs": duration_ms,
        "objects": objects,
        "metrics": {
            "settledAtFrame": settled_at,
            "maxPenetration": max(max_penetration.values(), default=0.0),
            "totalFallDistance": fall_distance,
        },
    }


# 参数扫描只扫一个维度：多维笛卡尔积会让「到底是哪个参数导致的」变得难查。
SWEEP_PARAMS = ("gravityY", "friction", "restitution", "initialVelocityY")


def sweep_values(params: SimulationParams, sweep: Mapping[str, Any] | None) -> list[dict[str, Any]]:
    """把扫描维度展开成一串「这次运行生效的参数」。

    没有扫描 → 只有一次运行（参数就是请求里给的那套）。
    """
    if not sweep:
        return [{}]

    param = str(sweep.get("param", ""))
    values = sweep.get("values")
    if not isinstance(values, list) or not values:
        raise SimulationError("sweep.values 不能为空")
    if param not in SWEEP_PARAMS:
        raise SimulationError(f"未知的扫描维度：{param}；只支持 {'/'.join(SWEEP_PARAMS)}")

    return [{param: value} for value in values]


def apply_sweep(params: SimulationParams, override: Mapping[str, Any]) -> SimulationParams:
    """把扫描值盖到参数上。"""
    if not override:
        return params
    merged = {
        "gravityY": override.get("gravityY", params.gravity_y),
        "friction": override.get("friction", params.friction),
        "restitution": override.get("restitution", params.restitution),
        "dt": params.dt,
        "steps": params.steps,
        "trace": params.trace,
        "initialVelocityY": override.get("initialVelocityY", params.initial_velocity_y),
    }
    return SimulationParams.from_mapping(merged)


def run_sweep(
    scene: Mapping[str, Any],
    params: SimulationParams,
    sweep: Mapping[str, Any] | None = None,
) -> list[dict[str, Any]]:
    """跑完整个扫描，返回每次运行的结果载荷。"""
    overrides = sweep_values(params, sweep)
    runs: list[dict[str, Any]] = []
    for index, override in enumerate(overrides):
        effective = apply_sweep(params, override)
        effective_params = dict(override)
        if not effective_params:
            effective_params = {
                "gravityY": params.gravity_y,
                "dt": params.dt,
                "steps": params.steps,
            }
        runs.append(run_once(scene, effective, index=index, run_params=effective_params))
    return runs


def summarize(runs: list[Mapping[str, Any]]) -> dict[str, Any]:
    """把多次运行汇总成一段摘要。

    ``settledRuns`` 数的是「这次运行里**所有**物体都静止」的运行数——
    有一件没落地的就不算落地。
    """
    settled = 0
    max_penetration = 0.0
    for run in runs:
        metrics = run.get("metrics") or {}
        max_penetration = max(max_penetration, float(metrics.get("maxPenetration", 0.0)))
        objects = run.get("objects") or []
        simulated = [obj for obj in objects if "skipped" not in obj]
        if simulated and all(obj.get("resting") for obj in simulated):
            settled += 1
    return {
        "runs": len(runs),
        "settledRuns": settled,
        "maxPenetration": max_penetration,
    }
