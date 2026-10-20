import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import * as THREE from 'three'
import { useSceneEditorStore } from './sceneEditorStore'

const newObject = (uuid: string) => ({
  uuid,
  name: 'Cube',
  type: 'cube',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

describe('sceneEditorStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('setSimulationSpeed 把速度限制在 0.1~5.0', () => {
    const store = useSceneEditorStore()

    store.setSimulationSpeed(99)
    expect(store.simulationState.speed).toBe(5)

    store.setSimulationSpeed(0)
    expect(store.simulationState.speed).toBe(0.1)

    store.setSimulationSpeed(2.5)
    expect(store.simulationState.speed).toBe(2.5)
  })

  it('addObject 追加物体并初始化物理属性', () => {
    const store = useSceneEditorStore()

    store.addObject(newObject('u1'))

    expect(store.objects).toHaveLength(1)
    expect(store.objects[0].uuid).toBe('u1')
    expect(store.objects[0].visible).toBe(true)
    expect(store.objects[0].physics?.mass).toBe(1)
  })

  it('setSelectedObject 记录选中项', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    store.setSelectedObject('u1')

    expect(store.selectedObjectUuid).toBe('u1')
    expect(store.selectedObject?.name).toBe('Cube')
  })

  it('removeObject 清理选中状态', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))
    store.setSelectedObject('u1')

    store.removeObject('u1')

    expect(store.selectedObjectUuid).toBeNull()
    expect(store.objects).toHaveLength(0)
  })

  it('removeObject 删除不存在的 uuid 时不改变列表', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    store.removeObject('nope')

    expect(store.objects).toHaveLength(1)
  })

  it('updateObject 覆盖指定属性', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    store.updateObject('u1', { name: 'Sphere', visible: false })

    expect(store.objects[0].name).toBe('Sphere')
    expect(store.objects[0].visible).toBe(false)
  })

  it('cleanup 清空物体与选中状态', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))
    store.setSelectedObject('u1')

    store.cleanup()

    expect(store.objects).toHaveLength(0)
    expect(store.selectedObjectUuid).toBeNull()
  })

  it('setSelectedObject(null) 清空选中状态', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))
    store.setSelectedObject('u1')

    store.setSelectedObject(null)

    expect(store.selectedObjectUuid).toBeNull()
    expect(store.selectedObject).toBeNull()
  })

  it('selectedObject 按「对象是否真的存在」取值，而不是照抄 uuid', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    store.setSelectedObject('ghost')

    // 契约：selectedObject 是带存在性校验的计算值（objects.find(uuid) || null），
    // uuid 指向不存在的对象时，它就是「没有选中」。
    // 这里刻意**不**锁定 selectedObjectUuid 的具体值——uuid 只是一个引用，
    // 将来「点地面时顺手清掉 uuid」的修复不该被这条用例挡住
    // （界面层 src/views/SceneEditor.vue 现在命中失败就直接 setSelectedObject(null)）。
    expect(store.selectedObject).toBeNull()
    expect(!!store.selectedObject).toBe(false)
  })

  it('selectedObject 才是「是否真的选中了对象」的真值来源', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    store.setSelectedObject('u1')
    expect(!!store.selectedObject).toBe(true)
    expect(store.selectedObject?.uuid).toBe('u1')

    store.setSelectedObject('ghost')
    expect(!!store.selectedObject).toBe(false)
  })
})

describe('removeObject 会通知物理引擎', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const collectRemoveEvents = () => {
    const events: CustomEvent[] = []
    const handler = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener('remove-rigidbody', handler)
    return {
      events,
      stop: () => window.removeEventListener('remove-rigidbody', handler),
    }
  }

  it('派发 remove-rigidbody 事件并携带对象 uuid', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-del-1'))

    const { events, stop } = collectRemoveEvents()
    store.removeObject('u-del-1')
    stop()

    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u-del-1')
  })

  it('事件同时携带 threeObject（向后兼容）', () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Object3D()
    mesh.uuid = 'mesh-uuid-1'
    store.addObject({ ...newObject('u-del-2'), threeObject: mesh })

    const { events, stop } = collectRemoveEvents()
    store.removeObject('u-del-2')
    stop()

    expect(events.length).toBe(1)
    // 注意：store.objects 是 reactive 数组，取出来的 threeObject 是响应式代理，
    // 不能直接和原始对象做深比较，这里按 uuid 断言。
    expect(events[0].detail.object?.uuid).toBe(mesh.uuid)
  })

  it('对象已带 userData.physics.body 时也只派发一次', () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Object3D()
    // 仿真实验室（usePhysics.ts）写的是 mesh 侧 userData.physics.body
    mesh.userData.physics = { body: { fake: true } }
    store.addObject({ ...newObject('u-del-3'), threeObject: mesh })

    const { events, stop } = collectRemoveEvents()
    store.removeObject('u-del-3')
    stop()

    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u-del-3')
  })

  it('删除不存在的 uuid 时不派发事件也不抛错', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-del-4'))

    const { events, stop } = collectRemoveEvents()
    expect(() => store.removeObject('not-there')).not.toThrow()
    stop()

    expect(events.length).toBe(0)
    expect(store.objects).toHaveLength(1)
  })
})

describe('updateObject 会通知物理引擎', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  const collectTransformEvents = () => {
    const events: CustomEvent[] = []
    const handler = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener('update-transform', handler)
    return {
      events,
      stop: () => window.removeEventListener('update-transform', handler),
    }
  }

  it('派发 update-transform 事件并携带 uuid 与新的 position', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-t1'))

    const { events, stop } = collectTransformEvents()
    store.updateObject('u-t1', { position: { x: 1, y: 5, z: 0 } })
    stop()

    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u-t1')
    expect(events[0].detail.transform.position).toEqual({ x: 1, y: 5, z: 0 })
  })

  it('改缩放时派发 update-transform 并携带 scale', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-t2'))

    const { events, stop } = collectTransformEvents()
    store.updateObject('u-t2', { scale: { x: 3, y: 1, z: 1 } })
    stop()

    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u-t2')
    expect(events[0].detail.transform.scale).toEqual({ x: 3, y: 1, z: 1 })
  })

  it('只改名称/可见性时不派发 update-transform', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-t3'))

    const { events, stop } = collectTransformEvents()
    store.updateObject('u-t3', { name: 'Cube2', visible: false })
    stop()

    expect(events.length).toBe(0)
  })

  it('删除不存在的 uuid 时不派发事件', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-t4'))

    const { events, stop } = collectTransformEvents()
    store.updateObject('not-there', { position: { x: 0, y: 1, z: 0 } })
    stop()

    expect(events.length).toBe(0)
  })

  it('没有物理引擎监听时也不抛错（事件无人监听是安全的空操作）', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u-t5'))

    expect(() => store.updateObject('u-t5', { position: { x: 0, y: 1, z: 0 } })).not.toThrow()
  })
})

describe('物理启停', () => {
  let store: ReturnType<typeof useSceneEditorStore>

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSceneEditorStore()
  })

  afterEach(async () => {
    // 停掉可能被 isPlaying 监听器拉起的 rAF 循环，避免泄漏到下一个用例
    store.stopSimulation()
    await nextTick()
    vi.restoreAllMocks()
  })

  it('startSimulation 在 isPlaying 已为 true 时仍能启动循环', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123 as never)

    store.simulationState.isPlaying = true
    store.startSimulation()

    expect(raf).toHaveBeenCalled()
    expect(store.renderState.isRendering).toBe(true)

    // 让 isPlaying 的监听器跑完，避免它把状态留给下一个用例
    await nextTick()
  })

  it('重复调用 startSimulation 不会启动第二条循环', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123 as never)

    store.simulationState.isPlaying = true
    store.startSimulation()
    store.startSimulation()

    expect(raf).toHaveBeenCalledTimes(1)

    await nextTick()
  })

  it('stopSimulation 之后 isRendering 为 false', async () => {
    vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123 as never)
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})

    store.simulationState.isPlaying = true
    store.startSimulation()
    store.stopSimulation()

    expect(cancel).toHaveBeenCalled()
    expect(store.renderState.isRendering).toBe(false)

    await nextTick()
  })

  it('stopSimulation 之后 store 循环不再排期，物理时钟由固定步长累加器独占', async () => {
    let pending: FrameRequestCallback | null = null
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb) => {
      pending = cb
      return 1
    })
    const cancel = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {
      pending = null
    })
    // 让时间可控
    let clock = 10_000
    vi.spyOn(performance, 'now').mockImplementation(() => (clock += 20))

    store.simulationState.isPlaying = true
    store.startSimulation()
    expect(raf).toHaveBeenCalledTimes(1)

    // 手动推进一帧：循环应当记账并重新排期
    const tick = pending as unknown as FrameRequestCallback
    pending = null
    tick(clock)

    // 物理时钟**不再**由 store 的循环推进：唯一权威是 Rapier，
    // 步数与仿真时间由固定步长累加器（useSceneEditor）按固定步长推进。
    // store 的循环只负责渲染侧的记账。
    expect(store.renderState.lastFrameTime).toBeGreaterThan(0)
    expect(store.simulationState.frameCount).toBe(0)
    expect(store.simulationState.currentTime).toBe(0)
    expect(raf).toHaveBeenCalledTimes(2)

    // 停止：取消待执行帧、结束渲染状态
    store.stopSimulation()

    expect(cancel).toHaveBeenCalled()
    expect(store.renderState.isRendering).toBe(false)
    expect(pending).toBeNull()
    expect(raf).toHaveBeenCalledTimes(2)

    // 即使停止之后才到达的旧回调被触发，也不允许复活循环或推进计数
    const framesAtStop = store.simulationState.frameCount
    tick(clock)

    expect(store.simulationState.frameCount).toBe(framesAtStop)
    expect(raf).toHaveBeenCalledTimes(2)

    await nextTick()
  })

  it('resetSimulation 复位仿真时钟，并把物体复位到创建时的初始变换', async () => {
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockReturnValue(123 as never)
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {})

    const mesh = new THREE.Object3D()
    store.addObject({
      ...newObject('u1'),
      position: { x: 0, y: 2, z: 0 },
      threeObject: mesh,
    })

    store.simulationState.isPlaying = true
    store.startSimulation()

    // 用户在属性面板里把位置改到了别处——那不是「初始位置」
    store.updateObject('u1', { position: { x: 9, y: 9, z: 9 } })

    // 造出「已经跑了一段时间」的状态
    store.simulationState.currentTime = 12
    store.simulationState.frameCount = 300
    store.renderState.lastFrameTime = 999

    const events: CustomEvent[] = []
    const handler = (e: Event) => events.push(e as CustomEvent)
    window.addEventListener('update-transform', handler)
    store.resetSimulation()
    window.removeEventListener('update-transform', handler)

    // 仿真时钟归零
    expect(store.simulationState.currentTime).toBe(0)
    expect(store.simulationState.frameCount).toBe(0)
    expect(store.renderState.lastFrameTime).toBe(0)

    // 复位走 update-transform 事件桥接（useSceneEditor 是刚体与碰撞体的唯一所有者），
    // 携带的是**创建时**的初始变换，而不是用户最后设定的位置
    expect(events.length).toBe(1)
    expect(events[0].detail.uuid).toBe('u1')
    expect(events[0].detail.transform.position).toEqual({ x: 0, y: 2, z: 0 })
    expect(events[0].detail.transform.scale).toEqual({ x: 1, y: 1, z: 1 })

    // store 不碰 mesh：位置的真值是 Rapier 刚体，mesh 只是它的镜像，
    // 由物理同步回写。store 再写一次就变成「第二个物理权威」了。
    expect(mesh.position.y).toBe(9)

    // 手写积分器的动态状态（velocity / isFalling）已经不存在了
    expect(store.objects[0].physics?.velocity).toBeUndefined()
    expect(store.objects[0].physics?.isFalling).toBeUndefined()

    // 复位之后循环要重新拉起来，而不是就此死掉
    expect(store.renderState.isRendering).toBe(true)
    expect(raf).toHaveBeenCalledTimes(2)

    await nextTick()
  })
})
