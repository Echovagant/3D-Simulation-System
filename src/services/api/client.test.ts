import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError, apiRequest, isApiUnavailable } from './client'

/** 造一个只会说 JSON 的 Response 替身 */
const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

/** 造一个响应体不是 JSON 的 Response 替身（json() 直接抛解析异常） */
const brokenJsonResponse = (status = 502): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Bad Gateway',
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError('Unexpected token < in JSON at position 0')
    },
    text: async () => '<html>502 Bad Gateway</html>',
  }) as unknown as Response

/** 把请求失败时的异常抓出来，断言它的形状 */
const catchError = async (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => {
      throw new Error('这次请求本该失败，但它成功了')
    },
    (error: unknown) => error,
  )

describe('API 客户端', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('后端返回统一错误形状时，错误码、状态码与文案都按后端给的来', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'scene_not_found', message: '场景不存在：x', detail: null } },
        404,
      ),
    )

    const error = await catchError(apiRequest('/api/scenes/x'))

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.code).toBe('scene_not_found')
    expect(apiError.status).toBe(404)
    expect(apiError.message).toBe('场景不存在：x')
    expect(apiError.detail).toBeNull()
  })

  it('后端回了错误码不算「后端不在」——它好好地应答了', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'scene_exists', message: '场景已存在：x', detail: null } },
        409,
      ),
    )

    const error = await catchError(apiRequest('/api/scenes', { method: 'POST' }))

    expect(isApiUnavailable(error)).toBe(false)
  })

  it('代理层的上游错误（502/503/504）算「后端不在」', async () => {
    vi.stubGlobal('fetch', async () => brokenJsonResponse(502))

    const error = await catchError(apiRequest('/api/scenes'))

    expect(isApiUnavailable(error)).toBe(true)
  })

  it('网络层失败（fetch 直接 reject）能被识别成「后端不在」', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await catchError(apiRequest('/api/health'))

    expect(isApiUnavailable(error)).toBe(true)
    expect(error).not.toBeInstanceOf(ApiError)
  })

  it('超时被识别成「后端不在」', async () => {
    vi.useFakeTimers()
    vi.stubGlobal(
      'fetch',
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('This operation was aborted', 'AbortError'))
          })
        }),
    )

    const pending = catchError(apiRequest('/api/health'))
    await vi.advanceTimersByTimeAsync(9000)
    const error = await pending

    expect(isApiUnavailable(error)).toBe(true)
  })

  it('后端返回非 JSON 时抛的仍然是 ApiError，状态码取真实值', async () => {
    vi.stubGlobal('fetch', async () => brokenJsonResponse(500))

    const error = await catchError(apiRequest('/api/scenes'))

    expect(error).toBeInstanceOf(ApiError)
    const apiError = error as ApiError
    expect(apiError.status).toBe(500)
    expect(apiError.code).toBe('http_error')
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('状态码成功但响应体不是 JSON：算「后端不在」', async () => {
    // 纯静态部署时 /api/* 落到 SPA 回退，返回 index.html（200 + HTML）——
    // 应答的根本不是我们的后端。这种情况必须按「后端不在」降级，
    // 否则界面会一边显示「后端在线」一边甩一句「不是合法 JSON」。
    vi.stubGlobal('fetch', async () => brokenJsonResponse(200))

    const error = await catchError(apiRequest('/api/scenes'))

    const apiError = error as ApiError
    expect(apiError.status).toBe(200)
    expect(apiError.code).toBe('invalid_response')
    expect(isApiUnavailable(error)).toBe(true)
  })

  it('错误信封缺字段时退回通用错误码与文案', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ error: {} }, 404))

    const error = await catchError(apiRequest('/api/scenes/x'))
    const apiError = error as ApiError

    expect(apiError.code).toBe('http_error')
    expect(apiError.message).toBe('请求失败：HTTP 404')
    expect(apiError.detail).toBeNull()
  })

  it('成功时返回解析后的 JSON', async () => {
    vi.stubGlobal('fetch', async () => jsonResponse({ status: 'ok', version: '0.1.0' }))

    const result = await apiRequest<{ status: string; version: string }>('/api/health')

    expect(result).toEqual({ status: 'ok', version: '0.1.0' })
  })

  it('204 返回 undefined，不会去读不存在的响应体', async () => {
    const json = vi.fn(async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    })
    vi.stubGlobal(
      'fetch',
      async () =>
        ({
          ok: true,
          status: 204,
          statusText: 'No Content',
          headers: new Headers(),
          json,
          text: async () => '',
        }) as unknown as Response,
    )

    const result = await apiRequest('/api/scenes/x', { method: 'DELETE' })

    expect(result).toBeUndefined()
    expect(json).not.toHaveBeenCalled()
  })

  it('默认发 JSON 头，调用方可以通过 init.headers 覆盖', async () => {
    let captured: RequestInit | undefined
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      captured = init
      return jsonResponse({})
    })

    await apiRequest('/api/health')
    expect((captured?.headers as Headers).get('Content-Type')).toBe('application/json')

    await apiRequest('/api/health', { headers: { 'Content-Type': 'text/plain' } })
    expect((captured?.headers as Headers).get('Content-Type')).toBe('text/plain')
  })

  it('请求地址用 API_BASE 拼，且结尾不留斜杠', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({})
    })

    await apiRequest('/api/scenes')

    expect(API_BASE.endsWith('/')).toBe(false)
    expect(capturedUrl).toBe(`${API_BASE}/api/scenes`)
  })
})
