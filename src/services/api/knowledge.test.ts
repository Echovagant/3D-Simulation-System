import { afterEach, describe, expect, it, vi } from 'vitest'
import { createKnowledge, deleteKnowledge, listKnowledge, searchKnowledge } from './knowledge'

/**
 * 资料客户端的契约网：路径、方法、软身份头、请求体形状。
 * 契约来源 backend/app/routers/knowledge.py（2026-11-23 实查）。
 */

/** apiRequest 会把 headers 包成 Headers 实例再传给 fetch：按 Headers 读 */
const headerOf = (init: RequestInit | undefined, name: string): string | null =>
  new Headers(init?.headers).get(name)

/** GET 请求不显式带 method 字段，fetch 默认就是 GET */
const methodOf = (init: RequestInit | undefined): string => init?.method ?? 'GET'

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('knowledge 客户端', () => {
  it('createKnowledge：POST /api/knowledge/entries，带归属头，可选字段缺省不发', async () => {
    const item = {
      id: 1,
      title: '力控经验',
      content: '接近目标时减小力度',
      tags: 'gym',
      importance: 0.5,
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(item, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createKnowledge('owner-1', {
      title: '力控经验',
      content: '接近目标时减小力度',
    })

    expect(result).toEqual(item)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/knowledge/entries')
    expect(init.method).toBe('POST')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')
    expect(JSON.parse(init.body as string)).toEqual({
      title: '力控经验',
      content: '接近目标时减小力度',
    })

    await createKnowledge('owner-1', {
      title: '带标签',
      content: '内容',
      tags: 'gym, 力控',
      importance: 0.8,
    })
    const [, initWithOptional] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(initWithOptional.body as string)).toEqual({
      title: '带标签',
      content: '内容',
      tags: 'gym, 力控',
      importance: 0.8,
    })
  })

  it('listKnowledge：GET /api/knowledge/entries，query/limit 进查询串', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await listKnowledge('owner-1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/knowledge/entries')
    expect(methodOf(init)).toBe('GET')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')

    await listKnowledge('owner-1', { query: 'gym', limit: 3 })
    const [urlWithParams] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(urlWithParams).toBe('/api/knowledge/entries?query=gym&limit=3')
  })

  it('searchKnowledge：关键词进 query 参数', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchKnowledge('owner-1', '力控', 3)

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/knowledge/entries?query=%E5%8A%9B%E6%8E%A7&limit=3')
  })

  it('deleteKnowledge：DELETE /api/knowledge/entries/{id}', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 204))
    vi.stubGlobal('fetch', fetchMock)

    await deleteKnowledge('owner-1', 7)

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/knowledge/entries/7')
    expect(init.method).toBe('DELETE')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')
  })
})
