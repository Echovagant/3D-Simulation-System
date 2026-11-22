import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  consolidateMemory,
  createMemory,
  deleteMemory,
  listMemories,
  searchMemories,
} from './memory'

/**
 * 记忆客户端的契约网：路径、方法、软身份头、请求体形状、错误信封。
 * 契约来源 backend/app/routers/memory.py，与 openapi.json 一致
 * （2026-11-23 全端点 curl 实查过真实响应）。
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

describe('memory 客户端', () => {
  it('createMemory：POST /api/memory，带 X-Owner-Token，importance 缺省不发', async () => {
    const item = { id: 1, kind: 'semantic', content: '事实', source: 'manual', importance: 0.5 }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(item, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createMemory('owner-1', { kind: 'semantic', content: '事实' })

    expect(result).toEqual(item)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/memory')
    expect(init.method).toBe('POST')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')
    expect(JSON.parse(init.body as string)).toEqual({ kind: 'semantic', content: '事实' })

    await createMemory('owner-1', { kind: 'procedural', content: '经验', importance: 0.8 })
    const [, initWithImportance] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(JSON.parse(initWithImportance.body as string)).toEqual({
      kind: 'procedural',
      content: '经验',
      importance: 0.8,
    })
  })

  it('listMemories：GET /api/memory，limit 进查询串，不带 query', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await listMemories('owner-1')

    expect(result).toEqual({ items: [] })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/memory')
    expect(methodOf(init)).toBe('GET')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')

    await listMemories('owner-1', { limit: 20 })
    const [urlWithLimit] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(urlWithLimit).toBe('/api/memory?limit=20')
  })

  it('searchMemories：GET /api/memory?query=关键词', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ items: [] }))
    vi.stubGlobal('fetch', fetchMock)

    await searchMemories('owner-1', '力上限')

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`/api/memory?query=${encodeURIComponent('力上限')}`)
  })

  it('deleteMemory：DELETE /api/memory/{id}，204 无响应体返回 undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 204))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteMemory('owner-1', 7)

    expect(result).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/memory/7')
    expect(methodOf(init)).toBe('DELETE')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')
  })

  it('consolidateMemory：POST /api/memory/consolidate，结果形状原样透传', async () => {
    const resultBody = {
      scannedLogs: 42,
      created: 1,
      updated: 2,
      patterns: [
        { sessionId: 'sess-1', errorCode: 'gym_force_out_of_range', occurrences: 3, memoryId: 9, action: 'updated' },
      ],
    }
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(resultBody))
    vi.stubGlobal('fetch', fetchMock)

    const result = await consolidateMemory('owner-1')

    expect(result).toEqual(resultBody)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/memory/consolidate')
    expect(init.method).toBe('POST')
  })

  it('404：错误信封解析成 ApiError，code 与 message 原样透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: { code: 'memory_not_found', message: '记忆不存在：999', detail: null },
          },
          404,
        ),
      ),
    )

    const error = await deleteMemory('owner-1', 999).catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(404)
    expect(apiError.code).toBe('memory_not_found')
    expect(apiError.message).toBe('记忆不存在：999')
  })
})
