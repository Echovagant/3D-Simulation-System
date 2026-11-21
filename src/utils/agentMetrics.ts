/**
 * 智能体指标的纯函数聚合层。
 *
 * 数据来源是 useAI 的运行时快照（里程、碰撞次数、胜负），这里只做聚合：
 * 导航成功率、碰撞总数、路径效率。放进纯函数文件是为了直接单测，
 * 不用挂载任何组件——指标口径写在注释里，改口径先改这里再改测试。
 */

/** 单个智能体的指标原始数据（由 useAI 的运行时快照填） */
export interface AgentMetricInput {
  agentId: string
  agentName: string
  /** 是否达成过胜利条件（到达目标点） */
  goalReached: boolean
  /** 累计撞上障碍物的次数（blocked 上升沿计一次） */
  collisionCount: number
  /** 累计走过的水平路程（米） */
  pathLength: number
  /** 出生点到当前目标的直线距离（米） */
  straightDistance: number
}

/** 单个智能体的聚合指标 */
export interface AgentMetric {
  agentId: string
  agentName: string
  goalReached: boolean
  collisionCount: number
  pathLength: number
  /** 路径效率 = 直线距离 / 实际路程（≤1，1 = 走了完美直线）；路程太短时为 null */
  pathEfficiency: number | null
}

export interface AgentMetrics {
  totalAgents: number
  goalReachedCount: number
  /** 导航成功率 = 达成过胜利条件的智能体 / 总数；没有智能体时为 null */
  successRate: number | null
  collisionCountTotal: number
  /** 平均路径效率：只统计路程超过门槛的智能体；没有可统计对象时为 null */
  meanPathEfficiency: number | null
  perAgent: AgentMetric[]
}

/** 路径效率的最小路程门槛：比这还短的路程算不出有意义的效率 */
const MIN_PATH_LENGTH = 0.1

export const computeAgentMetrics = (inputs: AgentMetricInput[]): AgentMetrics => {
  const perAgent: AgentMetric[] = inputs.map((input) => ({
    agentId: input.agentId,
    agentName: input.agentName,
    goalReached: input.goalReached,
    collisionCount: input.collisionCount,
    pathLength: Math.round(input.pathLength * 100) / 100,
    // 效率理论上 ≤1（直线最短）；实际路程短于直线（抖动补偿、数值误差）时夹到 1
    pathEfficiency:
      input.pathLength > MIN_PATH_LENGTH
        ? Math.min(1, input.straightDistance / input.pathLength)
        : null,
  }))

  const totalAgents = inputs.length
  const goalReachedCount = inputs.filter((item) => item.goalReached).length
  const efficiencies = perAgent
    .map((item) => item.pathEfficiency)
    .filter((value): value is number => value !== null)

  return {
    totalAgents,
    goalReachedCount,
    successRate: totalAgents > 0 ? goalReachedCount / totalAgents : null,
    collisionCountTotal: inputs.reduce((sum, item) => sum + item.collisionCount, 0),
    meanPathEfficiency:
      efficiencies.length > 0
        ? efficiencies.reduce((sum, value) => sum + value, 0) / efficiencies.length
        : null,
    perAgent,
  }
}

/** 一行能放进 JSONL 摘要的指标串 */
export const formatMetricsSummary = (metrics: AgentMetrics): string => {
  const rate = metrics.successRate === null ? 'n/a' : `${(metrics.successRate * 100).toFixed(1)}%`
  const efficiency =
    metrics.meanPathEfficiency === null ? 'n/a' : metrics.meanPathEfficiency.toFixed(3)
  return (
    `agents=${metrics.totalAgents} goalReached=${metrics.goalReachedCount} ` +
    `successRate=${rate} collisions=${metrics.collisionCountTotal} ` +
    `meanPathEfficiency=${efficiency}`
  )
}
