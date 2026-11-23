/**
 * 决策时间线的纯函数工具。
 *
 * 单独成文件是为了能直接单测：面板组件要挂载才能跑，
 * 而「怎么把一条决策折成一行可读文本」不该依赖 DOM。
 */
import type { AiDecision, AiDecisionSource } from '@/types'

/** 时间线默认展示的最近决策条数 */
export const TIMELINE_LIMIT = 100

/** 最近障碍距离的「无」读数——与感知层保持一致 */
const NO_OBSTACLE_DISTANCE = 999

const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value))

/** 墙上时间 HH:MM:SS（与日志面板同一套格式化，避免 Intl 的开销） */
export const formatDecisionClock = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

/** 仿真时间：mm:ss.s；没有记录时显示「—」 */
export const formatSimulationTime = (seconds?: number): string => {
  if (seconds == null || !Number.isFinite(seconds)) return '—'
  const total = Math.max(0, seconds)
  const minutes = Math.floor(total / 60)
  const rest = total - minutes * 60
  return `${pad2(minutes)}:${rest.toFixed(1).padStart(4, '0')}`
}

/** 最近障碍距离：视野内没有障碍物时显示「—」 */
export const formatNearestObstacle = (distance?: number | null): string => {
  if (distance == null || !Number.isFinite(distance) || distance >= NO_OBSTACLE_DISTANCE) {
    return '—'
  }
  return `${distance.toFixed(2)} 米`
}

/** 来源徽标文案：LLM 或 规则 */
export const decisionSourceLabel = (source?: AiDecisionSource): string =>
  source === 'llm' ? 'LLM' : '规则'

const round2 = (value: unknown): number => {
  const number = Number(value)
  return Number.isFinite(number) ? Math.round(number * 100) / 100 : 0
}

/**
 * 动作 + 参数的一行文本。
 *
 * 移动会摊开方向与速度，转向换算成角度——时间线是给人看的，
 * 不是给机器读的原始参数对象。
 */
export const formatDecisionAction = (decision: AiDecision): string => {
  const parameters = decision.parameters ?? {}
  switch (decision.action) {
    case 'move': {
      const direction = Array.isArray(parameters.direction) ? parameters.direction : null
      const directionText =
        direction && direction.length >= 3
          ? `方向 (${round2(direction[0]).toFixed(2)}, ${round2(direction[2]).toFixed(2)})`
          : '方向 —'
      const speed = Number(parameters.speed)
      return Number.isFinite(speed)
        ? `移动 ${directionText} · 速度 ${speed.toFixed(1)}`
        : `移动 ${directionText}`
    }
    case 'rotate': {
      const angle = Number(parameters.angle)
      if (!Number.isFinite(angle)) return '转向'
      const degrees = (angle * 180) / Math.PI
      return `转向 ${degrees >= 0 ? '+' : ''}${degrees.toFixed(0)}°`
    }
    case 'interact':
      return '交互（尚未实现）'
    case 'wait':
      return '等待'
    default:
      return String(decision.action)
  }
}

/** 决策当时的感知摘要——旧数据没有这些字段时统一显示「—」 */
export interface DecisionPerceptionSummary {
  awareness: number | null
  nearestObstacleDistance: number | null
  obstaclesInRange: number | null
  blocked: boolean
  awarenessText: string
  distanceText: string
  obstaclesText: string
}

export const summarizeDecisionPerception = (
  decision: AiDecision,
): DecisionPerceptionSummary => {
  const perception = decision.perception
  return {
    awareness: perception ? perception.awareness : null,
    nearestObstacleDistance: perception ? perception.nearestObstacleDistance : null,
    obstaclesInRange: perception ? perception.obstaclesInRange : null,
    blocked: Boolean(perception?.blocked),
    awarenessText:
      perception && Number.isFinite(perception.awareness)
        ? `${perception.awareness.toFixed(1)} 米`
        : '—',
    distanceText: formatNearestObstacle(perception?.nearestObstacleDistance),
    obstaclesText:
      perception && Number.isFinite(perception.obstaclesInRange)
        ? String(perception.obstaclesInRange)
        : '—',
  }
}

/** 按智能体筛选；`'all'` 表示不筛 */
export const filterDecisionsByAgent = (
  decisions: readonly AiDecision[],
  agentId: string = 'all',
): AiDecision[] =>
  agentId === 'all'
    ? [...decisions]
    : decisions.filter((decision) => decision.agentId === agentId)

/** 时间线里的一行 */
export interface DecisionTimelineRow {
  /** 渲染用的稳定 key（同一条决策不会因为列表被裁剪而换 key） */
  key: string
  timestamp: number
  clock: string
  simTime: string
  agentId: string
  agentName: string
  source: AiDecisionSource
  sourceLabel: string
  actionText: string
  awarenessText: string
  distanceText: string
  obstaclesText: string
  obstaclesInRange: number | null
  blocked: boolean
}

export interface TimelineOptions {
  /** 只显示某个智能体；默认全部 */
  agentId?: string
  /** 最多取最近多少条；默认 TIMELINE_LIMIT */
  limit?: number
}

/**
 * 把决策队列折成时间线行：**最新在上**。
 *
 * 只取最近 `limit` 条（默认 100），与队列本身的裁剪策略无关。
 */
export const toTimelineRows = (
  decisions: readonly AiDecision[],
  options: TimelineOptions = {},
): DecisionTimelineRow[] => {
  const { agentId = 'all', limit = TIMELINE_LIMIT } = options
  const filtered = filterDecisionsByAgent(decisions, agentId)
  const recent = filtered.slice(-Math.max(1, limit))

  return recent
    .map((decision, index) => {
      const perception = summarizeDecisionPerception(decision)
      const source: AiDecisionSource = decision.source === 'llm' ? 'llm' : 'rule'
      return {
        key: `${decision.agentId}-${decision.timestamp}-${index}`,
        timestamp: decision.timestamp,
        clock: formatDecisionClock(decision.timestamp),
        simTime: formatSimulationTime(decision.simTime),
        agentId: decision.agentId,
        agentName: decision.agentName || decision.agentId,
        source,
        sourceLabel: decisionSourceLabel(source),
        actionText: formatDecisionAction(decision),
        awarenessText: perception.awarenessText,
        distanceText: perception.distanceText,
        obstaclesText: perception.obstaclesText,
        obstaclesInRange: perception.obstaclesInRange,
        blocked: perception.blocked,
      }
    })
    .reverse()
}

/** 筛选下拉用的智能体清单（按首次出现顺序，带决策条数） */
export interface TimelineAgentOption {
  id: string
  name: string
  count: number
}

export const collectTimelineAgents = (
  decisions: readonly AiDecision[],
): TimelineAgentOption[] => {
  const options = new Map<string, TimelineAgentOption>()
  for (const decision of decisions) {
    const existing = options.get(decision.agentId)
    if (existing) {
      existing.count += 1
      if (!existing.name || existing.name === decision.agentId) {
        existing.name = decision.agentName || decision.agentId
      }
      continue
    }
    options.set(decision.agentId, {
      id: decision.agentId,
      name: decision.agentName || decision.agentId,
      count: 1,
    })
  }
  return Array.from(options.values())
}
