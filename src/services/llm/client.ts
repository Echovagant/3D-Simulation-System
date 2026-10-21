import { llmConfig, llmEndpoint, type LlmConfig } from '@/config/llm'
import { getApiKey, redactSecrets } from './secret'

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface LlmCallOptions {
  messages: LlmMessage[]
  /** 输出上限（OpenAI 兼容接口用 max_completion_tokens） */
  maxCompletionTokens?: number
  /** 思考深度；M3.1-Flash 不支持关闭思考 */
  reasoningEffort?: LlmConfig['reasoningEffort']
  /** 超时（毫秒），默认取配置 */
  timeoutMs?: number
  /** 覆盖 base_url（一般不需要） */
  baseUrl?: string
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

/** MiniMax 的错误信封：`{ type: "error", error: { type, message, http_code } }` */
interface MiniMaxErrorBody {
  type?: string
  error?: { type?: string; message?: string; http_code?: string | number }
  base_resp?: { status_code?: number; status_msg?: string }
}

/** 从错误信封里挑出最有用的一句话 */
const extractErrorMessage = (body: unknown, fallback: string): string => {
  if (body && typeof body === 'object') {
    const parsed = body as MiniMaxErrorBody
    const message = parsed.error?.message ?? parsed.base_resp?.status_msg
    if (typeof message === 'string' && message.trim()) return message.trim()
  }
  return fallback
}

/**
 * 调用 MiniMax 的 chat/completions。
 *
 * 这个函数**永不抛异常**：失败也返回结果对象（`ok: false`），
 * 让调用方能安静地降级，而不是让一个网络错误把整页炸掉。
 */
export const callLlm = async (options: LlmCallOptions): Promise<LlmCallResult> => {
  const key = getApiKey()
  if (!key) {
    return { ok: false, content: '', error: '未配置 API key（LLM 功能未启用）' }
  }

  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, content: '', error: '当前环境没有 fetch，无法调用 LLM' }
  }

  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? llmConfig.timeoutMs
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  const body = {
    model: llmConfig.model,
    messages: options.messages,
    max_completion_tokens: options.maxCompletionTokens ?? llmConfig.explainMaxTokens,
    reasoning_effort: options.reasoningEffort ?? llmConfig.reasoningEffort,
  }

  try {
    const response = await fetchImpl(llmEndpoint(options.baseUrl), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })

    const requestId =
      (response.headers?.get?.('x-request-id') ?? undefined) ?? undefined

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

    const payload = (await response.json()) as {
      id?: string
      choices?: Array<{ message?: { content?: string } }>
      usage?: { prompt_tokens?: number; completion_tokens?: number }
    }
    const content = payload.choices?.[0]?.message?.content ?? ''

    return {
      ok: true,
      content: typeof content === 'string' ? content.trim() : '',
      requestId: payload.id ?? requestId,
      usage: payload.usage
        ? {
            promptTokens: payload.usage.prompt_tokens,
            completionTokens: payload.usage.completion_tokens,
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
