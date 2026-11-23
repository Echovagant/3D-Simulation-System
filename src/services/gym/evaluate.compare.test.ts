/**
 * 策略对比纯函数的回归网。
 *
 * 只锁 compareGymEvalResults 的口径：成功率分母含失败、均值只算无错误运行、
 * Δ 以第一个策略为基准、逐任务矩阵按首次出现排序且缺失格为 null。
 * HTTP 与 store 都不参与。
 */
import { describe, expect, it } from 'vitest'
import { compareGymEvalResults } from './evaluate'
import type { GymEvalRunResult } from '@/stores/gymEvaluationStore'

const makeResult = (overrides: Partial<GymEvalRunResult> = {}): GymEvalRunResult => ({
  taskId: 't1',
  taskName: '任务一',
  policyId: 'constant',
  success: true,
  steps: 10,
  totalReward: 1,
  wallClockMs: 100,
  finalDistance: 0.2,
  error: null,
  ...overrides,
})

describe('compareGymEvalResults', () => {
  it('按策略给出六个指标，Δ 以第一个策略为基准', () => {
    const results: GymEvalRunResult[] = [
      makeResult({ taskId: 't1', policyId: 'constant', success: true, steps: 10, totalReward: 2, finalDistance: 0.3 }),
      makeResult({ taskId: 't1', policyId: 'proportional', success: true, steps: 6, totalReward: 4, finalDistance: 0.1 }),
      makeResult({ taskId: 't2', policyId: 'constant', success: false, steps: 20, totalReward: 0.5, finalDistance: 2 }),
      makeResult({ taskId: 't2', policyId: 'proportional', success: true, steps: 8, totalReward: 1, finalDistance: 0.4 }),
    ]

    const comparison = compareGymEvalResults(results, ['constant', 'proportional'])

    expect(comparison.baselinePolicyId).toBe('constant')
    expect(comparison.policies).toHaveLength(2)

    const [constant, proportional] = comparison.policies
    expect(constant).toMatchObject({
      runs: 2,
      successRate: 0.5,
      successRateDelta: 0,
      avgSteps: 15,
      avgReward: 1.25,
      avgFinalDistance: 1.15,
      errors: 0,
      errorsDelta: 0,
    })
    expect(proportional).toMatchObject({
      runs: 2,
      successRate: 1,
      successRateDelta: 0.5,
      avgSteps: 7,
      avgStepsDelta: -8,
      avgReward: 2.5,
      avgRewardDelta: 1.25,
      errors: 0,
      errorsDelta: 0,
    })
    expect(proportional.avgFinalDistance).toBeCloseTo(0.25, 8)
    expect(proportional.avgFinalDistanceDelta).toBeCloseTo(-0.9, 8)
  })

  it('失败运行：成功率分母含它，均值与距离只算无错误运行，错误数单独计', () => {
    const results: GymEvalRunResult[] = [
      makeResult({ taskId: 't1', success: true, steps: 5, finalDistance: 0.4 }),
      makeResult({
        taskId: 't2',
        success: false,
        steps: 0,
        totalReward: 0,
        finalDistance: null,
        error: '后端不可达，会话没建起来',
      }),
      makeResult({ taskId: 't3', policyId: 'proportional', success: true, steps: 7, finalDistance: 0.5 }),
    ]

    const comparison = compareGymEvalResults(results, ['constant', 'proportional'])
    const constant = comparison.policies[0]

    expect(constant.runs).toBe(2)
    expect(constant.successRate).toBeCloseTo(0.5, 8)
    expect(constant.avgSteps).toBe(5)
    expect(constant.avgFinalDistance).toBeCloseTo(0.4, 8)
    expect(constant.errors).toBe(1)

    // proportional 只有一条成功运行，Δ 相对 constant
    expect(comparison.policies[1].successRateDelta).toBeCloseTo(0.5, 8)
    expect(comparison.policies[1].errorsDelta).toBe(-1)
  })

  it('没有可用最终距离时平均值为 null，Δ 也为 null', () => {
    const results: GymEvalRunResult[] = [
      makeResult({ policyId: 'constant', finalDistance: null, success: false }),
      makeResult({ policyId: 'proportional', finalDistance: null, success: false, taskId: 't2' }),
    ]

    const comparison = compareGymEvalResults(results, ['constant', 'proportional'])

    expect(comparison.policies[0].avgFinalDistance).toBeNull()
    expect(comparison.policies[1].avgFinalDistance).toBeNull()
    expect(comparison.policies[1].avgFinalDistanceDelta).toBeNull()
  })

  it('逐任务矩阵：任务按首次出现排序，策略列顺序与指标行一致，缺失格为 null', () => {
    const results: GymEvalRunResult[] = [
      makeResult({ taskId: 't2', taskName: '任务二', policyId: 'constant', success: false, steps: 30 }),
      makeResult({
        taskId: 't1',
        taskName: '任务一',
        policyId: 'proportional',
        success: true,
        steps: 4,
        error: null,
      }),
    ]

    const comparison = compareGymEvalResults(results, ['constant', 'proportional'])

    expect(comparison.matrix.map((row) => row.taskId)).toEqual(['t2', 't1'])
    expect(comparison.matrix[0].cells).toEqual([
      { policyId: 'constant', success: false, steps: 30, error: null },
      null,
    ])
    expect(comparison.matrix[1].cells).toEqual([
      null,
      { policyId: 'proportional', success: true, steps: 4, error: null },
    ])
  })

  it('矩阵里的错误格保留错误文案，便于定位失败来源', () => {
    const results: GymEvalRunResult[] = [
      makeResult({
        taskId: 't1',
        policyId: 'constant',
        success: false,
        steps: 0,
        error: '力上限 = 30N，收到 999N，请减小',
      }),
    ]

    const comparison = compareGymEvalResults(results, ['constant'])
    const [cell] = comparison.matrix[0].cells

    expect(cell).toMatchObject({
      policyId: 'constant',
      success: false,
      steps: 0,
      error: '力上限 = 30N，收到 999N，请减小',
    })
  })

  it('空结果：基准为 null、矩阵为空；结果里出现的策略也会补进对比', () => {
    const empty = compareGymEvalResults([], ['constant', 'proportional'])
    expect(empty.baselinePolicyId).toBe('constant')
    expect(empty.matrix).toEqual([])
    expect(empty.policies.map((row) => row.runs)).toEqual([0, 0])

    const onlyResults = compareGymEvalResults(
      [makeResult({ policyId: 'proportional' })],
      [],
    )
    expect(onlyResults.baselinePolicyId).toBe('proportional')
    expect(onlyResults.policies).toHaveLength(1)
    expect(onlyResults.policies[0].runs).toBe(1)
  })
})
