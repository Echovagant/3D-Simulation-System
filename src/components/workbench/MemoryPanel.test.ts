// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import MemoryPanel from './MemoryPanel.vue'
import type { MemoryItem } from '@/services/api/memory'

/**
 * 记忆面板的冒烟网。
 *
 * 盯用户能看见的行为：挂载拉列表、kind 徽标、手动写入、检索、
 * 删除的本地同步、审计提炼的行内结果、后端缺席时安静降级。
 * fetch 全程被替身掉，不联网。
 */

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

let nextId = 1
/** 记忆注册表跟着建/删走，与真实后端一致 */
let memoriesNow: MemoryItem[] = []
let consolidateBody: Record<string, unknown> = { scannedLogs: 0, created: 0, updated: 0, patterns: [] }

const memoryItem = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: nextId++,
  kind: 'semantic',
  content: '一条记忆',
  source: 'manual',
  importance: 0.5,
  dedupeKey: null,
  createdAt: '2026-11-23T10:00:00',
  lastAccessedAt: '2026-11-23T10:00:00',
  ...overrides,
})

/** 按路径+方法路由的记忆替身 */
const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/memory' && method === 'GET') {
      const keyword = url.searchParams.get('query')
      const items = keyword
        ? memoriesNow.filter((item) => item.content.includes(keyword))
        : memoriesNow
      return jsonResponse({ items })
    }
    if (path === '/api/memory' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Partial<MemoryItem>
      const created = memoryItem({
        kind: body.kind ?? 'semantic',
        content: body.content ?? '',
        importance: body.importance ?? 0.5,
      })
      memoriesNow = [created, ...memoriesNow]
      return jsonResponse(created, 201)
    }
    if (path === '/api/memory/consolidate' && method === 'POST') {
      memoriesNow = [
        memoryItem({ kind: 'procedural', source: 'audit_distilled', content: '失败模式：gym_force_out_of_range' }),
        ...memoriesNow,
      ]
      return jsonResponse(consolidateBody)
    }
    const deleteMatch = /^\/api\/memory\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      if (!memoriesNow.some((item) => item.id === id)) {
        return jsonResponse(
          { error: { code: 'memory_not_found', message: `记忆不存在：${id}`, detail: null } },
          404,
        )
      }
      memoriesNow = memoriesNow.filter((item) => item.id !== id)
      return jsonResponse(null, 204)
    }
    return jsonResponse(
      { error: { code: 'http_error', message: `意外路径 ${method} ${path}`, detail: null } },
      500,
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

let wrappers: VueWrapper[] = []

/** 挂上面板；挂载会触发 onMounted 的列表拉取 */
const mountPanel = (): VueWrapper => {
  setActivePinia(createPinia())
  const wrapper = mount(MemoryPanel)
  wrappers.push(wrapper)
  return wrapper
}

const findButton = (wrapper: VueWrapper, label: string): ReturnType<typeof wrapper.find> | undefined =>
  wrapper.findAll('button').find((button) => button.text().includes(label))

beforeEach(() => {
  localStorage.clear()
  nextId = 1
  memoriesNow = []
  consolidateBody = { scannedLogs: 0, created: 0, updated: 0, patterns: [] }
  wrappers = []
})

afterEach(() => {
  while (wrappers.length) {
    wrappers.pop()?.unmount()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('MemoryPanel 冒烟', () => {
  it('挂载后拉列表并渲染条目：kind 徽标、来源、删除按钮、检索与提炼入口都在', async () => {
    installFetch()
    memoriesNow = [
      memoryItem({ kind: 'procedural', source: 'audit_distilled', content: '失败模式：力越界', dedupeKey: 'k1' }),
      memoryItem({ kind: 'episodic', content: '第二轮跑完了' }),
    ]

    const wrapper = mountPanel()
    await flushPromises()
    await nextTick()

    const items = wrapper.findAll('.wb-mem-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('失败模式：力越界')
    expect(items[0].find('.wb-mem-kind').text()).toBe('程序')
    expect(items[0].text()).toContain('审计提炼')
    expect(items[1].find('.wb-mem-kind').text()).toBe('情节')
    // 三类入口按钮必须存在
    expect(findButton(wrapper, '从审计提炼')).toBeDefined()
    expect(findButton(wrapper, '检索')).toBeDefined()
    expect(findButton(wrapper, '写入记忆')).toBeDefined()
    expect(items[0].find('.wb-mem-del').exists()).toBe(true)
  })

  it('手动写入：POST 之后新条目出现在列表最前，输入框清空', async () => {
    const fetchMock = installFetch()
    memoriesNow = [memoryItem({ content: '旧记忆' })]
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('#wb-mem-content').setValue('新记忆')
    await findButton(wrapper, '写入记忆')!.trigger('click')
    await flushPromises()

    const items = wrapper.findAll('.wb-mem-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('新记忆')
    expect((wrapper.find('#wb-mem-content').element as HTMLInputElement).value).toBe('')
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/memory') && init?.method === 'POST',
    )
    expect(postCall).toBeDefined()
  })

  it('检索：请求带 query，列表只剩命中项，计数行显示关键词', async () => {
    const fetchMock = installFetch()
    memoriesNow = [memoryItem({ content: '力上限公式' }), memoryItem({ content: '别的东西' })]
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('.wb-search-input').setValue('力上限')
    await findButton(wrapper, '检索')!.trigger('click')
    await flushPromises()

    const searchedCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('query='),
    )
    expect(searchedCall).toBeDefined()
    expect(wrapper.findAll('.wb-mem-item')).toHaveLength(1)
    expect(wrapper.find('.wb-count-line').text()).toContain('力上限')
  })

  it('删除：点删除按钮发 DELETE，条目本地同步消失', async () => {
    const fetchMock = installFetch()
    const target = memoryItem({ id: 7, content: '要删的' })
    memoriesNow = [memoryItem({ id: 1, content: '留下的' }), target]
    const wrapper = mountPanel()
    await flushPromises()

    // 点「要删的」那一条上的删除按钮，不是列表第一条
    const items = wrapper.findAll('.wb-mem-item')
    const targetIndex = items.findIndex((item) => item.text().includes('要删的'))
    expect(targetIndex).toBeGreaterThanOrEqual(0)
    await items[targetIndex].find('.wb-mem-del').trigger('click')
    await flushPromises()

    const deleteCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/memory/7') && init?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    const contents = wrapper.findAll('.wb-mem-item').map((item) => item.text())
    expect(contents.some((text) => text.includes('要删的'))).toBe(false)
    expect(contents.some((text) => text.includes('留下的'))).toBe(true)
  })

  it('从审计提炼：结果行内展示扫描数与新建/更新数', async () => {
    installFetch()
    consolidateBody = {
      scannedLogs: 30,
      created: 2,
      updated: 1,
      patterns: [
        { sessionId: 'sess-abcd1234-xxx', errorCode: 'gym_force_out_of_range', occurrences: 5, memoryId: 9, action: 'created' },
      ],
    }
    const wrapper = mountPanel()
    await flushPromises()

    await findButton(wrapper, '从审计提炼')!.trigger('click')
    await flushPromises()

    const summary = wrapper.find('.wb-conv-summary')
    expect(summary.exists()).toBe(true)
    expect(summary.text()).toContain('扫描 30 条审计')
    expect(summary.text()).toContain('新提炼 2')
    expect(summary.text()).toContain('更新 1')
    const pattern = wrapper.find('.wb-conv-pattern')
    expect(pattern.exists()).toBe(true)
    expect(pattern.text()).toContain('gym_force_out_of_range')
    expect(pattern.text()).toContain('sess-ab') // 会话 id 只留前 8 位
    // 提炼新建的审计记忆也进了列表
    expect(wrapper.findAll('.wb-mem-item').some((item) => item.text().includes('失败模式'))).toBe(true)
  })

  it('后端缺席：给出明确提示，页面不崩也不报未捕获异常', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const rejections: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => rejections.push(event.reason)
    window.addEventListener('unhandledrejection', onUnhandled)

    const wrapper = mountPanel()
    await flushPromises()

    window.removeEventListener('unhandledrejection', onUnhandled)

    expect(wrapper.find('.wb-error-line').exists()).toBe(true)
    expect(wrapper.find('.wb-error-line').text()).toContain('后端不可达')
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(rejections).toEqual([])
  })
})
