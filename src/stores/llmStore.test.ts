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

/** 后端用的 JSON 响应替身 */
const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

/** 后端用的 204 替身：真响应没有响应体，json() 必须不被调用 */
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

describe('LLM store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    for (const id of ['minimax', 'deepseek', 'anthropic']) clearApiKey(id)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
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

  it('冷却期内请求解释不会出网（烧钱的旁路必须被同一个闸门拦住）', async () => {
    vi.useFakeTimers()
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw new Error('network down')
    })

    // 先制造一次失败：失败即进入冷却期
    await store.requestExplanation(snapshot)
    expect(calls).toBe(1)
    expect(store.lastError).toContain('请求失败')

    // 冷却期内再点「解释」：必须拦下来，不许真的出网
    const text = await store.requestExplanation(snapshot)
    expect(calls).toBe(1)
    expect(text).toBe('')
    expect(store.explanation).toBe('')
    expect(store.lastError).toContain('冷却期')
    // 被拦下的请求不算一次调用
    expect(store.callCount).toBe(1)
  })

  it('冷却期内点「测试连接」也不会出网', async () => {
    vi.useFakeTimers()
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      throw new Error('network down')
    })

    expect(await store.testConnection()).toBe(false)
    expect(calls).toBe(1)

    // 冷却期内的连通性测试同样是重试：拦下来
    expect(await store.testConnection()).toBe(false)
    expect(calls).toBe(1)
    expect(store.lastError).toContain('冷却期')
  })

  it('冷却期过后恢复出网', async () => {
    vi.useFakeTimers()
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    let calls = 0
    vi.stubGlobal('fetch', async () => {
      calls += 1
      if (calls === 1) throw new Error('network down')
      return okResponse('冷却期过去了')
    })

    await store.requestExplanation(snapshot)
    expect(calls).toBe(1)

    await vi.advanceTimersByTimeAsync(llmConfig.cooldownMs + 100)
    const text = await store.requestExplanation(snapshot)

    expect(calls).toBe(2)
    expect(text).toContain('冷却期过去了')
    expect(store.lastError).toBe('')
  })
})

/**
 * 凭证类型与模型列表。
 *
 * ⚠️ 厂商常发好几种凭证，彼此不通用；模型能调哪些也跟凭证绑定。
 * 认错凭证类型 → 401 或「模型不存在」，报错完全指不到真正原因上。
 */
describe('LLM store · 凭证类型与模型列表', () => {
  /** 订阅 Key 的前缀样例（只测前缀识别，不是真 key） */
  const SUBSCRIPTION_KEY = 'sk-cp-example-value' // secret-scan: allow
  /** 按量计费 Key 的前缀样例 */
  const STANDARD_KEY = 'sk-api-example-value' // secret-scan: allow

  beforeEach(() => {
    setActivePinia(createPinia())
    for (const id of ['minimax', 'minimax-subscription', 'minimax-cn', 'minimax-cn-subscription']) {
      clearApiKey(id)
    }
  })

  it('认出订阅 Key 与按量计费 Key', () => {
    const store = useLlmStore()
    store.selectProvider('minimax-subscription')
    expect(store.detectKeyKind(SUBSCRIPTION_KEY)).toBe('subscription')
    expect(store.detectKeyKind(STANDARD_KEY)).toBe('standard')
  })

  it('认不出前缀时返回 null，不硬猜', () => {
    const store = useLlmStore()
    store.selectProvider('minimax-subscription')
    expect(store.detectKeyKind('some-other-credential')).toBeNull()
  })

  it('贴了另一种凭证时给出提示，而不是让它在调用时才报错', () => {
    const store = useLlmStore()
    store.selectProvider('minimax-subscription')
    store.applyKey(STANDARD_KEY)

    expect(store.keyKindMismatch).toContain('不通用')
  })

  it('凭证对得上时没有提示', () => {
    const store = useLlmStore()
    store.selectProvider('minimax-subscription')
    store.applyKey(SUBSCRIPTION_KEY)

    expect(store.keyKindMismatch).toBe('')
  })

  it('拉模型列表：拿到这把 key 能用的模型', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    const requested: string[] = []
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        requested.push(String(url))
        return {
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          json: async () => ({
            data: [{ id: 'model-a' }, { id: 'model-b' }],
          }),
          text: async () => '',
        } as unknown as Response
      }),
    )

    const ok = await store.loadModels()

    expect(ok).toBe(true)
    expect(store.availableModels).toEqual(['model-a', 'model-b'])
    expect(store.modelsError).toBe('')
    expect(requested[0]).toContain('/models')
  })

  it('拉模型列表失败时如实报错，不静默', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          headers: { get: () => null },
          json: async () => ({ error: { message: 'invalid api key' } }),
          text: async () => '{"error":{"message":"invalid api key"}}',
        }) as unknown as Response,
      ),
    )

    const ok = await store.loadModels()

    expect(ok).toBe(false)
    expect(store.availableModels).toEqual([])
    expect(store.modelsError).toContain('401')
  })

  it('换 key 之后上一次的模型列表作废', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        ({
          ok: true,
          status: 200,
          statusText: 'OK',
          headers: { get: () => null },
          json: async () => ({ data: [{ id: 'model-a' }] }),
          text: async () => '',
        }) as unknown as Response,
      ),
    )
    await store.loadModels()
    expect(store.availableModels).toHaveLength(1)

    store.applyKey('another-key')
    expect(store.availableModels).toEqual([])
  })

  it('前缀要按长度从长到短匹配：sk-sp- 不能被 sk- 抢走', () => {
    // ⚠️ 百炼的按量 key 是 `sk-` 开头、套餐 key 是 `sk-sp-` 开头——
    // 短的 `sk-` 正是长的 `sk-sp-` 的前缀。先匹配短的会把套餐 key 误判成按量 key。
    const store = useLlmStore()
    store.selectProvider('qwen')
    expect(store.detectKeyKind('sk-sp-example-value')).toBe('subscription') // secret-scan: allow
    expect(store.detectKeyKind('sk-example-value')).toBe('standard')
  })

  it('认不出前缀的厂商不硬猜（智谱两类 key 格式一样）', () => {
    const store = useLlmStore()
    store.selectProvider('zhipu-coding')
    expect(store.detectKeyKind('idpart.secretpart')).toBeNull()
    expect(store.keyKindMismatch).toBe('')
  })

  it('贴了别家厂商的 key 要说「贴错了厂商」，而不是「凭证类型不对」', () => {
    const store = useLlmStore()
    store.selectProvider('qwen')
    store.applyKey('sk-cp-example-value') // secret-scan: allow

    expect(store.keyFamilyMismatch).toContain('minimax')
    expect(store.keyKindMismatch).toBe('')
  })

  it('没有模型列表接口的接入线：不发请求，如实说明', async () => {
    const store = useLlmStore()
    store.selectProvider('qwen-coding')
    store.applyKey(FAKE_KEY)
    const mock = vi.fn()
    vi.stubGlobal('fetch', mock)

    const ok = await store.loadModels()

    expect(ok).toBe(false)
    expect(mock).not.toHaveBeenCalled()
    expect(store.modelsError).toContain('没有开放模型列表接口')
  })
})

/**
 * 托管模式：请求改走后端。
 *
 * ⚠️ 自带 Key 那条路的行为一个字都不能变——这些用例就是守着这条线的。
 */
describe('LLM store · 托管模式', () => {
  /** 一个"长得像密钥"的假 key——仓库里不允许出现真密钥 */
  const HOSTED_KEY = 'sk-hosted-secret-value' // secret-scan: allow

  /** 抓下来的一次请求 */
  interface Call {
    url: string
    method: string
    headers: Headers
    body: Record<string, unknown> | undefined
  }

  /**
   * 后端替身：密钥库、提交、删除、完成各走各的分支。
   *
   * @param options.keys 密钥库里各家配没配
   * @param options.complete 完成接口回什么
   */
  const backend = (options?: {
    keys?: Array<{ providerId: string; configured: boolean }>
    complete?: unknown
  }) => {
    const calls: Call[] = []
    let keys = options?.keys ?? [{ providerId: 'minimax', configured: true }]
    const mock = vi.fn(async (url: string, init?: RequestInit) => {
      const target = String(url)
      const method = init?.method ?? 'GET'
      calls.push({
        url: target,
        method,
        headers: new Headers(init?.headers),
        body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      })
      if (target.endsWith('/api/llm/keys')) {
        if (method === 'POST') {
          keys = [{ providerId: 'minimax', configured: true }]
          return jsonResponse({ providerId: 'minimax', configured: true }, 201)
        }
        return jsonResponse(keys)
      }
      if (target.endsWith('/api/llm/keys/minimax') && method === 'DELETE') {
        keys = []
        return emptyResponse(204)
      }
      if (target.endsWith('/api/llm/complete')) {
        return jsonResponse(
          options?.complete ?? {
            content: '{"action":"move","direction":[0,1],"speed":4}',
            providerId: 'minimax',
            model: 'MiniMax-M3.1-Flash',
          },
        )
      }
      return jsonResponse({}, 404)
    })
    return { calls, mock }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('默认是自带 Key 模式，托管通道不接管请求', async () => {
    const store = useLlmStore()
    const { calls, mock } = backend()
    vi.stubGlobal('fetch', mock)

    expect(store.hostingMode).toBe('direct')

    store.applyKey(FAKE_KEY)
    await store.requestAction(snapshot)

    // 直连厂商，不经过后端
    expect(calls.every((call) => !call.url.includes('/api/llm/'))).toBe(true)
  })

  it('自带 Key 模式：请求直接打厂商，不走后端', async () => {
    const store = useLlmStore()
    store.applyKey(FAKE_KEY)
    const urls: string[] = []
    vi.stubGlobal('fetch', async (url: string) => {
      urls.push(String(url))
      return okResponse('{"action":"move","direction":[0,1],"speed":4}')
    })

    const action = await store.requestAction(snapshot)

    expect(action?.action).toBe('move')
    expect(urls).toHaveLength(1)
    expect(urls[0]).toBe('https://api.minimax.io/v1/chat/completions')
    expect(urls[0]).not.toContain('/api/llm/')
  })

  it('托管模式：请求走后端，请求体是归一化形状', async () => {
    const store = useLlmStore()
    const { calls, mock } = backend()
    vi.stubGlobal('fetch', mock)

    await store.setHostingMode('hosted')
    expect(store.hostingMode).toBe('hosted')
    // 后端密钥库里 minimax 已配置 → 托管通道可用
    expect(store.configured).toBe(true)

    const action = await store.requestAction(snapshot)
    expect(action?.action).toBe('move')

    const complete = calls.find((call) => call.url.endsWith('/api/llm/complete'))
    expect(complete).toBeDefined()
    expect(complete?.method).toBe('POST')
    // 软身份必须带上，否则后端回 401
    expect(complete?.headers.get('X-Owner-Token')).toBe(store.ownerToken)
    // 归一化：只有这几个字段，不按协议拼
    expect(Object.keys(complete?.body ?? {}).sort()).toEqual([
      'maxTokens',
      'messages',
      'model',
      'providerId',
    ])
    expect(complete?.body?.providerId).toBe('minimax')
    expect(complete?.body?.model).toBe('MiniMax-M3.1-Flash')
    expect(complete?.body?.maxTokens).toBe(llmConfig.controllerMaxTokens)
    expect(Array.isArray(complete?.body?.messages)).toBe(true)
  })

  it('托管模式：当前厂商没存 key 时不指定厂商，让后端自己挑', async () => {
    const store = useLlmStore()
    const { calls, mock } = backend({
      keys: [{ providerId: 'deepseek', configured: true }],
    })
    vi.stubGlobal('fetch', mock)

    await store.setHostingMode('hosted')
    await store.requestAction(snapshot)

    const complete = calls.find((call) => call.url.endsWith('/api/llm/complete'))
    expect(complete?.body?.providerId).toBeUndefined()
    expect(complete?.body?.model).toBeUndefined()
  })

  it('ownerToken 会存进 localStorage，重新打开页面还是同一个', () => {
    const store = useLlmStore()
    const token = store.ownerToken

    expect(token).not.toBe('')
    expect(token).toMatch(/^[0-9a-f-]{36}$/i)
    expect(localStorage.getItem('llm-owner-token')).toBe(token)

    // 模拟刷新页面：新的 pinia、新的 store 实例
    setActivePinia(createPinia())
    const reopened = useLlmStore()
    expect(reopened.ownerToken).toBe(token)
  })

  it('托管模式：提交 key 后能查到配置状态，删掉后回到未配置', async () => {
    const store = useLlmStore()
    const { calls, mock } = backend({ keys: [] })
    vi.stubGlobal('fetch', mock)

    await store.setHostingMode('hosted')
    expect(store.hostedProviderConfigured).toBe(false)

    const ok = await store.submitHostedKey('minimax', HOSTED_KEY)
    expect(ok).toBe(true)
    expect(store.hostedProviderConfigured).toBe(true)
    expect(store.configured).toBe(true)

    const posted = calls.find((call) => call.method === 'POST')
    expect(posted?.headers.get('X-Owner-Token')).toBe(store.ownerToken)
    expect(posted?.body?.providerId).toBe('minimax')
    expect(posted?.body?.apiKey).toBe(HOSTED_KEY)

    const removed = await store.removeHostedKey('minimax')
    expect(removed).toBe(true)
    expect(store.hostedProviderConfigured).toBe(false)
  })

  it('托管模式：提交过的口令会跟着完成请求一起走（后端重启后能自愈）', async () => {
    const store = useLlmStore()
    const { calls, mock } = backend({ keys: [] })
    vi.stubGlobal('fetch', mock)

    await store.setHostingMode('hosted')
    await store.submitHostedKey('minimax', HOSTED_KEY, 'my-passphrase')

    const completed = await store.requestExplanation(snapshot)
    expect(completed).toBeTruthy()

    const call = calls.find((item) => item.url.endsWith('/api/llm/complete'))
    expect(call?.body?.passphrase).toBe('my-passphrase')
  })

  it('托管模式：后端连不上时安静降级，不抛异常', async () => {
    const store = useLlmStore()
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    await store.setHostingMode('hosted')

    expect(store.hostedAvailable).toBe(false)
    expect(store.hostedError).not.toBe('')

    const action = await store.requestAction(snapshot)
    expect(action).toBeNull()
    expect(store.configured).toBe(false)
  })

  it('托管模式：调用途中后端挂掉，降级但不抛异常', async () => {
    const store = useLlmStore()
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/api/llm/keys')) {
        return jsonResponse([{ providerId: 'minimax', configured: true }])
      }
      throw new TypeError('Failed to fetch')
    })

    await store.setHostingMode('hosted')
    expect(store.configured).toBe(true)

    const action = await store.requestAction(snapshot)
    expect(action).toBeNull()
    expect(store.hostedAvailable).toBe(false)
    expect(store.lastError).not.toBe('')
  })

  it('托管模式：后端回了配额错误时如实显示错误码对应的文案', async () => {
    const store = useLlmStore()
    vi.stubGlobal('fetch', async (url: string) => {
      if (String(url).endsWith('/api/llm/keys')) {
        return jsonResponse([{ providerId: 'minimax', configured: true }])
      }
      return jsonResponse(
        { error: { code: 'llm_quota_exceeded', message: '今日调用次数已用完', detail: null } },
        429,
      )
    })

    await store.setHostingMode('hosted')
    const action = await store.requestAction(snapshot)

    expect(action).toBeNull()
    expect(store.lastError).toContain('今日调用次数已用完')
    // 配额用满是业务错误，不是后端缺席：托管通道仍算可用
    expect(store.hostedAvailable).toBe(true)
  })
})
