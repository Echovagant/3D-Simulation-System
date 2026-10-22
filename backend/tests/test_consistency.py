"""一致性基准：后端算出来的轨迹必须与浏览器录的那份一致。

基准是 ``tests/fixtures/browser_baseline.json``——由协调方在浏览器里实跑录下
（生产产物 + 无头浏览器，逐物理步采样刚体位置）。
**这份测试不联网、不起浏览器**：基准就是仓库里那份 JSON。

比对容差取自基准文件自己（``tolerance.positionMeters``，当前 0.02 m）。
⚠️ 比对不过**不许**放宽容差来「解决」——那说明真的漂了，
要回去查参数（步长？重力？地面刚体平移？碰撞体尺寸？摩擦/弹性？）。
"""

import json
from pathlib import Path

import pytest

from app.services import simulator

FIXTURE_PATH = Path(__file__).resolve().parent / "fixtures" / "browser_baseline.json"


@pytest.fixture(scope="module")
def baseline() -> dict:
    return json.loads(FIXTURE_PATH.read_text(encoding="utf-8"))


def _baseline_scene(baseline: dict) -> dict:
    """按基准文件里记的物理参数搭出场景文档。

    基准把「地面」「立方体」分开记，这里合成为一个前端格式的 SceneDocument。
    """
    cube = baseline["cube"]
    half = cube["halfExtents"]
    return {
        "id": "browser-baseline",
        "name": "browser-baseline",
        "createdAt": "2026-10-23T00:00:00.000Z",
        "updatedAt": "2026-10-23T00:00:00.000Z",
        "version": 1,
        "objects": [
            {
                "uuid": "baseline-cube",
                "type": "cube",
                "name": "baseline-cube",
                "position": dict(cube["initialTranslation"]),
                "rotation": {"x": 0, "y": 0, "z": 0},
                # 基准记的是半长，换算回缩放：半长 = (size/2) * scale
                "scale": {"x": half["x"] * 2, "y": half["y"] * 2, "z": half["z"] * 2},
                "visible": True,
            }
        ],
    }


def _run_baseline(baseline: dict) -> dict:
    world = baseline["world"]
    params = simulator.SimulationParams.from_mapping(
        {"dt": world["dt"], "steps": world["steps"], "trace": True}
    )
    run = simulator.run_once(_baseline_scene(baseline), params, index=0)
    return run["objects"][0]["trace"]


def test_backend_matches_the_browser_baseline(baseline: dict):
    """逐个采样点比对：每个轴的偏差都必须在容差内。"""
    tolerance = baseline["tolerance"]["positionMeters"]
    trace = _run_baseline(baseline)

    deviations: list[tuple[int, str, float]] = []
    for sample in baseline["samples"]:
        step = sample["step"]
        expected = sample["position"]
        actual = trace[step]["position"]
        for axis in ("x", "y", "z"):
            delta = abs(actual[axis] - expected[axis])
            deviations.append((step, axis, delta))
            assert delta <= tolerance, (
                f"第 {step} 步的 {axis} 轴偏差 {delta:.6f} m 超过容差 {tolerance} m"
            )

    worst = max(deviations, key=lambda item: item[2])
    # 把最大偏差打印出来：跑测试时一眼能看到漂了多少
    print(f"最大偏差 {worst[2]:.6f} m（第 {worst[0]} 步 {worst[1]} 轴），容差 {tolerance} m")


def test_free_fall_phase_matches_exactly(baseline: dict):
    """还在空中的那段（落地之前）必须逐位一致。

    这段只有重力参与，没有接触求解——差一点点就说明步长或重力错了。
    """
    trace = _run_baseline(baseline)
    settled_step = baseline["settled"]["step"]

    for sample in baseline["samples"]:
        step = sample["step"]
        if step >= settled_step:
            continue
        expected = sample["position"]
        actual = trace[step]["position"]
        for axis in ("x", "y", "z"):
            assert actual[axis] == pytest.approx(expected[axis], abs=1e-9)


def test_resting_position_matches_the_browser(baseline: dict):
    """落地后的静止位置也要对得上（静止高度 ≈ 半高减去接触偏移）。"""
    tolerance = baseline["tolerance"]["positionMeters"]
    trace = _run_baseline(baseline)

    settled = baseline["settled"]
    actual = trace[settled["step"]]["position"]
    expected = settled["restingPosition"]

    for axis in ("x", "y", "z"):
        assert abs(actual[axis] - expected[axis]) <= tolerance


def test_baseline_parameters_are_the_ones_the_simulator_uses(baseline: dict):
    """基准文件记的参数必须真的被用上了（防止基准与实现各说各话）。"""
    world = baseline["world"]
    ground = baseline["ground"]
    cube = baseline["cube"]

    scene = _baseline_scene(baseline)
    params = simulator.SimulationParams.from_mapping({"dt": world["dt"], "steps": world["steps"]})
    sim = simulator.build_world(scene, params)

    assert sim.world.gravity.y == pytest.approx(world["gravity"]["y"])
    assert sim.world.integration_parameters.dt == pytest.approx(world["dt"])

    ground_collider = sim.world.colliders[sim.ground_collider]
    assert ground_collider.translation.y == pytest.approx(ground["bodyTranslation"]["y"])
    ground_half = ground_collider.shape.as_cuboid().half_extents
    assert (ground_half.x, ground_half.y, ground_half.z) == pytest.approx(
        (
            ground["halfExtents"]["x"],
            ground["halfExtents"]["y"],
            ground["halfExtents"]["z"],
        )
    )

    cube_collider = sim.world.colliders[sim.simulated[0].collider]
    cube_half = cube_collider.shape.as_cuboid().half_extents
    assert (cube_half.x, cube_half.y, cube_half.z) == pytest.approx(
        (cube["halfExtents"]["x"], cube["halfExtents"]["y"], cube["halfExtents"]["z"])
    )
    # 摩擦/弹性是 Rapier 的默认值——后端没覆盖它们
    assert cube_collider.friction == pytest.approx(cube["friction"])
    assert cube_collider.restitution == pytest.approx(cube["restitution"])


def test_baseline_run_reports_no_penetration(baseline: dict):
    """基准场景是健康的：不该报出穿透。"""
    world = baseline["world"]
    params = simulator.SimulationParams.from_mapping({"dt": world["dt"], "steps": world["steps"]})
    run = simulator.run_once(_baseline_scene(baseline), params)

    assert run["objects"][0]["penetrationDepth"] == 0.0
    assert run["metrics"]["maxPenetration"] == 0.0
    assert run["objects"][0]["resting"] is True
