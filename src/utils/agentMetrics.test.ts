import { describe, expect, it } from 'vitest'
import { computeAgentMetrics, formatMetricsSummary, type AgentMetricInput } from './agentMetrics'

/** 造一条指标原始数据 */
const buildInput = (overrides: Partial<AgentMetricInput> = {}): AgentMetricInput => ({
  agentId: 'agent-1',
  agentName: '一号',
  goalReached: false,
  collisionCount: 0,
  pathLength: 10,
  straightDistance: 5,
  ...overrides,
})

describe('computeAgentMetrics —— 指标聚合', () => {
  it('空列表：比例与效率如实给 null，不编 0', () => {
    const metrics = computeAgentMetrics([])
    expect(metrics.totalAgents).toBe(0)
    expect(metrics.successRate).toBeNull()
    expect(metrics.meanPathEfficiency).toBeNull()
    expect(metrics.collisionCountTotal).toBe(0)
    expect(metrics.perAgent).toEqual([])
  })

  it('导航成功率 = 达成胜利条件的智能体 / 总数', () => {
    const metrics = computeAgentMetrics([
      buildInput({ goalReached: true }),
      buildInput({ agentId: 'agent-2', goalReached: false }),
      buildInput({ agentId: 'agent-3', goalReached: true }),
    ])
    expect(metrics.totalAgents).toBe(3)
    expect(metrics.goalReachedCount).toBe(2)
    expect(metrics.successRate).toBeCloseTo(2 / 3, 10)
  })

  it('路径效率 = 直线距离 / 实际路程，且夹在 1 以内', () => {
    const [perfect] = computeAgentMetrics([
      buildInput({ pathLength: 10, straightDistance: 10 }),
    ]).perAgent
    expect(perfect.pathEfficiency).toBeCloseTo(1, 10)

    // 实际路程短于直线（抖动补偿 / 数值误差）时夹到 1，不出 >1 的怪数
    const [clamped] = computeAgentMetrics([
      buildInput({ pathLength: 5, straightDistance: 10 }),
    ]).perAgent
    expect(clamped.pathEfficiency).toBe(1)

    const [normal] = computeAgentMetrics([
      buildInput({ pathLength: 20, straightDistance: 5 }),
    ]).perAgent
    expect(normal.pathEfficiency).toBeCloseTo(0.25, 10)
  })

  it('路程低于门槛的智能体不参与效率平均（门槛 0.1 m）', () => {
    const metrics = computeAgentMetrics([
      buildInput({ agentId: 'agent-1', pathLength: 0.05, straightDistance: 0.05 }),
      buildInput({ agentId: 'agent-2', pathLength: 10, straightDistance: 5 }),
    ])
    expect(metrics.perAgent[0].pathEfficiency).toBeNull()
    expect(metrics.meanPathEfficiency).toBeCloseTo(0.5, 10)
  })

  it('碰撞次数跨智能体求和', () => {
    const metrics = computeAgentMetrics([
      buildInput({ collisionCount: 3 }),
      buildInput({ agentId: 'agent-2', collisionCount: 2 }),
    ])
    expect(metrics.collisionCountTotal).toBe(5)
  })
})

describe('formatMetricsSummary —— JSONL 摘要行', () => {
  it('有数据时输出全部指标', () => {
    const text = formatMetricsSummary(computeAgentMetrics([buildInput({ goalReached: true })]))
    expect(text).toContain('agents=1')
    expect(text).toContain('goalReached=1')
    expect(text).toContain('successRate=100.0%')
    expect(text).toContain('collisions=0')
  })

  it('空列表时比例输出 n/a，不装作有数据', () => {
    const text = formatMetricsSummary(computeAgentMetrics([]))
    expect(text).toContain('successRate=n/a')
    expect(text).toContain('meanPathEfficiency=n/a')
  })
})
