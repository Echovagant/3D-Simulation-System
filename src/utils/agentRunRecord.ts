/**
 * 实时演练的运行记录：把一次会话的环境、智能体、指标与日志收成一份可导出的 JSON。
 *
 * 这里只做**快照组装**，不读 store、不碰场景对象——输入由面板凑齐，
 * 所以能直接单测。运行记录是「演练留档」，不是正式评测结果：
 * 指标口径与面板上那四个数字完全一致（见 utils/agentMetrics.ts）。
 */
import type { AiAgent, AiAgentLog, AiEnvironmentSettings } from '@/stores/aiStore'
import type { AgentMetrics } from '@/utils/agentMetrics'
import type { SceneDocument } from '@/types'

/**
 * 运行记录里保留的日志条数上限。
 *
 * 面板自己有 5000 条上限、虚拟滚动负责渲染；导出文件是给人读/给工具解析的，
 * 200 条足够复盘最后一段决策，再长就只是把整个会话原样搬一遍。
 * 被截掉的条数不会丢——`logCount` 记的是截断前的总数。
 */
export const MAX_RUN_RECORD_LOGS = 200

/** 智能体在运行记录里的快照（只留可复现需要的字段） */
export interface AgentRunAgentSnapshot {
  id: string
  name: string
  type: AiAgent['type']
  status: AiAgent['status']
  parameters: Record<string, number | string | boolean>
}

/**
 * 运行指标快照。
 *
 * 四个字段与面板一致：
 * - `successRate`：导航成功率（0~1），没有智能体时为 null
 * - `collisions`：碰撞次数总和
 * - `efficiency`：平均路径效率（0~1），没有可统计对象时为 null
 * - `goals`：达成过目标的智能体数
 *
 * 指标整体缺失时全部给 null，不编 0——「没测过」和「测得 0」是两回事。
 */
export interface AgentRunMetrics {
  successRate: number | null
  collisions: number | null
  efficiency: number | null
  goals: number | null
}

/** 一次实时演练的完整运行记录（导出成 agent-run-<runId>.json） */
export interface AgentRunRecord {
  runId: string
  /** ISO 8601 时间；取不到真实起点时由调用方显式传入 */
  startedAt: string
  endedAt: string
  /** 环境设置快照（深拷贝，导出后不再随界面改动） */
  environment: AiEnvironmentSettings
  /** 智能体列表与参数快照 */
  agents: AgentRunAgentSnapshot[]
  metrics: AgentRunMetrics
  /** 最近若干条日志（默认最近 200 条，按时间正序） */
  logs: AiAgentLog[]
  /** 截断前的日志总条数 */
  logCount: number
  /**
   * 当前场地转成的场景文档（障碍 + 智能体）。
   *
   * 这是「顺手留档」，不是评测台的一键互通：评测台仍要求用户提供场景 JSON，
   * 本字段让导出的记录自带一份可读的场地快照。
   */
  sceneDocument?: SceneDocument
}

/** buildAgentRunRecord 的输入——全部由调用方（面板）凑齐 */
export interface BuildAgentRunRecordInput {
  environment: AiEnvironmentSettings
  agents: ReadonlyArray<Pick<AiAgent, 'id' | 'name' | 'type' | 'status' | 'parameters'>>
  /** 指标聚合结果；未聚合时传 null，记录里如实给 null */
  metrics?: AgentMetrics | null
  /** 全部日志（按时间正序）；内部只保留最近 maxLogs 条 */
  logs?: ReadonlyArray<AiAgentLog>
  /** 会话起点；缺省用导出时刻 */
  startedAt?: Date | number | string
  /** 会话终点；缺省用导出时刻 */
  endedAt?: Date | number | string
  /** 指定 runId（测试用）；缺省自动生成 */
  runId?: string
  /** 场地快照；没有则记录里不出现该字段 */
  sceneDocument?: SceneDocument | null
  /** 日志保留条数上限，默认 MAX_RUN_RECORD_LOGS */
  maxLogs?: number
}

/** 生成 runId：优先 crypto.randomUUID，环境不支持时退回时间戳 + 随机串 */
const createRunId = (): string => {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    try {
      return cryptoApi.randomUUID()
    } catch {
      // 非安全上下文等极端情况：走下面的兜底
    }
  }
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** 把 Date / 毫秒时间戳 / ISO 字符串统一成 ISO 字符串；非法输入退回当前时刻 */
const toIsoString = (value: Date | number | string | undefined): string => {
  if (value === undefined) return new Date().toISOString()
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

const toRunMetrics = (metrics: AgentMetrics | null | undefined): AgentRunMetrics => ({
  successRate: metrics?.successRate ?? null,
  collisions: metrics ? metrics.collisionCountTotal : null,
  efficiency: metrics?.meanPathEfficiency ?? null,
  goals: metrics ? metrics.goalReachedCount : null,
})

/**
 * 组装一份运行记录。
 *
 * 纯函数（runId/时间缺省时才读当前时钟）：同样的输入得到同样的结构，
 * 便于单测与事后归档。
 */
export const buildAgentRunRecord = (input: BuildAgentRunRecordInput): AgentRunRecord => {
  const allLogs = input.logs ?? []
  const limit = Math.max(0, input.maxLogs ?? MAX_RUN_RECORD_LOGS)
  const keptLogs = allLogs.slice(Math.max(0, allLogs.length - limit)).map((log) => ({ ...log }))

  const record: AgentRunRecord = {
    runId: input.runId?.trim() || createRunId(),
    startedAt: toIsoString(input.startedAt),
    endedAt: toIsoString(input.endedAt),
    environment: { ...input.environment },
    agents: input.agents.map((agent) => ({
      id: agent.id,
      name: agent.name,
      type: agent.type,
      status: agent.status,
      parameters: { ...agent.parameters },
    })),
    metrics: toRunMetrics(input.metrics),
    logs: keptLogs,
    logCount: allLogs.length,
  }

  if (input.sceneDocument) {
    record.sceneDocument = input.sceneDocument
  }

  return record
}
