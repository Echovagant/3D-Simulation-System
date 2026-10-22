// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useLlmStore } from './llmStore'
import { clearApiKey, hasApiKey } from '@/services/llm/secret'
import { llmConfig } from '@/config/llm'
import type { AgentSnapshot } from '@/services/llm/prompts'

/**
 * 一个"长得像密钥"的假 key——只用来验证它不会进响应式状态。
 * 仓库里不允许出现真密钥，所以这行显式豁免（闸门：scripts/check-no-secrets.mjs）。
 */
const FAKE_KEY = 'sk-secret-value-123456' // secret-scan: allow

const snapshot: AgentSnapshot = {
  id: 'agent-1',
  name: '导航机器人',
  type: 'basic',
  position: [0, 0.4, 0],
  velocity: [0, 0, 0],
  goalDirection: [0, 1],
  goal: [0, 0.4, 10],
  nearestObstacleDistance: 100,
  obstaclesInRange: 0,
  awarenessRange: 10,
  maxSpeed: 8,
  collided: false,
}

const okResponse = (content: string) =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ choices: [{ message: { content } }] }),
    text: async () => '',
  }) as unknown as Response

describe('LLM store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const id of ['minimax', 'deepseek', 'anthropic']) clearApiKey(id)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('key 只进内存，不出现在 store 的状态里', () => {
    const store = useLlmStore()
    expect(store.configured).toBe(false)

    store.applyKey(FAKE_KEY)

    expect(store.configured).toBe(true)
    expect(hasApiKey(store.providerId)).toBe(true)
    // ⚠️ 整个状态序列化一遍都不该出现 key——它不在响应式里
    expect(JSON.stringify(store.$state)).not.toContain(FAKE_KEY)
    expect(Object.keys(store.$state)).not.toContain('apiKey')
  })

  it('切换提供商：换 key 槽位，也载入它自己的默认模型与端点', () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    expect(store.model).toBe('MiniMax-M3.1-Flash')

    store.selectProvider('deepseek')
    expect(store.configured).toBe(false)
    expect(store.model).toBe('deepseek-flash')
    expect(store.baseUrl).toBe('https://api.deepseek.com')

    // 上一家的 key 还在槽位里，切回来还能用
    store.selectProvider('minimax')
    expect(store.configured).toBe(true)
  })

  it('模型与端点可以按提供商分别覆盖', () => {
    const store = useLlmStore()
    store.setModel('my-model')
    store.setBaseUrl('https://proxy.example.com/v1/')

    expect(store.model).toBe('my-model')
    expect(store.baseUrl).toBe('https://proxy.example.com/v1')

    store.selectProvider('deepseek')
    expect(store.model).toBe('deepseek-flash')
    store.selectProvider('minimax')
    expect(store.model).toBe('my-model')
  })

  it('清除 key 后状态回到未配置', () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    store.clearKey()
    expect(store.configured).toBe(false)
    expect(hasApiKey(store.providerId)).toBe(false)
  })

  it('没配 key 时请求动作直接失败，不会出网', async () => {
    const store = useLlmStore()
    let called = false
    vi.stubGlobal('fetch', async () => {
      called = true
      return okResponse('{}')
    })

    const action = await store.requestAction(snapshot)
    expect(action).toBeNull()
    expect(called).toBe(false)
    expect(store.lastError).toContain('未配置')
  })

  it('模型返回可用动作时能解析出来', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal('fetch', async () => okResponse('{"action":"move","direction":[0,1],"speed":4}'))

    const action = await store.requestAction(snapshot)
    expect(action?.action).toBe('move')
    expect(action?.speed).toBe(4)
    expect(store.callCount).toBe(1)
    expect(store.degraded).toBe(false)
  })

  it('模型返回无法解析的内容时返回 null（调用方回落规则式）', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal('fetch', async () => okResponse('我想让它往前走。'))

    const action = await store.requestAction(snapshot)
    expect(action).toBeNull()
    expect(store.lastError).toContain('无法解析')
  })

  it('超过调用上限后不再发请求', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      return okResponse('{"action":"wait"}')
    })

    for (let i = 0; i < llmConfig.maxCallsPerSession; i += 1) {
      await store.requestAction(snapshot)
    }
    expect(calls).toBe(llmConfig.maxCallsPerSession)

    const action = await store.requestAction(snapshot)
    expect(action).toBeNull()
    expect(calls).toBe(llmConfig.maxCallsPerSession)
    expect(store.lastError).toContain('上限')
  })

  it('调用失败会记下错误并进入降级状态', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })

    const action = await store.requestAction(snapshot)
    expect(action).toBeNull()
    expect(store.lastError).toContain('请求失败')
    store.markDegraded('已回落到规则式')
    expect(store.degraded).toBe(true)
  })

  it('解释请求成功时把文本放进 explanation', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal('fetch', async () => okResponse('因为前方有箱子挡路，所以它往右绕。'))

    const text = await store.requestExplanation(snapshot)
    expect(text).toContain('箱子')
    expect(store.explanation).toContain('箱子')
    expect(store.explaining).toBe(false)
  })

  it('并发的解释请求共享同一次请求，不会拿到上一次的旧解释', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      await new Promise((resolve) => setTimeout(resolve, 0))
      return okResponse('这一次的新解释')
    })

    const first = store.requestExplanation(snapshot)
    const second = store.requestExplanation(snapshot)
    const [a, b] = await Promise.all([first, second])

    expect(calls).toBe(1)
    expect(a).toContain('这一次的新解释')
    expect(b).toContain('这一次的新解释')
    expect(store.explanation).toContain('这一次的新解释')
    expect(store.explaining).toBe(false)
  })

  it('换了提供商之后，在途解释的结果不会再写进状态', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal('fetch', async () => {
      await new Promise((resolve) => setTimeout(resolve, 0))
      return okResponse('上一家厂商的解释')
    })

    const pending = store.requestExplanation(snapshot)
    store.selectProvider('deepseek')
    const text = await pending

    expect(text).toBe('')
    expect(store.explanation).toBe('')
    expect(store.explaining).toBe(false)
  })

  it('换了提供商之后，在途解释的失败不会覆盖 lastError', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal('fetch', async () => {
      throw new Error('network down')
    })

    const pending = store.requestExplanation(snapshot)
    store.selectProvider('deepseek')
    store.setError('当前提供商这边的问题')
    await pending

    expect(store.lastError).toBe('当前提供商这边的问题')
  })

  it('冷却期内回落到规则式时，会说清还在冷却期', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw new Error('network down')
    })

    const first = await store.requestAction(snapshot)
    expect(first).toBeNull()
    expect(store.lastError).toContain('请求失败')
    expect(calls).toBe(1)

    // 失败后进入冷却期：这一次必须给出原因，而不是静默回落
    const second = await store.requestAction(snapshot)
    expect(second).toBeNull()
    expect(calls).toBe(1)
    expect(store.lastError).toContain('冷却期')
    expect(store.lastError).toContain('规则式')
    expect(store.lastError).toMatch(/还需 \d+ 秒/)
  })
})
