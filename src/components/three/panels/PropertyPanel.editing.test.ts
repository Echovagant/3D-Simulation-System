import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { nextTick } from 'vue'
import { mount, type VueWrapper, type DOMWrapper } from '@vue/test-utils'
import * as THREE from 'three'
import PropertyPanel from './PropertyPanel.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

/**
 * 计划 013：属性面板不再深度遍历 three 对象图。
 *
 * 面板要同时满足两件事：
 * 1. 仿真运行时，用户正在输入的值不能被物理同步回填冲掉；
 * 2. 用户没有在编辑时，面板数值仍然要跟随物理同步刷新。
 *
 * 面板的刷新触发源是 `simulationState.frameCount`（一个原始数字），
 * 所以「物理推进一帧」在测试里就等于 `frameCount += 1`。
 */

/** 给 mesh 的顶层属性装上访问计数器：统计面板到底读了多少属性。 */
const instrumentReads = (mesh: THREE.Object3D) => {
  const counts: Record<string, number> = {}
  const values = new Map<string, unknown>()
  const keys = [
    'position',
    'rotation',
    'quaternion',
    'scale',
    'matrix',
    'matrixWorld',
    'children',
    'geometry',
    'material',
    'userData',
    'visible',
    'name',
    'uuid',
    'type',
    'parent',
    'up',
    'layers',
  ]
  for (const key of keys) {
    if (!(key in mesh)) continue
    const target = mesh as unknown as Record<string, unknown>
    values.set(key, target[key])
    counts[key] = 0
    Object.defineProperty(mesh, key, {
      configurable: true,
      enumerable: true,
      get() {
        counts[key] += 1
        return values.get(key)
      },
      set(v) {
        values.set(key, v)
      },
    })
  }
  return {
    total: () => Object.values(counts).reduce((a, b) => a + b, 0),
    of: (key: string) => counts[key] ?? 0,
  }
}

const makeMesh = (y = 2) => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  )
  mesh.position.set(1, y, 3)
  return mesh
}

describe('PropertyPanel 的实时同步与编辑保护', () => {
  let wrapper: VueWrapper
  let store: ReturnType<typeof useSceneEditorStore>
  let mesh: THREE.Mesh

  const setup = async (): Promise<void> => {
    setActivePinia(createPinia())
    store = useSceneEditorStore()
    mesh = makeMesh()

    store.addObject({
      uuid: 'u1',
      name: 'Cube',
      type: 'cube',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      threeObject: mesh,
    })
    store.setSelectedObject('u1')

    wrapper = mount(PropertyPanel)
    await nextTick()
  }

  /** 第 2 个数字输入框是「位置 Y」 */
  const yInput = (): DOMWrapper<HTMLInputElement> =>
    wrapper.findAll('input[type=number]')[1] as DOMWrapper<HTMLInputElement>

  beforeEach(async () => {
    await setup()
  })

  it('初始值来自 mesh 的真实位置', () => {
    expect(yInput().element.value).toBe('2')
  })

  it('用户正在输入时，物理推进不会把输入冲掉', async () => {
    const input = yInput()
    // 只触发 input：模拟「正在打字，还没提交」
    input.element.value = '5'
    await input.trigger('input')
    expect(input.element.value).toBe('5')

    // 物理同步把 mesh 挪走，并推进一帧
    mesh.position.y = 9.5
    store.simulationState.frameCount += 1
    await nextTick()

    // 用户输入仍然是 '5'
    expect(input.element.value).toBe('5')
  })

  it('用户没有在编辑时，面板数值跟随物理同步刷新', async () => {
    const input = yInput()

    mesh.position.y = 9.5
    store.simulationState.frameCount += 1
    await nextTick()

    expect(input.element.value).toBe('9.5')
  })

  it('提交（change）后恢复与物理同步的实时刷新', async () => {
    const input = yInput()
    input.element.value = '5'
    await input.trigger('input')
    await input.trigger('change')

    // 提交之后，物理继续推进，面板应重新跟随 mesh
    mesh.position.y = 7.25
    store.simulationState.frameCount += 1
    await nextTick()

    expect(input.element.value).toBe('7.25')
  })

  it('编辑途中切换选中对象：强制刷新成新对象的值，不残留旧值', async () => {
    const input = yInput()
    input.element.value = '5'
    await input.trigger('input')

    const other = makeMesh(8)
    store.addObject({
      uuid: 'u2',
      name: 'Sphere',
      type: 'sphere',
      position: { x: 1, y: 8, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      threeObject: other,
    })
    store.setSelectedObject('u2')
    await nextTick()

    expect(yInput().element.value).toBe('8')
  })

  it('每帧只读固定几个属性，不再遍历整棵 mesh 图', async () => {
    const reads = instrumentReads(mesh)

    store.simulationState.frameCount += 1
    await nextTick()

    // 一帧只读 position / rotation / scale 各 3 次（x、y、z 三个分量）
    expect(reads.of('position')).toBeLessThanOrEqual(3)
    expect(reads.of('rotation')).toBeLessThanOrEqual(3)
    expect(reads.of('scale')).toBeLessThanOrEqual(3)
    expect(reads.total()).toBeLessThanOrEqual(9)
    // 这些只有「深度遍历」才会碰到的属性，一次都不该被读
    expect(reads.of('quaternion')).toBe(0)
    expect(reads.of('matrix')).toBe(0)
    expect(reads.of('children')).toBe(0)
    expect(reads.of('geometry')).toBe(0)
    expect(reads.of('material')).toBe(0)
    expect(reads.of('userData')).toBe(0)
    expect(reads.of('parent')).toBe(0)
    expect(reads.of('visible')).toBe(0)
  })

  it('编辑期间连 position 都不读：完全不做回填', async () => {
    const input = yInput()
    input.element.value = '5'
    await input.trigger('input')

    const reads = instrumentReads(mesh)
    store.simulationState.frameCount += 1
    await nextTick()

    expect(reads.total()).toBe(0)
  })
})
