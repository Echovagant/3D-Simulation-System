// @vitest-environment jsdom
/**
 * 代理日志面板的渲染开销。
 *
 * 盯的是**用户能感觉到的东西**：日志面板每行、每次重渲染都要格式化一次时间戳。
 * 那个格式化曾经用 `toLocaleTimeString`——它每次调用都要新建一个 Intl 格式化器，
 * 实测单次约 97 微秒。两百多行、每秒重渲几次，单这一项就是每秒上百毫秒的主线程时间：
 * 代理一多，界面就跟着卡住（多开两个代理就能感觉到）。
 *
 * ⚠️ 这些用例守住的是「不再用慢格式化」与「key 是稳定的」，
 * 不是像素级外观——面板长什么样由截图负责。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiDebugPanel from './AiDebugPanel.vue'
import { useAiStore } from '@/stores/aiStore'

describe('AiDebugPanel —— 日志渲染开销', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('渲染日志不调用 toLocaleTimeString（那是最贵的一笔）', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '决定: move {"direction":[0,0,1],"speed":5}')

    const spy = vi.spyOn(Date.prototype, 'toLocaleTimeString')
    const wrapper = mount(AiDebugPanel)

    expect(wrapper.find('.ai-log-list').exists()).toBe(true)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })

  it('日志时间显示成 HH:MM:SS', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '出发')

    const wrapper = mount(AiDebugPanel)

    expect(wrapper.text()).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  it('日志序号单调递增且互不重复——面板拿它当 key', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 5; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    const seqs = store.agents[0].logs.map((log) => log.seq)

    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  })

  it('单个代理的日志封顶 100 条（面板要把所有代理的日志合起来渲染）', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 150; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    expect(store.agents[0].logs).toHaveLength(100)
    // 丢的是最早的，不是最新的
    expect(store.agents[0].logs[99].message).toBe('第 149 条')
  })

  it('列表只渲染最近的一批日志——几百行每次重渲染都要重新布局与绘制', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 200; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    const wrapper = mount(AiDebugPanel)
    const rows = wrapper.findAll('.ai-log-list > div')

    expect(rows.length).toBeLessThanOrEqual(60)
    // 画出来的是最新的一批，不是最早的一批
    expect(rows[rows.length - 1].text()).toContain('第 199 条')
  })
})
