/**
 * LLM 接入的公共配置。
 *
 * 提供商、端点与模型在 `src/config/llmProviders.ts` 里（按协议分族）。
 * 这里放的是**与提供商无关**的那部分：超时、输出上限、调用频次与额度。
 */

export interface LlmConfig {
  /** 单次请求超时（毫秒） */
  timeoutMs: number
  /**
   * 控制器单次请求的输出上限。
   *
   * ⚠️ 这个上限**同时管着推理与正文**：推理型模型（M3.1-Flash）先花掉一部分
   * token 写思考，剩下的才是正文。实测推理长度在 30~165 token 之间波动，
   * 上限给 256 时正文偶尔会被挤空（`finish_reason=length`，JSON 变成半截，
   * 闸门必然拒收）。给到 512 后推理再长也留得下正文。
   */
  controllerMaxTokens: number
  /** 解释层单次请求的输出上限 */
  explainMaxTokens: number
  /** 一次会话内最多允许的 LLM 调用次数（防止意外烧钱） */
  maxCallsPerSession: number
  /** 两次调用之间的最小间隔（毫秒）——控制器的思考频率 */
  minIntervalMs: number
  /** 失败后的冷却时间（毫秒）：这段时间内不再重试 */
  cooldownMs: number
}

export const llmConfig: LlmConfig = {
  timeoutMs: 15000,
  controllerMaxTokens: 512,
  explainMaxTokens: 400,
  maxCallsPerSession: 60,
  minIntervalMs: 1500,
  cooldownMs: 5000,
}
