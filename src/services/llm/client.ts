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

    return {
      ok: true,
      content: extractContent(provider.protocol, payload),
      requestId: requestId ?? (payload as Record<string, any>)?.id,
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
