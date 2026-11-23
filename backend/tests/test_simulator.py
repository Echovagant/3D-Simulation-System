"""仿真器：场景映射、步进与采样、落地判定、穿透检测、参数扫描。

这一层不碰数据库也不碰队列——它是纯计算，跑多快都不影响别人。
"""

import pytest
import rapier3d as rp

from app.services import simulator

# Rapier 绑定层的默认线速度封顶（m/s）：``IntegrationParameters.normalized_max_linear_velocity``
# 的出厂默认（Rapier 0.35 起每个 substep 后封顶线速度）。simulator 不覆盖它，
# 极端场景（重力/初速拉满、步数极多）的终速封顶就来自这里。
# 对账登记在 docs/simulation-spec.md 的 SIM_BACKEND_MAX_LINEAR_VELOCITY，
# 机器对账读的就是这个钉值；升级 rapier3d 若改了默认，下面的测试当场报警。
RAPIER_MAX_LINEAR_VELOCITY = 400.0


def _obj(
    uuid: str = "o1",
    obj_type: str = "cube",
    y: float = 2.0,
    scale: dict[str, float] | None = None,
    **extra: object,
) -> dict[str, object]:
    return {
        "uuid": uuid,
        "type": obj_type,
        "name": uuid,
        "position": {"x": 0, "y": y, "z": 0},
        "rotation": {"x": 0, "y": 0, "z": 0},
        "scale": scale or {"x": 1, "y": 1, "z": 1},
        "visible": True,
        **extra,
    }


def _scene(*objects: dict[str, object]) -> dict[str, object]:
    return {
        "id": "s1",
        "name": "测试场景",
        "createdAt": "2026-10-23T00:00:00.000Z",
        "updatedAt": "2026-10-23T00:00:00.000Z",
        "version": 1,
        "objects": list(objects),
    }


def _shape(sim: simulator.SimulationWorld, binding: simulator.ObjectBinding):
    return sim.world.colliders[binding.collider].shape


# --------------------------------------------------------------------------
# 场景映射
# --------------------------------------------------------------------------


def test_world_matches_frontend_parameters():
    """重力、步长、地面都要与前端逐项对齐——差一点都不行。"""
    sim = simulator.build_world(_scene(_obj()), simulator.SimulationParams())

    assert sim.world.gravity.y == pytest.approx(-9.81)
    assert sim.world.integration_parameters.dt == pytest.approx(1 / 60)

    ground = sim.world.colliders[sim.ground_collider]
    # 地面刚体下移 0.1，碰撞体顶面因此落在 y=0
    assert ground.translation.y == pytest.approx(-0.1)
    half = ground.shape.as_cuboid().half_extents
    assert (half.x, half.y, half.z) == pytest.approx((5.0, 0.1, 5.0))


def test_cube_collider_half_extents_follow_scale():
    """立方体碰撞体 = (size/2) * |scale|，每轴各算各的。"""
    scene = _scene(_obj(scale={"x": 2, "y": 1, "z": 0.5}))
    sim = simulator.build_world(scene, simulator.SimulationParams())

    half = _shape(sim, sim.simulated[0]).as_cuboid().half_extents
    assert (half.x, half.y, half.z) == pytest.approx((1.0, 0.5, 0.25))


def test_sphere_radius_uses_mean_scale():
    """球体没有椭球碰撞体：非等比缩放用三轴均值近似（与前端一致）。"""
    scene = _scene(_obj(obj_type="sphere", scale={"x": 2, "y": 2, "z": 2}))
    sim = simulator.build_world(scene, simulator.SimulationParams())

    assert _shape(sim, sim.simulated[0]).as_ball().radius == pytest.approx(1.0)


def test_friction_and_restitution_are_not_set_unless_overridden():
    """前端只在被覆盖时才下发这两个值——后端也得这样。

    默认就用 Rapier 的默认值（0.5 / 0.0），不然与浏览器对不上。
    """
    default = simulator.build_world(_scene(_obj()), simulator.SimulationParams())
    collider = default.world.colliders[default.simulated[0].collider]
    assert collider.friction == pytest.approx(0.5)
    assert collider.restitution == pytest.approx(0.0)

    overridden = simulator.SimulationParams.from_mapping({"friction": 0.1, "restitution": 0.8})
    sim = simulator.build_world(_scene(_obj()), overridden)
    collider = sim.world.colliders[sim.simulated[0].collider]
    assert collider.friction == pytest.approx(0.1)
    assert collider.restitution == pytest.approx(0.8)


def test_static_object_becomes_fixed_body():
    """physics.type=static 的物体必须是固定刚体：不吃重力、不吃初始速度。

    用户摆的地面/墙要是被建成 dynamic 会被落体撞飞，穿透深度爆表。
    """
    scene = _scene(_obj(uuid="wall", physics={"type": "static", "shape": "box", "mass": 0}))
    sim = simulator.build_world(scene, simulator.SimulationParams())

    assert sim.simulated[0].is_static is True
    assert sim.simulated[0].body.is_fixed


def test_static_ground_supports_falling_ball():
    """用户 static 地面 + dynamic 落球：球必须稳稳落在地面上、零穿透。

    这是「前后端真实契约」的回归：修复前地面被建成 dynamic 被撞飞，
    穿透能到 20+ 米、全场景永远不 settle。
    """
    scene = _scene(
        _obj(
            uuid="ground",
            y=-0.5,
            scale={"x": 10, "y": 1, "z": 10},
            physics={"type": "static", "shape": "box", "mass": 0},
        ),
        _obj(
            uuid="ball",
            obj_type="sphere",
            y=2.0,
            physics={"type": "dynamic", "shape": "sphere", "mass": 1},
        ),
    )
    run = simulator.run_once(scene, simulator.SimulationParams.from_mapping({"steps": 120}))

    ground = run["objects"][0]
    ball = run["objects"][1]
    assert ground["penetrationDepth"] == 0.0
    assert ball["resting"] is True
    assert ball["finalPosition"]["y"] == pytest.approx(0.5, abs=0.02)
    assert ball["penetrationDepth"] == pytest.approx(0.0, abs=0.02)
    assert run["metrics"]["maxPenetration"] < 0.1


def test_kinematic_is_skipped_with_reason():
    """运动学刚体后端暂不支持：跳过并写明原因，不能悄悄当 dynamic 跑。"""
    scene = _scene(_obj(physics={"type": "kinematic", "shape": "box", "mass": 0}))
    sim = simulator.build_world(scene, simulator.SimulationParams())

    assert len(sim.objects) == 1
    assert sim.objects[0].skipped == simulator.SKIP_KINEMATIC
    assert sim.simulated == []


def test_unsupported_type_is_skipped_with_reason():
    """模型等类型后端没有碰撞体：跳过，但要在结果里写明原因。"""
    scene = _scene(_obj(uuid="m1", obj_type="model"))
    run = simulator.run_once(scene, simulator.SimulationParams())

    entry = run["objects"][0]
    assert entry["skipped"] == "unsupported_type"
    assert entry["reason"]
    assert "finalPosition" not in entry


# --------------------------------------------------------------------------
# 步进与采样
# --------------------------------------------------------------------------


def test_trace_records_every_step():
    params = simulator.SimulationParams.from_mapping({"steps": 10, "trace": True})
    run = simulator.run_once(_scene(_obj()), params)

    trace = run["objects"][0]["trace"]
    assert len(trace) == 11
    assert trace[0]["frame"] == 0
    assert trace[-1]["frame"] == 10
    # 每一帧都要有位置
    assert all("position" in point for point in trace)


def test_trace_is_absent_by_default():
    """默认不返回 trace：几百个点会把响应撑爆。"""
    run = simulator.run_once(_scene(_obj()), simulator.SimulationParams())
    assert "trace" not in run["objects"][0]


def test_positions_advance_step_by_step():
    """落体时位置必须一帧一帧往下走（不是原地不动）。"""
    params = simulator.SimulationParams.from_mapping({"steps": 20, "trace": True})
    run = simulator.run_once(_scene(_obj()), params)

    ys = [point["position"]["y"] for point in run["objects"][0]["trace"]]
    assert ys[0] == pytest.approx(2.0)
    assert ys[-1] < ys[0]
    assert all(later < earlier for earlier, later in zip(ys, ys[1:], strict=False))


# --------------------------------------------------------------------------
# 落地静止判定与穿透检测
# --------------------------------------------------------------------------


def test_cube_lands_and_settles_on_ground():
    params = simulator.SimulationParams.from_mapping({"steps": 120})
    run = simulator.run_once(_scene(_obj()), params)

    entry = run["objects"][0]
    assert entry["resting"] is True
    assert entry["settledAtFrame"] is not None
    # 静止高度 ≈ 半高（容许求解器的一点点下沉）
    assert entry["finalPosition"]["y"] == pytest.approx(0.5, abs=0.01)
    assert run["metrics"]["settledAtFrame"] is not None


def test_penetration_is_reported_when_object_starts_inside_ground():
    """物体一开始就在地面里：必须报出穿透深度（物理配置错了）。"""
    scene = _scene(_obj(y=0.1))
    run = simulator.run_once(scene, simulator.SimulationParams.from_mapping({"steps": 30}))

    entry = run["objects"][0]
    assert entry["penetrationDepth"] > 0.3
    assert run["metrics"]["maxPenetration"] > 0.3


def test_no_penetration_in_a_healthy_run():
    run = simulator.run_once(
        _scene(_obj()), simulator.SimulationParams.from_mapping({"steps": 120})
    )
    assert run["objects"][0]["penetrationDepth"] == 0.0
    assert run["metrics"]["maxPenetration"] == 0.0


# --------------------------------------------------------------------------
# 参数扫描
# --------------------------------------------------------------------------


def test_sweep_runs_every_value():
    """扫 3 个取值就要跑 3 次——每次的参数还得是对应那个值。"""
    params = simulator.SimulationParams.from_mapping({"steps": 60})
    runs = simulator.run_sweep(
        _scene(_obj()), params, {"param": "friction", "values": [0.1, 0.5, 0.9]}
    )

    assert len(runs) == 3
    assert [run["index"] for run in runs] == [0, 1, 2]
    assert [run["params"]["friction"] for run in runs] == [0.1, 0.5, 0.9]


def test_sweep_without_sweep_runs_once():
    runs = simulator.run_sweep(_scene(_obj()), simulator.SimulationParams())
    assert len(runs) == 1


def test_sweep_rejects_unknown_dimension():
    """扫描维度写错必须报错，不能默默跑成默认值。"""
    with pytest.raises(simulator.SimulationError):
        simulator.run_sweep(
            _scene(_obj()),
            simulator.SimulationParams(),
            {"param": "dt", "values": [0.01, 0.02]},
        )


def test_sweeping_gravity_changes_the_outcome():
    """重力更大 → 落得更早（settledAtFrame 更小）。"""
    params = simulator.SimulationParams.from_mapping({"steps": 120})
    runs = simulator.run_sweep(
        _scene(_obj()), params, {"param": "gravityY", "values": [-1.0, -20.0]}
    )

    slow, fast = runs[0]["objects"][0], runs[1]["objects"][0]
    assert slow["settledAtFrame"] > fast["settledAtFrame"]


# --------------------------------------------------------------------------
# 参数解析：丢键 / 回落键报告与加速度常量
# --------------------------------------------------------------------------


def test_max_acceleration_matches_frontend():
    """与 src/composables/useAI.ts:47 同口径，改一侧必须改另一侧。"""
    assert simulator.MAX_ACCELERATION == 30.0


def test_rapier_default_max_linear_velocity_is_pinned():
    """400 m/s 封顶来自 Rapier 绑定层的出厂默认，仓库代码里没有这个常数。

    simulator 只改 dt，不覆盖 ``normalized_max_linear_velocity``；升级 rapier3d
    若改了默认值，这里当场报警——对账表与行为都靠它钉住。
    """
    assert rp.IntegrationParameters().normalized_max_linear_velocity == pytest.approx(
        RAPIER_MAX_LINEAR_VELOCITY
    )
    world = simulator.build_world(_scene(_obj()), simulator.SimulationParams())
    assert world.world.integration_parameters.normalized_max_linear_velocity == pytest.approx(
        RAPIER_MAX_LINEAR_VELOCITY
    )


def test_extreme_gravity_hits_velocity_cap():
    """gravity=+50 跑 520 步：前 480 步匀加速到 400 封顶，之后匀速。

    批量仿真极端测试实测的「finalVel 恰为 400 整」就是它——
    与裸物理理论（一直匀加速）的偏离来自 Rapier 绑定层默认，
    见 docs/simulation-spec.md 对账表的 SIM_BACKEND_MAX_LINEAR_VELOCITY。
    """
    sim = simulator.build_world(_scene(_obj()), simulator.SimulationParams(gravity_y=50.0))
    body = sim.simulated[0].body

    # 前 470 步还在匀加速段：50 m/s² × 470/60 s ≈ 391.7 m/s，够不着封顶
    for _ in range(470):
        sim.world.step()
        assert body.linvel.y < RAPIER_MAX_LINEAR_VELOCITY

    # 到第 480 步正好撞线（50 × 480/60 = 400），再跑 40 步保持匀速
    for _ in range(50):
        sim.world.step()
    assert body.linvel.y == pytest.approx(RAPIER_MAX_LINEAR_VELOCITY)


def test_resolve_reports_unknown_keys():
    params, dropped, defaulted = simulator.SimulationParams.resolve({"dt": 0.02, "bogus": 1})
    assert params.dt == 0.02
    assert dropped == ["bogus"]
    assert defaulted == []


def test_resolve_reports_illegal_values():
    _, dropped, defaulted = simulator.SimulationParams.resolve(
        {"dt": "abc", "steps": True, "gravityY": None}
    )
    assert dropped == []
    assert defaulted == ["dt", "gravityY", "steps"]


def test_resolve_clean_params_report_nothing():
    _, dropped, defaulted = simulator.SimulationParams.resolve({"dt": 0.01, "steps": 10})
    assert dropped == []
    assert defaulted == []


def test_resolve_trace_never_defaulted():
    """trace 走 bool()，任何值都能转，不算回落。"""
    _, _, defaulted = simulator.SimulationParams.resolve({"trace": "yes"})
    assert defaulted == []


def test_resolve_empty_returns_defaults():
    params, dropped, defaulted = simulator.SimulationParams.resolve(None)
    assert params == simulator.SimulationParams()
    assert dropped == []
    assert defaulted == []


def test_resolve_all_known_keys_leave_nothing_dropped():
    """全部 7 个合法键一起给：不丢键、不回落，逐字段生效。

    钉住 _KNOWN_PARAM_KEYS 与 _parse 里 take() 的双枚举——
    一侧加了键另一侧没加，这里先红。
    """
    raw = {
        "gravityY": -9.81,
        "friction": 0.3,
        "restitution": 0.2,
        "dt": 0.02,
        "steps": 100,
        "trace": True,
        "initialVelocityY": -1.5,
    }
    params, dropped, defaulted = simulator.SimulationParams.resolve(raw)
    assert dropped == []
    assert defaulted == []
    assert params.gravity_y == -9.81
    assert params.friction == 0.3
    assert params.restitution == 0.2
    assert params.dt == 0.02
    assert params.steps == 100
    assert params.trace is True
    assert params.initial_velocity_y == -1.5


def test_resolve_empty_mapping_returns_defaults():
    """resolve({}) 与 resolve(None) 同走默认值，三个报告都是空。"""
    params, dropped, defaulted = simulator.SimulationParams.resolve({})
    assert params == simulator.SimulationParams()
    assert dropped == []
    assert defaulted == []


def test_resolve_explicit_null_falls_back():
    """friction/restitution/initialVelocityY 显式给 null：回落且如实上报。

    friction/restitution 的回落值是 None（不下发，用 Rapier 默认），
    initialVelocityY 回落 0.0；键在请求里出现过，所以要进 defaulted。
    """
    params, dropped, defaulted = simulator.SimulationParams.resolve(
        {"friction": None, "restitution": None, "initialVelocityY": None}
    )
    assert params.friction is None
    assert params.restitution is None
    assert params.initial_velocity_y == 0.0
    assert defaulted == ["friction", "initialVelocityY", "restitution"]
    assert dropped == []


def test_resolve_multiple_unknown_keys_sorted():
    """多个未知键按升序如实上报。"""
    _, dropped, defaulted = simulator.SimulationParams.resolve({"zeta": 1, "alpha": 2, "mid": 3})
    assert dropped == ["alpha", "mid", "zeta"]
    assert defaulted == []


def test_from_mapping_behavior_unchanged():
    """既有批量仿真调用方不能受影响：非法值仍静默回落。"""
    assert simulator.SimulationParams.from_mapping({"dt": "abc"}).dt == simulator.DEFAULT_DT
    assert simulator.SimulationParams.from_mapping(None) == simulator.SimulationParams()


# --------------------------------------------------------------------------
# 多维扫描 / seed / 随机扰动
# --------------------------------------------------------------------------


def test_sweep_values_expands_cartesian_product_with_seeds():
    """多维扫描做笛卡尔积，每组扫描值按 seeds 各跑一遍。"""
    overrides = simulator.sweep_values(
        simulator.SimulationParams(),
        sweeps=[
            {"param": "gravityY", "values": [-9.81, -3.0]},
            {"param": "friction", "values": [0.1, 0.9]},
        ],
        seeds=[0, 7],
    )

    assert len(overrides) == 8
    assert {
        (item["gravityY"], item["friction"], item["seed"]) for item in overrides
    } == {
        (gravity, friction, seed)
        for gravity in (-9.81, -3.0)
        for friction in (0.1, 0.9)
        for seed in (0, 7)
    }
    # 不要重复键：每个 override 只有被扫参数 + seed
    assert all(set(item) == {"gravityY", "friction", "seed"} for item in overrides)


def test_sweep_values_defaults_to_seed_zero():
    assert simulator.sweep_values(simulator.SimulationParams()) == [{"seed": 0}]


def test_duplicate_sweep_dimensions_are_rejected():
    """同一个参数扫两次，「哪个值生效」说不清，直接报错。"""
    with pytest.raises(simulator.SimulationError):
        simulator.sweep_values(
            simulator.SimulationParams(),
            sweeps=[
                {"param": "friction", "values": [0.1]},
                {"param": "friction", "values": [0.9]},
            ],
        )


def test_count_runs_multiplies_dimensions_and_seeds():
    config = {
        "sweeps": [
            {"param": "gravityY", "values": [-9.81, -3.0]},
            {"param": "friction", "values": [0.1, 0.5, 0.9]},
        ],
        "seeds": [0, 1],
    }
    assert simulator.count_runs(config) == 12
    # 旧的单维度写法照旧按取值数算；没有扫描就是 1 次
    assert simulator.count_runs({"param": "friction", "values": [0.1, 0.2]}) == 2
    assert simulator.count_runs(None) == 1


def test_run_sweep_multi_dimension_with_seeds():
    runs = simulator.run_sweep(
        _scene(_obj()),
        simulator.SimulationParams.from_mapping({"steps": 20}),
        {
            "sweeps": [
                {"param": "gravityY", "values": [-9.81, -3.0]},
                {"param": "friction", "values": [0.1, 0.9]},
            ],
            "seeds": [0, 1],
        },
    )

    assert len(runs) == 8
    assert [run["index"] for run in runs] == list(range(8))
    combos = {
        (run["params"]["gravityY"], run["params"]["friction"], run["params"]["seed"])
        for run in runs
    }
    assert len(combos) == 8


def test_randomization_is_deterministic_for_the_same_seed():
    """同 seed + 同参数 = 同结果（RNG 按 seed:uuid 播种）。"""
    scene = _scene(_obj())
    params = simulator.SimulationParams.from_mapping({"steps": 120})

    first = simulator.run_once(scene, params, seed=3, randomization=2.0)
    second = simulator.run_once(scene, params, seed=3, randomization=2.0)

    assert first["objects"][0]["finalPosition"] == second["objects"][0]["finalPosition"]
    assert first["objects"][0]["finalVelocity"] == second["objects"][0]["finalVelocity"]


def test_different_seeds_produce_different_outcomes_with_randomization():
    """amp > 0 时不同 seed 的初速度不同，落点随之不同。"""
    scene = _scene(_obj())
    params = simulator.SimulationParams.from_mapping({"steps": 120})

    first = simulator.run_once(scene, params, seed=1, randomization=3.0)
    second = simulator.run_once(scene, params, seed=2, randomization=3.0)

    first_pos = first["objects"][0]["finalPosition"]
    second_pos = second["objects"][0]["finalPosition"]
    assert (first_pos["x"], first_pos["z"]) != (second_pos["x"], second_pos["z"])


def test_zero_randomization_ignores_seed():
    """amp = 0 时没有任何抖动：不同 seed 结果完全一致。"""
    scene = _scene(_obj())
    params = simulator.SimulationParams.from_mapping({"steps": 60})

    first = simulator.run_once(scene, params, seed=0, randomization=0.0)
    second = simulator.run_once(scene, params, seed=99, randomization=0.0)

    assert first["objects"][0]["finalPosition"] == second["objects"][0]["finalPosition"]


def test_static_objects_are_not_jittered():
    """static 物体是用户摆的地面/墙，不能被随机扰动撞飞。"""
    scene = _scene(
        _obj(uuid="wall", y=0.0, physics={"type": "static", "shape": "box", "mass": 0})
    )
    sim = simulator.build_world(scene, simulator.SimulationParams(), seed=5, randomization=4.0)

    velocity = sim.simulated[0].body.linvel
    assert (velocity.x, velocity.y, velocity.z) == (0.0, 0.0, 0.0)


def test_dynamic_objects_get_velocity_within_amplitude():
    sim = simulator.build_world(
        _scene(_obj()), simulator.SimulationParams(), seed=5, randomization=2.0
    )

    velocity = sim.simulated[0].body.linvel
    assert abs(velocity.x) <= 2.0
    assert abs(velocity.y) <= 2.0
    assert abs(velocity.z) <= 2.0
    assert (velocity.x, velocity.y, velocity.z) != (0.0, 0.0, 0.0)
