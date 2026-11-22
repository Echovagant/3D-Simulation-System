import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './client'
import {
  createGymSession,
  deleteGymSession,
  listGymLogs,
  listGymSessions,
  resetGymSession,
  stepGymSession,
} from './gymWorkbench'

/**
 * Gym 会话客户端的契约网：路径、方法、软身份头、请求体形状、错误信封。
 * 契约来源 backend/app/routers/gym.py，与 openapi.json 一致。
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

describe('gymWorkbench 客户端', () => {
  it('createGymSession：POST /api/gym/sessions，带 X-Owner-Token，可选字段缺省不发', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ sessionId: 's1' }, 201))
    vi.stubGlobal('fetch', fetchMock)

    const result = await createGymSession('owner-1', {
      scene: { objects: [{}] },
      target: { x: 3, z: 0 },
    })

    expect(result).toEqual({ sessionId: 's1' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/gym/sessions')
    expect(init.method).toBe('POST')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')
    const body = JSON.parse(init.body as string) as Record<string, unknown>
    expect(body).toEqual({ scene: { objects: [{}] }, target: { x: 3, z: 0 } })
  })

  it('listGymSessions：GET /api/gym/sessions', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await listGymSessions('owner-1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/gym/sessions')
    expect(methodOf(init)).toBe('GET')
    expect(headerOf(init, 'X-Owner-Token')).toBe('owner-1')
  })

  it('stepGymSession：POST …/step，请求体只有 forceX/forceZ', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ reward: 0.1 }))
    vi.stubGlobal('fetch', fetchMock)

    await stepGymSession('owner-1', 'sess 1', { forceX: 5, forceZ: -2 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    // sessionId 要编码，特殊字符不能把路径拆坏
    expect(url).toBe('/api/gym/sessions/sess%201/step')
    expect(methodOf(init)).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({ forceX: 5, forceZ: -2 })
  })

  it('step 422：错误信封解析成 ApiError，code 与 message（修复指令）原样透传', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'gym_force_out_of_range',
              message: '力上限 = 30 × 质量 1.00kg = 30.00N，收到 999.00N，请减小',
              detail: null,
            },
          },
          422,
        ),
      ),
    )

    const error = await stepGymSession('owner-1', 's1', { forceX: 999, forceZ: 0 }).catch(
      (e: unknown) => e,
    )

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(422)
    expect(apiError.code).toBe('gym_force_out_of_range')
    expect(apiError.message).toBe('力上限 = 30 × 质量 1.00kg = 30.00N，收到 999.00N，请减小')
  })

  it('resetGymSession：POST …/reset', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ reward: 0 }))
    vi.stubGlobal('fetch', fetchMock)

    await resetGymSession('owner-1', 's1')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/gym/sessions/s1/reset')
    expect(methodOf(init)).toBe('POST')
  })

  it('listGymLogs：GET …/logs，round/limit 进查询串', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    await listGymLogs('owner-1', 's1', { round: 2, limit: 50 })

    const [url] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/gym/sessions/s1/logs?round=2&limit=50')

    await listGymLogs('owner-1', 's1')
    const [urlNoQuery] = fetchMock.mock.calls[1] as [string, RequestInit]
    expect(urlNoQuery).toBe('/api/gym/sessions/s1/logs')
  })

  it('deleteGymSession：DELETE …/{id}，204 无响应体返回 undefined', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(null, 204))
    vi.stubGlobal('fetch', fetchMock)

    const result = await deleteGymSession('owner-1', 's1')

    expect(result).toBeUndefined()
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/gym/sessions/s1')
    expect(methodOf(init)).toBe('DELETE')
  })
})
