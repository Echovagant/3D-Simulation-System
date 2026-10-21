// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import {
  buildDecisionMessages,
  buildExplainMessages,
  extractJsonObject,
  parseLlmAction,
  type AgentSnapshot,
} from './prompts'

const snapshot: AgentSnapshot = {
  id: 'agent-1',
  name: '导航机器人',
  type: 'basic',
  position: [1, 0.4, -2],
  velocity: [3, 0, 1],
  goalDirection: [0.2, 0.98],
  goal: [5, 0.4, 12],
  nearestObstacleDistance: 2.4,
  obstaclesInRange: 2,
  awarenessRange: 10,
  maxSpeed: 8,
  collided: false,
  lastAction: 'move',
  lastParameters: { direction: [0, 0, 1], speed: 5 },
}

describe('LLM 提示词', () => {
  it('控制器提示词里写清了可用动作与 JSON 格式要求', () => {
    const messages = buildDecisionMessages(snapshot)
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('"action":"move"')
    expect(messages[0].content).toContain('"action":"rotate"')
    expect(messages[0].content).toContain('"action":"wait"')
    expect(messages[0].content).toContain('JSON')
  })

  it('状态快照真的进了提示词（感知数字不能丢）', () => {
    const payload = JSON.parse(buildDecisionMessages(snapshot)[1].content)
    expect(payload.nearest_obstacle_distance).toBe(2.4)
    expect(payload.obstacles_in_range).toBe(2)
    expect(payload.awareness_range).toBe(10)
    expect(payload.goal_direction).toEqual([0.2, 0.98])
    expect(payload.last_action).toBe('move')
  })

  it('解释层提示词要求输出说明文字而不是 JSON', () => {
    const messages = buildExplainMessages(snapshot)
    expect(messages[0].content).toContain('讲解员')
    expect(messages[0].content).toContain('不要 JSON')
  })
})

describe('从模型回复里抠 JSON', () => {
  it('能处理 Markdown 代码块包裹', () => {
    const raw = '好的，这是动作：\n```json\n{"action":"wait"}\n```\n希望有帮助。'
    expect(extractJsonObject(raw)).toBe('{"action":"wait"}')
  })

  it('能处理前后有闲话的情况', () => {
    const raw = 'I think {"action":"move","direction":[0,1],"speed":4} is right.'
    expect(extractJsonObject(raw)).toBe('{"action":"move","direction":[0,1],"speed":4}')
  })

  it('字符串里的括号不会把提取器带偏', () => {
    const raw = '{"action":"wait","note":"有个 { 在字符串里"}'
    expect(extractJsonObject(raw)).toBe('{"action":"wait","note":"有个 { 在字符串里"}')
  })

  it('没有 JSON 时返回 null', () => {
    expect(extractJsonObject('完全不是 JSON')).toBeNull()
  })
})

describe('动作校验（LLM 与物理之间唯一的闸门）', () => {
  it('接受合法动作并归一化方向', () => {
    const action = parseLlmAction('{"action":"move","direction":[3,4],"speed":5}')
    expect(action).not.toBeNull()
    expect(action?.action).toBe('move')
    expect(action?.direction?.[0]).toBeCloseTo(0.6, 6)
    expect(action?.direction?.[1]).toBeCloseTo(0.8, 6)
    expect(action?.speed).toBe(5)
  })

  it('速度被夹在允许范围内', () => {
    expect(parseLlmAction('{"action":"move","direction":[0,1],"speed":999}')?.speed).toBe(8)
    expect(parseLlmAction('{"action":"move","direction":[0,1],"speed":0.01}')?.speed).toBe(0.5)
  })

  it('转向角被夹在 ±π', () => {
    expect(parseLlmAction('{"action":"rotate","angle":99}')?.angle).toBeCloseTo(Math.PI, 6)
    expect(parseLlmAction('{"action":"rotate","angle":-99}')?.angle).toBeCloseTo(-Math.PI, 6)
  })

  it('非法动作一律拒绝（调用方会回落到规则式）', () => {
    expect(parseLlmAction('{"action":"jump"}')).toBeNull()
    expect(parseLlmAction('{"action":"move"}')).toBeNull()
    expect(parseLlmAction('{"action":"move","direction":[0,0]}')).toBeNull()
    expect(parseLlmAction('{"action":"move","direction":"前"}')).toBeNull()
    expect(parseLlmAction('{"action":"rotate"}')).toBeNull()
    expect(parseLlmAction('完全不是 JSON')).toBeNull()
    expect(parseLlmAction('')).toBeNull()
  })

  it('wait 不带任何参数', () => {
    expect(parseLlmAction('{"action":"wait"}')).toEqual({ action: 'wait' })
  })
})
