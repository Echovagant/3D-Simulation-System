// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import * as THREE from 'three'
import { usePhysics } from './usePhysics'

let wrapper: VueWrapper | null = null

/** 挂载一个只调用 usePhysics 的宿主组件（onUnmounted 需要组件上下文） */
const mountPhysics = (): ReturnType<typeof usePhysics> => {
  let api!: ReturnType<typeof usePhysics>
  wrapper = mount(
    defineComponent({
      setup() {
        api = usePhysics()
        return () => h('div')
      },
    }),
  )
  return api
}

/** 一个带物理数据的静态方块 */
const makeStaticBox = (x: number, y: number, z: number): THREE.Mesh => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x475569 }),
  )
  mesh.position.set(x, y, z)
  mesh.userData.physics = {
    type: 'static',
    shape: 'box',
    halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
    friction: 0.6,
    restitution: 0.25,
  }
  return mesh
}

describe('usePhysics —— 地面可配置、固定刚体落在真实位置', () => {
  beforeEach(() => {
    wrapper = null
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('不传地面配置时保持既有行为：20×20 的 Ground，摆在 y = -0.5', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()

    await physics.initPhysics(scene)

    const ground = scene.getObjectByName('Ground') as THREE.Mesh | undefined
    expect(ground).toBeDefined()
    expect(ground?.userData.physics.halfExtents).toEqual({ x: 10, y: 0.5, z: 10 })
    expect(ground?.position.y).toBeCloseTo(-0.5, 5)
    // 地面自己也必须有刚体，否则物体会直接掉下去
    expect(ground?.userData.physics.body).toBeTruthy()
  })

  it('地面可以换成演武场那样的自定义尺寸与材质', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()

    await physics.initPhysics(scene, {
      ground: {
        name: 'ai-arena-ground',
        halfExtents: { x: 30, y: 0.5, z: 30 },
        color: 0x1f2530,
        opacity: 1,
        friction: 0.8,
        restitution: 0.05,
      },
    })

    const ground = scene.getObjectByName('ai-arena-ground') as THREE.Mesh | undefined
    expect(ground).toBeDefined()
    expect(ground?.userData.physics.halfExtents).toEqual({ x: 30, y: 0.5, z: 30 })
    expect(ground?.userData.physics.friction).toBe(0.8)
    expect(ground?.position.y).toBeCloseTo(-0.5, 5)
  })

  it('ground: null 时完全不建地面', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()

    await physics.initPhysics(scene, { ground: null })

    expect(scene.getObjectByName('Ground')).toBeUndefined()
    expect(scene.getObjectByName('ai-arena-ground')).toBeUndefined()
  })

  it('固定刚体建在网格的真实位置上，而不是原点', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()
    const box = makeStaticBox(12, 1, -7)
    scene.add(box)

    await physics.initPhysics(scene)

    const body = box.userData.physics.body
    expect(body).toBeTruthy()
    // 早期版本固定体一律建在原点：摆在远处的箱子其实根本没参与碰撞
    expect(body.translation().x).toBeCloseTo(12, 4)
    expect(body.translation().y).toBeCloseTo(1, 4)
    expect(body.translation().z).toBeCloseTo(-7, 4)
  })

  it('固定刚体带上了网格的旋转', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()
    const box = makeStaticBox(3, 1, 3)
    box.rotation.y = Math.PI / 2
    scene.add(box)

    await physics.initPhysics(scene)

    const body = box.userData.physics.body
    const rotation = body.rotation()
    // 绕 Y 轴转 90°：四元数的 y 分量约等于 sin(45°)
    expect(rotation.y).toBeCloseTo(Math.SQRT1_2, 4)
    expect(rotation.w).toBeCloseTo(Math.SQRT1_2, 4)
  })

  it('addRigidBody 幂等：同一个对象不会被建出两个碰撞体', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()
    const box = makeStaticBox(0, 1, 0)
    scene.add(box)

    await physics.initPhysics(scene)
    const first = box.userData.physics.body

    physics.addRigidBody(box)
    expect(box.userData.physics.body).toBe(first)
  })

  it('动态体真的会受重力落下，并停在地面上（真物理，不是改坐标）', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()
    const ball = new THREE.Mesh(
      new THREE.SphereGeometry(0.5, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xffd700 }),
    )
    ball.position.set(0, 5, 0)
    ball.userData.physics = {
      type: 'dynamic',
      shape: 'sphere',
      radius: 0.5,
      mass: 1,
      friction: 0.5,
      restitution: 0.2,
    }
    scene.add(ball)

    await physics.initPhysics(scene)

    // 推 2 秒
    for (let i = 0; i < 120; i += 1) {
      physics.updatePhysics(1 / 60)
    }

    // 自由落体 2 秒会掉 19.6 米，落点必然低于起点
    expect(ball.position.y).toBeLessThan(4.9)
    // 球停在地面上，不会穿到地面下面去
    expect(ball.position.y).toBeGreaterThan(0.35)
  })

  it('removeRigidBody 之后刚体真的离开物理世界', async () => {
    const physics = mountPhysics()
    const scene = new THREE.Scene()
    const box = makeStaticBox(0, 1, 0)
    scene.add(box)

    await physics.initPhysics(scene)
    expect(physics.world.value?.bodies.len()).toBeGreaterThan(0)

    physics.removeRigidBody(box)
    expect(box.userData.physics.body).toBeNull()
    expect(box.userData.physics.collider).toBeNull()
  })
})
