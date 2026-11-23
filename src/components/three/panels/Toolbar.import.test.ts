// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import Toolbar from './Toolbar.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

vi.mock('./ImportModelDialog.vue', () => ({ default: { template: '<div />' } }))
vi.mock('./AiSceneDialog.vue', () => ({ default: { template: '<div />' } }))

/** 一份最小的合法导出文档 */
const exportDocument = {
  id: 'roundtrip-1',
  name: '往返验证',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  version: 1,
  worldSize: 40,
  objects: [
    {
      uuid: 'cube-1',
      type: 'cube',
      name: '立方体',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      color: 0x4f9dff,
      physics: { type: 'dynamic', shape: 'box', mass: 1 },
    },
  ],
}

const mountToolbar = () =>
  mount(Toolbar, {
    global: {
      provide: {
        getIsSceneInitialized: () => true,
        addCube: () => true,
        addSphere: () => true,
        addRamp: () => true,
        addPrimitive: () => true,
        importModel: async () => true,
        stepOnce: () => true,
      },
    },
  })

const chooseFile = async (
  wrapper: ReturnType<typeof mountToolbar>,
  content: string,
  name = 'scene.json',
) => {
  const input = wrapper.find('input[type="file"]')
  const file = new File([content], name, { type: 'application/json' })
  Object.defineProperty(input.element, 'files', {
    configurable: true,
    value: [file],
  })
  await input.trigger('change')
  await flushPromises()
}

describe('工具栏 · 导入场景 JSON', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('导入导出文档后物体真正被重建，并写入「我的场景」索引', async () => {
    const store = useSceneEditorStore()
    const wrapper = mountToolbar()

    await chooseFile(wrapper, JSON.stringify(exportDocument))

    expect(store.objects).toHaveLength(1)
    expect(store.objects[0].type).toBe('cube')
    expect(store.objects[0].threeObject?.position.x).toBe(1)
    expect(store.objects[0].threeObject?.position.y).toBe(2)
    expect(store.listScenes().map((scene) => scene.id)).toContain('roundtrip-1')
    expect(wrapper.text()).toContain('已导入')
    expect(wrapper.text()).toContain('1/1')
  })

  it('畸形 JSON 被拒绝，现有场景不被破坏，错误原因可读', async () => {
    const store = useSceneEditorStore()
    store.addObject({
      uuid: 'keep',
      name: '保留',
      type: 'cube',
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })

    const wrapper = mountToolbar()
    await chooseFile(wrapper, '{ 这不是 JSON')

    expect(store.objects.map((obj) => obj.uuid)).toEqual(['keep'])
    expect(wrapper.text()).toContain('导入失败')
    expect(wrapper.text()).toContain('JSON')
  })

  it('不支持的物体类型会指出是第几个，而不是静默丢物体', async () => {
    const store = useSceneEditorStore()
    const wrapper = mountToolbar()

    await chooseFile(
      wrapper,
      JSON.stringify({
        objects: [{ type: 'cone', position: { x: 0, y: 1, z: 0 } }],
      }),
    )

    expect(store.objects).toHaveLength(0)
    expect(wrapper.text()).toContain('第 1 个物体')
    expect(wrapper.text()).toContain('cone')
  })
})
