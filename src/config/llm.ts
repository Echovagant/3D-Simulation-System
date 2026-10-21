/**
 * LLM（MiniMax）接入配置。
 *
 * ⚠️ 这里的每一个默认值都对着官方文档核过
 * （`https://platform.minimax.io/docs/guides/text-generation`）：
 *
 * - base_url（OpenAI 兼容）：`https://api.minimax.io/v1`，端点 `POST /v1/chat/completions`
 * - 当前模型：`MiniMax-M3.1-Flash`（官方描述：Frontier multimodal coding model,
 *   1M context window, tunable thinking depth）
 * - 鉴权：`Authorization: Bearer <MINIMAX_API_KEY>`
 * - 输出上限字段：`max_completion_tokens`（`max_tokens` 在这个接口上已弃用）
 * - 思考深度：`reasoning_effort`（OpenAI 兼容）/ `output_config.effort`（Anthropic 兼容）。
 *   ⚠️ `MiniMax-M3.1-Flash` **不允许关闭思考**——发 `thinking: { type: "disabled" }`
 *   会直接 400（`model "MiniMax-M3.1-Flash" requires adaptive thinking`），
 *   想更快只能把 effort 调低。
 */

/** 官方核实过的默认 base_url（OpenAI 兼容） */
const DEFAULT_BASE_URL = 'https://api.minimax.io/v1'
/** 官方核实过的当前模型 */
const DEFAULT_MODEL = 'MiniMax-M3.1-Flash'

/** 读构建期可覆盖的环境变量（只放非机密项——API key 永远不进构建产物） */
const readEnv = (key: string): string | undefined => {
  const env = import.meta.env as unknown as Record<string, string | undefined>
  const value = env?.[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export interface LlmConfig {
  /** OpenAI 兼容 base_url（不要带 /chat/completions） */
  baseUrl: string
  /** 模型 id */
  model: string
  /** 单次请求超时（毫秒） */
  timeoutMs: number
  /** 控制器单次请求的输出上限 */
  controllerMaxTokens: number
  /** 解释层单次请求的输出上限 */
  explainMaxTokens: number
  /** 思考深度：M3.1-Flash 不支持关闭，只能调低 */
  reasoningEffort: 'low' | 'medium' | 'high'
  /** 一次会话内最多允许的 LLM 调用次数（防止意外烧钱） */
  maxCallsPerSession: number
  /** 两次调用之间的最小间隔（毫秒）——控制器的思考频率 */
  minIntervalMs: number
  /** 失败后的冷却时间（毫秒）：这段时间内不再重试，直接用规则式 */
  cooldownMs: number
}

export const llmConfig: LlmConfig = {
  baseUrl: readEnv('VITE_MINIMAX_BASE_URL') ?? DEFAULT_BASE_URL,
  model: readEnv('VITE_MINIMAX_MODEL') ?? DEFAULT_MODEL,
  timeoutMs: 15000,
  controllerMaxTokens: 256,
  explainMaxTokens: 400,
  // 官方说 M3.1-Flash 的思考关不掉——想快就把 effort 调到 low
  reasoningEffort: 'low',
  maxCallsPerSession: 60,
  minIntervalMs: 1500,
  cooldownMs: 5000,
}

/** 完整端点 */
export const llmEndpoint = (baseUrl: string = llmConfig.baseUrl): string =>
  `${baseUrl.replace(/\/+$/, '')}/chat/completions`
