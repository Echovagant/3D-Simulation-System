// @vitest-environment jsdom
/**
 * 决策时间线的可观察行为：
 *
 * 1. 空状态要给出可读文案，而不是一片空白；
 * 2. 每行能看出「谁、什么时候、什么来源、做了什么、当时看到什么」；
 * 3. 最新在上，最多展示最近 100 条；
 * 4. 筛选下拉按智能体过滤。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import DecisionTimelinePanel from './DecisionTimelinePanel.vue'
import type { AiDecision } from '@/types'

const makeDecision = (overrides: Partial<AiDecision> = {}): AiDecision => ({
  agentId: 'agent-1',
  agentName: '导航机器人',
  action: 'move',
  parameters: { direction: [0, 0, 1], speed: 5 },
  confidence: 0.9,
  timestamp: new Date('2026-01-02T03:04:05').getTime(),
  simTime: 12.3,
  source: 'rule',
  perception: {
    awareness: 10,
    nearestObstacleDistance: 3.21,
    obstaclesInRange: 2,
    blocked: false,
  },
  ...overrides,
})

const mountPanel = (decisions: AiDecision[], limit?: number) =>
  mount(DecisionTimelinePanel, { props: { decisions, ...(limit ? { limit } : {}) } })

describe('DecisionTimelinePanel —— 决策时间线', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('没有决策时给出可读的空状态', () => {
    const wrapper = mountPanel([])
    expect(wrapper.find('.dt-empty').exists()).toBe(true)
    expect(wrapper.text()).toContain('还没有决策记录')
    expect(wrapper.findAll('.dt-row')).toHaveLength(0)
  })

  it('一行里能看出时间、智能体、来源、动作与感知摘要', () => {
    const wrapper = mountPanel([makeDecision()])
    const row = wrapper.find('.dt-row')

    expect(row.exists()).toBe(true)
    expect(row.text()).toContain('03:04:05')
    expect(row.text()).toContain('导航机器人')
    expect(row.text()).toContain('规则')
    expect(row.text()).toContain('移动')
    expect(row.text()).toContain('3.21 米')
    expect(row.text()).toContain('仿真 00:12.3')
  })

  it('LLM 来源用单独的徽标，受阻决策带受阻标记', () => {
    const wrapper = mountPanel([
      makeDecision({
        source: 'llm',
        perception: {
          awareness: 10,
          nearestObstacleDistance: 1,
          obstaclesInRange: 1,
          blocked: true,
        },
      }),
    ])

    expect(wrapper.find('.dt-badge-llm').exists()).toBe(true)
    expect(wrapper.find('.dt-badge-blocked').exists()).toBe(true)
    expect(wrapper.find('.dt-row-blocked').exists()).toBe(true)
  })

  it('旧数据没有感知字段时显示「—」，不出现 NaN', () => {
    const legacy: AiDecision = {
      agentId: 'agent-old',
      action: 'wait',
      parameters: {},
      confidence: 0.5,
      timestamp: Date.now(),
    }
    const wrapper = mountPanel([legacy])

    expect(wrapper.text()).toContain('等待')
    expect(wrapper.text()).not.toContain('NaN')
    expect(wrapper.text()).toContain('—')
  })

  it('最新在上：第一行是最后一条决策', () => {
    const wrapper = mountPanel([
      makeDecision({ timestamp: 1000, agentName: '旧决策' }),
      makeDecision({ timestamp: 2000, agentName: '新决策' }),
    ])

    const rows = wrapper.findAll('.dt-row')
    expect(rows[0].text()).toContain('新决策')
    expect(rows[1].text()).toContain('旧决策')
  })

  it('最多展示最近 100 条', () => {
    const decisions = Array.from({ length: 120 }, (_, index) =>
      makeDecision({ timestamp: 1000 + index }),
    )
    const wrapper = mountPanel(decisions)

    expect(wrapper.findAll('.dt-row')).toHaveLength(100)
    expect(wrapper.text()).toContain('最近 100 条')
  })

  it('筛选下拉按智能体过滤', async () => {
    const wrapper = mountPanel([
      makeDecision({ agentId: 'a', agentName: '甲' }),
      makeDecision({ agentId: 'b', agentName: '乙' }),
    ])

    await wrapper.find('.dt-agent-filter').setValue('b')
    const rows = wrapper.findAll('.dt-row')
    expect(rows).toHaveLength(1)
    expect(rows[0].text()).toContain('乙')
  })
})
