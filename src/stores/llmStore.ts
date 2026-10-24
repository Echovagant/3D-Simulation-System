import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { llmConfig } from '@/config/llm'
import { findProvider, llmProviders, type LlmProvider } from '@/config/llmProviders'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import {
  completeLlm,
  deleteLlmKey,
  getLlmQuota,
  listLlmAudit,
  listLlmKeys,
  saveLlmKey,
  type LlmAudit,
  type LlmKeyStatus,
  type LlmQuota,
} from '@/services/api/llm'
import { callLlm, fetchModels } from '@/services/llm/client'
import {
  buildDecisionMessages,
  buildExplainMessages,
  parseLlmAction,
  type AgentSnapshot,
  type LlmAction,
} from '@/services/llm/prompts'
import { clearApiKey, getApiKey, hasApiKey, redactSecrets, setApiKey } from '@/services/llm/secret'

/** 控制器模式：规则式（默认，不出网）还是 LLM */
export type LlmControllerMode = 'rule' | 'llm'

/**
 * 密钥托管模式。
 *
 * - `direct`（默认）：自带 Key——key 只在浏览器内存里，请求直接打厂商
 * - `hosted`：托管——key 存在服务端加密保管，请求改走后端（配额、审计、故障转移在后端做）
 *
 * ⚠️ 两种模式并存，用户自己选；`direct` 的既有行为一个字都不能改。
 */
export type LlmHostingMode = 'direct' | 'hosted'

/** owner token 在 localStorage 里的键名 */
const OWNER_TOKEN_KEY = 'llm-owner-token'

/** 生成一个软身份 token */
const createOwnerToken = (): string => {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  // 极老的环境没有 randomUUID：软身份不需要密码学强度，但要**稳定**
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/**
 * 取（或生成）软身份 token。
 *
 * ⚠️ 它不是密码：只用来给后端的配额、审计与密钥库分区。
 * 但它必须**稳定**——刷新页面后还是同一个，否则后端会当成换了个人，
 * 之前存在服务端的 key 就再也找不回来了。
 */
const resolveOwnerToken = (): string => {
  let stored: string | null = null
  try {
    stored = globalThis.localStorage?.getItem(OWNER_TOKEN_KEY) ?? null
  } catch {
    // 隐私模式下 localStorage 可能直接抛错：退化成"本次会话一个新身份"
  }
  if (stored) return stored
  const created = createOwnerToken()
  try {
    globalThis.localStorage?.setItem(OWNER_TOKEN_KEY, created)
  } catch {
    // 存不进去就算了：本次会话内至少还能用同一个 token
  }
  return created
}

/** 把异常翻译成一句能直接显示的话（脱敏，不泄露内部细节） */
const describeError = (error: unknown, fallback: string): string => {
  if (isApiUnavailable(error)) return fallback
  if (error instanceof ApiError) return redactSecrets(error.message || fallback)
  if (error instanceof Error && error.message) return redactSecrets(error.message)
  return fallback
}

/**
 * LLM 接入状态。
 *
 * ⚠️ 这里**没有** API key 字段：key 放在 `services/llm/secret.ts` 的模块作用域里，
 * 刻意不进响应式（否则 DevTools 会把它整个列出来）。本 store 只暴露"配没配"这个布尔值。
 */
export const useLlmStore = defineStore('llm', () => {
  /** 当前选中的提供商 id */
  const providerId = ref(llmProviders[0].id)
  /** 每个提供商的模型 id 覆盖（没覆盖就用清单里的默认值） */
  const modelOverrides = ref<Record<string, string>>({})
  /** 每个提供商的 base_url 覆盖 */
  const baseUrlOverrides = ref<Record<string, string>>({})
  /** 当前提供商是否已配置 API key */
  const configured = ref(false)
  /** 决策来源 */
  const mode = ref<LlmControllerMode>('rule')
  /** 最近一次解释 */
  const explanation = ref('')
  /** 解释请求进行中 */
  const explaining = ref(false)
  /** 最近一次错误（已脱敏） */
  const lastError = ref('')
  /** LLM 控制器是否已降级回规则式 */
  const degraded = ref(false)
  /** 本次会话已发出的 LLM 调用次数 */
  const callCount = ref(0)
  /** 上一次调用的时间戳（毫秒） */
  const lastCallAt = ref(0)
  /** 密钥托管模式：自带 Key（默认）还是服务端托管 */
  const hostingMode = ref<LlmHostingMode>('direct')
  /** 软身份 token：后端靠它给配额、审计与密钥库分区 */
  const ownerToken = ref<string>(resolveOwnerToken())
  /** 服务端密钥库里各厂商的配置状态（只有「配没配」，没有明文） */
  const hostedKeys = ref<LlmKeyStatus[]>([])
  /** 托管通道是否可用：后端缺席时为 false，界面安静降级 */
  const hostedAvailable = ref(true)
  /** 托管通道上一次失败的原因（已脱敏） */
  const hostedError = ref('')
  /** 今日配额 */
  const quota = ref<LlmQuota | null>(null)
  /** 最近一次调用审计 */
  const audit = ref<LlmAudit | null>(null)
  /** 上一次托管调用实际由哪家厂商答上（后端可能故障转移过） */
  const lastHostedProvider = ref('')
  /**
   * 托管模式的口令（只留在内存里，不持久化）。
   *
   * 后端把派生出来的密钥缓存在自己内存里；服务器一重启，缓存就没了，
   * 这时后端要靠口令重新派生。留着它，托管模式就能自己恢复，
   * 不用用户重新提交一遍 key。
   */
  const hostedPassphrase = ref('')

  /** 冷却截止时间戳：失败后这段时间内不再重试 */
  let cooldownUntil = 0
  /** 托管通道自己的冷却：别让后端的故障拖累自带 Key 那条路 */
  let hostedCooldownUntil = 0
  /** 解释请求的序号：只有序号最新的那次请求才允许写状态 */
  let explainSeq = 0
  /** 在途的解释请求：并发调用共享它，不重复发请求 */
  let explainPending: { promise: Promise<string>; seq: number } | null = null

  /** 当前提供商 */
  const provider = computed<LlmProvider>(() => findProvider(providerId.value) ?? llmProviders[0])
  /** 当前使用的模型 id */
  const model = computed<string>(
    () => modelOverrides.value[providerId.value] ?? provider.value.model,
  )
  /** 当前使用的 base_url */
  const baseUrl = computed<string>(
    () => baseUrlOverrides.value[providerId.value] ?? provider.value.baseUrl,
  )
  /** 服务端是否至少有一家配了 key（托管通道能不能用） */
  const hostedAnyConfigured = computed<boolean>(() =>
    hostedKeys.value.some((item) => item.configured),
  )
  /** 当前选中的厂商在服务端有没有 key */
  const hostedProviderConfigured = computed<boolean>(() =>
    hostedKeys.value.some((item) => item.providerId === providerId.value && item.configured),
  )
  /** 当前模式生效的冷却截止时间：两种模式各算各的 */
  const currentCooldownUntil = (): number =>
    hostingMode.value === 'hosted' ? hostedCooldownUntil : cooldownUntil

  const syncConfigured = (): void => {
    configured.value =
      hostingMode.value === 'hosted' ? hostedAnyConfigured.value : hasApiKey(providerId.value)
  }

  /** 切换提供商：换 key 槽位，也载入它自己的默认模型与端点 */
  const selectProvider = (id: string): void => {
    if (!findProvider(id)) return
    // 换厂商了：在途的解释属于上一家，回来时不能再写进状态
    invalidateExplanation()
    providerId.value = id
    syncConfigured()
    lastError.value = ''
  }

  /** 改模型 id（模型迭代很快、还常常与账号绑定，所以让它可以随手改） */
  const setModel = (value: string): void => {
    modelOverrides.value = { ...modelOverrides.value, [providerId.value]: value.trim() }
  }

  /** 改 base_url（换代理网关、自建服务时用得到） */
  const setBaseUrl = (value: string): void => {
    baseUrlOverrides.value = {
      ...baseUrlOverrides.value,
      [providerId.value]: value.trim().replace(/\/+$/, ''),
    }
  }

  /** 写入 key（只进内存，按提供商分槽） */
  const applyKey = (value: string): void => {
    setApiKey(providerId.value, value)
    syncConfigured()
    // 换了 key 就作废上一次的模型列表——那是上一把 key 的能力边界
    availableModels.value = []
    modelsLoaded.value = false
    modelsError.value = ''
    if (configured.value) {
      lastError.value = ''
      degraded.value = false
    }
  }

  /**
   * 认出用户贴的是哪一种凭证。
   *
   * ⚠️ 厂商常发好几种凭证，彼此不通用。贴错了的报错完全指不到真正原因上
   * （401 看着像 key 错了，「模型不存在」看着像模型名错了），
   * 所以在用户填的时候就告诉他「你这把是哪一种」。
   *
   * @returns 认出来是哪种；认不出返回 null（不该拦——前缀规则可能过时）
   */
  const detectKeyKind = (value: string): 'standard' | 'subscription' | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    // 当前 provider 期望的前缀
    const expected = provider.value.keyPrefix
    if (expected && trimmed.startsWith(expected)) {
      return provider.value.keyKind ?? null
    }
    // 同一厂商的另一种前缀：这是最常踩的坑——贴了订阅 Key 却选了按量计费的条目
    const sibling = llmProviders.find(
      (item) => item.keyPrefix && item.keyPrefix !== expected && trimmed.startsWith(item.keyPrefix),
    )
    if (sibling) return sibling.keyKind ?? null
    return null
  }

  /** 用户贴的 key 与当前条目期望的是否一致 */
  const keyKindMismatch = computed<string>(() => {
    const expected = provider.value.keyKind
    if (!expected) return ''
    const current = detectKeyKind(getApiKey(providerId.value))
    if (!current) return ''
    return current === expected ? '' : expected === 'subscription'
      ? '这把是按量计费的 Key，当前条目要的是订阅 Key——两者不通用，请换条目或换 Key。'
      : '这把是订阅 Key，当前条目要的是按量计费的 Key——两者不通用，请换条目或换 Key。'
  })

  /** 清掉当前提供商的 key */
  const clearKey = (): void => {
    clearApiKey(providerId.value)
    syncConfigured()
    if (providerId.value === llmProviders[0].id) explanation.value = ''
    lastError.value = ''
  }

  /**
   * 切换密钥托管模式。
   *
   * ⚠️ 这里只改「请求走哪条路」：自带 Key 那条路的内存 key、
   * 直连厂商的拼包逻辑都一个字不动。
   */
  const setHostingMode = async (next: LlmHostingMode): Promise<void> => {
    if (next !== 'direct' && next !== 'hosted') return
    hostingMode.value = next
    hostedError.value = ''
    syncConfigured()
    if (next === 'hosted') await refreshHostedKeys()
  }

  /**
   * 拉取服务端密钥库的状态。
   *
   * 后端缺席是**正常状态**：这里只把它记成「不可用」，不抛错、不打断界面。
   */
  const refreshHostedKeys = async (): Promise<boolean> => {
    try {
      hostedKeys.value = await listLlmKeys(ownerToken.value)
      hostedAvailable.value = true
      hostedError.value = ''
      syncConfigured()
      return true
    } catch (error) {
      hostedAvailable.value = false
      hostedKeys.value = []
      hostedError.value = describeError(error, '后端不可达，托管功能暂时不可用')
      syncConfigured()
      return false
    }
  }

  /**
   * 把 key 交给后端保管。
   *
   * ⚠️ 明文 key 只在这一次请求体里出现：后端加密存下，
   * 前端**不留存**（刷新、DevTools、响应式状态里都没有它）。
   */
  const submitHostedKey = async (
    provider: string,
    apiKey: string,
    passphrase?: string,
  ): Promise<boolean> => {
    const trimmedKey = apiKey.trim()
    if (!trimmedKey) {
      hostedError.value = 'API Key 不能为空'
      return false
    }
    try {
      await saveLlmKey(ownerToken.value, {
        providerId: provider,
        apiKey: trimmedKey,
        ...(passphrase && passphrase.trim() ? { passphrase: passphrase.trim() } : {}),
      })
      hostedAvailable.value = true
      hostedError.value = ''
      // 留住口令：后端重启后要靠它重新派生密钥
      hostedPassphrase.value = passphrase?.trim() ?? ''
      await refreshHostedKeys()
      return true
    } catch (error) {
      hostedAvailable.value = !isApiUnavailable(error)
      hostedError.value = describeError(error, '后端不可达，key 没能存进去')
      return false
    }
  }

  /** 删掉服务端某个厂商的 key */
  const removeHostedKey = async (provider: string): Promise<boolean> => {
    try {
      await deleteLlmKey(ownerToken.value, provider)
      hostedError.value = ''
      await refreshHostedKeys()
      return true
    } catch (error) {
      hostedAvailable.value = !isApiUnavailable(error)
      hostedError.value = describeError(error, '后端不可达，key 没能删掉')
      return false
    }
  }

  /** 读今日配额 */
  const refreshQuota = async (): Promise<boolean> => {
    try {
      quota.value = await getLlmQuota(ownerToken.value)
      return true
    } catch (error) {
      // ⚠️ 配额是辅助信息，读不到不代表托管通道坏了——不能因此把通道判成不可用
      hostedError.value = describeError(error, '后端不可达，配额暂时读不到')
      return false
    }
  }

  /** 读最近若干条调用审计 */
  const refreshAudit = async (): Promise<boolean> => {
    try {
      audit.value = await listLlmAudit(ownerToken.value)
      return true
    } catch (error) {
      hostedError.value = describeError(error, '后端不可达，审计暂时读不到')
      return false
    }
  }

  /** 还能不能发请求：没配 key、超了次数上限、还在冷却里，都不行 */
  const canCall = (): boolean => {
    if (!configured.value) return false
    if (callCount.value >= llmConfig.maxCallsPerSession) return false
    if (Date.now() < currentCooldownUntil()) return false
    return true
  }

  /**
   * 托管模式的出网口：请求交给后端，后端再打厂商。
   *
   * ⚠️ 前端在这里**不再按协议拼请求**——只发归一化的形状，
   * 三族协议的差别、故障转移与审计都由后端负责。
   *
   * 这个函数**永不抛异常**：后端缺席也只是失败，界面照常。
   */
  const invokeHosted = async (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxCompletionTokens: number,
    isCurrent: () => boolean = () => true,
  ) => {
    if (!hostedAvailable.value) {
      const error = hostedError.value || '后端不可达，托管模式暂时不可用'
      if (isCurrent()) lastError.value = error
      return { ok: false as const, content: '', error }
    }
    if (!hostedAnyConfigured.value) {
      const error = '未配置任何厂商的 API Key（托管模式下先在服务端存一个）'
      if (isCurrent()) lastError.value = error
      return { ok: false as const, content: '', error }
    }
    if (callCount.value >= llmConfig.maxCallsPerSession) {
      const error = `已达本次会话的调用上限（${llmConfig.maxCallsPerSession} 次）`
      if (isCurrent()) lastError.value = error
      return { ok: false as const, content: '', error }
    }
    // 冷却期：失败后这段时间内一律不再出网（被拦下的请求也不计数）
    if (Date.now() < hostedCooldownUntil) {
      const remain = Math.ceil((hostedCooldownUntil - Date.now()) / 1000)
      const error = `上一次调用失败后仍在冷却期（还需 ${remain} 秒）`
      if (isCurrent()) lastError.value = error
      return { ok: false as const, content: '', error }
    }

    callCount.value += 1
    lastCallAt.value = Date.now()

    try {
      const result = await completeLlm(ownerToken.value, {
        // 当前厂商在服务端没存 key 时不指定厂商：让后端按自己的顺序挑
        ...(hostedProviderConfigured.value
          ? { providerId: providerId.value, model: model.value }
          : {}),
        messages,
        maxTokens: maxCompletionTokens,
        // 后端重启后内存里的派生密钥没了，带上口令让它自己恢复
        ...(hostedPassphrase.value ? { passphrase: hostedPassphrase.value } : {}),
      })
      lastHostedProvider.value = result.providerId
      if (isCurrent()) lastError.value = ''
      const emptyReason: 'truncated' | 'empty' =
        result.finishReason === 'length' ? 'truncated' : 'empty'
      return {
        ok: true as const,
        content: result.content,
        error: '',
        // 正文空时把「被截断」与「真空」区分开，与自带 Key 那条路保持同一套口径
        ...(result.content ? {} : { emptyReason }),
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      }
    } catch (error) {
      const unavailable = isApiUnavailable(error)
      if (unavailable) hostedAvailable.value = false
      const message = describeError(error, '后端不可达，托管调用失败')
      hostedError.value = message
      if (isCurrent()) {
        lastError.value = message
        hostedCooldownUntil = Date.now() + llmConfig.cooldownMs
      }
      return { ok: false as const, content: '', error: message }
    }
  }

  /**
   * 统一的发请求入口：记账、错误脱敏、失败进冷却。
   *
   * 这是**唯一的出网口**，冷却期必须拦在这里——
   * 只在调用方（requestAction）检查的话，"解释"与"测试连接"这些旁路会绕过它直接发出去。
   *
   * `isCurrent` 是过期守卫：返回 false 时这次请求的结果不再写进共享状态
   * （错误、冷却都不写），免得过期的失败把后来的状态盖掉。
   */
  const invoke = async (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxCompletionTokens: number,
    isCurrent: () => boolean = () => true,
  ) => {
    // 托管模式改走后端；自带 Key 那条路（下面这段）一个字都不动
    if (hostingMode.value === 'hosted') {
      return invokeHosted(messages, maxCompletionTokens, isCurrent)
    }
    if (!configured.value) {
      lastError.value = `未配置 ${provider.value.name} 的 API Key`
      return { ok: false as const, content: '', error: lastError.value }
    }
    if (callCount.value >= llmConfig.maxCallsPerSession) {
      lastError.value = `已达本次会话的调用上限（${llmConfig.maxCallsPerSession} 次）`
      return { ok: false as const, content: '', error: lastError.value }
    }
    // 冷却期：失败后这段时间内一律不再出网（被拦下的请求也不计数）
    if (Date.now() < cooldownUntil) {
      const remain = Math.ceil((cooldownUntil - Date.now()) / 1000)
      const error = `上一次调用失败后仍在冷却期（还需 ${remain} 秒）`
      if (isCurrent()) lastError.value = error
      return { ok: false as const, content: '', error }
    }

    callCount.value += 1
    lastCallAt.value = Date.now()

    const result = await callLlm({
      provider: provider.value,
      model: model.value,
      baseUrl: baseUrl.value,
      messages,
      maxCompletionTokens,
    })
    if (!result.ok) {
      const error = result.error ?? '调用失败'
      if (isCurrent()) {
        lastError.value = error
        cooldownUntil = Date.now() + llmConfig.cooldownMs
      }
      return { ok: false as const, content: '', error }
    }
    if (isCurrent()) lastError.value = ''
    return { ok: true as const, content: result.content, error: '' }
  }

  /** 连通性测试：发一个极短的请求 */
  const testConnection = async (): Promise<boolean> => {
    const result = await invoke([{ role: 'user', content: '回复两个字：可用' }], 32)
    return result.ok
  }

  // ------------------------------------------------------------------------
  // 模型列表
  // ------------------------------------------------------------------------

  /** 这把 key 实际能用的模型 id */
  const availableModels = ref<string[]>([])
  /** 正在拉模型列表 */
  const loadingModels = ref(false)
  /** 拉模型列表失败的原因 */
  const modelsError = ref('')
  /** 已经拉过一次（避免重复点按钮重复发请求） */
  const modelsLoaded = ref(false)

  /**
   * 拉一把 key 实际能用的模型列表。
   *
   * ⚠️ 模型 id 跟账号绑定：订阅 Key 与按量计费 Key 能调的模型不是一套。
   * 拉一次就能看到这把 key 的能力边界，比手填模型名再撞 404 划算。
   */
  const loadModels = async (): Promise<boolean> => {
    if (loadingModels.value) return false
    loadingModels.value = true
    modelsError.value = ''
    try {
      const result = await fetchModels({
        provider: provider.value,
        baseUrl: baseUrl.value,
      })
      if (!result.ok) {
        availableModels.value = []
        modelsError.value = result.error ?? '查询模型列表失败'
        modelsLoaded.value = true
        return false
      }
      availableModels.value = result.models
      modelsLoaded.value = true
      return true
    } finally {
      loadingModels.value = false
    }
  }

  /** 换模型（从拉到的列表里选） */
  const applyModel = (value: string): void => {
    setModel(value)
  }

  /**
   * 让在途的解释请求作废。
   *
   * 换了提供商或重置了会话之后，在途请求的结果已经不对应当前的语境，
   * 回来时必须丢掉——否则界面会显示上一家的解释。
   */
  const invalidateExplanation = (): void => {
    if (!explainPending) return
    explainSeq += 1
    explainPending = null
    explaining.value = false
  }

  /**
   * 请求一次解释（按需触发，不自动调用）。
   *
   * 并发调用共享**同一次**请求：后来的调用等到的是这一次的网络结果，
   * 不是上一次遗留的旧文本；已经在途的请求也不会被重复发出。
   */
  const requestExplanation = (snapshot: AgentSnapshot): Promise<string> => {
    if (explainPending) return explainPending.promise
    const seq = ++explainSeq
    explaining.value = true
    const request = (async (): Promise<string> => {
      const result = await invoke(
        buildExplainMessages(snapshot),
        llmConfig.explainMaxTokens,
        () => seq === explainSeq,
      )
      // 过期结果直接丢弃：不写解释、不覆盖错误
      if (seq !== explainSeq) return ''
      if (!result.ok) {
        explanation.value = ''
        return ''
      }
      explanation.value = result.content
      return result.content
    })()
    const tracked = request.finally(() => {
      if (explainPending?.seq === seq) explainPending = null
      if (seq === explainSeq) explaining.value = false
    })
    explainPending = { promise: tracked, seq }
    return tracked
  }

  /**
   * 请求一个动作。
   *
   * 返回 `null` 表示"这次没有可用动作"——调用方必须回落规则式控制器。
   */
  const requestAction = async (snapshot: AgentSnapshot): Promise<LlmAction | null> => {
    if (!configured.value) {
      if (hostingMode.value === 'hosted') {
        // 托管通道不可用有两种原因，别混为一谈：后端不在 vs 一个 key 都没存
        lastError.value = hostedAvailable.value
          ? '未配置任何厂商的 API Key（托管模式下先在服务端存一个，LLM 控制器未启用）'
          : hostedError.value || '后端不可达，托管模式暂时不可用'
      } else {
        lastError.value = `未配置 ${provider.value.name} 的 API Key（LLM 控制器未启用）`
      }
      return null
    }
    if (!canCall()) {
      if (callCount.value >= llmConfig.maxCallsPerSession) {
        lastError.value = `已达本次会话的调用上限（${llmConfig.maxCallsPerSession} 次），控制器已回落到规则式`
      } else if (Date.now() < currentCooldownUntil()) {
        const remain = Math.ceil((currentCooldownUntil() - Date.now()) / 1000)
        lastError.value = `上一次调用失败后仍在冷却期（还需 ${remain} 秒），控制器已回落到规则式`
      }
      return null
    }
    const result = await invoke(buildDecisionMessages(snapshot), llmConfig.controllerMaxTokens)
    if (!result.ok) return null

    // 正文空要先说清是哪一种空：
    // 「被输出预算截断」调大上限就能救，「模型真没给」调大也没用——
    // 两者都报「无法解析」的话，用户既不知道怎么修，也无从判断该不该重试。
    if (!result.content) {
      lastError.value =
        result.emptyReason === 'truncated'
          ? '模型输出被长度上限截断（推理占用了输出预算），已回落到规则式'
          : '模型返回了空内容，已回落到规则式'
      return null
    }

    const action = parseLlmAction(result.content, snapshot.maxSpeed)
    if (!action) {
      lastError.value = '模型返回的动作无法解析，已回落到规则式'
      return null
    }
    return action
  }

  /** 标记降级（LLM 控制器用不了） */
  const markDegraded = (reason: string): void => {
    degraded.value = true
    if (reason) lastError.value = reason
  }

  /** 解除降级标记（LLM 恢复可用） */
  const clearDegraded = (): void => {
    degraded.value = false
  }

  /** 外部设置一条错误提示（已脱敏的短消息） */
  const setError = (message: string): void => {
    lastError.value = message
  }

  /** 重置本次会话的计数 */
  const resetSession = (): void => {
    // 会话重置了：在途的解释属于上一段会话，回来时不能再写进状态
    invalidateExplanation()
    callCount.value = 0
    lastCallAt.value = 0
    cooldownUntil = 0
    hostedCooldownUntil = 0
    degraded.value = false
    lastError.value = ''
  }

  syncConfigured()

  return {
    providerId,
    modelOverrides,
    baseUrlOverrides,
    configured,
    mode,
    explanation,
    explaining,
    lastError,
    degraded,
    callCount,
    lastCallAt,
    provider,
    model,
    baseUrl,
    hostingMode,
    ownerToken,
    hostedKeys,
    hostedAvailable,
    hostedError,
    hostedAnyConfigured,
    hostedProviderConfigured,
    quota,
    audit,
    lastHostedProvider,
    selectProvider,
    setModel,
    setBaseUrl,
    applyKey,
    clearKey,
    setHostingMode,
    refreshHostedKeys,
    submitHostedKey,
    removeHostedKey,
    hostedPassphrase,
    refreshQuota,
    refreshAudit,
    canCall,
    testConnection,
    availableModels,
    loadingModels,
    modelsError,
    modelsLoaded,
    loadModels,
    applyModel,
    detectKeyKind,
    keyKindMismatch,
    requestExplanation,
    requestAction,
    markDegraded,
    clearDegraded,
    setError,
    resetSession,
  }
})
