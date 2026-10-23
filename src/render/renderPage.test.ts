// @vitest-environment jsdom
/// <reference types="node" />
/**
 * 渲染页的单元测试。
 *
 * 守的是三件事：
 * 1. 动作类型**只有四种**——多一种就是多一条实现与一条测试，得先在这里拦住；
 * 2. 一帧一步——`frames()` 必须严格等于已推进的物理步数；
 * 3. 物理与浏览器实跑基线一致——渲染页用的是同一套引擎与参数，
 *    数值对不上就说明渲染出来的视频是错的。
 */
import { describe, it, expect, beforeAll } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import * as THREE from 'three'
import { loadRapier } from '@/composables/loadRapier'
import {
  createRenderController,
  normalizeRenderScene,
  parseRenderAction,
  RENDER_ACTION_TYPES,
  type RenderController,
} from './renderPage'

type Rapier = Awaited<ReturnType<typeof loadRapier>>

let rapier: Rapier

beforeAll(async () => {
  rapier = await loadRapier()
})

interface BaselineFixture {
  world: { gravity: { x: number; y: number; z: number }; dt: number; steps: number }
  ground: { bodyTranslation: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } }
  cube: { initialTranslation: { x: number; y: number; z: number }; halfExtents: { x: number; y: number; z: number } }
  samples: { step: number; position: { x: number; y: number; z: number } }[]
  tolerance: { positionMeters: number }
}

/**
 * 浏览器实跑基线。
 *
 * 路径按 **进程工作目录** 拼，不按 `import.meta.url`：
 * Vitest 的 jsdom 环境里 `import.meta.url` 不是 file: URL，
 * `fileURLToPath()` 会直接抛「The URL must be of scheme file」。
 */
const loadBaseline = (): BaselineFixture =>
  JSON.parse(
    readFileSync(
      join(process.cwd(), 'backend', 'tests', 'fixtures', 'browser_baseline.json'),
      'utf8',
    ),
  ) as BaselineFixture

/** 与浏览器基线对应的场景文档：一个从 y=2 落下的立方体 */
const baselineSceneDocument = (baseline: BaselineFixture) => ({
  id: 'baseline',
  name: 'baseline',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1 as const,
  gravity: baseline.world.gravity,
  objects: [
    {
      uuid: 'cube-1',
      type: 'cube',
      name: 'Cube',
      position: baseline.cube.initialTranslation,
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      physics: { type: 'dynamic' as const, shape: 'box' as const, mass: 1 },
    },
  ],
})

interface Harness {
  controller: RenderController
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  draws: number
  /** 场景里第一个网格（渲染页只往场景里放被渲染的物体） */
  mesh: () => THREE.Mesh
}

const createHarness = (sceneDocument?: unknown): Harness => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000)
  const harness: Harness = {
    controller: null as unknown as RenderController,
    scene,
    camera,
    draws: 0,
    mesh: () => scene.children.find((c) => c instanceof THREE.Mesh) as THREE.Mesh,
  }
  harness.controller = createRenderController({
    rapier,
    scene,
    camera,
    draw: () => {
      harness.draws += 1
    },
    sceneDocument,
  })
  return harness
}

describe('渲染页 · 动作类型', () => {
  it('只允许四种动作类型，第五种直接报错', () => {
    expect([...RENDER_ACTION_TYPES]).toEqual(['addCube', 'addSphere', 'setCamera', 'setSpeed'])
    expect(() => parseRenderAction({ type: 'removeCube', params: {} })).toThrow(/未知的动作类型/)
    expect(() => parseRenderAction({ type: 'deleteAll', params: {} })).toThrow(/未知的动作类型/)
  })

  it('归一化四种动作的参数', () => {
    expect(parseRenderAction({ type: 'addCube', params: { position: { x: 0, y: 3, z: 0 } } })).toEqual({
      atFrame: 0,
      type: 'addCube',
      params: { position: { x: 0, y: 3, z: 0 }, size: 1 },
    })
    expect(
      parseRenderAction({ atFrame: 30, type: 'addSphere', params: { position: { x: 2, y: 4, z: 0 }, radius: 0.5 } }),
    ).toEqual({
      atFrame: 30,
      type: 'addSphere',
      params: { position: { x: 2, y: 4, z: 0 }, radius: 0.5 },
    })
    expect(
      parseRenderAction({
        atFrame: 60,
        type: 'setCamera',
        params: { position: { x: 6, y: 4, z: 6 }, lookAt: { x: 0, y: 1, z: 0 } },
      }),
    ).toEqual({
      atFrame: 60,
      type: 'setCamera',
      params: { position: { x: 6, y: 4, z: 6 }, lookAt: { x: 0, y: 1, z: 0 } },
    })
    expect(parseRenderAction({ atFrame: 90, type: 'setSpeed', params: { value: 0.5 } })).toEqual({
      atFrame: 90,
      type: 'setSpeed',
      params: { value: 0.5 },
    })
  })

  it('参数不合法时报出可读的错误，而不是默默用默认值', () => {
    expect(() => parseRenderAction({ type: 'addCube', params: {} })).toThrow(/position/)
    expect(() => parseRenderAction({ type: 'addCube', params: { position: { x: 0, y: 3, z: 0 }, size: -1 } })).toThrow(
      /size/,
    )
    expect(() => parseRenderAction({ type: 'setCamera', params: { position: { x: 0, y: 0, z: 0 } } })).toThrow(
      /lookAt/,
    )
    expect(() => parseRenderAction({ type: 'setSpeed', params: { value: 0 } })).toThrow(/value/)
  })
})

describe('渲染页 · 场景文档', () => {
  it('只还原立方体与球体；模型这类还原不了的类型被跳过', () => {
    const specs = normalizeRenderScene({
      objects: [
        { type: 'cube', position: { x: 0, y: 2, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
        { type: 'sphere', position: { x: 2, y: 4, z: 0 } },
        { type: 'model', modelId: 'mech', position: { x: 1, y: 1, z: 1 } },
      ],
    })
    expect(specs.map((s) => s.kind)).toEqual(['cube', 'sphere'])
  })

  it('位置缺失就是数据坏了，要报错', () => {
    expect(() => normalizeRenderScene({ objects: [{ type: 'cube' }] })).toThrow(/position/)
    expect(() => normalizeRenderScene({ objects: 'nope' })).toThrow(/objects/)
  })
})

describe('渲染页 · 逐帧驱动', () => {
  it('step() 推进恰好一步：帧数与步数严格一一对应', () => {
    const harness = createHarness({ objects: [] })
    expect(harness.controller.frames()).toBe(0)
    expect(harness.controller.screenshotReady()).toBe(false)

    for (let i = 1; i <= 10; i++) {
      harness.controller.step()
      expect(harness.controller.frames()).toBe(i)
    }
    expect(harness.draws).toBe(10)
    expect(harness.controller.screenshotReady()).toBe(true)
  })

  it('paint() 只画不推进物理——初始那一帧不能算进步数', () => {
    const harness = createHarness({ objects: [] })
    harness.controller.paint()
    expect(harness.controller.frames()).toBe(0)
    expect(harness.draws).toBe(1)
    expect(harness.controller.screenshotReady()).toBe(true)
  })
})

describe('渲染页 · 物理与浏览器基线一致', () => {
  it('落下的立方体与浏览器实跑基线逐点吻合', () => {
    const baseline = loadBaseline()
    const harness = createHarness(baselineSceneDocument(baseline))
    const mesh = harness.mesh()

    const sampled = new Map<number, { x: number; y: number; z: number }>()
    const sampleSteps = new Set(baseline.samples.map((s) => s.step))

    for (let step = 0; step <= baseline.world.steps; step++) {
      if (sampleSteps.has(step)) {
        sampled.set(step, { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z })
      }
      if (step < baseline.world.steps) harness.controller.step()
    }

    expect(harness.controller.frames()).toBe(baseline.world.steps)
    for (const sample of baseline.samples) {
      const actual = sampled.get(sample.step)
      expect(actual, `第 ${sample.step} 步没有采样到`).toBeDefined()
      expect(actual!.x).toBeCloseTo(sample.position.x, 2)
      expect(actual!.y).toBeCloseTo(sample.position.y, 2)
      expect(actual!.z).toBeCloseTo(sample.position.z, 2)
      const drift = Math.hypot(
        actual!.x - sample.position.x,
        actual!.y - sample.position.y,
        actual!.z - sample.position.z,
      )
      expect(drift, `第 ${sample.step} 步的位置漂移 ${drift} m 超过容差`).toBeLessThanOrEqual(
        baseline.tolerance.positionMeters,
      )
    }
  })

  it('同一个场景跑两遍，每一步的位置逐位相同', () => {
    const baseline = loadBaseline()
    const run = () => {
      const harness = createHarness(baselineSceneDocument(baseline))
      const mesh = harness.mesh()
      const trace: number[] = []
      for (let i = 0; i < 120; i++) {
        harness.controller.step()
        trace.push(mesh.position.x, mesh.position.y, mesh.position.z)
      }
      return trace
    }
    expect(run()).toEqual(run())
  })
})

describe('渲染页 · 动作效果', () => {
  it('addCube 往场景里加一个立方体', () => {
    const harness = createHarness({ objects: [] })
    expect(harness.controller.objectCount()).toBe(0)
    harness.controller.apply({ atFrame: 0, type: 'addCube', params: { position: { x: 1, y: 3, z: 0 }, size: 1 } })
    expect(harness.controller.objectCount()).toBe(1)
    expect(harness.mesh().position.y).toBeCloseTo(3, 5)
  })

  it('addSphere 往场景里加一个球体', () => {
    const harness = createHarness({ objects: [] })
    harness.controller.apply({
      atFrame: 0,
      type: 'addSphere',
      params: { position: { x: 2, y: 4, z: 0 }, radius: 0.5 },
    })
    expect(harness.controller.objectCount()).toBe(1)
  })

  it('setCamera 真的把相机搬到指定位置并看向指定点', () => {
    const harness = createHarness({ objects: [] })
    harness.controller.apply({
      atFrame: 0,
      type: 'setCamera',
      params: { position: { x: 6, y: 4, z: 6 }, lookAt: { x: 0, y: 1, z: 0 } },
    })
    expect(harness.camera.position.x).toBe(6)
    expect(harness.camera.position.y).toBe(4)
    expect(harness.camera.position.z).toBe(6)
    // 断言「相机看向哪里」，而不是断言某个欧拉角：
    // lookAt 的结果在有俯仰角时会被分解成不同的 yaw，
    // 直接比 rotation.y 会把「实现对不对」变成「分解顺序对不对」。
    const forward = new THREE.Vector3()
    harness.camera.getWorldDirection(forward)
    const expected = new THREE.Vector3(0 - 6, 1 - 4, 0 - 6).normalize()
    expect(forward.x).toBeCloseTo(expected.x, 6)
    expect(forward.y).toBeCloseTo(expected.y, 6)
    expect(forward.z).toBeCloseTo(expected.z, 6)
  })

  it('setSpeed 让画面里的快慢真的变掉：步长按倍率缩放', () => {
    const fast = createHarness({
      objects: [
        {
          type: 'cube',
          position: { x: 0, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    })
    const slow = createHarness({
      objects: [
        {
          type: 'cube',
          position: { x: 0, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
    })

    slow.controller.apply({ atFrame: 0, type: 'setSpeed', params: { value: 0.5 } })

    for (let i = 0; i < 30; i++) {
      fast.controller.step()
      slow.controller.step()
    }

    // 慢的落得少、快的多
    expect(slow.mesh().position.y).toBeGreaterThan(fast.mesh().position.y)
  })
})
