// @vitest-environment jsdom
/**
 * 代理日志面板。
 *
 * 盯的是**用户能感觉到的东西**：
 *
 * 1. 日志是给人查的——**不许边存边丢**。以前每个代理只留最近 100 条，
 *    超出的直接丢掉，于是「那个代理当时为什么转向」永远查不到
 *    （实测 4 个代理跑 1 分钟就到 400 条封顶）。
 * 2. 但几千条日志全画进 DOM 一样会卡——所以要**虚拟滚动**：
 *    全部日志都留着、都翻得到，DOM 里却只有视口里那十几行。
 * 3. 每行、每次重渲染都要格式化一次时间戳。那个格式化曾经用
 *    `toLocaleTimeString`——它每次调用都要新建一个 Intl 格式化器，
 *    实测单次约 97 微秒。两百多行、每秒重渲几次，单这一项就是每秒上百毫秒的
 *    主线程时间：代理一多，界面就跟着卡住。
 *
 * ⚠️ 这些用例守住的是「不丢」「翻得到」「画得少」「key 稳定」，
 * 不是像素级外观——面板长什么样由截图负责。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AiDebugPanel from './AiDebugPanel.vue'
import { useAiStore } from '@/stores/aiStore'

/** 面板画出来的一行 */
const rowsOf = (wrapper: ReturnType<typeof mount>) => wrapper.findAll('.ai-log-row')

describe('AiDebugPanel —— 日志面板', () => {
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

    const seqs = store.logs.map((log) => log.seq)

    expect(new Set(seqs).size).toBe(seqs.length)
    expect([...seqs].sort((a, b) => a - b)).toEqual(seqs)
  })

  it('日志表是所有代理合在一起的一张表，代理是谁记在条目上', () => {
    const store = useAiStore()
    const first = store.createAgent('导航机器人', 'basic')
    const second = store.createAgent('猎手', 'advanced')
    store.addAgentLog(first.id, '甲的日志')
    store.addAgentLog(second.id, '乙的日志')

    expect(store.logs).toHaveLength(2)
    expect(store.logs[0].agentName).toBe('导航机器人')
    expect(store.logs[1].agentName).toBe('猎手')
    expect(store.logs[1].agentId).toBe(second.id)
  })

  it('日志不丢——几百条一条不少地留着（以前每个代理只留 100 条就丢）', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 400; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    expect(store.logs).toHaveLength(400)
    expect(store.logs[0].message).toBe('第 0 条')
    expect(store.logs[399].message).toBe('第 399 条')
  })

  it('日志总数封顶在 5000 条，超出时丢的是最旧的', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 5100; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    expect(store.logs).toHaveLength(5000)
    // 丢的是最早的，不是最新的
    expect(store.logs[0].message).toBe('第 100 条')
    expect(store.logs[4999].message).toBe('第 5099 条')
  })

  it('虚拟滚动：日志都留着，但 DOM 里只画视口里那几行', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 400; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    const wrapper = mount(AiDebugPanel)
    const rows = rowsOf(wrapper)

    // 画出来的远少于全部——这就是虚拟滚动的意义
    expect(rows.length).toBeLessThan(400)
    expect(rows.length).toBeGreaterThan(0)
    // 界面上写明总数，让人知道有多少条可翻
    expect(wrapper.text()).toContain('共 400 条')
  })

  it('虚拟滚动：占位层按总条数撑高，滚动条长度反映真实条数', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 400; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    const wrapper = mount(AiDebugPanel)
    const spacer = wrapper.find('.ai-log-spacer')

    // 400 条 × 18 像素一行
    expect(spacer.attributes('style')).toContain('height: 7200px')
  })

  it('往回翻能看到更早的日志——行是按滚动位置定位的', async () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    for (let i = 0; i < 400; i += 1) {
      store.addAgentLog(agent.id, `第 ${i} 条`)
    }

    const wrapper = mount(AiDebugPanel)
    const box = wrapper.find('.ai-log-list').element as HTMLElement
    // jsdom 里没有布局，手动指定滚动位置
    Object.defineProperty(box, 'scrollTop', { value: 0, writable: true })
    Object.defineProperty(box, 'clientHeight', { value: 260, writable: true })
    Object.defineProperty(box, 'scrollHeight', { value: 7200, writable: true })

    await wrapper.find('.ai-log-list').trigger('scroll')

    const rows = rowsOf(wrapper)
    expect(rows.length).toBeGreaterThan(0)
    // 回到顶部之后，画出来的是最前面那批
    expect(rows[0].text()).toContain('第 0 条')
  })

  it('每一行都带日志类型的颜色——面板默认文字是深色的，不给颜色就看不见', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '普通信息', 'info')
    store.addAgentLog(agent.id, '出错了', 'error')

    const wrapper = mount(AiDebugPanel)
    const rows = rowsOf(wrapper)

    expect(rows[0].classes()).toContain('ai-t-blue')
    expect(rows[1].classes()).toContain('ai-t-red')
  })

  it('能按类型筛选', async () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '普通信息', 'info')
    store.addAgentLog(agent.id, '出错了', 'error')

    const wrapper = mount(AiDebugPanel)
    expect(wrapper.text()).toContain('出错了')

    await wrapper.find('select').setValue('error')
    expect(wrapper.text()).toContain('出错了')
    expect(wrapper.text()).not.toContain('普通信息')
  })

  it('清空日志只清日志，不动代理', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '出发')

    const wrapper = mount(AiDebugPanel)
    wrapper.findAll('button').find((b) => b.text().includes('清空日志'))?.trigger('click')

    expect(store.logs).toHaveLength(0)
    expect(store.agents).toHaveLength(1)
  })

  it('导出按钮把当前日志写进 .jsonl 下载', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '出发', 'info')

    const created: Blob[] = []
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob)
      return 'blob:mock'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL

    const wrapper = mount(AiDebugPanel)
    wrapper.findAll('button').find((b) => b.text().includes('导出'))?.trigger('click')

    expect(created).toHaveLength(1)
    expect(created[0].type).toContain('application/x-ndjson')

    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })

  it('日志导出旁边提供「导出运行记录」按钮', () => {
    const store = useAiStore()
    store.createAgent('导航机器人', 'basic')

    const wrapper = mount(AiDebugPanel)
    const button = wrapper
      .findAll('button')
      .find((item) => item.text().includes('导出运行记录'))

    expect(button).toBeTruthy()
  })

  it('导出运行记录：下载 JSON 并给出成功提示，不碰日志导出', async () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')
    store.addAgentLog(agent.id, '出发', 'info')

    const created: Blob[] = []
    const originalCreate = URL.createObjectURL
    const originalRevoke = URL.revokeObjectURL
    URL.createObjectURL = ((blob: Blob) => {
      created.push(blob)
      return 'blob:mock'
    }) as typeof URL.createObjectURL
    URL.revokeObjectURL = (() => {}) as typeof URL.revokeObjectURL

    const wrapper = mount(AiDebugPanel)
    await wrapper
      .findAll('button')
      .find((item) => item.text().includes('导出运行记录'))
      ?.trigger('click')

    expect(created).toHaveLength(1)
    expect(created[0].type).toContain('application/json')
    expect(wrapper.text()).toContain('已导出运行记录')
    // 「导出日志」仍只导出 .jsonl——两个入口互不替代
    expect(created[0].type).not.toContain('application/x-ndjson')

    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
  })
})
