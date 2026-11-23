// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import KnowledgePanel from './KnowledgePanel.vue'
import type { KnowledgeItem } from '@/services/api/knowledge'

/**
 * 资料面板的冒烟网。
 *
 * 盯用户能看见的行为：挂载拉列表、写入、检索、删除的本地同步、
 * 后端缺席时安静降级。fetch 全程被替身掉，不联网。
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
/** 资料注册表跟着建/删走，与真实后端一致 */
let entriesNow: KnowledgeItem[] = []

const knowledgeItem = (overrides: Partial<KnowledgeItem> = {}): KnowledgeItem => ({
  id: nextId++,
  title: '一条资料',
  content: '资料正文',
  tags: 'gym',
  importance: 0.5,
  createdAt: '2026-11-23T10:00:00',
  updatedAt: '2026-11-23T10:00:00',
  lastAccessedAt: '2026-11-23T10:00:00',
  ...overrides,
})

/** 按路径+方法路由的资料替身 */
const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/knowledge/entries' && method === 'GET') {
      const keyword = (url.searchParams.get('query') ?? '').trim()
      const terms = keyword.split(/[\s,，;；]+/).filter(Boolean)
      const items =
        terms.length === 0
          ? entriesNow
          : entriesNow.filter((item) =>
              terms.some((term) =>
                `${item.title}\n${item.content}\n${item.tags}`.includes(term),
              ),
            )
      return jsonResponse({ items })
    }
    if (path === '/api/knowledge/entries' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Partial<KnowledgeItem>
      const created = knowledgeItem({
        title: body.title ?? '',
        content: body.content ?? '',
        tags: body.tags ?? '',
        importance: body.importance ?? 0.5,
      })
      entriesNow = [created, ...entriesNow]
      return jsonResponse(created, 201)
    }
    const deleteMatch = /^\/api\/knowledge\/entries\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      if (!entriesNow.some((item) => item.id === id)) {
        return jsonResponse(
          { error: { code: 'knowledge_not_found', message: `资料不存在：${id}`, detail: null } },
          404,
        )
      }
      entriesNow = entriesNow.filter((item) => item.id !== id)
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
  const wrapper = mount(KnowledgePanel)
  wrappers.push(wrapper)
  return wrapper
}

const findButton = (wrapper: VueWrapper, label: string): ReturnType<typeof wrapper.find> | undefined =>
  wrapper.findAll('button').find((button) => button.text().includes(label))

beforeEach(() => {
  localStorage.clear()
  nextId = 1
  entriesNow = []
  wrappers = []
})

afterEach(() => {
  while (wrappers.length) {
    wrappers.pop()?.unmount()
  }
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('KnowledgePanel 冒烟', () => {
  it('挂载后拉列表并渲染条目：标题、标签、正文与删除入口都在', async () => {
    installFetch()
    entriesNow = [
      knowledgeItem({ title: '力控经验', content: '接近目标时减小力度', tags: 'gym, 力控' }),
      knowledgeItem({ title: '摩擦取值', content: '地面摩擦 0.5', tags: 'gym' }),
    ]

    const wrapper = mountPanel()
    await flushPromises()
    await nextTick()

    const items = wrapper.findAll('.wb-kn-item')
    expect(items).toHaveLength(2)
    expect(items[0].text()).toContain('力控经验')
    expect(items[0].find('.wb-kn-tags').text()).toBe('gym, 力控')
    expect(items[0].text()).toContain('接近目标时减小力度')
    expect(items[0].find('.wb-kn-del').exists()).toBe(true)
    expect(findButton(wrapper, '检索')).toBeDefined()
    expect(findButton(wrapper, '写入资料')).toBeDefined()
    expect(wrapper.text()).toContain('gym')
  })

  it('写入资料：POST 之后重拉列表，输入框清空', async () => {
    const fetchMock = installFetch()
    entriesNow = [knowledgeItem({ title: '旧资料', content: '旧的' })]
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('#wb-kn-title').setValue('新资料')
    await wrapper.find('#wb-kn-content').setValue('新的正文')
    await findButton(wrapper, '写入资料')!.trigger('click')
    await flushPromises()

    const contents = wrapper.findAll('.wb-kn-item').map((item) => item.text())
    expect(contents.some((text) => text.includes('新资料'))).toBe(true)
    expect((wrapper.find('#wb-kn-title').element as HTMLInputElement).value).toBe('')
    expect((wrapper.find('#wb-kn-content').element as HTMLTextAreaElement).value).toBe('')
    const postCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/api/knowledge/entries') && init?.method === 'POST',
    )
    expect(postCall).toBeDefined()
  })

  it('标题或正文空白：不请求后端，行内提示', async () => {
    const fetchMock = installFetch()
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('#wb-kn-title').setValue('只有标题')
    await findButton(wrapper, '写入资料')!.trigger('click')
    await flushPromises()

    expect(wrapper.find('.wb-error-line').text()).toContain('标题与正文都不能是空白')
    const postCall = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')
    expect(postCall).toBeUndefined()
  })

  it('检索：请求带 query，列表只剩命中项，计数行显示关键词', async () => {
    const fetchMock = installFetch()
    entriesNow = [
      knowledgeItem({ title: '力控经验', content: '减小力度' }),
      knowledgeItem({ title: '别的资料', content: '无关内容' }),
    ]
    const wrapper = mountPanel()
    await flushPromises()

    await wrapper.find('.wb-search-input').setValue('力控')
    await findButton(wrapper, '检索')!.trigger('click')
    await flushPromises()

    const searchedCall = fetchMock.mock.calls.find(([input]) =>
      String(input).includes('query='),
    )
    expect(searchedCall).toBeDefined()
    expect(wrapper.findAll('.wb-kn-item')).toHaveLength(1)
    expect(wrapper.find('.wb-count-line').text()).toContain('力控')
  })

  it('删除：点删除按钮发 DELETE，条目本地同步消失', async () => {
    const fetchMock = installFetch()
    const target = knowledgeItem({ id: 7, title: '要删的', content: '删掉' })
    entriesNow = [knowledgeItem({ id: 1, title: '留下的', content: '保留' }), target]
    const wrapper = mountPanel()
    await flushPromises()

    const items = wrapper.findAll('.wb-kn-item')
    const targetIndex = items.findIndex((item) => item.text().includes('要删的'))
    expect(targetIndex).toBeGreaterThanOrEqual(0)
    await items[targetIndex].find('.wb-kn-del').trigger('click')
    await flushPromises()

    const deleteCall = fetchMock.mock.calls.find(
      ([input, init]) =>
        String(input).endsWith('/api/knowledge/entries/7') && init?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    const contents = wrapper.findAll('.wb-kn-item').map((item) => item.text())
    expect(contents.some((text) => text.includes('要删的'))).toBe(false)
    expect(contents.some((text) => text.includes('留下的'))).toBe(true)
  })

  it('后端缺席：给出明确提示，页面不崩也不报未捕获异常', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
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
    expect(rejections).toHaveLength(0)
  })
})
