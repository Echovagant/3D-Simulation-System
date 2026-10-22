import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError, isApiUnavailable } from './client'
import {
  completeLlm,
  deleteLlmKey,
  getLlmQuota,
  listLlmAudit,
  listLlmKeys,
  saveLlmKey,
} from './llm'

/** 软身份 token：不是密码，只是后端给配额、审计与密钥库分区用的归属键 */
const TOKEN = 'owner-token-abc'

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

/** 造一个 204 替身：真响应没有响应体，json() 必须不被调用 */
const emptyResponse = (status = 204): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'No Content',
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    },
    text: async () => '',
  }) as unknown as Response

/** 抓一次请求：地址、方法、头与体 */
interface Captured {
  url: string
  method: string
  headers: Headers
  body: unknown
}

const capture = (response: Response): { captured: Captured; mock: ReturnType<typeof vi.fn> } => {
  const captured: Captured = { url: '', method: '', headers: new Headers(), body: undefined }
  const mock = vi.fn(async (url: string, init?: RequestInit) => {
    captured.url = String(url)
    captured.method = init?.method ?? 'GET'
    captured.headers = new Headers(init?.headers)
    captured.body = init?.body ? JSON.parse(String(init.body)) : undefined
    return response
  })
  return { captured, mock }
}

describe('LLM 托管接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('列出密钥库：GET /api/llm/keys，带上软身份头', async () => {
    const { captured, mock } = capture(
      jsonResponse([
        { providerId: 'minimax', configured: true, updatedAt: '2026-10-23T00:00:00Z' },
        { providerId: 'deepseek', configured: false, updatedAt: null },
      ]),
    )
    vi.stubGlobal('fetch', mock)

    const keys = await listLlmKeys(TOKEN)

    expect(captured.url).toBe(`${API_BASE}/api/llm/keys`)
    expect(captured.method).toBe('GET')
    expect(captured.headers.get('X-Owner-Token')).toBe(TOKEN)
    expect(keys).toHaveLength(2)
    expect(keys[0].providerId).toBe('minimax')
    expect(keys[0].configured).toBe(true)
    expect(keys[1].configured).toBe(false)
  })

  it('提交 key：POST /api/llm/keys，请求体只有 providerId 与 apiKey', async () => {
    const { captured, mock } = capture(
      jsonResponse({ providerId: 'minimax', configured: true }, 201),
    )
    vi.stubGlobal('fetch', mock)

    const receipt = await saveLlmKey(TOKEN, { providerId: 'minimax', apiKey: 'sk-test-key' })

    expect(captured.url).toBe(`${API_BASE}/api/llm/keys`)
    expect(captured.method).toBe('POST')
    expect(captured.headers.get('X-Owner-Token')).toBe(TOKEN)
    expect(captured.body).toEqual({ providerId: 'minimax', apiKey: 'sk-test-key' })
    expect(receipt.configured).toBe(true)
  })

  it('提交 key 时给了口令才带上 passphrase', async () => {
    const { captured, mock } = capture(
      jsonResponse({ providerId: 'minimax', configured: true }, 201),
    )
    vi.stubGlobal('fetch', mock)

    await saveLlmKey(TOKEN, { providerId: 'minimax', apiKey: 'sk-test-key', passphrase: '口令' })

    expect(captured.body).toEqual({
      providerId: 'minimax',
      apiKey: 'sk-test-key',
      passphrase: '口令',
    })
  })

  it('删除 key：DELETE /api/llm/keys/{providerId}，204 不抛错且没有请求体', async () => {
    const { captured, mock } = capture(emptyResponse(204))
    vi.stubGlobal('fetch', mock)

    await expect(deleteLlmKey(TOKEN, 'minimax')).resolves.toBeUndefined()

    expect(captured.url).toBe(`${API_BASE}/api/llm/keys/minimax`)
    expect(captured.method).toBe('DELETE')
    expect(captured.headers.get('X-Owner-Token')).toBe(TOKEN)
    expect(captured.body).toBeUndefined()
  })

  it('删除 key 时厂商 id 会做 URL 编码', async () => {
    const { captured, mock } = capture(emptyResponse(204))
    vi.stubGlobal('fetch', mock)

    await deleteLlmKey(TOKEN, 'a b/c')

    expect(captured.url).toBe(`${API_BASE}/api/llm/keys/a%20b%2Fc`)
  })

  it('完成一次调用：POST /api/llm/complete，请求体是归一化形状', async () => {
    const { captured, mock } = capture(
      jsonResponse({
        content: '好的',
        providerId: 'minimax',
        model: 'MiniMax-M3.1-Flash',
        usage: { promptTokens: 12, completionTokens: 3 },
      }),
    )
    vi.stubGlobal('fetch', mock)

    const result = await completeLlm(TOKEN, {
      providerId: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      messages: [
        { role: 'system', content: '你是控制器' },
        { role: 'user', content: '往前走' },
      ],
      maxTokens: 256,
    })

    expect(captured.url).toBe(`${API_BASE}/api/llm/complete`)
    expect(captured.method).toBe('POST')
    expect(captured.headers.get('X-Owner-Token')).toBe(TOKEN)
    expect(captured.body).toEqual({
      providerId: 'minimax',
      model: 'MiniMax-M3.1-Flash',
      messages: [
        { role: 'system', content: '你是控制器' },
        { role: 'user', content: '往前走' },
      ],
      maxTokens: 256,
    })
    expect(result.content).toBe('好的')
    expect(result.providerId).toBe('minimax')
    expect(result.model).toBe('MiniMax-M3.1-Flash')
    expect(result.usage?.promptTokens).toBe(12)
  })

  it('不指定厂商与模型时，请求体里就不该有这两个字段', async () => {
    const { captured, mock } = capture(
      jsonResponse({ content: '好的', providerId: 'deepseek', model: 'deepseek-flash' }),
    )
    vi.stubGlobal('fetch', mock)

    await completeLlm(TOKEN, { messages: [{ role: 'user', content: '往前走' }] })

    expect(captured.body).toEqual({ messages: [{ role: 'user', content: '往前走' }] })
  })

  it('读配额：GET /api/llm/quota', async () => {
    const { captured, mock } = capture(
      jsonResponse({ limit: 100, used: 3, remaining: 97, resetAt: '2026-10-24T00:00:00Z' }),
    )
    vi.stubGlobal('fetch', mock)

    const quota = await getLlmQuota(TOKEN)

    expect(captured.url).toBe(`${API_BASE}/api/llm/quota`)
    expect(captured.headers.get('X-Owner-Token')).toBe(TOKEN)
    expect(quota.limit).toBe(100)
    expect(quota.used).toBe(3)
    expect(quota.remaining).toBe(97)
  })

  it('读审计：GET /api/llm/audit', async () => {
    const { captured, mock } = capture(
      jsonResponse({
        calls: [
          {
            ts: '2026-10-23T01:02:03Z',
            providerId: 'minimax',
            model: 'MiniMax-M3.1-Flash',
            ok: true,
            latencyMs: 812,
            tokens: 42,
          },
        ],
      }),
    )
    vi.stubGlobal('fetch', mock)

    const audit = await listLlmAudit(TOKEN)

    expect(captured.url).toBe(`${API_BASE}/api/llm/audit`)
    expect(captured.headers.get('X-Owner-Token')).toBe(TOKEN)
    expect(audit.calls).toHaveLength(1)
    expect(audit.calls[0].providerId).toBe('minimax')
    expect(audit.calls[0].ok).toBe(true)
  })

  it('后端回了错误码时抛 ApiError，错误码与状态码都如实带出', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'llm_quota_exceeded',
            message: '今日调用次数已用完',
            detail: { limit: 100, used: 100 },
          },
        },
        429,
      ),
    )

    const error = await completeLlm(TOKEN, {
      messages: [{ role: 'user', content: '往前走' }],
    }).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('llm_quota_exceeded')
    expect((error as ApiError).status).toBe(429)
    // 配额用满是业务错误，不是「后端不在」——不该触发降级
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('该厂商没存 key 时抛 llm_key_missing（404）', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'llm_key_missing', message: '该厂商没有托管的 key', detail: null } },
        404,
      ),
    )

    const error = await listLlmKeys(TOKEN).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('llm_key_missing')
    expect((error as ApiError).status).toBe(404)
  })

  it('后端连不上时错误原样抛出，且能被判定为「后端不在」', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await getLlmQuota(TOKEN).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(TypeError)
    expect(isApiUnavailable(error)).toBe(true)
  })
})
