import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { llmConfig } from '@/config/llm'
import { findProvider, llmProviders, type LlmProvider } from '@/config/llmProviders'
import { callLlm } from '@/services/llm/client'
import {
  buildDecisionMessages,
  buildExplainMessages,
  parseLlmAction,
  type AgentSnapshot,
  type LlmAction,
} from '@/services/llm/prompts'
import { clearApiKey, hasApiKey, setApiKey } from '@/services/llm/secret'

/** 控制器模式：规则式（默认，不出网）还是 LLM */
export type LlmControllerMode = 'rule' | 'llm'

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

  /** 冷却截止时间戳：失败后这段时间内不再重试 */
  let cooldownUntil = 0

  /** 当前提供商 */
  const provider = computed<LlmProvider>(
    () => findProvider(providerId.value) ?? llmProviders[0],
  )
  /** 当前使用的模型 id */
  const model = computed<string>(
    () => modelOverrides.value[providerId.value] ?? provider.value.model,
  )
  /** 当前使用的 base_url */
  const baseUrl = computed<string>(
    () => baseUrlOverrides.value[providerId.value] ?? provider.value.baseUrl,
  )

  const syncConfigured = (): void => {
    configured.value = hasApiKey(providerId.value)
  }

  /** 切换提供商：换 key 槽位，也载入它自己的默认模型与端点 */
  const selectProvider = (id: string): void => {
    if (!findProvider(id)) return
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
    if (configured.value) {
      lastError.value = ''
      degraded.value = false
    }
  }

  /** 清掉当前提供商的 key */
  const clearKey = (): void => {
    clearApiKey(providerId.value)
    syncConfigured()
    if (providerId.value === llmProviders[0].id) explanation.value = ''
    lastError.value = ''
  }

  /** 还能不能发请求：没配 key、超了次数上限、还在冷却里，都不行 */
  const canCall = (respectCooldown = true): boolean => {
    if (!configured.value) return false
    if (callCount.value >= llmConfig.maxCallsPerSession) return false
    if (respectCooldown && Date.now() < cooldownUntil) return false
    return true
  }

  /** 统一的发请求入口：记账、错误脱敏、失败进冷却 */
  const invoke = async (
    messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>,
    maxCompletionTokens: number,
  ) => {
    if (!configured.value) {
      lastError.value = `未配置 ${provider.value.name} 的 API Key`
      return { ok: false as const, content: '', error: lastError.value }
    }
    if (callCount.value >= llmConfig.maxCallsPerSession) {
      lastError.value = `已达本次会话的调用上限（${llmConfig.maxCallsPerSession} 次）`
      return { ok: false as const, content: '', error: lastError.value }
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
      lastError.value = result.error ?? '调用失败'
      cooldownUntil = Date.now() + llmConfig.cooldownMs
      return { ok: false as const, content: '', error: lastError.value }
    }
    lastError.value = ''
    return { ok: true as const, content: result.content, error: '' }
  }

  /** 连通性测试：发一个极短的请求 */
  const testConnection = async (): Promise<boolean> => {
    const result = await invoke(
      [{ role: 'user', content: '回复两个字：可用' }],
      32,
    )
    return result.ok
  }

  /** 请求一次解释（按需触发，不自动调用） */
  const requestExplanation = async (snapshot: AgentSnapshot): Promise<string> => {
    if (explaining.value) return explanation.value
    explaining.value = true
    try {
      const result = await invoke(buildExplainMessages(snapshot), llmConfig.explainMaxTokens)
      if (!result.ok) {
        explanation.value = ''
        return ''
      }
      explanation.value = result.content
      return result.content
    } finally {
      explaining.value = false
    }
  }

  /**
   * 请求一个动作。
   *
   * 返回 `null` 表示"这次没有可用动作"——调用方必须回落规则式控制器。
   */
  const requestAction = async (snapshot: AgentSnapshot): Promise<LlmAction | null> => {
    if (!configured.value) {
      lastError.value = `未配置 ${provider.value.name} 的 API Key（LLM 控制器未启用）`
      return null
    }
    if (!canCall()) {
      if (callCount.value >= llmConfig.maxCallsPerSession) {
        lastError.value = `已达本次会话的调用上限（${llmConfig.maxCallsPerSession} 次），控制器已回落到规则式`
      }
      return null
    }
    const result = await invoke(buildDecisionMessages(snapshot), llmConfig.controllerMaxTokens)
    if (!result.ok) return null

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
    callCount.value = 0
    lastCallAt.value = 0
    cooldownUntil = 0
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
    selectProvider,
    setModel,
    setBaseUrl,
    applyKey,
    clearKey,
    canCall,
    testConnection,
    requestExplanation,
    requestAction,
    markDegraded,
    clearDegraded,
    setError,
    resetSession,
  }
})
