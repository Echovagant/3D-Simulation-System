import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { isReactive, isProxy } from 'vue'
import * as THREE from 'three'
import { useSceneEditorStore } from './sceneEditorStore'

/**
 * 计划 013：store 里的 three 对象不再被 Vue 深度代理。
 *
 * 这组用例盯的是「代理」本身，不是业务行为：
 * 只要 `threeObject` 又被代理了，`THREE.Object3D.remove()` 内部的
 * `children.indexOf(object)` 就会失配，删除物体时会静默失败——
 * 物体从 store 里消失了，视口里却还留着。
 */

const newObject = (uuid: string) => ({
  uuid,
  name: 'Cube',
  type: 'cube',
  position: { x: 0, y: 0, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
})

describe('store 的 objects 列表不被深度代理', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('objects 本身是普通数组，不是响应式代理', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))

    expect(isReactive(store.objects)).toBe(false)
    expect(isProxy(store.objects)).toBe(false)
    expect(Array.isArray(store.objects)).toBe(true)
  })

  it('addObject 存入的 threeObject 身份不变、也不是代理', () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())

    store.addObject({ ...newObject('u-raw-1'), threeObject: mesh })

    const stored = store.objects[0]
    // 身份不变：store 里存的就是创建出来的那个对象
    expect(stored.threeObject).toBe(mesh)
    expect(isReactive(stored.threeObject)).toBe(false)
    expect(isProxy(stored.threeObject)).toBe(false)
  })

  it('selectedObject 返回的是原始对象，而不是代理', () => {
    const store = useSceneEditorStore()
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    store.addObject({ ...newObject('u-sel'), threeObject: mesh })
    store.setSelectedObject('u-sel')

    expect(store.selectedObject).toBe(store.objects[0])
    expect(store.selectedObject?.threeObject).toBe(mesh)
    expect(isProxy(store.selectedObject)).toBe(false)
  })

  it('增删改都是「替换数组」，原地修改不会被追踪', () => {
    const store = useSceneEditorStore()

    const beforeAdd = store.objects
    store.addObject(newObject('u1'))
    const afterAdd = store.objects
    expect(afterAdd).not.toBe(beforeAdd)

    const beforeUpdate = store.objects
    store.updateObject('u1', { name: 'Renamed' })
    expect(store.objects).not.toBe(beforeUpdate)
    expect(store.objects[0].name).toBe('Renamed')

    const beforeRemove = store.objects
    store.removeObject('u1')
    expect(store.objects).not.toBe(beforeRemove)
    expect(store.objects).toHaveLength(0)
  })

  it('updateObject 保留 physics 等未传入的字段', () => {
    const store = useSceneEditorStore()
    store.addObject(newObject('u1'))
    const physics = store.objects[0].physics

    store.updateObject('u1', { name: 'Renamed' })

    expect(store.objects[0].physics).toBe(physics)
    expect(store.objects[0].physics?.mass).toBe(1)
  })
})

describe('删除物体时 mesh 真的离开场景', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('removeObject 之后 mesh 从 scene.children 里消失', () => {
    const store = useSceneEditorStore()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const renderer = { setSize: () => {}, dispose: () => {} } as unknown as THREE.WebGLRenderer
    store.initializeScene(scene, camera, renderer)

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    scene.add(mesh)
    store.addObject({ ...newObject('u-del'), threeObject: mesh })

    expect(scene.children).toContain(mesh)
    const childrenBefore = scene.children.length

    store.removeObject('u-del')

    // 关键断言：不是「store 里的长度对了」，而是「视口里的 child 真的少了」
    expect(scene.children.length).toBe(childrenBefore - 1)
    expect(scene.children.indexOf(mesh)).toBe(-1)
    expect(scene.children).not.toContain(mesh)
    expect(store.objects).toHaveLength(0)
  })

  it('store 里存的 threeObject 就是场景里那个 child（indexOf 能命中）', () => {
    const store = useSceneEditorStore()
    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera()
    const renderer = { setSize: () => {}, dispose: () => {} } as unknown as THREE.WebGLRenderer
    store.initializeScene(scene, camera, renderer)

    const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial())
    scene.add(mesh)
    store.addObject({ ...newObject('u-hit'), threeObject: mesh })

    const stored = store.objects[0].threeObject
    expect(scene.children.indexOf(stored as THREE.Object3D)).toBeGreaterThanOrEqual(0)
  })
})
