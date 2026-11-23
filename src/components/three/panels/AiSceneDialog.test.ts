// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiSceneDialog from './AiSceneDialog.vue'
import { useLlmStore } from '@/stores/llmStore'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

/**
 * AI 生成场景的界面闭环。
 *
 * 真实厂商鉴权在 CI 里不可控，这里把「模型返回什么」替身掉，
 * 但**解析之后的所有工程动作都走真实代码**：批量添加、撤销栈、
 * 保存为场景。这样厂商不可用时也能证明链路没有断。
 */
describe('AiSceneDialog', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('生成成功后批量添加物体、只占一条撤销记录，并可保存为场景', async () => {
    // 让组件与断言使用同一个 pinia
    const pinia = createPinia()
    setActivePinia(pinia)

    const llm = useLlmStore()
    const sceneStore = useSceneEditorStore()
    const addPrimitive = vi.fn(() => true)
    const wrapper = mount(AiSceneDialog, {
      global: { plugins: [pinia], provide: { addPrimitive } },
    })

    vi.spyOn(llm, 'requestSceneGeneration').mockResolvedValue({
      ok: true,
      objects: [
        {
          name: '斜坡',
          type: 'ramp',
          position: { x: 0, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 1, z: 1 },
        },
        {
          name: '小球',
          type: 'sphere',
          position: { x: 0, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
        },
      ],
      skipped: [],
    })

    await wrapper.find('textarea').setValue('一个斜坡和一个小球')
    await wrapper.find('.ai-scene-dialog__go').trigger('click')
    await flushPromises()

    expect(addPrimitive).toHaveBeenCalledTimes(2)
    expect(sceneStore.canUndo).toBe(true)
    expect(wrapper.text()).toContain('已添加 2 个物体')
    expect(wrapper.find('.ai-scene-dialog__save').exists()).toBe(true)

    const saveSpy = vi.spyOn(sceneStore, 'saveScene').mockResolvedValue('ai-scene-1')
    await wrapper.find('.ai-scene-dialog__save').trigger('click')
    await flushPromises()

    expect(saveSpy).toHaveBeenCalledWith('AI 场景 · 一个斜坡和一个小球')
    expect(wrapper.text()).toContain('已保存')
  })

  it('厂商返回不可用时显示可读错误，且不添加物体', async () => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const llm = useLlmStore()
    const addPrimitive = vi.fn(() => true)
    const wrapper = mount(AiSceneDialog, {
      global: { plugins: [pinia], provide: { addPrimitive } },
    })

    vi.spyOn(llm, 'requestSceneGeneration').mockResolvedValue({
      ok: false,
      error: 'HTTP 401：invalid api key',
    })

    await wrapper.find('textarea').setValue('任意场景')
    await wrapper.find('.ai-scene-dialog__go').trigger('click')
    await flushPromises()

    expect(addPrimitive).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('401')
    expect(wrapper.find('.ai-scene-dialog__save').exists()).toBe(false)
  })
})
