/**
 * Agent 评测台 · 批量评测 runner。
 *
 * 逐「任务 × 策略」建会话、循环推进、最后一定销毁会话（后端是内存态，最多 32 个，
 * 不清理会把后续任务挤掉）。两种策略都只用观测里的位置/目标算力，不调 LLM：
 *
 * - 恒定推力（constant）：方向朝目标，力大小 = 力上限 × 50%
 * - 比例控制（proportional）：方向朝目标，力大小 = min(力上限 × 80%, 距离 × 2)
 *
 * 力分量必须满足 `hypot(forceX, forceZ) <= forceLimit`，否则后端回 422。
 * 单次运行的失败（后端不可达 / 422 / 清理失败）只记在那一行 `error` 里，
 * 不中断整批——批量评测的意义就是「哪几条没跑起来」也要看得见。
 */
import {
  createGymSession,
  deleteGymSession,
  stepGymSession,
  type GymObservation,
} from '@/services/api/gymWorkbench'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import type {
  GymEvalPolicyId,
  GymEvalPolicySummary,
  GymEvalProgress,
  GymEvalRunResult,
  GymEvalSummary,
  GymTask,
  GymTaskSuite,
} from '@/stores/gymEvaluationStore'

/** 目标圈半径（米），与后端 gym_service.GOAL_RADIUS 同口径 */
export const GYM_EVAL_GOAL_RADIUS = 0.5

/** forceLimit 缺失时的保守回落；后端默认 30 × 1kg = 30N */
const FALLBACK_FORCE_LIMIT = 30

/** 恒定推力策略：出力占力上限的比例 */
export const CONSTANT_POLICY_RATIO = 0.5

/** 比例控制策略：出力最多用到力上限的 80%（留 20% 余量避免 422） */
export const PROPORTIONAL_POLICY_MAX_RATIO = 0.8

/** 比例控制策略的增益：离目标 1m 给 2N */
export const PROPORTIONAL_POLICY_GAIN = 2

const POLICY_LABELS: Record<GymEvalPolicyId, string> = {
  constant: '恒定推力',
  proportional: '比例控制',
}

/** 一次性批量评测的输入 */
export interface EvaluateTaskSuiteInput {
  suite: GymTaskSuite
  policies: GymEvalPolicyId[]
  ownerToken: string
  /** 每开始 / 完成一个「任务 × 策略」回调一次 */
  onProgress?: (progress: GymEvalProgress) => void
}

/** 一次性批量评测的输出 */
export interface GymEvalEvaluation {
  results: GymEvalRunResult[]
  summary: GymEvalSummary
  wallClockMs: number
}

/** 一步动作（与 step 端点同形状） */
export interface GymEvalForce {
  forceX: number
  forceZ: number
}

export interface GymEvalForceInput {
  policy: GymEvalPolicyId
  observation: GymObservation
  /** create 响应里的力上限（牛） */
  forceLimit: number
}

const resolveForceLimit = (value: number): number =>
  Number.isFinite(value) && value > 0 ? value : FALLBACK_FORCE_LIMIT

/**
 * 按策略算一步推力。
 *
 * 方向永远是「当前智能体位置 → 目标」的单位向量；力大小由策略决定，
 * 最后统一收在 forceLimit 以内。没有智能体或已经贴到目标时给零力。
 */
export const computeGymEvalForce = (input: GymEvalForceInput): GymEvalForce => {
  const agent = input.observation.agent
  if (!agent) return { forceX: 0, forceZ: 0 }

  const target = input.observation.target
  const dx = target.x - agent.position.x
  const dz = target.z - agent.position.z
  const distance = Math.hypot(dx, dz)
  const limit = resolveForceLimit(input.forceLimit)

  const requested =
    input.policy === 'constant'
      ? limit * CONSTANT_POLICY_RATIO
      : Math.min(limit * PROPORTIONAL_POLICY_MAX_RATIO, distance * PROPORTIONAL_POLICY_GAIN)

  if (!(distance > 0) || !(requested > 0)) return { forceX: 0, forceZ: 0 }

  // 留 1e-9 的相对余量：归一化与乘法各带一次舍入，贴着上限仍可能多出 1 ulp
  const magnitude = Math.min(requested, limit * (1 - 1e-9))
  const forceX = (dx / distance) * magnitude
  const forceZ = (dz / distance) * magnitude

  // 兜底：极端浮点情况下再等比缩一次，保证 hypot <= limit
  const actual = Math.hypot(forceX, forceZ)
  if (actual > limit) {
    const scale = limit / actual
    return { forceX: forceX * scale, forceZ: forceZ * scale }
  }
  return { forceX, forceZ }
}

type EvalPhase = 'create' | 'step'

/** 把失败翻译成一行可读文案；后端不在与业务错误分开说 */
const describeRunError = (error: unknown, phase: EvalPhase): string => {
  if (isApiUnavailable(error)) {
    return phase === 'create' ? '后端不可达，会话没建起来' : '后端不可达，这一步没送出去'
  }
  if (error instanceof ApiError) return error.message || `后端返回 ${error.status}`
  if (error instanceof Error && error.message) return error.message
  return '未知错误'
}

/**
 * 跑一个「任务 × 策略」。
 *
 * 会话一定在 finally 里销毁：step 失败、422、甚至中途抛异常都不能留内存会话。
 * success 口径：最终距离 <= 0.5m。**不能只看 terminated**——后端把
 * 「全部智能体都 done」都算 terminated，其中包含「坠出世界」这种失败终局，
 * 只看 terminated 会把掉下平台的 run 记成成功。
 */
const runSingle = async (
  task: GymTask,
  policyId: GymEvalPolicyId,
  ownerToken: string,
): Promise<GymEvalRunResult> => {
  const startedAt = Date.now()
  let sessionId = ''
  let steps = 0
  let totalReward = 0
  let finalDistance = Number.POSITIVE_INFINITY
  let success = false
  let error: string | null = null

  try {
    const created = await createGymSession(ownerToken, {
      scene: task.scene,
      target: task.target,
      maxSteps: task.maxSteps,
      ...(task.params && Object.keys(task.params).length > 0 ? { params: task.params } : {}),
    })
    sessionId = created.sessionId

    let observation = created.observation
    let terminated = created.terminated
    let truncated = created.truncated
    finalDistance = observation.distance

    // 建会话时已经在目标圈内：0 步成功，不再发动作
    while (
      !terminated &&
      !truncated &&
      steps < task.maxSteps &&
      finalDistance > GYM_EVAL_GOAL_RADIUS
    ) {
      if (!observation.agent) {
        error = '观测里没有智能体，无法计算推力'
        break
      }
      const action = computeGymEvalForce({
        policy: policyId,
        observation,
        forceLimit: created.forceLimit,
      })
      const stepped = await stepGymSession(ownerToken, sessionId, action)
      steps += 1
      totalReward += stepped.reward
      observation = stepped.observation
      finalDistance = observation.distance
      terminated = stepped.terminated
      truncated = stepped.truncated
    }

    success = error === null && finalDistance <= GYM_EVAL_GOAL_RADIUS
  } catch (caught) {
    error = describeRunError(caught, sessionId ? 'step' : 'create')
  } finally {
    if (sessionId) {
      try {
        await deleteGymSession(ownerToken, sessionId)
      } catch (cleanupError) {
        // 清理失败不推翻已经跑出来的结果，但必须让人看见
        if (!error) error = `会话清理失败：${describeRunError(cleanupError, 'step')}`
      }
    }
  }

  return {
    taskId: task.id,
    taskName: task.name,
    policyId,
    success,
    steps,
    totalReward,
    wallClockMs: Date.now() - startedAt,
    error,
  }
}

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

const summarizePolicy = (
  policyId: GymEvalPolicyId,
  results: GymEvalRunResult[],
): GymEvalPolicySummary => {
  const runs = results.filter((result) => result.policyId === policyId)
  const healthy = runs.filter((result) => result.error === null)
  const successes = runs.filter((result) => result.success).length
  return {
    policyId,
    runs: runs.length,
    successes,
    successRate: runs.length > 0 ? successes / runs.length : 0,
    avgSteps: average(healthy.map((result) => result.steps)),
    avgReward: average(healthy.map((result) => result.totalReward)),
    avgLatencyMs: average(healthy.map((result) => result.wallClockMs)),
  }
}

/**
 * 汇总明细。
 *
 * 成功率的分母是全部运行（失败也是「没成功」）；平均步数 / reward / 耗时
 * 只统计没有 error 的运行，避免「后端不可达」的 0 步把均值拉低。
 * `policies` 传了就把这些策略都列出来（即使 0 次运行），没传则从结果里推。
 */
export const summarizeGymEvalResults = (
  results: GymEvalRunResult[],
  policies?: GymEvalPolicyId[],
): GymEvalSummary => {
  const policyIds = [
    ...new Set([
      ...(policies ?? []),
      ...results.map((result) => result.policyId),
    ]),
  ]
  const healthy = results.filter((result) => result.error === null)
  const successes = results.filter((result) => result.success).length

  return {
    totalRuns: results.length,
    successes,
    successRate: results.length > 0 ? successes / results.length : 0,
    avgSteps: average(healthy.map((result) => result.steps)),
    avgReward: average(healthy.map((result) => result.totalReward)),
    avgLatencyMs: average(healthy.map((result) => result.wallClockMs)),
    byPolicy: policyIds.map((policyId) => summarizePolicy(policyId, results)),
  }
}

/** CSV 单元格：含逗号/引号/换行时加引号并转义内部引号 */
const csvCell = (value: string | number | boolean | null): string => {
  const text = value === null ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** 把明细导出为 CSV（任务、策略、成功、步数、奖励、耗时、错误） */
export const serializeGymEvalResultsCsv = (results: GymEvalRunResult[]): string => {
  const rows: Array<Array<string | number | boolean | null>> = [
    ['任务', '策略', '成功', '步数', '总奖励', '耗时(ms)', '错误'],
    ...results.map((result) => [
      result.taskName,
      POLICY_LABELS[result.policyId],
      result.success ? '是' : '否',
      result.steps,
      result.totalReward,
      result.wallClockMs,
      result.error,
    ]),
  ]
  return rows.map((row) => row.map(csvCell).join(',')).join('\n') + '\n'
}

/**
 * 批量跑完一套任务。
 *
 * 串行执行（后端单会话、全局锁，并发只会互相抢锁），每条运行都带自己的
 * 错误位。`onProgress` 在每次「任务 × 策略」开始前与结束后各回调一次。
 */
export const evaluateTaskSuite = async (
  input: EvaluateTaskSuiteInput,
): Promise<GymEvalEvaluation> => {
  const startedAt = Date.now()
  const policies = [...new Set(input.policies)]
  const total = input.suite.tasks.length * policies.length
  const results: GymEvalRunResult[] = []

  const report = (task: GymTask | null, policyId: GymEvalPolicyId | null): void => {
    input.onProgress?.({
      completed: results.length,
      total,
      currentTaskName: task?.name ?? '',
      currentPolicyId: policyId,
    })
  }

  report(null, null)
  for (const task of input.suite.tasks) {
    for (const policyId of policies) {
      report(task, policyId)
      results.push(await runSingle(task, policyId, input.ownerToken))
      report(null, null)
    }
  }

  return {
    results,
    summary: summarizeGymEvalResults(results, policies),
    wallClockMs: Date.now() - startedAt,
  }
}
