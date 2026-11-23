import { describe, expect, it, vi } from 'vitest'
import { llmConfig } from '@/config/llm'
import type { GymObservation } from '@/services/api/gymWorkbench'
import {
  buildGymDecisionMessages,
  buildGymDecisionSnapshot,
  GYM_DEFAULT_FORCE_LIMIT,
  GYM_FORCE_MARGIN,
  parseForceProposal,
  proposeForceAction,
  type GymDecisionSnapshot,
} from './gymDecision'

/**
 * 力动作提议的回归网。
 *
 * 出网口全程用替身（invoke 注入），盯三件事：
 * 提示词确实带了观测数据、解析层对畸形输出永不抛异常、
 * 超上限提议被等比缩回安全线。
 */

const observation: GymObservation = {
  agent: { uuid: 'agent-1', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0.5, y: 0, z: -0.2 } },
  objects: [{ uuid: 'agent-1', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0.5, y: 0, z: -0.2 } }],
  target: { x: 3, z: 0 },
  step: 4,
  maxSteps: 300,
  distance: 3,
}

const snapshot: GymDecisionSnapshot = {
  agentPosition: { x: 0, y: 1, z: 0 },
  agentVelocity: { x: 0.5, y: 0, z: -0.2 },
  target: { x: 3, z: 0 },
  distance: 3,
  step: 4,
  maxSteps: 300,
  forceLimit: 30,
  lastStep: { reward: 0.1, terminated: false, truncated: false },
}

const invokeOk = (content: string) =>
  vi.fn(async (..._args: unknown[]) => ({ ok: true, content }))

describe('buildGymDecisionSnapshot', () => {
  it('从观测 + 上一步结果拼快照：位置、速度、目标、距离、力上限都在', () => {
    const snap = buildGymDecisionSnapshot({ observation, lastStep: { reward: 0.1, terminated: false, truncated: false }, forceLimit: 30 })
    expect(snap.agentPosition).toEqual({ x: 0, y: 1, z: 0 })
    expect(snap.agentVelocity).toEqual({ x: 0.5, y: 0, z: -0.2 })
    expect(snap.target).toEqual({ x: 3, z: 0 })
    expect(snap.distance).toBe(3)
    expect(snap.step).toBe(4)
    expect(snap.maxSteps).toBe(300)
    expect(snap.forceLimit).toBe(30)
    expect(snap.lastStep?.reward).toBe(0.1)
  })

  it('观测里没有智能体时位置/速度为 null，不炸', () => {
    const snap = buildGymDecisionSnapshot({
      observation: { ...observation, agent: null },
      lastStep: null,
      forceLimit: 30,
    })
    expect(snap.agentPosition).toBeNull()
    expect(snap.agentVelocity).toBeNull()
    expect(snap.lastStep).toBeNull()
  })

  it('力上限非法（0 / 非有限数）回落默认 30N', () => {
    expect(buildGymDecisionSnapshot({ observation, lastStep: null, forceLimit: 0 }).forceLimit).toBe(
      GYM_DEFAULT_FORCE_LIMIT,
    )
    expect(
      buildGymDecisionSnapshot({ observation, lastStep: null, forceLimit: Number.NaN }).forceLimit,
    ).toBe(GYM_DEFAULT_FORCE_LIMIT)
  })
})

describe('buildGymDecisionMessages', () => {
  it('系统提示词讲清输出格式与安全上限，用户内容带全部观测数据', () => {
    const [system, user] = buildGymDecisionMessages(snapshot)
    expect(system.role).toBe('system')
    expect(system.content).toContain('{"forceX": <数字>, "forceZ": <数字>}')
    expect(system.content).toContain('safe_force_limit')

    const payload = JSON.parse(user.content) as Record<string, unknown>
    expect(payload.agent_position).toEqual({ x: 0, y: 1, z: 0 })
    expect(payload.target).toEqual({ x: 3, z: 0 })
    expect(payload.distance).toBe(3)
    expect(payload.force_limit).toBe(30)
    // 安全上限 = 力上限 × 0.8，直接给模型算好的数，不让它自己乘
    expect(payload.safe_force_limit).toBe(24)
    expect(payload.last_step).toEqual({ reward: 0.1, terminated: false, truncated: false })
  })
})

describe('proposeForceAction（mock invoke）', () => {
  it('合法 JSON：解析出 forceX/forceZ，来源留档原样带回', async () => {
    const invoke = invokeOk('{"forceX": 5, "forceZ": 0}')
    const result = await proposeForceAction(snapshot, { invoke, provider: '测试商', model: 'test-model' })

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.action).toEqual({ forceX: 5, forceZ: 0 })
    expect(result.clamped).toBe(false)
    expect(result.original).toBeNull()
    expect(result.source).toEqual({ provider: '测试商', model: 'test-model' })

    // 出网口收到的是消息数组与控制器输出上限
    expect(invoke).toHaveBeenCalledTimes(1)
    const [messages, maxTokens] = invoke.mock.calls[0]
    expect(messages).toHaveLength(2)
    expect(maxTokens).toBe(llmConfig.controllerMaxTokens)
  })

  it('JSON 外裹说明文字与代码块：照样抠出来解析', async () => {
    const invoke = invokeOk('好的，提议如下：\n```json\n{"forceX": -2.5, "forceZ": 1}\n```')
    const result = await proposeForceAction(snapshot, { invoke })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action).toEqual({ forceX: -2.5, forceZ: 1 })
  })

  it('数字字符串也认（模型偶尔把数字带引号输出）', async () => {
    const invoke = invokeOk('{"forceX": "6", "forceZ": "-1"}')
    const result = await proposeForceAction(snapshot, { invoke })
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.action).toEqual({ forceX: 6, forceZ: -1 })
  })

  it('零力提议合法（回合结束时模型就该这么提）', async () => {
    const invoke = invokeOk('{"forceX": 0, "forceZ": 0}')
    const result = await proposeForceAction(snapshot, { invoke })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.action).toEqual({ forceX: 0, forceZ: 0 })
      expect(result.clamped).toBe(false)
    }
  })

  it.each([
    ['没有 JSON 的一段话', '我觉得应该往左推一点'],
    ['JSON 缺 forceX', '{"forceX": 5}'],
    ['forceX 不是数字', '{"forceX": "abc", "forceZ": 0}'],
    ['forceX 是 null（Number(null) 静默变 0 的坑，必须拒）', '{"forceX": null, "forceZ": 0}'],
    ['forceX 是 NaN 字面量（JSON.parse 直接炸）', '{"forceX": NaN, "forceZ": 0}'],
    ['空数组', '[]'],
    ['空串', ''],
  ])('畸形输出转 ok:false 不抛异常：%s', async (_label, content) => {
    const result = await proposeForceAction(snapshot, { invoke: invokeOk(content) })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toBeTruthy()
  })

  it('超上限提议：等比缩回到安全线，方向不变，原始值留档', async () => {
    // 力上限 30 → 安全线 24；提议 (30, 0) 模长 30 > 24
    const invoke = invokeOk('{"forceX": 30, "forceZ": 0}')
    const result = await proposeForceAction(snapshot, { invoke })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.clamped).toBe(true)
    expect(result.action).toEqual({ forceX: 24, forceZ: 0 })
    expect(result.original).toEqual({ forceX: 30, forceZ: 0 })
    // 缩完仍在安全线内（含浮点容差）
    expect(Math.hypot(result.action.forceX, result.action.forceZ)).toBeLessThanOrEqual(
      30 * GYM_FORCE_MARGIN + 1e-9,
    )
  })

  it('斜向超上限：缩回后模长恰好等于安全线', async () => {
    const invoke = invokeOk('{"forceX": 6, "forceZ": 8}')
    const result = await proposeForceAction({ ...snapshot, forceLimit: 10 }, { invoke })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.clamped).toBe(true)
    expect(result.action).toEqual({ forceX: 4.8, forceZ: 6.4 })
    expect(Math.hypot(result.action.forceX, result.action.forceZ)).toBeCloseTo(8, 6)
    expect(result.original).toEqual({ forceX: 6, forceZ: 8 })
  })

  it('invoke 报失败（未配 key / 冷却 / 上限）：错误原样透传', async () => {
    const invoke = vi.fn(async () => ({
      ok: false,
      content: '',
      error: '上一次调用失败后仍在冷却期（还需 5 秒）',
    }))
    const result = await proposeForceAction(snapshot, { invoke })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('冷却期')
  })

  it('正文为空分两种：截断可重试，真空也明说', async () => {
    const truncated = await proposeForceAction(snapshot, {
      invoke: vi.fn(async () => ({ ok: true, content: '', emptyReason: 'truncated' as const })),
    })
    expect(truncated.ok).toBe(false)
    if (!truncated.ok) expect(truncated.error).toContain('截断')

    const empty = await proposeForceAction(snapshot, {
      invoke: vi.fn(async () => ({ ok: true, content: '' })),
    })
    expect(empty.ok).toBe(false)
    if (!empty.ok) expect(empty.error).toContain('空内容')
  })

  it('invoke 本身抛异常也不炸穿：兜成一句可读的失败', async () => {
    const invoke = vi.fn(async () => {
      throw new Error('网络断了')
    })
    const result = await proposeForceAction(snapshot, { invoke })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('网络断了')
  })
})

describe('parseForceProposal（直接测闸门）', () => {
  it('力上限非法时拒收（不该有越不过校验的提议）', () => {
    const result = parseForceProposal('{"forceX": 1, "forceZ": 0}', 0)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain('力上限非法')
  })

  it('成功结果的 raw 留档截到 200 字符', () => {
    const result = parseForceProposal('{"forceX": 1, "forceZ": 0}', 30)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.raw.length).toBeLessThanOrEqual(200)
  })
})
