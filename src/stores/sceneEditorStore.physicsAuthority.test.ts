import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import * as THREE from 'three'
import { useSceneEditorStore } from './sceneEditorStore'

/**
 * 计划 014：单一物理权威（store 这一层）。
 *
 * 盯的是三件事：
 * 1. 手写积分器连同它的状态一起没了（动态状态的真值只剩 Rapier 刚体）；
 * 2. 「重置模拟」回到的是**创建时**的位置，而不是属性面板里最后设定的位置；
 * 3. store 不碰 mesh——位置的真值是刚体，mesh 只是它的镜像。
 */

const newObject = (uuid: string, y = 2) => ({
  uuid,
  name: 'Cube',
  type: 'cube',
  position: { x: 0, y, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

describe('手写积分器已经不存在了', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('物体上不再有 velocity / isFalling 这类积分器状态', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    // 动态状态的真值只有 Rapier 刚体（body.linvel() / body.translation()），
    // store 里再存一份镜像只会变成「第二个权威」。
    expect(store.objects[0].physics?.velocity).toBeUndefined()
    expect(store.objects[0].physics?.acceleration).toBeUndefined()
    expect(store.objects[0].physics?.isFalling).toBeUndefined()
    // 静态信息仍然保留（质量等）
    expect(store.objects[0].physics?.mass).toBe(1)
  })

  it('store 不再暴露手写积分器的配置项', () => {
    const store = useSceneEditorStore()

    // physicsConfig（gravity / airResistance / updateRate）只服务于已删除的积分器
    expect((store as unknown as Record<string, unknown>).physicsConfig).toBeUndefined()
  })

  it('store 的渲染循环不会移动 mesh', async () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Object3D()
    mesh.position.set(1, 2, 3)
    store.addObject({ ...newObject('u1'), threeObject: mesh })

    let pending: FrameRequestCallback | null = null
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      pending = cb
      return 1
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
      pending = null
    })

    store.simulationState.isPlaying = true
    store.startSimulation()
    await nextTick()

    const tick = pending as unknown as FrameRequestCallback
    pending = null
    tick(0)
    tick(16)
    tick(32)

    // 位置的真值在 Rapier 刚体上：store 循环动不了 mesh
    expect(mesh.position.x).toBe(1)
    expect(mesh.position.y).toBe(2)
    expect(mesh.position.z).toBe(3)

    store.stopSimulation()
    await nextTick()
  })
})

describe('「重置模拟」的复位基准', () => {
  let store: ReturnType<typeof useSceneEditorStore>
  let events: CustomEvent[]
  let handler: (e: Event) => void

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSceneEditorStore()
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123 as never)
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})
    events = []
    handler = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener('update-transform', handler)
  })

  afterEach(() => {
    window.removeEventListener('update-transform', handler)
  })

  it('回到创建时的位置，而不是用户在属性面板里最后设定的位置', () => {
    store.addObject(newObject('u1', 2))

    // 用户把物体挪到了别处
    store.updateObject('u1', { position: { x: 9, y: 9, z: 9 } })

    events.length = 0
    store.resetSimulation()

    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u1')
    expect(events[0].detail.transform.position).toEqual({ x: 0, y: 2, z: 0 })
  })

  it('每个物体各派发一次复位事件，携带它自己的初始变换', () => {
    store.addObject(newObject('u1', 2))
    store.addObject(newObject('u2', 5))

    events.length = 0
    store.resetSimulation()

    expect(events.length).toBe(2)
    const byUuid = new Map(events.map((e) => [e.detail.uuid, e.detail.transform]))
    expect(byUuid.get('u1')?.position).toEqual({ x: 0, y: 2, z: 0 })
    expect(byUuid.get('u2')?.position).toEqual({ x: 0, y: 5, z: 0 })
    // 碰撞体形状也要跟着回到初始缩放
    expect(byUuid.get('u1')?.scale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('复位不会动 mesh：位置由刚体回写，store 写 mesh 就成了第二个权威', () => {
    const mesh = new THREE.Object3D()
    mesh.position.set(0, 2, 0)
    store.addObject({ ...newObject('u1', 2), threeObject: mesh })

    // 模拟物理把它推到了别处
    mesh.position.set(0.5, 1.25, -0.5)

    store.resetSimulation()

    // store 不碰 mesh：mesh 仍然是物理留下的样子，等刚体同步覆盖它
    expect(mesh.position.y).toBe(1.25)
  })

  it('被删除的物体不会被复位事件带回来', () => {
    store.addObject(newObject('u1', 2))
    store.addObject(newObject('u2', 5))
    store.removeObject('u1')

    events.length = 0
    store.resetSimulation()

    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u2')
  })

  it('复位把仿真时钟归零', () => {
    store.addObject(newObject('u1', 2))
    store.simulationState.currentTime = 12.5
    store.simulationState.frameCount = 300
    store.renderState.lastFrameTime = 999

    store.resetSimulation()

    expect(store.simulationState.currentTime).toBe(0)
    expect(store.simulationState.frameCount).toBe(0)
    expect(store.renderState.lastFrameTime).toBe(0)
  })
})
