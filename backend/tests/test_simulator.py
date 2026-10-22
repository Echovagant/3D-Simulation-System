"""仿真器：场景映射、步进与采样、落地判定、穿透检测、参数扫描。

这一层不碰数据库也不碰队列——它是纯计算，跑多快都不影响别人。
"""

import pytest

from app.services import simulator


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
