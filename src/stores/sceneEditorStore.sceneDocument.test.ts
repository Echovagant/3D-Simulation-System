import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import * as THREE from 'three'
import { useSceneEditorStore } from './sceneEditorStore'

/**
 * 计划 018：场景文档的存取闭环。
 *
 * 关注点：存 → 列 → 取 → 还原 真的能跑通，
 * 以及「存进文档的到底是什么」。
 */

const newObject = (uuid: string) => ({
  uuid,
  name: 'Cube',
  type: 'cube',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

const readIndex = () => JSON.parse(localStorage.getItem('scene-index') ?? '[]')

describe('场景文档的保存与索引', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('saveScene 把文档写进 scene-<id>，并把索引写进 scene-index', async () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    const id = await store.saveScene('测试场景')

    const raw = localStorage.getItem(`scene-${id}`)
    expect(raw).toBeTruthy()

    const doc = JSON.parse(raw as string)
    expect(doc.id).toBe(id)
    expect(doc.name).toBe('测试场景')
    expect(doc.version).toBe(1)
    expect(doc.objects).toHaveLength(1)
    expect(doc.objects[0].uuid).toBe('u1')

    const index = readIndex()
    expect(index).toHaveLength(1)
    expect(index[0]).toMatchObject({ id, name: '测试场景', objectCount: 1 })
  })

  it('存进文档的是 mesh 的当前真实位置，而不是 SceneObject.position', async () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    store.addObject({ ...newObject('u1'), threeObject: mesh })

    // 物理同步（Rapier → mesh）把物体挪到了别处，
    // 但 SceneObject.position 仍停在「用户最后一次通过属性面板设定的位置」
    mesh.position.set(3, 0.25, -4)

    const id = await store.saveScene('位置')
    const doc = JSON.parse(localStorage.getItem(`scene-${id}`) as string)

    expect(doc.objects[0].position).toEqual({ x: 3, y: 0.25, z: -4 })
  })

  it('存进文档的物理参数带 friction / restitution（缺省补 0.5 / 0.2）', async () => {
    const store = useSceneEditorStore()
    store.addObject({ ...newObject('u-default') })
    store.addObject({
      ...newObject('u-custom'),
      friction: 0.8,
      restitution: 0.1,
    })

    const id = await store.saveScene('物理参数')
    const doc = JSON.parse(localStorage.getItem(`scene-${id}`) as string)

    expect(doc.objects[0].physics).toMatchObject({
      mass: 1,
      friction: 0.5,
      restitution: 0.2,
    })
    expect(doc.objects[1].physics).toMatchObject({
      mass: 1,
      friction: 0.8,
      restitution: 0.1,
    })
  })

  it('listScenes 按保存顺序倒序列出场景', async () => {
    const store = useSceneEditorStore()

    await store.saveScene('第一个')
    await store.saveScene('第二个')

    expect(store.listScenes().map((scene) => scene.name)).toEqual(['第二个', '第一个'])
  })

  it('同一毫秒内连续保存不会撞 id', async () => {
    const store = useSceneEditorStore()

    const first = await store.saveScene('A')
    const second = await store.saveScene('B')

    expect(first).not.toBe(second)
    expect(store.listScenes()).toHaveLength(2)
    expect(store.listScenes().map((scene) => scene.id)).toContain(first)
    expect(store.listScenes().map((scene) => scene.id)).toContain(second)
  })

  it('索引损坏时 listScenes 返回空数组而不是抛错', () => {
    const store = useSceneEditorStore()
    localStorage.setItem('scene-index', '{ 这不是 JSON')

    expect(store.listScenes()).toEqual([])
  })

  it('deleteScene 同时删掉文档与索引项', async () => {
    const store = useSceneEditorStore()
    const id = await store.saveScene('待删除')

    expect(store.deleteScene(id)).toBe(true)
    expect(localStorage.getItem(`scene-${id}`)).toBeNull()
    expect(store.listScenes()).toHaveLength(0)
  })
})

describe('场景文档的加载', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('loadScene 能还原基本体（cube），数量、位置、可见性都对', async () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    store.addObject({ ...newObject('u1'), threeObject: mesh })
    mesh.position.set(1, 2, 3)
    store.updateObject('u1', { visible: false })

    const id = await store.saveScene('基本体')
    const loaded = await store.loadScene(id)

    expect(loaded.ok).toBe(true)
    expect(store.objects).toHaveLength(1)
    expect(store.objects[0].type).toBe('cube')
    expect(store.objects[0].position).toEqual({ x: 1, y: 2, z: 3 })
    expect(store.objects[0].visible).toBe(false)
    expect(store.objects[0].threeObject?.position.x).toBe(1)
    expect(store.objects[0].threeObject?.position.y).toBe(2)
    expect(store.objects[0].threeObject?.position.z).toBe(3)
    expect(store.objects[0].threeObject?.visible).toBe(false)
  })

  it('loadScene 会清掉不在文档里的旧物体，并通知物理引擎销掉旧刚体', async () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('keep'))
    const id = await store.saveScene('场景')
    store.addObject(newObject('extra'))

    const events: CustomEvent[] = []
    const handler = (event: Event) => events.push(event as CustomEvent)
    window.addEventListener('remove-rigidbody', handler)

    await store.loadScene(id)
    window.removeEventListener('remove-rigidbody', handler)

    expect(store.objects.map((obj) => obj.uuid)).toEqual(['keep'])
    expect(events.map((event) => event.detail.uuid)).toContain('extra')
  })

  it('loadScene 对不存在的 id 返回 false，并且不动现有场景', async () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    const loaded = await store.loadScene('nope')

    expect(loaded.ok).toBe(false)
    expect(store.objects).toHaveLength(1)
  })

  it('loadScene 兼容旧的双前缀存储键（scene-scene-<id>）', async () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))
    const id = await store.saveScene('旧键')
    const doc = JSON.parse(localStorage.getItem(`scene-${id}`) as string)

    // 模拟历史实现写下的键（双前缀）
    localStorage.setItem(`scene-scene-${id}`, JSON.stringify(doc))
    localStorage.removeItem(`scene-${id}`)

    const loaded = await store.loadScene(id)

    expect(loaded.ok).toBe(true)
    expect(store.objects).toHaveLength(1)
  })

  it('注册基本体工厂后，加载场景走工厂（基本体因此带得动物理）', async () => {
    const store = useSceneEditorStore()
    // 工厂已注册 = 编辑器动线：loadScene 会先等世界就绪（scene 注入），
    // 这里把 scene 装上，模拟「初始化已完成」的编辑器。
    store.initializeScene(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      {} as unknown as THREE.WebGLRenderer,
    )
    store.addObject(newObject('u1'))
    const saved = await store.saveScene('有物体')

    const calls: string[] = []
    store.registerPrimitiveFactory({
      createCube: () => {
        calls.push('cube')
        store.addObject(newObject('from-factory'))
        return true
      },
      createSphere: () => {
        calls.push('sphere')
        store.addObject(newObject('from-factory'))
        return true
      },
      createRamp: () => {
        calls.push('ramp')
        store.addObject(newObject('from-factory'))
        return true
      },
    })

    await store.loadScene(saved)

    expect(calls).toEqual(['cube'])
    expect(store.objects).toHaveLength(1)
    expect(store.objects[0].uuid).toBe('from-factory')
  })

  it('restorePrimitive 把 mass / friction / restitution 交给工厂', async () => {
    const store = useSceneEditorStore()
    store.initializeScene(
      new THREE.Scene(),
      new THREE.PerspectiveCamera(),
      {} as unknown as THREE.WebGLRenderer,
    )

    const captured: Array<Record<string, unknown> | undefined> = []
    store.registerPrimitiveFactory({
      createCube: (options) => {
        captured.push(options as Record<string, unknown> | undefined)
        store.addObject({ ...newObject('restored') })
        return true
      },
      createSphere: () => false,
      createRamp: () => false,
    })

    const result = await store.loadSceneDocument({
      id: 'physics-doc',
      name: '物理参数',
      createdAt: '2026-11-23T10:00:00.000Z',
      updatedAt: '2026-11-23T10:00:00.000Z',
      version: 1,
      worldSize: 40,
      objects: [
        {
          uuid: 'src',
          type: 'cube',
          name: '源立方体',
          position: { x: 0, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          visible: true,
          physics: {
            type: 'static',
            shape: 'box',
            mass: 2,
            friction: 0.3,
            restitution: 0.7,
          },
        },
      ],
    })

    expect(result.ok).toBe(true)
    expect(captured).toHaveLength(1)
    expect(captured[0]).toMatchObject({
      bodyType: 'static',
      mass: 2,
      friction: 0.3,
      restitution: 0.7,
    })
  })

  it('没有注册工厂时，加载场景仍能还原基本体的 mesh（只是没有物理）', async () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    store.addObject({ ...newObject('u1'), threeObject: mesh })
    mesh.position.set(5, 6, 7)

    const id = await store.saveScene('无工厂')
    const loaded = await store.loadScene(id)

    expect(loaded.ok).toBe(true)
    expect(store.objects).toHaveLength(1)
    expect(store.objects[0].threeObject?.position.x).toBe(5)
    expect(store.objects[0].threeObject?.position.y).toBe(6)
  })
})

describe('编辑历史（撤销 / 重做）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('添加物体后可撤销，撤销后可重做', async () => {
    const store = useSceneEditorStore()
    const before = store.snapshotForHistory()

    store.addObject(newObject('u1'))
    store.pushHistory('添加立方体', before)
    expect(store.objects).toHaveLength(1)
    expect(store.canUndo).toBe(true)
    expect(store.canRedo).toBe(false)

    expect(await store.undo()).toBe(true)
    expect(store.objects).toHaveLength(0)
    expect(store.canRedo).toBe(true)

    expect(await store.redo()).toBe(true)
    expect(store.objects.map((obj) => obj.uuid)).toEqual(['u1'])
    expect(store.canUndo).toBe(true)
  })

  it('删除物体后可撤销，物体连同位置一起回来', async () => {
    const store = useSceneEditorStore()
    store.addObject({ ...newObject('u1'), position: { x: 2, y: 3, z: 4 } })

    const before = store.snapshotForHistory()
    store.removeObject('u1')
    store.pushHistory('删除立方体', before)
    expect(store.objects).toHaveLength(0)

    expect(await store.undo()).toBe(true)
    expect(store.objects).toHaveLength(1)
    expect(store.objects[0].position).toEqual({ x: 2, y: 3, z: 4 })
    expect(store.objects[0].threeObject?.position.x).toBe(2)
  })

  it('撤销会连同场地尺寸一起恢复', async () => {
    const store = useSceneEditorStore()
    store.setWorldSize(60)
    const before = store.snapshotForHistory()

    store.setWorldSize(20)
    store.pushHistory('切换场地尺寸', before)
    expect(store.worldSize).toBe(20)

    expect(await store.undo()).toBe(true)
    expect(store.worldSize).toBe(60)
  })

  it('没有历史时 undo / redo 返回 false，不抛错', async () => {
    const store = useSceneEditorStore()
    expect(await store.undo()).toBe(false)
    expect(await store.redo()).toBe(false)
  })

  it('载入场景会清空历史，避免撤销到上一个场景', async () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))
    store.pushHistory('添加')
    const saved = await store.saveScene('场景 A')

    await store.loadScene(saved)
    expect(store.canUndo).toBe(false)
    expect(store.canRedo).toBe(false)
  })
})
