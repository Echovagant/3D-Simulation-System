import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SceneCheckDialog from './SceneCheckDialog.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

/**
 * 场景检查弹窗：结果分组展示、空态、点击条目定位物体。
 */

const mountDialog = () => mount(SceneCheckDialog)

describe('SceneCheckDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('没有问题展示空态', () => {
    const store = useSceneEditorStore()
    store.addObject({
      uuid: 'ok',
      name: '贴地方块',
      type: 'cube',
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })

    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('没有发现问题')
    expect(wrapper.findAll('.scene-check-dialog__item')).toHaveLength(0)
  })

  it('越界物体列在错误分组，点击条目选中它并关闭弹窗', async () => {
    const store = useSceneEditorStore()
    store.addObject({
      uuid: 'offscreen',
      name: '越界方块',
      type: 'cube',
      position: { x: 25, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })

    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('错误 · 1')
    expect(wrapper.text()).toContain('越界方块')
    expect(wrapper.text()).toContain('超出场地边界')

    await wrapper.find('.scene-check-dialog__item').trigger('click')

    expect(store.selectedObjectUuid).toBe('offscreen')
    expect(wrapper.emitted('close')).toBeTruthy()
  })

  it('悬空静态物体列在提示分组', () => {
    const store = useSceneEditorStore()
    store.addObject({
      uuid: 'floating',
      name: '悬空平台',
      type: 'cube',
      position: { x: 0, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      physicsType: 'static',
    })

    const wrapper = mountDialog()

    expect(wrapper.text()).toContain('提示 · 1')
    expect(wrapper.text()).toContain('悬空平台')
    expect(wrapper.text()).toContain('底部悬空')
  })
})
