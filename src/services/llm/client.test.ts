// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { callLlm } from './client'
import { clearApiKey, setApiKey } from './secret'
import { findProvider, type LlmProvider } from '@/config/llmProviders'

const provider = (id: string): LlmProvider => {
  const found = findProvider(id)
  if (!found) throw new Error(`没有这个提供商：${id}`)
  return found
}

/**
 * 一个"长得像密钥"的假 key——用来验证脱敏逻辑真的会把密钥抹掉。
 * 仓库里不允许出现真密钥，所以这行显式豁免（闸门：scripts/check-no-secrets.mjs）。
 */
const FAKE_KEY = 'sk-supersecretvalue123456' // secret-scan: allow

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

describe('LLM 客户端', () => {
  beforeEach(() => {
    for (const id of ['minimax', 'deepseek', 'anthropic', 'gemini']) clearApiKey(id)
  })

  it('没配 key 时直接返回，不发出任何请求', async () => {
    let called = false
    const result = await callLlm({
      provider: provider('minimax'),
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

  it('OpenAI 兼容：打对端点，带 Bearer 鉴权与 max_completion_tokens', async () => {
    setApiKey('minimax', 'test-key-for-unit-test')
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    let capturedBody: Record<string, unknown> = {}

    const result = await callLlm({
      provider: provider('minimax'),
      messages: [
        { role: 'system', content: '你是控制器' },
        { role: 'user', content: '你好' },
      ],
      fetchImpl: (async (url: string, init: RequestInit) => {
        capturedUrl = String(url)
        capturedInit = init
        capturedBody = JSON.parse(String(init.body))
        return jsonResponse({
          id: 'r1',
          choices: [{ message: { content: ' 你好 ' } }],
          usage: { prompt_tokens: 11, completion_tokens: 3 },
        })
      }) as unknown as typeof fetch,
    })

    expect(capturedUrl).toBe('https://api.minimax.io/v1/chat/completions')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer test-key-for-unit-test')
    expect(headers['Content-Type']).toBe('application/json')
    expect(capturedBody.max_completion_tokens).toBeTypeOf('number')
    expect(capturedBody.model).toBe('MiniMax-M3.1-Flash')
    // MiniMax 官方支持 reasoning_effort
    expect(capturedBody.reasoning_effort).toBe('low')
    // system 消息在 OpenAI 协议里就是消息列表里的一项
    expect((capturedBody.messages as Array<{ role: string }>)[0].role).toBe('system')

    expect(result.ok).toBe(true)
    expect(result.content).toBe('你好')
    expect(result.usage?.promptTokens).toBe(11)
  })

  it('OpenAI 兼容：模型与端点可以临时覆盖', async () => {
    setApiKey('deepseek', 'test-key')
    let capturedUrl = ''
    let capturedBody: Record<string, unknown> = {}

    await callLlm({
      provider: provider('deepseek'),
      model: 'my-own-model',
      baseUrl: 'https://proxy.example.com/v1/',
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: (async (url: string, init: RequestInit) => {
        capturedUrl = String(url)
        capturedBody = JSON.parse(String(init.body))
        return jsonResponse({ choices: [{ message: { content: 'ok' } }] })
      }) as unknown as typeof fetch,
    })

    expect(capturedUrl).toBe('https://proxy.example.com/v1/chat/completions')
    expect(capturedBody.model).toBe('my-own-model')
  })

  it('Anthropic 协议：system 是顶层字段，输出上限用 max_tokens，鉴权用 x-api-key', async () => {
    setApiKey('anthropic', 'test-key')
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    let capturedBody: Record<string, unknown> = {}

    const result = await callLlm({
      provider: provider('anthropic'),
      messages: [
        { role: 'system', content: '你是讲解员' },
        { role: 'user', content: '为什么转向？' },
      ],
      fetchImpl: (async (url: string, init: RequestInit) => {
        capturedUrl = String(url)
        capturedInit = init
        capturedBody = JSON.parse(String(init.body))
        return jsonResponse({ content: [{ type: 'text', text: '因为前面有箱子。' }] })
      }) as unknown as typeof fetch,
    })

    expect(capturedUrl).toBe('https://api.anthropic.com/v1/messages')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['x-api-key']).toBe('test-key')
    expect(headers['anthropic-version']).toBe('2023-06-01')
    expect(headers.Authorization).toBeUndefined()
    expect(capturedBody.system).toBe('你是讲解员')
    expect(capturedBody.max_tokens).toBeTypeOf('number')
    expect(capturedBody.max_completion_tokens).toBeUndefined()
    expect(capturedBody.messages).toEqual([{ role: 'user', content: '为什么转向？' }])

    expect(result.content).toBe('因为前面有箱子。')
  })

  it('Gemini 协议：走 interactions 端点，鉴权用 x-goog-api-key', async () => {
    setApiKey('gemini', 'test-key')
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    let capturedBody: Record<string, unknown> = {}

    const result = await callLlm({
      provider: provider('gemini'),
      messages: [
        { role: 'system', content: '你是讲解员' },
        { role: 'user', content: '为什么转向？' },
      ],
      fetchImpl: (async (url: string, init: RequestInit) => {
        capturedUrl = String(url)
        capturedInit = init
        capturedBody = JSON.parse(String(init.body))
        return jsonResponse({ output_text: '因为前面有箱子。' })
      }) as unknown as typeof fetch,
    })

    expect(capturedUrl).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    const headers = capturedInit?.headers as Record<string, string>
    expect(headers['x-goog-api-key']).toBe('test-key')
    expect(capturedBody.system_instruction).toBe('你是讲解员')
    expect(capturedBody.input).toContain('为什么转向？')
    expect(capturedBody.generation_config).toEqual({ thinking_level: 'low' })

    expect(result.content).toBe('因为前面有箱子。')
  })

  it('HTTP 失败时返回脱敏后的错误，不会把 key 抖出来', async () => {
    setApiKey('minimax', FAKE_KEY)
    const result = await callLlm({
      provider: provider('minimax'),
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
    setApiKey('minimax', 'test-key')
    const result = await callLlm({
      provider: provider('minimax'),
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
    setApiKey('minimax', 'test-key')
    const result = await callLlm({
      provider: provider('minimax'),
      messages: [{ role: 'user', content: 'hi' }],
      fetchImpl: (async () => {
        throw new Error('network down')
      }) as unknown as typeof fetch,
    })

    expect(result.ok).toBe(false)
    expect(result.error).toContain('请求失败')
  })
})
