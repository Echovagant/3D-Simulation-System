/**
 * Agent 工作台 · Gym 会话的 LLM 力动作提议。
 *
 * 职责链：观测快照（纯函数构造）→ 提示词（纯函数）→ 出网 → 解析收敛（纯函数，
 * 永不抛异常）→ 可执行的 `{ forceX, forceZ }`。
 *
 * ⚠️ 出网只走 llmStore.invoke（唯一出网口）：次数上限、冷却期与错误脱敏都收在
 * 那里面，这里不直接碰 fetch / callLlm。invoke 由调用方注入（生产传 llmStore.invoke，
 * 测试传替身）；缺省时动态引用 llmStore——services 不静态依赖 stores。
 *
 * 与 AI 演武场的决策（services/llm/prompts.ts）是两套动作空间：
 * 那边是 move/rotate/wait 的速度指令，这边是 step 接口的水平力（牛）。
 */
import { llmConfig } from '@/config/llm'
import { extractJsonObject } from './prompts'
import type { GymObservation } from '@/services/api/gymWorkbench'

/** 默认力上限：后端口径是 30 × 质量，默认质量 1kg → 30N */
export const GYM_DEFAULT_FORCE_LIMIT = 30

/** 提议的安全余量：合力模长最多用到力上限的 80%（越界 422 的修复成本高，留出余量） */
export const GYM_FORCE_MARGIN = 0.8

/** 决策快照：喂给模型的全部输入（与 GymObservation 解耦，字段收敛到决策需要的） */
export interface GymDecisionSnapshot {
  /** 智能体当前位置（还没有智能体时为 null） */
  agentPosition: { x: number; y: number; z: number } | null
  /** 智能体当前速度（有动量时提示模型别顶满力） */
  agentVelocity: { x: number; y: number; z: number } | null
  /** 目标点（水平面） */
  target: { x: number; z: number }
  /** 到目标的水平距离（米） */
  distance: number
  /** 当前回合步数与上限（让模型知道还剩多少机会） */
  step: number
  maxSteps: number
  /** 力上限（牛）；合力模长不许超过它的 80% */
  forceLimit: number
  /** 上一步结果（还没走过步时为 null） */
  lastStep: { reward: number; terminated: boolean; truncated: boolean } | null
}

/**
 * 从执行面状态拼一份决策快照（纯函数）。
 *
 * 力上限非法（缺回显 / 非有限数 / ≤0）时回落默认值，不炸——
 * 提议这一层宁可保守，也不能把异常抛给界面。
 */
export const buildGymDecisionSnapshot = (input: {
  observation: GymObservation
  lastStep: { reward: number; terminated: boolean; truncated: boolean } | null
  forceLimit: number
}): GymDecisionSnapshot => {
  const { observation, lastStep, forceLimit } = input
  const limit =
    Number.isFinite(forceLimit) && forceLimit > 0 ? forceLimit : GYM_DEFAULT_FORCE_LIMIT
  return {
    agentPosition: observation.agent ? { ...observation.agent.position } : null,
    agentVelocity: observation.agent ? { ...observation.agent.velocity } : null,
    target: { x: observation.target.x, z: observation.target.z },
    distance: observation.distance,
    step: observation.step,
    maxSteps: observation.maxSteps,
    forceLimit: limit,
    lastStep: lastStep
      ? { reward: lastStep.reward, terminated: lastStep.terminated, truncated: lastStep.truncated }
      : null,
  }
}

const FORCE_DECISION_SYSTEM_PROMPT = `你是 3D 仿真场地里的推力控制器。场地是水平地面，一个刚体智能体放在地面上，你只能通过施加水平方向的力影响它的运动，不能直接改坐标。

坐标里 x 与 z 是水平方向，y 是竖直方向。力的单位是牛（N）。

你只能输出一个 JSON 对象，字段名必须原样使用：
{"forceX": <数字>, "forceZ": <数字>}

要求：
1. 只输出 JSON 本身，不要解释文字，不要 Markdown 代码块。
2. forceX 与 forceZ 都是有限数字；两个力的合力模长不能超过输入里的 safe_force_limit。
3. 根据观测选择合适的推力：离目标越远可以用越大的力，接近目标时减小力度，避免冲过头。
4. 上一步 reward 为正说明方向合适，可以延续当前方向；回合已结束（terminated 或 truncated 为 true）时输出 {"forceX": 0, "forceZ": 0}。`

/** 快照 → 给模型看的 JSON（字段名英文下划线，语义在系统提示词里讲清楚） */
const snapshotToPayload = (snapshot: GymDecisionSnapshot): Record<string, unknown> => ({
  agent_position: snapshot.agentPosition,
  agent_velocity: snapshot.agentVelocity,
  target: snapshot.target,
  distance: snapshot.distance,
  force_limit: snapshot.forceLimit,
  safe_force_limit: round4(snapshot.forceLimit * GYM_FORCE_MARGIN),
  step: snapshot.step,
  max_steps: snapshot.maxSteps,
  last_step: snapshot.lastStep,
})

/** 构造力决策的消息（纯函数，单测直接断言提示词带了感知数据） */
export const buildGymDecisionMessages = (
  snapshot: GymDecisionSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> => [
  { role: 'system', content: FORCE_DECISION_SYSTEM_PROMPT },
  { role: 'user', content: JSON.stringify(snapshotToPayload(snapshot)) },
]

/** 一条 LLM 消息的最小形状（与 llmStore.invoke 的入参对齐） */
export type GymDecisionMessage = { role: 'system' | 'user' | 'assistant'; content: string }

/** 出网口的最小形状（与 llmStore.invoke 的返回对齐；多余字段不影响赋值） */
export interface GymInvokeResult {
  ok: boolean
  content: string
  error?: string
  emptyReason?: 'truncated' | 'empty'
}

export type GymInvokeFn = (
  messages: GymDecisionMessage[],
  maxCompletionTokens: number,
) => Promise<GymInvokeResult>

/** 缺省出网口：llmStore.invoke（唯一出网口）。动态引用——services 不静态依赖 stores */
const defaultInvoke: GymInvokeFn = async (messages, maxCompletionTokens) => {
  const { useLlmStore } = await import('@/stores/llmStore')
  return useLlmStore().invoke(messages, maxCompletionTokens)
}

/** 提议的动作（已过安全校验，可直接送 step） */
export interface GymForceAction {
  forceX: number
  forceZ: number
}

/** 决策来源留档：哪家服务商哪个模型出的主意（显示与排障用） */
export interface ForceProposalSource {
  provider?: string
  model?: string
  baseUrl?: string
}

export type ForceProposalResult =
  | {
      ok: true
      action: GymForceAction
      /** 合力模长超安全上限，被解析层等比缩回 */
      clamped: boolean
      /** 收窄前的原始提议（clamped 为 true 时才有值） */
      original: GymForceAction | null
      /** 模型原始输出（截到 200 字符，排障用） */
      raw: string
      source: ForceProposalSource
    }
  | { ok: false; error: string; raw: string }

const round4 = (value: number): number => Number(value.toFixed(4))

/**
 * 字符串 → 有限数字。只认 number 与非空数字字符串——
 * `Number(null)` / `Number('')` 都会静默变 0，不能放进来。
 */
const toFiniteNumber = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/**
 * 解析模型输出的力提议。
 *
 * ⚠️ 这是模型与物理之间**唯一**的闸门，且**永不抛异常**：模型输出不可信，
 * 一切畸形都转成 `{ ok: false, error }`。合力模长超过力上限的 80% 时
 * 等比缩回到安全线（方向不变），原始值留在 original 里如实呈现。
 */
export const parseForceProposal = (
  content: string,
  forceLimit: number,
  source: ForceProposalSource = {},
): ForceProposalResult => {
  const raw = content.slice(0, 200)
  const limit = Number(forceLimit)
  if (!Number.isFinite(limit) || limit <= 0) {
    return { ok: false, error: '力上限非法，提议没法校验', raw }
  }

  // 模型常在 JSON 外面裹一段话或 ```json 代码块——先抠出第一个完整对象
  const json = extractJsonObject(content)
  if (!json) {
    return { ok: false, error: '模型没有返回 JSON（找不到对象）', raw }
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return { ok: false, error: '模型返回的 JSON 无法解析', raw }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: '提议要是一个 JSON 对象：{ "forceX": 数字, "forceZ": 数字 }', raw }
  }

  const record = parsed as Record<string, unknown>
  const forceX = toFiniteNumber(record.forceX)
  const forceZ = toFiniteNumber(record.forceZ)
  if (forceX === null || forceZ === null) {
    return { ok: false, error: 'forceX 与 forceZ 都要给，且必须是有限数字', raw }
  }

  const safeLimit = limit * GYM_FORCE_MARGIN
  const magnitude = Math.hypot(forceX, forceZ)
  if (magnitude > safeLimit) {
    const scale = safeLimit / magnitude
    return {
      ok: true,
      action: { forceX: round4(forceX * scale), forceZ: round4(forceZ * scale) },
      clamped: true,
      original: { forceX: round4(forceX), forceZ: round4(forceZ) },
      raw,
      source,
    }
  }
  return {
    ok: true,
    action: { forceX: round4(forceX), forceZ: round4(forceZ) },
    clamped: false,
    original: null,
    raw,
    source,
  }
}

export interface GymDecisionOptions {
  /**
   * 出网口：生产传 llmStore.invoke（唯一出网口，冷却 / 次数上限 / 脱敏都在里面）；
   * 测试注入替身。缺省走 llmStore.invoke 的动态引用。
   */
  invoke?: GymInvokeFn
  /** 决策来源留档（ok 结果里原样带回） */
  provider?: string
  model?: string
  baseUrl?: string
}

/**
 * 请求一次力动作提议：快照 → 提示词 → 出网 → 解析。
 *
 * 永不抛异常，也永不返回"拿不准"的动作——要么给一个过了安全校验的
 * `{ forceX, forceZ }`，要么给一句能直接显示的失败原因。
 */
export const proposeForceAction = async (
  snapshot: GymDecisionSnapshot,
  options: GymDecisionOptions = {},
): Promise<ForceProposalResult> => {
  const invoke = options.invoke ?? defaultInvoke
  const source: ForceProposalSource = {
    ...(options.provider ? { provider: options.provider } : {}),
    ...(options.model ? { model: options.model } : {}),
    ...(options.baseUrl ? { baseUrl: options.baseUrl } : {}),
  }

  let result: GymInvokeResult
  try {
    // 出网口按约定不抛异常；真抛了也不能把这层炸穿——兜成一句可读的失败
    result = await invoke(buildGymDecisionMessages(snapshot), llmConfig.controllerMaxTokens)
  } catch (error) {
    const message = error instanceof Error && error.message ? error.message : String(error)
    return { ok: false, error: `LLM 调用异常：${message}`, raw: '' }
  }

  if (!result.ok) {
    return { ok: false, error: result.error || 'LLM 调用失败', raw: '' }
  }

  // 「正文为空」分两种：被输出预算截断（可重试）与模型真没给（调大也没用）
  if (!result.content) {
    return {
      ok: false,
      error:
        result.emptyReason === 'truncated'
          ? '模型输出被长度上限截断（推理占用了输出预算），可稍后重试'
          : '模型返回了空内容，可稍后重试',
      raw: '',
    }
  }

  return parseForceProposal(result.content, snapshot.forceLimit, source)
}
