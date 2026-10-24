/**
 * 代理日志的纯函数工具——导出与格式化。
 *
 * 单独成文件是为了能直接单测：面板组件要挂载才能跑，
 * 而这里面的逻辑（序列化成 JSONL、浮点数取整）都是纯函数。
 */

/** 导出需要的最小日志形状——不依赖 store 的具体类型 */
export interface ExportableAgentLog {
  seq: number
  timestamp: number
  message: string
  type: string
  agentId: string
  agentName: string
}

/**
 * 递归把数字取整到两位小数。
 *
 * ⚠️ 原始浮点有十几位小数（`-0.5640458590656282`），一行根本放不下，
 * 面板里每条日志都要折成两三行，虚拟滚动就没法按固定行高来算了。
 * 取整之后既读得懂，也够短。
 */
const roundNumbers = (value: unknown): unknown => {
  if (typeof value === 'number') return Math.round(value * 100) / 100
  if (Array.isArray(value)) return value.map(roundNumbers)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      out[key] = roundNumbers(item)
    }
    return out
  }
  return value
}

/** 把决策参数格式成一行能放下的 JSON（浮点数已取整） */
export const formatLogParameters = (parameters: Record<string, unknown>): string =>
  JSON.stringify(roundNumbers(parameters))

/**
 * 序列化成 JSONL——一行一条 JSON 记录。
 *
 * 用 JSONL 而不是 JSON 数组：行式格式可以直接 grep、可以直接被
 * `jq` 一行一条地读，也不必为了追加一条而重写整个文件。
 */
export const serializeAgentLogs = (logs: ExportableAgentLog[]): string => {
  if (logs.length === 0) return ''
  const lines = logs.map((log) =>
    JSON.stringify({
      seq: log.seq,
      time: new Date(log.timestamp).toISOString(),
      agent: log.agentName,
      agentId: log.agentId,
      type: log.type,
      message: log.message,
    }),
  )
  return lines.join('\n') + '\n'
}

/** 导出文件名里的时间戳——冒号在 Windows 文件名里非法，换成横线 */
export const exportFileStamp = (date: Date = new Date()): string =>
  date.toISOString().replace(/[:.]/g, '-')
