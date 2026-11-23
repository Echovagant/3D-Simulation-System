import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import MaterialsPanel from './MaterialsPanel.vue'
import { MATERIAL_PRESETS } from '@/data/materialPresets'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

// 组件只用得到 router.push：用一个替身记录跳转目标即可
const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }))
vi.mock('vue-router', () => ({ useRouter: () => ({ push: pushMock }) }))

describe('资源中心 · 材质页签', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    sessionStorage.clear()
    pushMock.mockClear()
  })

  it('渲染全部材质预设卡片，含名称、说明与金属度 / 粗糙度', () => {
    const wrapper = mount(MaterialsPanel)

    const cards = wrapper.findAll('.material-card')
    expect(cards).toHaveLength(MATERIAL_PRESETS.length)

    const text = wrapper.text()
    for (const preset of MATERIAL_PRESETS) {
      expect(text).toContain(preset.name)
      expect(text).toContain(preset.description)
    }
    expect(wrapper.findAll('.material-apply')).toHaveLength(MATERIAL_PRESETS.length)
  })

  it('点击「在编辑器中应用」写入待应用材质并跳到场景编辑器', async () => {
    const store = useSceneEditorStore()
    const wrapper = mount(MaterialsPanel)

    await wrapper.findAll('.material-apply')[0].trigger('click')

    const preset = MATERIAL_PRESETS[0]
    expect(sessionStorage.getItem('pending-material')).toBe(preset.id)
    expect(store.pendingMaterialId).toBe(preset.id)
    expect(pushMock).toHaveBeenCalledWith('/scene-editor')
  })
})
