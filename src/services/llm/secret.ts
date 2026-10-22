/**
 * API key 的**唯一**存放点。
 *
 * ⚠️ 这些 key 刻意**不放进 Pinia / Vue 响应式**：
 * 响应式状态会被 Vue DevTools 完整列出来、也容易被顺手写进 localStorage。
 * 放在模块作用域里，它们只活在当前页面的内存中，刷新即失效。
 *
 * 它们也**不会**出现在：
 * - 仓库里（这里没有任何持久化代码）
 * - 磁盘上（没有任何写文件的代码）
 * - 日志与错误信息里（`client.ts` 只回报脱敏后的错误）
 * - 构建产物里（它们是运行时才有的，不来自任何环境变量）
 *
 * 按提供商分槽存放：换一家提供商不用重新粘贴另一家的 key。
 */

/** providerId → key */
const apiKeys = new Map<string, string>()

/** 读某个提供商的 key（调用方负责不外传） */
export const getApiKey = (providerId: string): string => apiKeys.get(providerId) ?? ''

/** 写入某个提供商的 key（会去掉首尾空白） */
export const setApiKey = (providerId: string, value: string): void => {
  apiKeys.set(providerId, typeof value === 'string' ? value.trim() : '')
}

/** 清掉某个提供商的 key */
export const clearApiKey = (providerId: string): void => {
  apiKeys.delete(providerId)
}

/** 某个提供商是否已配置 */
export const hasApiKey = (providerId: string): boolean =>
  (apiKeys.get(providerId) ?? '').length > 0

/** 一次性清掉所有 key（"清除全部"按钮用） */
export const clearAllApiKeys = (): void => {
  apiKeys.clear()
}

/**
 * 脱敏：把任何长得像密钥的片段替换掉。
 *
 * 服务端的报错偶尔会把请求头原样回显——那里面就有我们的 key。
 * 所有要显示给用户或写进日志的文本都要先过这一道。
 *
 * ⚠️ 规则按识别度从高到低排列：带厂商特有前缀的形态（`AIza` / `xai-`）先匹配，
 * 否则会被后面的通用规则先截掉、只留下可辨认的半截。
 */
export const redactSecrets = (text: string): string => {
  if (!text) return ''
  return text
    // Google Gemini：AIza + 35 位
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    // xAI Grok：xai- + 一长串
    .replace(/\bxai-[A-Za-z0-9_-]{20,}/g, 'xai-***')
    // OpenAI / Anthropic / DeepSeek / Qwen 等：sk- 前缀
    .replace(/sk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
    // MiniMax 等：JWT 形态
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{4,}/g, 'eyJ***')
    // 通用鉴权头
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{8,}/gi, '$1***')
    // 智谱 GLM：两段十六进制（id.secret）。
    // 长度下限取得比真实 key（各 32 位）更保守，免得把版本号、时间戳、哈希误伤。
    .replace(/\b[0-9a-f]{24,}\.[0-9a-f]{24,}\b/gi, '***')
}
