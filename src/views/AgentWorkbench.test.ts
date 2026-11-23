// @vitest-environment jsdom
/**
 * Agent 工作台页面的冒烟网。
 *
 *  只做骨架：本页盯的是「三个分区都在、状态各自接管」与
 * 「卸载时收掉审计轮询」这两件用户能感知的事。执行与审计的细节
 * 行为由 store 单测（gymWorkbenchStore.test.ts）锁住，这里不重复。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import AgentWorkbench from './AgentWorkbench.vue'
import { useGymWorkbenchStore, AUDIT_POLL_INTERVAL_MS } from '@/stores/gymWorkbenchStore'

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/gym/sessions') return jsonResponse([])
    if (path.endsWith('/logs')) return jsonResponse([])
    if (path === '/api/memory') return jsonResponse({ items: [] })
    if (path === '/api/knowledge/entries') return jsonResponse({ items: [] })
    return jsonResponse({ error: { code: 'http_error', message: `意外路径 ${path}`, detail: null } }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

describe('AgentWorkbench 页面', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('三栏分区都在：会话 / 执行 / 审计流各有自己的面板', async () => {
    installFetch()
    const wrapper = mount(AgentWorkbench, { attachTo: document.body })

    await wrapper.vm.$nextTick()

    expect(wrapper.find('.workbench-toolbar').exists()).toBe(true)
    expect(wrapper.find('.toolbar-title').text()).toContain('Agent 评测台')
    expect(wrapper.find('.pane-left [aria-label="Gym 会话面板"]').exists()).toBe(true)
    expect(wrapper.find('.pane-center [aria-label="3D 视口"]').exists()).toBe(true)
    expect(wrapper.find('.pane-center [aria-label="动作执行面板"]').exists()).toBe(true)
    expect(wrapper.find('.pane-right [aria-label="审计流面板"]').exists()).toBe(true)

    // 面板标题各就各位
    expect(wrapper.find('.pane-left .wb-panel-title').text()).toContain('会话')
    expect(wrapper.find('.pane-center .wb-panel-title').text()).toContain('动作执行')
    expect(wrapper.find('.pane-right .wb-panel-title').text()).toContain('审计流')

    wrapper.unmount()
  })

  it('右栏页签：默认显示记忆，切到资料后渲染资料面板', async () => {
    installFetch()
    const wrapper = mount(AgentWorkbench, { attachTo: document.body })
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.side-tabs').exists()).toBe(true)
    expect(wrapper.find('[aria-label="记忆面板"]').exists()).toBe(true)

    const knowledgeTab = wrapper
      .findAll('.side-tab')
      .find((button) => button.text() === '资料')
    expect(knowledgeTab).toBeDefined()
    await knowledgeTab!.trigger('click')
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[aria-label="资料面板"]').exists()).toBe(true)
    expect(wrapper.find('[aria-label="记忆面板"]').exists()).toBe(false)

    wrapper.unmount()
  })

  it('后端缺席时工具条如实显示「后端不在」', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const wrapper = mount(AgentWorkbench, { attachTo: document.body })
    // refreshSessions 是异步的，等状态落定
    await new Promise((resolve) => setTimeout(resolve, 20))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.toolbar-status.offline').exists()).toBe(true)

    wrapper.unmount()
  })

  it('卸载时收掉审计轮询：定时器不再打日志端点', async () => {
    vi.useFakeTimers()
    const fetchMock = installFetch()
    const wrapper = mount(AgentWorkbench, { attachTo: document.body })
    // fake timers 下 setTimeout 是假的：推进虚拟时钟让 onMounted 的拉取落定
    await vi.advanceTimersByTimeAsync(20)
    await wrapper.vm.$nextTick()

    // 手动选中一个会话并启动轮询（正常路径是用户点会话触发，这里直达 store）
    const store = useGymWorkbenchStore()
    store.currentSessionId = 'sess-1'
    store.startAuditPolling()
    expect(store.auditPollingActive).toBe(true)

    wrapper.unmount()
    expect(store.auditPollingActive).toBe(false)

    const logCallsBefore = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/logs'),
    ).length
    await vi.advanceTimersByTimeAsync(AUDIT_POLL_INTERVAL_MS * 2)
    const logCallsAfter = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes('/logs'),
    ).length
    expect(logCallsAfter).toBe(logCallsBefore)
  })
})
