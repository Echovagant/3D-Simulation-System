import { describe, it, expect } from 'vitest'
import type { AiDecision } from '@/types'
import {
  TIMELINE_LIMIT,
  collectTimelineAgents,
  decisionSourceLabel,
  filterDecisionsByAgent,
  formatDecisionAction,
  formatDecisionClock,
  formatNearestObstacle,
  formatSimulationTime,
  summarizeDecisionPerception,
  toTimelineRows,
} from './decisionTimeline'

const makeDecision = (overrides: Partial<AiDecision> = {}): AiDecision => ({
  agentId: 'agent-1',
  action: 'move',
  parameters: { direction: [0.5, 0, -0.8660254], speed: 5 },
  confidence: 0.8,
  timestamp: new Date('2026-01-02T03:04:05').getTime(),
  ...overrides,
})

describe('decisionTimeline —— 动作与时间的可读化', () => {
  it('move 摊开方向与速度，浮点数取整到两位', () => {
    expect(formatDecisionAction(makeDecision())).toBe(
      '移动 方向 (0.50, -0.87) · 速度 5.0',
    )
  })

  it('rotate 把弧度换算成角度', () => {
    expect(
      formatDecisionAction(makeDecision({ action: 'rotate', parameters: { angle: Math.PI / 3 } })),
    ).toBe('转向 +60°')
  })

  it('wait / interact 有各自的文案', () => {
    expect(formatDecisionAction(makeDecision({ action: 'wait', parameters: {} }))).toBe('等待')
    expect(formatDecisionAction(makeDecision({ action: 'interact', parameters: {} }))).toContain(
      '交互',
    )
  })

  it('时间格式固定为 HH:MM:SS，不依赖 Intl', () => {
    expect(formatDecisionClock(makeDecision().timestamp)).toBe('03:04:05')
  })

  it('仿真时间格式为 mm:ss.s，缺失时显示「—」', () => {
    expect(formatSimulationTime(5.25)).toBe('00:05.3')
    expect(formatSimulationTime(65.04)).toBe('01:05.0')
    expect(formatSimulationTime(undefined)).toBe('—')
  })

  it('最近障碍距离：999（视野内无障碍）显示「—」', () => {
    expect(formatNearestObstacle(3.456)).toBe('3.46 米')
    expect(formatNearestObstacle(999)).toBe('—')
    expect(formatNearestObstacle(null)).toBe('—')
  })

  it('来源徽标：llm → LLM，其余（含缺失）→ 规则', () => {
    expect(decisionSourceLabel('llm')).toBe('LLM')
    expect(decisionSourceLabel('rule')).toBe('规则')
    expect(decisionSourceLabel(undefined)).toBe('规则')
  })
})

describe('decisionTimeline —— 感知摘要', () => {
  it('旧决策没有感知字段时全部显示「—」', () => {
    const summary = summarizeDecisionPerception(makeDecision())
    expect(summary.awareness).toBeNull()
    expect(summary.nearestObstacleDistance).toBeNull()
    expect(summary.blocked).toBe(false)
    expect(summary.awarenessText).toBe('—')
    expect(summary.distanceText).toBe('—')
    expect(summary.obstaclesText).toBe('—')
  })

  it('新决策带出感知半径、最近障碍距离、视野内数量与受阻标记', () => {
    const summary = summarizeDecisionPerception(
      makeDecision({
        perception: {
          awareness: 12,
          nearestObstacleDistance: 2.5,
          obstaclesInRange: 3,
          blocked: true,
        },
      }),
    )
    expect(summary.awarenessText).toBe('12.0 米')
    expect(summary.distanceText).toBe('2.50 米')
    expect(summary.obstaclesText).toBe('3')
    expect(summary.blocked).toBe(true)
  })
})

describe('decisionTimeline —— 时间线行', () => {
  it('最新在上，且只保留最近 limit 条', () => {
    const decisions = Array.from({ length: 5 }, (_, index) =>
      makeDecision({ timestamp: 1000 + index, agentId: `agent-${index}` }),
    )
    const rows = toTimelineRows(decisions, { limit: 3 })

    expect(rows.map((row) => row.timestamp)).toEqual([1004, 1003, 1002])
  })

  it('默认最多展示 100 条', () => {
    const decisions = Array.from({ length: 120 }, (_, index) =>
      makeDecision({ timestamp: 1000 + index }),
    )
    expect(toTimelineRows(decisions)).toHaveLength(TIMELINE_LIMIT)
    expect(toTimelineRows(decisions)[0].timestamp).toBe(1119)
  })

  it('按智能体筛选只留该智能体的决策', () => {
    const decisions = [
      makeDecision({ agentId: 'a', agentName: '甲' }),
      makeDecision({ agentId: 'b', agentName: '乙' }),
      makeDecision({ agentId: 'a', agentName: '甲' }),
    ]
    const rows = toTimelineRows(decisions, { agentId: 'a' })
    expect(rows).toHaveLength(2)
    expect(rows.every((row) => row.agentName === '甲')).toBe(true)
  })

  it('行里带来源徽标、动作文本与受阻标记', () => {
    const row = toTimelineRows([
      makeDecision({
        source: 'llm',
        agentName: '导航机器人',
        perception: {
          awareness: 10,
          nearestObstacleDistance: 1.2,
          obstaclesInRange: 1,
          blocked: true,
        },
      }),
    ])[0]

    expect(row.sourceLabel).toBe('LLM')
    expect(row.agentName).toBe('导航机器人')
    expect(row.actionText).toContain('移动')
    expect(row.distanceText).toBe('1.20 米')
    expect(row.blocked).toBe(true)
  })
})

describe('decisionTimeline —— 智能体清单与筛选', () => {
  it('按首次出现顺序收集智能体，并统计决策条数', () => {
    const decisions = [
      makeDecision({ agentId: 'a', agentName: '甲' }),
      makeDecision({ agentId: 'b', agentName: '乙' }),
      makeDecision({ agentId: 'a', agentName: '甲' }),
    ]
    expect(collectTimelineAgents(decisions)).toEqual([
      { id: 'a', name: '甲', count: 2 },
      { id: 'b', name: '乙', count: 1 },
    ])
  })

  it('filterDecisionsByAgent 的 all 不筛', () => {
    const decisions = [makeDecision({ agentId: 'a' }), makeDecision({ agentId: 'b' })]
    expect(filterDecisionsByAgent(decisions, 'all')).toHaveLength(2)
    expect(filterDecisionsByAgent(decisions, 'b')).toHaveLength(1)
  })
})
