/**
 * LLM 托管服务（后端）的客户端。
 *
 * ⚠️ 这里的请求体是**归一化**的：前端只说「要什么」（模型 + 消息），
 * 三族协议（OpenAI 兼容 / Anthropic Messages / Gemini Interactions）的差别全在后端。
 * 自带 Key 模式不走这里——那条路仍然由 `services/llm/client.ts` 直接打厂商。
 *
 * 所有端点都要带 `X-Owner-Token`：它是软身份（配额、审计、密钥库的归属键），
 * 不是密码学意义上的认证，但缺了后端会回 401。
 */
import { apiRequest } from './client'

/** 归一化的一条消息：角色与内容，三族协议都一样 */
export interface LlmMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 密钥库条目：后端只回「配没配」，绝不回明文、密文或口令 */
export interface LlmKeyStatus {
  providerId: string
  configured: boolean
  updatedAt?: string | null
}

/** 提交 key 的请求体 */
export interface LlmKeyInput {
  providerId: string
  apiKey: string
  /** 口令：后端没配主密钥时必须给 */
  passphrase?: string
}

/** 提交成功后的回执 */
export interface LlmKeyReceipt {
  providerId: string
  configured: boolean
}

/** 归一化的完成请求：`providerId` / `model` / `maxTokens` 都可省 */
export interface LlmCompleteInput {
  providerId?: string
  model?: string
  messages: LlmMessage[]
  maxTokens?: number
  /**
   * 口令：后端重启后内存里的派生密钥就没了，这时要靠口令重新派生。
   * 平时不用传——后端缓存着派生结果。
   */
  passphrase?: string
}

/** token 用量 */
export interface LlmUsage {
  promptTokens?: number
  completionTokens?: number
}

/** 完成结果 */
export interface LlmCompleteResult {
  content: string
  usage?: LlmUsage
  /** 实际答上那家（后端可能故障转移过，不一定是请求里指定的那家） */
  providerId: string
  model: string
}

/** 今日配额 */
export interface LlmQuota {
  limit: number
  used: number
  remaining: number
  resetAt: string
}

/** 一条调用审计 */
export interface LlmAuditEntry {
  ts: string
  providerId: string
  model: string
  ok: boolean
  latencyMs: number
  tokens?: number
  errorCode?: string
}

/** 审计列表（只回该 owner 自己最近若干条） */
export interface LlmAudit {
  calls: LlmAuditEntry[]
}

/** 所有端点都要带的软身份头 */
const ownerHeaders = (ownerToken: string): Record<string, string> => ({
  'X-Owner-Token': ownerToken,
})

/** key 的路径：id 要编码，避免 id 里的特殊字符把路径拆坏 */
const keyPath = (providerId: string): string => `/api/llm/keys/${encodeURIComponent(providerId)}`

/** 后端回的 usage 字段名没在契约里写死，两种拼法都收，出去统一成驼峰 */
interface RawUsage {
  promptTokens?: number
  prompt_tokens?: number
  completionTokens?: number
  completion_tokens?: number
}

const normalizeUsage = (raw: RawUsage | undefined): LlmUsage | undefined => {
  if (!raw) return undefined
  const promptTokens = raw.promptTokens ?? raw.prompt_tokens
  const completionTokens = raw.completionTokens ?? raw.completion_tokens
  if (promptTokens === undefined && completionTokens === undefined) return undefined
  return { promptTokens, completionTokens }
}

/** 列出密钥库里各家配没配（只回状态，不回明文） */
export const listLlmKeys = (ownerToken: string): Promise<LlmKeyStatus[]> =>
  apiRequest<LlmKeyStatus[]>('/api/llm/keys', {
    headers: ownerHeaders(ownerToken),
  })

/**
 * 把 key 交给后端保管。
 *
 * ⚠️ 明文 key 只在这个请求体里出现一次：后端加密存下，
 * 之后前端只能通过 `listLlmKeys` 看到「配没配」。
 */
export const saveLlmKey = (ownerToken: string, input: LlmKeyInput): Promise<LlmKeyReceipt> =>
  apiRequest<LlmKeyReceipt>('/api/llm/keys', {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({
      providerId: input.providerId,
      apiKey: input.apiKey,
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
    }),
  })

/** 删掉某个厂商的 key；后端回 204（无响应体） */
export const deleteLlmKey = (ownerToken: string, providerId: string): Promise<void> =>
  apiRequest<void>(keyPath(providerId), {
    method: 'DELETE',
    headers: ownerHeaders(ownerToken),
  })

/**
 * 走托管通道完成一次对话。
 *
 * ⚠️ 前端在这里**不再按协议拼请求**：只发归一化的形状，
 * 协议差别、故障转移与审计都由后端负责。
 */
export const completeLlm = async (
  ownerToken: string,
  input: LlmCompleteInput,
): Promise<LlmCompleteResult> => {
  const raw = await apiRequest<{
    content?: string
    usage?: RawUsage
    providerId?: string
    model?: string
  }>('/api/llm/complete', {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({
      ...(input.providerId ? { providerId: input.providerId } : {}),
      ...(input.model ? { model: input.model } : {}),
      messages: input.messages,
      ...(input.maxTokens ? { maxTokens: input.maxTokens } : {}),
      ...(input.passphrase ? { passphrase: input.passphrase } : {}),
    }),
  })
  const usage = normalizeUsage(raw.usage)
  return {
    content: typeof raw.content === 'string' ? raw.content : '',
    providerId: typeof raw.providerId === 'string' ? raw.providerId : '',
    model: typeof raw.model === 'string' ? raw.model : '',
    ...(usage ? { usage } : {}),
  }
}

/** 今日配额 */
export const getLlmQuota = (ownerToken: string): Promise<LlmQuota> =>
  apiRequest<LlmQuota>('/api/llm/quota', {
    headers: ownerHeaders(ownerToken),
  })

/** 最近若干条调用审计 */
export const listLlmAudit = (ownerToken: string): Promise<LlmAudit> =>
  apiRequest<LlmAudit>('/api/llm/audit', {
    headers: ownerHeaders(ownerToken),
  })
