// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { callLlm } from './client'
import { clearApiKey, setApiKey } from './secret'

/** 造一个最小可用的 Response 替身 */
const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

const textResponse = (text: string, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Error',
    headers: { get: () => null },
    json: async () => JSON.parse(text),
    text: async () => text,
  }) as unknown as Response

/**
 * 一个"长得像密钥"的假 key——用来验证脱敏逻辑真的会把密钥抹掉。
 * 仓库里不允许出现真密钥，所以这行显式豁免（闸门：scripts/check-no-secrets.mjs）。
 */
const FAKE_KEY = 'sk-supersecretvalue123456' // secret-scan: allow

describe('LLM 客户端', () => {
  beforeEach(() => {
    clearApiKey()
  })

  it('没配 key 时直接返回，不发出任何请求', async () => {
    let called = false
    const result = await callLlm({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: (async () => {
        called = true
        return jsonResponse({})
      }) as unknown as typeof fetch,
    })

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('未配置')
  })

  it('请求打对官方端点，带上 Bearer 鉴权与官方要求的字段', async () => {
    setApiKey('test-key-for-unit-test')
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    let capturedBody: Record<string, unknown> = {}

    const result = await callLlm({
      messages: [{ role: 'user', content: '你好' }],
      fetchImpl: (async (url: string, init: RequestInit) => {
        capturedUrl = String(url)
        capturedInit = init
        capturedBody = JSON.parse(String(init.body))
        return jsonResponse({
          id: 'req-1',
          choices: [{ message: { content: ' 你好 ' } }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        })
      }) as unknown as typeof fetch,
    })

    expect(capturedUrl).toBe('https://api.minimax.io/v1/chat/completions')
    expect(capturedUrl.endsWith('/chat/completions')).toBe(true)
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-key-for-unit-test')
    expect(headers['Content-Type']).toBe('application/json')
    // 官方接口用 max_completion_tokens，thinking 关不掉，只能给 reasoning_effort
    expect(capturedBody.max_completion_tokens).toBeTypeOf('number')
    expect(capturedBody.reasoning_effort).toBeTypeOf('string')
    expect(capturedBody.thinking).toBeUndefined()
    expect(capturedBody.model).toBeTypeOf('string')

    expect(result.ok).toBe(true)
    expect(result.content).toBe('你好')
    expect(result.usage?.promptTokens).toBe(11)
  })

  it('HTTP 失败时返回脱敏后的错误，不会把 key 抖出来', async () => {
    setApiKey(FAKE_KEY)
    const result = await callLlm({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: (async () =>
        textResponse(
          JSON.stringify({
            type: 'error',
            error: {
              type: 'authorized_error',
              message: `login fail: bad key ${FAKE_KEY}`,
              http_code: 401,
            },
          }),
          401,
        )) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('401')
    expect(result.error).not.toContain(FAKE_KEY)
    expect(result.error).toContain('sk-***')
  })

  it('请求超时会返回超时原因，而不是抛异常', async () => {
    setApiKey('test-key')
    const result = await callLlm({
      messages: [{ role: 'user', content: 'hi' }],
      timeoutMs: 20,
      fetchImpl: ((_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'))
          })
        })) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('超时')
  })

  it('网络异常被吞成结果对象，不会把整页炸掉', async () => {
    setApiKey('test-key')
    const result = await callLlm({
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: (async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('请求失败')
  })
})
