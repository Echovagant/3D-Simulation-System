/**
 * 批量评测 runner 的回归网。
 *
 * HTTP 层整个被替身掉：这里锁的是「策略公式、终止条件、会话一定清理、
 * 单条失败不中断整批、汇总口径」这几件评测台真正依赖的行为。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from '@/services/api/client'

vi.mock('@/services/api/gymWorkbench', () => ({
  createGymSession: vi.fn(),
  stepGymSession: vi.fn(),
  deleteGymSession: vi.fn(),
}))

import {
  computeGymEvalForce,
  evaluateTaskSuite,
  GYM_EVAL_GOAL_RADIUS,
  serializeGymEvalResultsCsv,
} from './evaluate'
import {
  createGymSession,
  deleteGymSession,
  stepGymSession,
  type GymObservation,
  type GymSessionCreated,
  type GymStepResponse,
} from '@/services/api/gymWorkbench'
import type { GymEvalRunResult, GymTask, GymTaskSuite } from '@/stores/gymEvaluationStore'

const makeObservation = (overrides: Partial<GymObservation> = {}): GymObservation => ({
  agent: {
    uuid: 'agent-1',
    position: { x: 0, y: 1, z: 0 },
    velocity: { x: 0, y: 0, z: 0 },
  },
  objects: [
    { uuid: 'agent-1', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  ],
  target: { x: 3, z: 0 },
  step: 0,
  maxSteps: 5,
  distance: 3,
  ...overrides,
})

const makeCreated = (overrides: Partial<GymSessionCreated> = {}): GymSessionCreated => ({
  sessionId: 'sess-1',
  observation: makeObservation(),
  reward: 0,
  terminated: false,
  truncated: false,
  effectiveParams: {
    gravityY: -9.81,
    friction: null,
    restitution: null,
    dt: 1 / 60,
    steps: 240,
    trace: false,
    initialVelocityY: 0,
  },
  droppedParamKeys: [],
  defaultedParamKeys: [],
  forceLimit: 10,
  ...overrides,
})

const makeStep = (overrides: Partial<GymStepResponse> = {}): GymStepResponse => ({
  observation: makeObservation({ step: 1, distance: 0.2 }),
  reward: 10,
  terminated: true,
  truncated: false,
  info: {},
  ...overrides,
})

const makeTask = (overrides: Partial<GymTask> = {}): GymTask => ({
  id: 'task-1',
  name: '任务一',
  scene: { objects: [] },
  target: { x: 3, z: 0 },
  maxSteps: 5,
  ...overrides,
})

const makeSuite = (tasks: GymTask[] = [makeTask()]): GymTaskSuite => ({
  id: 'suite-1',
  name: '回归套件',
  tasks,
})

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(deleteGymSession).mockResolvedValue(undefined)
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('computeGymEvalForce —— 策略公式与力上限', () => {
  it('恒定推力：方向朝目标，大小 = 力上限 × 50%', () => {
    const force = computeGymEvalForce({
      policy: 'constant',
      observation: makeObservation({ target: { x: 0, z: 3 } }),
      forceLimit: 10,
    })
    expect(force.forceX).toBeCloseTo(0, 8)
    expect(force.forceZ).toBeCloseTo(5, 8)
  })

  it('比例控制：min(力上限 × 80%, 距离 × 2)，远距离封顶在 80%', () => {
    const near = computeGymEvalForce({
      policy: 'proportional',
      observation: makeObservation({ target: { x: 3, z: 0 } }),
      forceLimit: 10,
    })
    expect(Math.hypot(near.forceX, near.forceZ)).toBeCloseTo(6, 8)

    const far = computeGymEvalForce({
      policy: 'proportional',
      observation: makeObservation({ target: { x: 1000, z: 0 } }),
      forceLimit: 10,
    })
    expect(Math.hypot(far.forceX, far.forceZ)).toBeCloseTo(8, 8)
  })

  it('力上限非法时回落默认值，仍不超过上限', () => {
    const force = computeGymEvalForce({
      policy: 'constant',
      observation: makeObservation(),
      forceLimit: Number.NaN,
    })
    expect(Math.hypot(force.forceX, force.forceZ)).toBeCloseTo(15, 8)
    expect(Math.hypot(force.forceX, force.forceZ)).toBeLessThanOrEqual(30)
  })

  it('没有智能体或已经贴到目标时给零力', () => {
    expect(
      computeGymEvalForce({
        policy: 'constant',
        observation: makeObservation({ agent: null }),
        forceLimit: 10,
      }),
    ).toEqual({ forceX: 0, forceZ: 0 })

    expect(
      computeGymEvalForce({
        policy: 'proportional',
        observation: makeObservation({
          agent: {
            uuid: 'agent-1',
            position: { x: 3, y: 1, z: 0 },
            velocity: { x: 0, y: 0, z: 0 },
          },
        }),
        forceLimit: 10,
      }),
    ).toEqual({ forceX: 0, forceZ: 0 })
  })
})

describe('evaluateTaskSuite —— 正常路径', () => {
  it('一步 terminated：记成功、累计 reward、销毁会话、汇总正确', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(makeStep())
    const onProgress = vi.fn()

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite(),
      policies: ['constant'],
      ownerToken: 'owner-1',
      onProgress,
    })

    expect(evaluation.results).toHaveLength(1)
    const [result] = evaluation.results
    expect(result).toMatchObject({
      taskId: 'task-1',
      policyId: 'constant',
      success: true,
      steps: 1,
      totalReward: 10,
      error: null,
    })
    expect(deleteGymSession).toHaveBeenCalledWith('owner-1', 'sess-1')
    expect(evaluation.summary).toMatchObject({
      totalRuns: 1,
      successes: 1,
      successRate: 1,
      avgSteps: 1,
      avgReward: 10,
    })
    expect(evaluation.summary.byPolicy).toHaveLength(1)
    expect(onProgress).toHaveBeenLastCalledWith({
      completed: 1,
      total: 1,
      currentTaskName: '',
      currentPolicyId: null,
    })
  })

  it('terminated 但最终距离很远（坠出世界）不算成功', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(
      makeStep({
        observation: makeObservation({ step: 1, distance: 20 }),
        terminated: true,
      }),
    )

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite(),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results[0]).toMatchObject({ success: false, steps: 1 })
    expect(evaluation.summary.successRate).toBe(0)
  })

  it('建会话时已在目标圈内：0 步成功，不推进也不留会话', async () => {
    vi.mocked(createGymSession).mockResolvedValue(
      makeCreated({ observation: makeObservation({ distance: 0.2 }) }),
    )

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite(),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results[0]).toMatchObject({ success: true, steps: 0 })
    expect(stepGymSession).not.toHaveBeenCalled()
    expect(deleteGymSession).toHaveBeenCalledWith('owner-1', 'sess-1')
  })

  it('多任务 × 多策略：逐条运行，进度总数正确', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(makeStep())
    const onProgress = vi.fn()

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite([makeTask({ id: 't1' }), makeTask({ id: 't2' })]),
      policies: ['constant', 'proportional'],
      ownerToken: 'owner-1',
      onProgress,
    })

    expect(evaluation.results).toHaveLength(4)
    expect(evaluation.summary.totalRuns).toBe(4)
    expect(evaluation.summary.byPolicy.map((row) => row.policyId)).toEqual([
      'constant',
      'proportional',
    ])
    expect(deleteGymSession).toHaveBeenCalledTimes(4)
    expect(onProgress).toHaveBeenLastCalledWith({
      completed: 4,
      total: 4,
      currentTaskName: '',
      currentPolicyId: null,
    })
  })

  it('两种策略实际发出的力都不超过 forceLimit', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(makeStep())

    await evaluateTaskSuite({
      suite: makeSuite([makeTask({ maxSteps: 1 })]),
      policies: ['constant', 'proportional'],
      ownerToken: 'owner-1',
    })

    const actions = vi.mocked(stepGymSession).mock.calls.map((call) => call[2])
    expect(actions).toHaveLength(2)
    for (const action of actions) {
      expect(Math.hypot(action.forceX, action.forceZ)).toBeLessThanOrEqual(10)
    }
    expect(Math.hypot(actions[0].forceX, actions[0].forceZ)).toBeCloseTo(5, 8)
    expect(Math.hypot(actions[1].forceX, actions[1].forceZ)).toBeCloseTo(6, 8)
  })
})

describe('evaluateTaskSuite —— 终局与上限', () => {
  it('truncated：按步数截断，未进目标圈算失败', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(
      makeStep({
        observation: makeObservation({ step: 1, distance: 2 }),
        reward: 1,
        terminated: false,
        truncated: true,
      }),
    )

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite([makeTask({ maxSteps: 2 })]),
      policies: ['proportional'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results[0]).toMatchObject({ success: false, steps: 1, totalReward: 1 })
    expect(deleteGymSession).toHaveBeenCalledWith('owner-1', 'sess-1')
  })

  it('后端一直不终止时，最多跑 maxSteps 步', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(
      makeStep({
        observation: makeObservation({ step: 1, distance: 2 }),
        reward: 0.1,
        terminated: false,
        truncated: false,
      }),
    )

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite([makeTask({ maxSteps: 3 })]),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(stepGymSession).toHaveBeenCalledTimes(3)
    expect(evaluation.results[0].steps).toBe(3)
    expect(evaluation.results[0].success).toBe(false)
    expect(deleteGymSession).toHaveBeenCalledTimes(1)
  })

  it('最终距离 <= 0.5m 也算成功（后端未置 terminated 的边界）', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(
      makeStep({
        observation: makeObservation({ step: 1, distance: GYM_EVAL_GOAL_RADIUS }),
        terminated: false,
        truncated: true,
      }),
    )

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite([makeTask({ maxSteps: 1 })]),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results[0].success).toBe(true)
  })
})

describe('evaluateTaskSuite —— 失败隔离与会话清理', () => {
  it('step 422：把修复指令记到该 run，仍然销毁会话，其余任务继续', async () => {
    vi.mocked(createGymSession)
      .mockResolvedValueOnce(makeCreated({ sessionId: 'sess-1' }))
      .mockResolvedValueOnce(makeCreated({ sessionId: 'sess-2' }))
    vi.mocked(stepGymSession)
      .mockRejectedValueOnce(
        new ApiError('力上限 = 30N，收到 999N，请减小', {
          code: 'gym_force_out_of_range',
          status: 422,
        }),
      )
      .mockResolvedValueOnce(makeStep())

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite([makeTask({ id: 't1' }), makeTask({ id: 't2' })]),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results).toHaveLength(2)
    expect(evaluation.results[0]).toMatchObject({ success: false, steps: 0 })
    expect(evaluation.results[0].error).toContain('力上限')
    expect(evaluation.results[1]).toMatchObject({ success: true, steps: 1 })
    expect(deleteGymSession).toHaveBeenCalledWith('owner-1', 'sess-1')
    expect(deleteGymSession).toHaveBeenCalledWith('owner-1', 'sess-2')
  })

  it('后端不可达（create 失败）：记可读错误，不调用 delete，整批不静默', async () => {
    vi.mocked(createGymSession).mockRejectedValue(new TypeError('Failed to fetch'))

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite([makeTask({ id: 't1' }), makeTask({ id: 't2' })]),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results).toHaveLength(2)
    for (const result of evaluation.results) {
      expect(result.success).toBe(false)
      expect(result.error).toContain('后端不可达')
    }
    expect(deleteGymSession).not.toHaveBeenCalled()
    expect(evaluation.summary.successRate).toBe(0)
  })

  it('清理失败不推翻已跑出的结果，但错误会写进该 run', async () => {
    vi.mocked(createGymSession).mockResolvedValue(makeCreated())
    vi.mocked(stepGymSession).mockResolvedValue(makeStep())
    vi.mocked(deleteGymSession).mockRejectedValue(new TypeError('Failed to fetch'))

    const evaluation = await evaluateTaskSuite({
      suite: makeSuite(),
      policies: ['constant'],
      ownerToken: 'owner-1',
    })

    expect(evaluation.results[0].success).toBe(true)
    expect(evaluation.results[0].error).toContain('会话清理失败')
  })
})

describe('serializeGymEvalResultsCsv', () => {
  it('输出表头与明细，含逗号的错误信息会被引号包住', () => {
    const result: GymEvalRunResult = {
      taskId: 't1',
      taskName: '带,逗号的任务',
      policyId: 'proportional',
      success: false,
      steps: 3,
      totalReward: -1.5,
      wallClockMs: 250,
      error: 'force limit = 30N, got 999N',
    }

    const csv = serializeGymEvalResultsCsv([result])
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('任务,策略,成功,步数,总奖励,耗时(ms),错误')
    expect(lines[1]).toContain('"带,逗号的任务"')
    expect(lines[1]).toContain('比例控制')
    expect(lines[1]).toContain('否')
    expect(lines[1]).toContain('"force limit = 30N, got 999N"')
  })
})
