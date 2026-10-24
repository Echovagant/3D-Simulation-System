import { llmConfig } from '@/config/llm'
import type { LlmProvider, LlmProtocol } from '@/config/llmProviders'
import { getApiKey, redactSecrets } from './secret'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  /** 用哪家服务商的协议与默认参数 */
  provider: LlmProvider
  messages: LlmMessage[]
  /** 覆盖模型 id */
  model?: string
  /** 覆盖 base_url */
  baseUrl?: string
  /** 输出上限 */
  maxCompletionTokens?: number
  /** 超时（毫秒），默认取配置 */
  timeoutMs?: number
  /** 注入 fetch —— 测试用，生产走全局 fetch */
  fetchImpl?: typeof fetch
}

export interface LlmCallResult {
  /** 是否成功 */
  ok: boolean
  /** 模型回复正文 */
  content: string
  /** 失败原因（已脱敏） */
  error?: string
  /** 服务端 request_id，排障用 */
  requestId?: string
  /** token 用量 */
  usage?: { promptTokens?: number; completionTokens?: number }
  /**
   * 「正文为空」的原因。
   *
   * ⚠️ 推理型模型有两种「空」：
   * - `truncated`：推理 token 把输出预算吃光，正文被截断（`finish_reason=length`）——
   *   模型其实想给动作，但预算不够，**调大输出上限就能解决**。
   * - `empty`：模型真的什么都没给（正文与推理都空）——调大上限也没用。
   * 这两种混在一起报「无法解析」，用户既不知道怎么修，也无从判断该不该重试。
   */
  emptyReason?: 'truncated' | 'empty'
  /** 厂商返回的结束原因（`stop` / `length` / …），排障用 */
  finishReason?: string
}

/** 各家错误信封的公共形状：`{ error: { message } }` */
interface ProviderErrorBody {
  error?: { message?: string; type?: string; code?: string | number }
  message?: string
}

/** 从错误信封里挑出最有用的一句话 */
const extractErrorMessage = (body: unknown, fallback: string): string => {
  if (body && typeof body === 'object') {
    const parsed = body as ProviderErrorBody
    const message = parsed.error?.message ?? parsed.message
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return fallback
}

/** 一个已经算好的请求：地址、头、体 */
interface BuiltRequest {
  url: string
  headers: Record<string, string>
  body: Record<string, unknown>
}

const trimBase = (baseUrl: string): string => baseUrl.replace(/\/+$/, '')

/**
 * 按协议拼出请求。
 *
 * 三种协议的差别都在这里：
 * - **OpenAI 兼容**：`POST {base}/chat/completions`，`Authorization: Bearer`，
 *   输出上限字段 `max_completion_tokens`，回复在 `choices[0].message.content`
 * - **Anthropic Messages**：`POST {base}/messages`，`x-api-key` + `anthropic-version`，
 *   system 提示词是**顶层字段**不是消息角色，输出上限用 `max_tokens`，
 *   回复在 `content[].text`
 * - **Gemini Interactions**：`POST {base}/interactions`，`x-goog-api-key`，
 *   system 提示词是 `system_instruction`，对话压成 `input` 字符串，
 *   思考深度用 `generation_config.thinking_level`，回复在 `output_text`
 */
const buildRequest = (
  protocol: LlmProtocol,
  provider: LlmProvider,
  params: { baseUrl: string; model: string; messages: LlmMessage[]; maxTokens: number; key: string },
): BuiltRequest => {
  const { baseUrl, model, messages, maxTokens, key } = params
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n')
  const rest = messages.filter((m) => m.role !== 'system')

  if (protocol === 'anthropic') {
    return {
      url: `${trimBase(baseUrl)}/messages`,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: {
        model,
        max_tokens: maxTokens,
        ...(system ? { system } : {}),
        messages: rest.map((m) => ({ role: m.role, content: m.content })),
      },
    }
  }

  if (protocol === 'gemini') {
    return {
      url: `${trimBase(baseUrl)}/interactions`,
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: {
        model,
        input: rest.map((m) => `${m.role}: ${m.content}`).join('\n\n'),
        ...(system ? { system_instruction: system } : {}),
        generation_config: { thinking_level: 'low' },
      },
    }
  }

  // OpenAI 兼容
  const body: Record<string, unknown> = {
    model,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
    max_completion_tokens: maxTokens,
  }
  // 只有官方文档明确写了 reasoning_effort 的服务商才带这个字段
  if (provider.reasoningEffort) body.reasoning_effort = provider.reasoningEffort

  return {
    url: `${trimBase(baseUrl)}/chat/completions`,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${key}`,
    },
    body,
  }
}

/** 从各家响应里取出正文 */
const extractContent = (protocol: LlmProtocol, payload: unknown): string => {
  if (!payload || typeof payload !== 'object') return ''
  const data = payload as Record<string, any>

  if (protocol === 'anthropic') {
    const blocks = Array.isArray(data.content) ? data.content : []
    return blocks
      .filter((block: any) => typeof block?.text === 'string')
      .map((block: any) => block.text as string)
      .join('\n')
      .trim()
  }

  if (protocol === 'gemini') {
    if (typeof data.output_text === 'string') return data.output_text.trim()
    const blocks = Array.isArray(data.output) ? data.output : []
    return blocks
      .map((block: any) => {
        if (typeof block?.text === 'string') return block.text as string
        if (typeof block?.content === 'string') return block.content as string
        return ''
      })
      .filter(Boolean)
      .join('\n')
      .trim()
  }

  const content = data.choices?.[0]?.message?.content
  return typeof content === 'string' ? content.trim() : ''
}

/**
 * 取出「结束原因」。
 *
 * ⚠️ OpenAI 兼容协议把 `finish_reason` 放在 `choices[0]` 上，不在 message 里。
 * `length` 表示**输出预算被用光**（正文被截断）——这与「模型什么都没给」是两回事。
 */
const extractFinishReason = (protocol: LlmProtocol, payload: unknown): string | undefined => {
  if (!payload || typeof payload !== 'object') return undefined
  const data = payload as Record<string, any>
  if (protocol === 'openai') {
    const reason = data.choices?.[0]?.finish_reason
    return typeof reason === 'string' ? reason : undefined
  }
  if (protocol === 'anthropic') {
    const reason = data.stop_reason
    return typeof reason === 'string' ? reason : undefined
  }
  if (protocol === 'gemini') {
    const reason = data.finish_reason
    return typeof reason === 'string' ? reason : undefined
  }
  return undefined
}

/**
 * 调用 LLM。
 *
 * 这个函数**永不抛异常**：失败也返回结果对象（`ok: false`），
 * 让调用方能安静地降级，而不是让一个网络错误把整页炸掉。
 */
export const callLlm = async (options: LlmCallOptions): Promise<LlmCallResult> => {
  const { provider } = options
  const key = getApiKey(provider.id)
  if (!key) {
    return { ok: false, content: '', error: `未配置 ${provider.name} 的 API Key` }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, content: '', error: '当前环境没有 fetch，无法调用 LLM' }
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? llmConfig.timeoutMs
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const request = buildRequest(provider.protocol, provider, {
    baseUrl: options.baseUrl ?? provider.baseUrl,
    model: options.model ?? provider.model,
    messages: options.messages,
    maxTokens: options.maxCompletionTokens ?? llmConfig.explainMaxTokens,
    key,
  })

  try {
    const response = await fetchImpl(request.url, {
      method: 'POST',
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    })

    const requestId = response.headers?.get?.('x-request-id') ?? undefined

    if (!response.ok) {
      let raw = ''
      try {
        raw = await response.text()
      } catch {
        raw = ''
      }
      let parsed: unknown = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        parsed = null
      }
      const detail = extractErrorMessage(parsed, raw.slice(0, 160) || response.statusText)
      return {
        ok: false,
        content: '',
        error: redactSecrets(`HTTP ${response.status}：${detail}`).slice(0, 240),
        requestId,
      }
    }

    const payload = await response.json()
    const usage = (payload as Record<string, any>)?.usage

    const content = extractContent(provider.protocol, payload)
    const finishReason = extractFinishReason(provider.protocol, payload)
    const emptyReason: 'truncated' | 'empty' = finishReason === 'length' ? 'truncated' : 'empty'

    return {
      ok: true,
      content,
      requestId: requestId ?? (payload as Record<string, any>)?.id,
      // 正文空时把原因带上：被输出预算截断（调大上限能救）与模型真没给（调大也没用）
      // 是两回事，混报「无法解析」用户没法处置。
      ...(content ? {} : { emptyReason }),
      ...(finishReason ? { finishReason } : {}),
      usage: usage
        ? {
            promptTokens: usage.prompt_tokens ?? usage.input_tokens,
            completionTokens: usage.completion_tokens ?? usage.output_tokens,
          }
        : undefined,
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = controller.signal.aborted
      ? `请求超时（${timeoutMs}ms）`
      : `请求失败：${message}`
    return { ok: false, content: '', error: redactSecrets(reason).slice(0, 240) }
  } finally {
    clearTimeout(timer)
  }
}

// --------------------------------------------------------------------------
// 模型列表
// --------------------------------------------------------------------------

export interface LlmModelsResult {
  /** 是否成功 */
  ok: boolean
  /** 这把 key 能用的模型 id（厂商返回的顺序） */
  models: string[]
  /** 失败原因（已脱敏） */
  error?: string
}

/**
 * 拉一把 key 实际能用的模型列表。
 *
 * ⚠️ 为什么要它：模型 id 迭代很快，而且**跟账号绑定**——
 * 订阅 Key 能调的模型与按量计费 Key 能调的模型不是一套，
 * 手填模型名填错时报的错还完全指不到真正原因上（404 看着像模型不存在，
 * 实际是凭证不对）。让用户填完 key 点一下，直接看到这把 key 的能力边界。
 *
 * ⚠️ 只支持 OpenAI 兼容协议——它是唯一有模型发现接口的那一族。
 * Anthropic 与 Gemini 的 `/models` 路径与解析方式都不同，
 * 那两家这里直接说明不支持，不猜。
 */
export const fetchModels = async (options: {
  provider: LlmProvider
  /** 覆盖 base_url */
  baseUrl?: string
  /** 覆盖超时（毫秒） */
  timeoutMs?: number
  /** 注入 fetch —— 测试用，生产走全局 fetch */
  fetchImpl?: typeof fetch
}): Promise<LlmModelsResult> => {
  const { provider } = options
  if (provider.protocol !== 'openai') {
    return {
      ok: false,
      models: [],
      error: `${provider.name} 没有开放模型列表接口，模型名需要手填`,
    }
  }

  const key = getApiKey(provider.id)
  if (!key) {
    return { ok: false, models: [], error: `未配置 ${provider.name} 的 API Key` }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, models: [], error: '当前环境没有 fetch，无法查询模型列表' }
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? llmConfig.timeoutMs
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const base = (options.baseUrl ?? provider.baseUrl).replace(/\/+$/, '')

  try {
    const response = await fetchImpl(`${base}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    })

    if (!response.ok) {
      let raw = ''
      try {
        raw = await response.text()
      } catch {
        raw = ''
      }
      let parsed: unknown = null
      try {
        parsed = raw ? JSON.parse(raw) : null
      } catch {
        parsed = null
      }
      const body = parsed as { error?: { message?: string } } | null
      const detail = body?.error?.message ?? raw.slice(0, 160) ?? response.statusText
      return {
        ok: false,
        models: [],
        error: redactSecrets(`HTTP ${response.status}：${detail}`).slice(0, 240),
      }
    }

    const payload = (await response.json()) as { data?: unknown }
    const list = Array.isArray(payload?.data) ? payload.data : []
    const models: string[] = []
    for (const entry of list) {
      const id = (entry as { id?: unknown })?.id
      if (typeof id === 'string' && id.trim()) models.push(id.trim())
    }

    if (models.length === 0) {
      return { ok: false, models: [], error: '厂商返回的模型列表是空的' }
    }
    return { ok: true, models }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const reason = controller.signal.aborted ? `请求超时（${timeoutMs}ms）` : `请求失败：${message}`
    return { ok: false, models: [], error: redactSecrets(reason).slice(0, 240) }
  } finally {
    clearTimeout(timer)
  }
}
