import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useSceneEditor } from './useSceneEditor'
import { useSceneEditorStore } from '../stores/sceneEditorStore'

type Editor = ReturnType<typeof useSceneEditor>

/**
 * 刚体生命周期的唯一所有者是 useSceneEditor（它持有 physicsWorld 与 rigidBodies 账本）。
 * 这里盯的是它的对外契约：能不能按 uuid 移除刚体、以及账本能不能被观察。
 *
 * Rapier 与 WebGLRenderer 都被替身掉了：jsdom 没有 WebGL 上下文，
 * 而本用例要的是「刚体有没有真的从物理世界里消失」，不是渲染。
 */
const rapierMock = vi.hoisted(() => ({
  removedBodies: [] as Array<{ handle: number; removed: boolean }>,
  lastWorld: null as null | {
    bodies: { len: () => number }
  },
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

  /**
   * 碰撞体形状替身。Rapier 的 cuboid 记半长、ball 记半径，
   * 这里保持同样的基准，否则「碰撞体尺寸」这件事根本测不出来。
   */
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

  class MockBody {
    handle: number
    removed = false
    // 真实 Rapier 的 RigidBody.translation() / rotation() / linvel() 都是**方法**，
    // 替身必须保持同样的形状，否则「刚体 → mesh」的同步那条路径根本测不到。
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
      this.currentTranslation = { x: tra.x, y: tra.y, z: tra.z }
    }
    setRotation(rot: { x: number; y: number; z: number; w: number }) {
      this.currentRotation = { x: rot.x, y: rot.y, z: rot.z, w: rot.w }
    }
    setLinvel(vel: { x: number; y: number; z: number }) {
      this.currentLinvel = { x: vel.x, y: vel.y, z: vel.z }
    }
    setAngvel(vel: { x: number; y: number; z: number }) {
      this.currentAngvel = { x: vel.x, y: vel.y, z: vel.z }
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
      rapierMock.lastWorld = this
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
      rapierMock.removedBodies.push(body)
    }

    step() {}
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

describe('useSceneEditor 的刚体生命周期', () => {
  const wrappers: VueWrapper[] = []

  // 在真实组件实例里创建 composable：这样 onUnmounted 能正常注册，卸载即清理
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

  beforeEach(() => {
    setActivePinia(createPinia())
    rapierMock.removedBodies.length = 0
    rapierMock.lastWorld = null
  })

  afterEach(() => {
    while (wrappers.length) {
      wrappers.pop()?.unmount()
    }
  })

  it('导出了可用于移除刚体的能力', () => {
    const editor = createEditor()
    expect(typeof editor.removeRigidBodyByUuid).toBe('function')
  })

  it('removeRigidBodyByUuid 对未知 uuid 返回 false 且不抛错', () => {
    const editor = createEditor()
    expect(() => editor.removeRigidBodyByUuid('never-existed')).not.toThrow()
    expect(editor.removeRigidBodyByUuid('never-existed')).toBe(false)
  })

  it('刚体账本初始为空，未知 uuid 不在账本里', () => {
    const editor = createEditor()
    expect(editor.getRigidBodyCount()).toBe(0)
    expect(editor.hasRigidBody('never-existed')).toBe(false)
  })

  it('删除物体后刚体数量从 1 降到 0，且刚体真的离开了物理世界', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    expect(editor.addCube()).toBe(true)
    const uuid = store.objects[0].uuid
    const world = rapierMock.lastWorld!
    const aliveBefore = world.bodies.len()

    expect(editor.getRigidBodyCount()).toBe(1)
    expect(editor.hasRigidBody(uuid)).toBe(true)

    store.removeObject(uuid)

    expect(editor.getRigidBodyCount()).toBe(0)
    expect(editor.hasRigidBody(uuid)).toBe(false)
    expect(world.bodies.len()).toBe(aliveBefore - 1)
    expect(rapierMock.removedBodies.length).toBe(1)
    expect(store.objects).toHaveLength(0)
  })

  it('删除不存在的 uuid 是安全空操作', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    editor.addCube()
    const world = rapierMock.lastWorld!
    const aliveBefore = world.bodies.len()

    expect(() => store.removeObject('does-not-exist')).not.toThrow()
    expect(editor.getRigidBodyCount()).toBe(1)
    expect(world.bodies.len()).toBe(aliveBefore)
    expect(store.objects).toHaveLength(1)
  })

  it('连续删除所有物体后物理世界里不再有残留刚体', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    editor.addCube()
    editor.addCube()
    editor.addSphere()
    const world = rapierMock.lastWorld!
    const aliveBefore = world.bodies.len()

    // 地面刚体 1 个 + 物体刚体 3 个
    expect(aliveBefore).toBe(4)
    expect(editor.getRigidBodyCount()).toBe(3)

    while (store.objects.length > 0) {
      store.removeObject(store.objects[0].uuid)
    }

    expect(editor.getRigidBodyCount()).toBe(0)
    // 只剩地面刚体
    expect(world.bodies.len()).toBe(1)
    expect(store.objects).toHaveLength(0)
  })

  it('刚体同时挂在 mesh 的 userData.physics 上（与 usePhysics.ts 的约定一致）', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    editor.addCube()
    const mesh = store.objects[0].threeObject

    expect(mesh?.userData.physics?.body).toBeTruthy()
    expect(mesh?.userData.physics?.type).toBe('dynamic')
    expect(mesh?.userData.physics?.shape).toBe('box')
  })

  it('userData.physics 上挂的是真实碰撞体，而不是 null', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    editor.addCube()
    const mesh = store.objects[0].threeObject

    const collider = mesh?.userData.physics?.collider
    expect(collider).toBeTruthy()
    // 立方体整长 1.0 → Rapier 半长 0.5
    expect(collider.halfExtents().x).toBe(0.5)
  })
})

describe('变换写回物理引擎', () => {
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

  // userData.physics 在 three 的类型里是 any，这里取的是真实刚体/碰撞体
  const physicsOf = (store: ReturnType<typeof useSceneEditorStore>) =>
    store.objects[0].threeObject?.userData?.physics

  beforeEach(() => {
    setActivePinia(createPinia())
    rapierMock.removedBodies.length = 0
    rapierMock.lastWorld = null
  })

  afterEach(() => {
    while (wrappers.length) {
      wrappers.pop()?.unmount()
    }
  })

  it('导出了 updateObjectTransform', () => {
    const editor = createEditor()
    expect(typeof editor.updateObjectTransform).toBe('function')
  })

  it('未知 uuid 返回 false 且不抛错', () => {
    const editor = createEditor()
    const transform = { position: { x: 0, y: 1, z: 0 } }
    expect(() => editor.updateObjectTransform('never-existed', transform)).not.toThrow()
    expect(editor.updateObjectTransform('never-existed', transform)).toBe(false)
  })

  it('物理引擎没起来时返回 false', () => {
    const editor = createEditor()
    expect(editor.updateObjectTransform('any', { position: { x: 0, y: 1, z: 0 } })).toBe(false)
  })

  it('改位置后刚体收到新的 translation，线速度被清零', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const body = physicsOf(store).body

    expect(body.translation().y).not.toBe(5)

    store.updateObject(uuid, { position: { x: 1, y: 5, z: 0 } })

    expect(body.translation().x).toBe(1)
    expect(body.translation().y).toBe(5)
    expect(body.translation().z).toBe(0)
    // 位置突变必须清掉旧动量，否则物体会带着旧速度飞走
    expect(body.linvel().x).toBe(0)
    expect(body.linvel().y).toBe(0)
    expect(body.linvel().z).toBe(0)
  })

  it('改旋转后刚体收到对应的四元数，角速度被清零', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const body = physicsOf(store).body

    store.updateObject(uuid, { rotation: { x: Math.PI / 2, y: 0, z: 0 } })

    expect(body.rotation().x).toBeCloseTo(Math.SQRT1_2)
    expect(body.rotation().y).toBeCloseTo(0)
    expect(body.rotation().z).toBeCloseTo(0)
    expect(body.rotation().w).toBeCloseTo(Math.SQRT1_2)
    expect(body.angvel().x).toBe(0)
  })

  it('改缩放后碰撞体跟着变宽', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const collider = physicsOf(store).collider

    // 立方体整长 1.0 → Rapier 半长 0.5
    expect(collider.shape.halfExtents.x).toBe(0.5)

    store.updateObject(uuid, { scale: { x: 3, y: 1, z: 1 } })

    expect(collider.shape.halfExtents.x).toBe(1.5)
    expect(collider.shape.halfExtents.y).toBe(0.5)
    expect(collider.shape.halfExtents.z).toBe(0.5)
  })

  it('缩放是绝对值：连续改两次不会累乘', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const collider = physicsOf(store).collider

    store.updateObject(uuid, { scale: { x: 3, y: 1, z: 1 } })
    store.updateObject(uuid, { scale: { x: 2, y: 1, z: 1 } })

    expect(collider.shape.halfExtents.x).toBe(1)
  })

  it('球体缩放后碰撞体半径跟着变', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addSphere()
    const uuid = store.objects[0].uuid
    const collider = physicsOf(store).collider

    expect(collider.shape.radius).toBe(0.5)

    store.updateObject(uuid, { scale: { x: 2, y: 2, z: 2 } })

    expect(collider.shape.radius).toBe(1)
  })

  it('只改名称不会碰到刚体', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    editor.addCube()
    const uuid = store.objects[0].uuid
    const body = physicsOf(store).body
    const before = { ...body.translation() }

    store.updateObject(uuid, { name: 'Renamed' })

    expect(body.translation()).toEqual(before)
  })
})
