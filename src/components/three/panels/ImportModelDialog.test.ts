// @vitest-environment jsdom
/**
 * 编辑器内选模型弹窗（A-1b）的回归网。
 *
 * 盯的是用户能看见的行为：列出模型库全部模型、点卡片即写 selectedModelId
 * 并关闭（导入由 Toolbar 的既有 watch 消费，这里不重复导入逻辑）、
 * 会话上传模型如实标注「仅本会话」。
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import ImportModelDialog from './ImportModelDialog.vue'
import { useModelStore } from '@/stores/modelStore'

describe('ImportModelDialog —— 编辑器内选模型', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('列出模型库全部模型（内置 9 个起步）', () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useModelStore()
    const wrapper = mount(ImportModelDialog, { global: { plugins: [pinia] } })
    expect(store.models.length).toBeGreaterThan(0)
    expect(wrapper.findAll('.import-card').length).toBe(store.models.length)
  })

  it('点卡片即写 selectedModelId 并 emit close——交给既有 watch 消费', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useModelStore()
    const wrapper = mount(ImportModelDialog, { global: { plugins: [pinia] } })

    await wrapper.findAll('.import-card')[0].trigger('click')

    expect(store.selectedModelId).toBe(store.models[0].id)
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('sessionOnly 上传模型如实标注「仅本会话」', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useModelStore()
    store.models.push({
      ...store.models[0],
      id: 'session-tmp-1',
      name: '会话上传模型',
      sessionOnly: true,
      modelUrl: 'blob:http://localhost/obj',
      thumbnailUrl: 'blob:http://localhost/thumb',
    })
    const wrapper = mount(ImportModelDialog, { global: { plugins: [pinia] } })

    await wrapper.findAll('.import-card')[store.models.length - 1].trigger('click')

    expect(store.selectedModelId).toBe('session-tmp-1')
    expect(wrapper.text()).toContain('仅本会话')
  })

  it('点遮罩空白处关闭（ backdrop click.self ）', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    useModelStore()
    const wrapper = mount(ImportModelDialog, { global: { plugins: [pinia] } })

    await wrapper.find('.import-dialog-backdrop').trigger('click')

    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})
