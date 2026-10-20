import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import * as THREE from 'three'
import { useSceneEditor } from './useSceneEditor'
import { useSceneEditorStore } from '../stores/sceneEditorStore'

/**
 * 计划 013：几何体共享 + 创建失败时的资源清理。
 *
 * 盯两件事：
 * 1. 几何体是共享的（每次点击不再新建 BoxGeometry），但材质必须每对象独立
 *    ——点击高亮走 material.emissive，共享材质会让所有物体一起变黄；
 * 2. 创建过程中抛错时，**刚体不能留在物理世界里**（孤儿刚体会永远参与碰撞，
 *    却不在账本里、再也无法被移除），材质也必须 dispose。
 */

type Editor = ReturnType<typeof useSceneEditor>

const rapierMock = vi.hoisted(() => ({
  removedBodies: [] as Array<{ handle: number }>,
  failOnCollider: false,
  lastWorld: null as null | { bodies: { len: () => number } },
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

  class MockBody {
    handle: number
    removed = false
    translation: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 }
    rotation = { x: 0, y: 0, z: 0, w: 1 }
    colliders: unknown[] = []

    constructor(handle: number) {
      this.handle = handle
    }

    numColliders() {
      return this.colliders.length
    }

    collider(index: number) {
      return this.colliders[index] ?? null
    }
  }

  class World {
    gravity: Vector3
    integrationParameters = { dt: 1 / 60 }
    bodies: { len: () => number }
    private handles = new Map<number, MockBody>()

    constructor(gravity: Vector3) {
      this.gravity = gravity
      this.bodies = {
        len: () => [...this.handles.values()].filter((body) => !body.removed).length,
      }
      rapierMock.lastWorld = this
    }

    createRigidBody(desc: { translation?: { x: number; y: number; z: number } }) {
      const body = new MockBody(this.handles.size)
      if (desc?.translation) body.translation = { ...desc.translation }
      this.handles.set(body.handle, body)
      return body
    }

    createCollider(desc: { shape: unknown }, parent: MockBody) {
      // 故障注入：让碰撞体创建失败，用来验证错误路径的清理
      if (rapierMock.failOnCollider) {
        throw new Error('collider 创建失败（测试注入）')
      }
      const collider = { shape: desc.shape }
      parent.colliders.push(collider)
      return collider
    }

    removeRigidBody(body: MockBody) {
      body.removed = true
      rapierMock.removedBodies.push(body)
    }

    step() {}
  }

  class EventQueue {
    constructor(_autoDrain: boolean) {}
  }

  class RigidBodyDesc {
    private t = { x: 0, y: 0, z: 0 }
    static dynamic() {
      return new RigidBodyDesc()
    }
    static fixed() {
      return new RigidBodyDesc()
    }
    setTranslation(x: number, y: number, z: number) {
      this.t = { x, y, z }
      return this
    }
    get translation() {
      return this.t
    }
  }

  class MockCuboid {
    readonly kind = 'cuboid' as const
    halfExtents: { x: number; y: number; z: number }
    constructor(hx: number, hy: number, hz: number) {
      this.halfExtents = { x: hx, y: hy, z: hz }
    }
  }

  class MockBall {
    readonly kind = 'ball' as const
    radius: number
    constructor(radius: number) {
      this.radius = radius
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

describe('useSceneEditor 的几何体共享与失败清理', () => {
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

  beforeEach(() => {
    setActivePinia(createPinia())
    rapierMock.removedBodies.length = 0
    rapierMock.failOnCollider = false
    rapierMock.lastWorld = null
  })

  afterEach(() => {
    while (wrappers.length) {
      wrappers.pop()?.unmount()
    }
    vi.restoreAllMocks()
  })

  it('同类型的物体共享同一个 geometry 实例', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    editor.addCube()
    editor.addCube()
    editor.addSphere()

    const [cubeA, cubeB, sphere] = store.objects.map((o) => o.threeObject as THREE.Mesh)

    // 两个立方体共享几何体：不再每次点击都 new 一份 BoxGeometry
    expect(cubeA.geometry).toBe(cubeB.geometry)
    // 球体是另一种几何体
    expect(sphere.geometry).not.toBe(cubeA.geometry)
  })

  it('材质每对象独立（高亮走 material.emissive，共享会串色）', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()

    editor.addCube()
    editor.addCube()

    const [a, b] = store.objects.map((o) => o.threeObject as THREE.Mesh)
    expect(a.material).not.toBe(b.material)
  })

  it('创建失败时不留下孤儿刚体：物理世界与账本都回到原状', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    const world = rapierMock.lastWorld!

    // 地面刚体 1 个
    const bodiesBefore = world.bodies.len()
    expect(bodiesBefore).toBe(1)

    rapierMock.failOnCollider = true
    expect(editor.addCube()).toBe(false)
    rapierMock.failOnCollider = false

    // 刚体不能留在物理世界里：否则它会永远参与碰撞，却再也无法被移除
    expect(world.bodies.len()).toBe(bodiesBefore)
    expect(rapierMock.removedBodies.length).toBe(1)
    // 账本里也不能留下悬空条目
    expect(editor.getRigidBodyCount()).toBe(0)
    // store 里同样不能有半个物体
    expect(store.objects).toHaveLength(0)
  })

  it('创建失败时释放本次新建的材质', async () => {
    const editor = await initEditor()
    const dispose = vi.spyOn(THREE.Material.prototype, 'dispose')

    rapierMock.failOnCollider = true
    expect(editor.addCube()).toBe(false)

    expect(dispose).toHaveBeenCalled()
  })

  it('创建成功后刚体正常入账，删除物体时刚体与场景同步清理', async () => {
    const editor = await initEditor()
    const store = useSceneEditorStore()
    const world = rapierMock.lastWorld!

    expect(editor.addCube()).toBe(true)
    const uuid = store.objects[0].uuid
    expect(editor.getRigidBodyCount()).toBe(1)
    expect(world.bodies.len()).toBe(2)

    store.removeObject(uuid)

    expect(editor.getRigidBodyCount()).toBe(0)
    expect(world.bodies.len()).toBe(1)
    expect(store.objects).toHaveLength(0)
  })
})
