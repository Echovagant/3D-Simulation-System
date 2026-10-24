// @vitest-environment jsdom
/**
 * LLM 面板的拍数统计。
 *
 * 盯的是**用户能看见的东西**：切到 LLM 决策来源时，面板上要有一行读得出
 * 「模型到底有没有在起作用」的数字；一拍都没跑过时不能出现 NaN。
 *
 * ⚠️ 面板**不许**调用 useAI()：useAI 会起自己的物理实例与决策循环，
 * 面板再调一次就会多出第二个循环（决策翻倍）。最后一条用例守着这件事。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import LlmPanel from './LlmPanel.vue'
import { useAiStore } from '@/stores/aiStore'
import { useLlmStore } from '@/stores/llmStore'

let wrapper: VueWrapper | null = null

/** 挂载面板（不需要解释对象，解释按钮因此是禁用的） */
const mountPanel = (): VueWrapper => {
  wrapper = mount(LlmPanel, {
    props: {
      agentId: null,
      getSnapshot: () => null,
    },
  })
  return wrapper
}

describe('LlmPanel —— 拍数统计', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('规则式模式下不显示拍数统计（那些数字恒为 0，是噪声）', async () => {
    const panel = mountPanel()
    const llm = useLlmStore()
    llm.mode = 'rule'
    const ai = useAiStore()
    ai.llmTicks = 10
    ai.llmApplied = 3
    await nextTick()

    expect(panel.text()).not.toContain('拍数统计')
    expect(panel.text()).not.toContain('LLM 生效')
  })

  it('LLM 模式下一拍都没跑过时显示「—」，不出现 NaN', async () => {
    const panel = mountPanel()
    const llm = useLlmStore()
    llm.mode = 'llm'
    await nextTick()

    expect(panel.text()).toContain('拍数统计')
    expect(panel.text()).toContain('LLM 生效 0 / 0 拍（—）')
    expect(panel.text()).not.toContain('NaN')
  })

  it('LLM 模式下显示生效拍数、总拍数与占比', async () => {
    const panel = mountPanel()
    const llm = useLlmStore()
    llm.mode = 'llm'
    const ai = useAiStore()
    ai.llmTicks = 87
    ai.llmApplied = 12
    ai.llmPending = 30
    ai.llmRejected = 20
    ai.llmFallbacks = 25
    await nextTick()

    expect(panel.text()).toContain('LLM 生效 12 / 87 拍（13.8%）')
    expect(panel.text()).toContain('30 拍')
    expect(panel.text()).toContain('20 拍')
    expect(panel.text()).toContain('25 拍')
  })

  it('保留「本次会话已调用 N / M 次」', async () => {
    const panel = mountPanel()
    const llm = useLlmStore()
    llm.mode = 'llm'
    await nextTick()

    expect(panel.text()).toContain('本次会话已调用')
  })

  it('面板不会自己起一套仿真（不会调 useAI）', async () => {
    vi.useFakeTimers()
    mountPanel()
    const ai = useAiStore()

    await vi.advanceTimersByTimeAsync(500)

    // useAI 挂载后会创建默认智能体并跑决策循环——面板不许有这些副作用
    expect(ai.agents).toHaveLength(0)
    expect(ai.llmTicks).toBe(0)
  })
})
