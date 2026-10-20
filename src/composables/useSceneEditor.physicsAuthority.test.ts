import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { useSceneEditor } from './useSceneEditor'
import { useSceneEditorStore } from '../stores/sceneEditorStore'
import { simulationConfig } from '../config/simulation'

type Editor = ReturnType<typeof useSceneEditor>

/**
 * 计划 014：单一物理权威 + 固定步长累加器（useSceneEditor 这一层）。
 *
 * 盯的是两件事：
 * 1. 物理按**固定步长**推进，步数由真实时间决定，与显示刷新率无关；
 * 2. 刚体是位置的唯一权威——mesh 只是刚体的镜像。
 *
 * Rapier 与 WebGLRenderer 都被替身掉了：jsdom 没有 WebGL 上下文，
 * 而这里要验的是「步长与刚体状态」，不是渲染。
 */

const FIXED_DT = simulationConfig.physics.fixedTimeStep
const MAX_SUB_STEPS = simulationConfig.physics.maxSubSteps

/** 替身世界：记录步进次数与每次的 dt，并按重力积分刚体位移 */
const rapierMock = vi.hoisted(() => ({
  stepCount: 0,
  lastDt: -1,
  worldCount: 0,
}))

vi.mock('./loadRapier', () => {
  class Vector3 {
    x: number
    y: number
    z: number
    constructor(x = 0, y = 0, z = 0) {
      this.x = x
      this.y = y
      this.z = z
    }
  }

  class MockCuboid {
    readonly kind = 'cuboid' as const
    readonly halfExtents: { x: number; y: number; z: number }
    constructor(hx: number, hy: number, hz: number) {
      this.halfExtents = { x: hx, y: hy, z: hz }
    }
  }

  class MockBall {
    readonly kind = 'ball' as const
    readonly radius: number
    constructor(radius: number) {
      this.radius = radius
    }
  }

  class MockCollider {
    shape: MockCuboid | MockBall
    constructor(shape: MockCuboid | MockBall) {
      this.shape = shape
    }
    halfExtents() {
      return this.shape.kind === 'cuboid' ? this.shape.halfExtents : { x: 0, y: 0, z: 0 }
    }
    radius() {
      return this.shape.kind === 'ball' ? this.shape.radius : 0
    }
    setShape(shape: MockCuboid | MockBall) {
      this.shape = shape
    }
  }

  /** 刚体替身：translation() / rotation() / linvel() 都跟真实 Rapier 一样是方法 */
  class MockBody {
    handle: number
    removed = false
    private currentTranslation: { x: number; y: number; z: number }
    private currentRotation = { x: 0, y: 0, z: 0, w: 1 }
    private currentLinvel = { x: 0, y: 0, z: 0 }
    private currentAngvel = { x: 0, y: 0, z: 0 }
    colliders: MockCollider[] = []

    constructor(handle: number, translation: { x: number; y: number; z: number }) {
      this.handle = handle
      this.currentTranslation = { ...translation }
    }

    translation() {
      return { ...this.currentTranslation }
    }
    rotation() {
      return { ...this.currentRotation }
    }
    linvel() {
      return { ...this.currentLinvel }
    }
    angvel() {
      return { ...this.currentAngvel }
    }
    setTranslation(tra: { x: number; y: number; z: number }) {
      this.currentTranslation = { ...tra }
    }
    setRotation(rot: { x: number; y: number; z: number; w: number }) {
      this.currentRotation = { ...rot }
    }
    setLinvel(vel: { x: number; y: number; z: number }) {
      this.currentLinvel = { ...vel }
    }
    setAngvel(vel: { x: number; y: number; z: number }) {
      this.currentAngvel = { ...vel }
    }
    numColliders() {
      return this.colliders.length
    }
    collider(index: number) {
      return this.colliders[index]
    }
  }

  class World {
    gravity: Vector3
    integrationParameters: { dt: number }
    bodies: { len: () => number }
    private handles = new Map<number, MockBody>()

    constructor(gravity: Vector3) {
      this.gravity = gravity
      this.integrationParameters = { dt: 1 / 60 }
      this.bodies = {
        len: () => [...this.handles.values()].filter((body) => !body.removed).length,
      }
      rapierMock.worldCount++
    }

    createRigidBody(desc: RigidBodyDesc): MockBody {
      const handle = this.handles.size
      const body = new MockBody(handle, desc.translation)
      this.handles.set(handle, body)
      return body
    }

    createCollider(desc: ColliderDesc, parent?: MockBody): MockCollider {
      const collider = new MockCollider(desc.shape)
      if (parent) parent.colliders.push(collider)
      return collider
    }

    removeRigidBody(body: MockBody) {
      body.removed = true
    }

    /** 按重力积分一次：让「刚体 → mesh」的同步真的能看出位移 */
    step() {
      rapierMock.stepCount++
      rapierMock.lastDt = this.integrationParameters.dt
      const dt = this.integrationParameters.dt
      for (const body of this.handles.values()) {
        if (body.removed) continue
        const velocity = body.linvel()
        const next = { x: velocity.x, y: velocity.y + this.gravity.y * dt, z: velocity.z }
        body.setLinvel(next)
        const position = body.translation()
        body.setTranslation({
          x: position.x + next.x * dt,
          y: position.y + next.y * dt,
          z: position.z + next.z * dt,
        })
      }
    }
  }

  class EventQueue {
    constructor() {}
  }

  class RigidBodyDesc {
    private tx = 0
    private ty = 0
    private tz = 0
    static dynamic() {
      return new RigidBodyDesc()
    }
    static fixed() {
      return new RigidBodyDesc()
    }
    setTranslation(x: number, y: number, z: number) {
      this.tx = x
      this.ty = y
      this.tz = z
      return this
    }
    get translation() {
      return { x: this.tx, y: this.ty, z: this.tz }
    }
  }

  class ColliderDesc {
    shape: MockCuboid | MockBall
    private constructor(shape: MockCuboid | MockBall) {
      this.shape = shape
    }
    static cuboid(hx: number, hy: number, hz: number) {
      return new ColliderDesc(new MockCuboid(hx, hy, hz))
    }
    static ball(radius: number) {
      return new ColliderDesc(new MockBall(radius))
    }
  }

  return {
    loadRapier: async () => ({
      Vector3,
      World,
      EventQueue,
      RigidBodyDesc,
      ColliderDesc,
      Cuboid: MockCuboid,
      Ball: MockBall,
    }),
  }
})

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()

  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement = document.createElement('canvas')
    shadowMap = { enabled: false, type: 0, mapSize: { width: 0, height: 0 } }
    setSize() {}
    setPixelRatio() {}
    dispose() {}
    render() {}
  }

  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer as unknown as typeof actual.WebGLRenderer,
  }
})

describe('固定步长推进物理', () => {
  const wrappers: VueWrapper[] = []

  const createEditor = (): Editor => {
    let editor: Editor | undefined
    const wrapper = mount(
      defineComponent({
        setup() {
          editor = useSceneEditor(null)
          return () => h('div')
        },
      }),
    )
    wrappers.push(wrapper)
    return editor!
  }

  const initEditor = async (): Promise<Editor> => {
    const editor = createEditor()
    const ok = await editor.initEditor()
    expect(ok).toBe(true)
    return editor
  }

  /** 打开播放，并等 isPlaying 的监听器把累加器归零 */
  const startPlaying = async (store: ReturnType<typeof useSceneEditorStore>) => {
    store.simulationState.isPlaying = true
    await nextTick()
  }

  /** 取场景里第一个物体的 mesh（没有就是用例写错了，直接炸出来） */
  const meshOf = (store: ReturnType<typeof useSceneEditorStore>) => {
    const mesh = store.objects[0]?.threeObject
    if (!mesh) throw new Error('场景里没有带 threeObject 的物体')
    return mesh
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    rapierMock.stepCount = 0
    rapierMock.lastDt = -1
    rapierMock.worldCount = 0
  })

  afterEach(() => {
    while (wrappers.length) {
      wrappers.pop()?.unmount()
    }
  })

  it('每一步的 dt 都是固定的 1/60，绝不随速度或帧率变化', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    await startPlaying(store)

    editor.updatePhysics(0)
    editor.updatePhysics(16)
    editor.updatePhysics(32)
    editor.updatePhysics(1000)

    expect(rapierMock.stepCount).toBeGreaterThan(0)
    expect(rapierMock.lastDt).toBe(FIXED_DT)

    // 速度调大也不改变 dt：速度是「每秒多少个固定步」，不是「步子多大」
    store.simulationState.speed = 3
    editor.updatePhysics(1016)
    expect(rapierMock.lastDt).toBe(FIXED_DT)
  })

  it('帧率不同，1 秒真实时间推进的物理步数相同', async () => {
    const runOneSecond = async (fps: number) => {
      const editor = await initEditor()
      const store = useSceneEditorStore()
      await startPlaying(store)
      rapierMock.stepCount = 0
      const timeBefore = store.simulationState.currentTime
      const framesBefore = store.simulationState.frameCount

      // 第一帧建立时间基准
      editor.updatePhysics(0)
      for (let i = 1; i <= fps; i++) {
        editor.updatePhysics((i * 1000) / fps)
      }
      return {
        steps: rapierMock.stepCount,
        simulated: store.simulationState.currentTime - timeBefore,
        frames: store.simulationState.frameCount - framesBefore,
        store,
      }
    }

    const at15 = await runOneSecond(15)
    const at30 = await runOneSecond(30)
    const at144 = await runOneSecond(144)

    // 1 秒真实时间 = 60 个固定步，三种帧率都必须如此
    expect(at15.steps).toBe(60)
    expect(at30.steps).toBe(60)
    expect(at144.steps).toBe(60)

    // 仿真时钟跟着物理步走
    expect(at15.simulated).toBeCloseTo(1, 6)
    expect(at30.simulated).toBeCloseTo(1, 6)
    expect(at144.simulated).toBeCloseTo(1, 6)
    expect(at15.frames).toBe(60)
    expect(at30.frames).toBe(60)
    expect(at144.frames).toBe(60)
  })

  it('仿真时钟记的是「模拟了多久」，与渲染帧数无关', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    await startPlaying(store)

    editor.updatePhysics(0)
    for (let i = 1; i <= 30; i++) {
      editor.updatePhysics((i * 1000) / 30)
    }

    // 30 帧 × 1/30 秒 = 1 秒真实时间 = 60 个物理步 = 1 秒模拟时间
    expect(store.simulationState.frameCount).toBe(60)
    expect(store.simulationState.currentTime).toBeCloseTo(1, 6)
  })

  it('单帧积压超过 maxSubSteps 时截断，不追帧', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    await startPlaying(store)

    editor.updatePhysics(0)
    // 1 秒的间隔 → 本该 60 步，但单帧上限是 maxSubSteps
    editor.updatePhysics(1000)

    expect(rapierMock.stepCount).toBe(MAX_SUB_STEPS)
  })

  it('刚体是位置的唯一权威：mesh 的位置就是刚体的位置', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const mesh = meshOf(store)
    const body = mesh.userData.physics.body

    await startPlaying(store)

    editor.updatePhysics(0)
    editor.updatePhysics(100)

    // 刚体被重力积分下去了，mesh 必须走到同一个位置
    expect(body.translation().y).toBeLessThan(2)
    expect(mesh.position.y).toBeCloseTo(body.translation().y, 10)
    expect(uuid).toBeTruthy()
  })

  it('复位事件把刚体与碰撞体一起复位：位置回到初始值、速度清零', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const mesh = meshOf(store)
    const body = mesh.userData.physics.body
    const collider = mesh.userData.physics.collider

    const initialY = body.translation().y

    // 先让物体动起来：位置变了、速度不为零、缩放也被改过
    await startPlaying(store)
    editor.updatePhysics(0)
    editor.updatePhysics(100)
    expect(body.linvel().y).not.toBe(0)

    store.updateObject(uuid, { scale: { x: 3, y: 1, z: 1 } })
    expect(collider.shape.halfExtents.x).toBe(1.5)

    // 「重置模拟」做的事：把初始变换写回刚体与碰撞体
    window.dispatchEvent(
      new CustomEvent('update-transform', {
        detail: {
          uuid,
          transform: {
            position: { x: 0, y: initialY, z: 0 },
            rotation: { x: 0, y: 0, z: 0 },
            scale: { x: 1, y: 1, z: 1 },
          },
        },
      }),
    )

    // 刚体：位置回到初始值、线速度与角速度都归零
    expect(body.translation().y).toBeCloseTo(initialY, 10)
    expect(body.linvel().x).toBe(0)
    expect(body.linvel().y).toBe(0)
    expect(body.linvel().z).toBe(0)
    expect(body.angvel().x).toBe(0)

    // 碰撞体形状跟着回到初始缩放
    expect(collider.shape.halfExtents.x).toBe(0.5)

    // mesh 是刚体的镜像：复位后立即对齐，不需要等下一帧
    expect(mesh.position.y).toBeCloseTo(initialY, 10)
  })
})
