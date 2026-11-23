/**
 * 实时演练 → 评测审计的交接数据。
 *
 * 演武场（AIPlayground）把当前场地与智能体折成一份 `AiLabHandoff` 写进
 * sessionStorage，评测台（AgentWorkbench）读到后预填会话表单——**不自动建会话**，
 * 用户检查参数后自己点创建。交接是「一次有效」：读完即删，避免下次进入重复预填。
 *
 * 这里只做数据组装与校验，不读 store、不碰场景对象，因此可以直接单测。
 * 旧值 / 外部篡改 / 隐私模式下的写失败都按「坏数据」处理：读返回 null、写返回 false，
 * 绝不抛异常——调用方负责给用户一句能看懂的话。
 */
import type { SceneDocument } from '@/types'

/** sessionStorage 里存放交接数据的键 */
export const AI_LAB_HANDOFF_KEY = 'ai-lab-handoff'

/** 交接里的一只智能体：uuid 必须与场景里的物体 uuid 一致（后端按它绑定受控物体） */
export interface AiLabHandoffAgent {
  uuid: string
  target: { x: number; z: number }
}

/** 实时演练交给评测审计的完整数据 */
export interface AiLabHandoff {
  scene: SceneDocument
  target: { x: number; z: number }
  maxSteps: number
  agents: AiLabHandoffAgent[]
  label?: string
  source: 'ai-playground'
  at: number
}

/** buildArenaHandoff 的输入：场地快照 + 智能体目标 + 环境时间上限 */
export interface BuildArenaHandoffInput {
  scene: SceneDocument
  agents: ReadonlyArray<AiLabHandoffAgent>
  /** 演武场的时间上限（秒）；0 表示不限制 */
  timeLimitSeconds: number
  label?: string
  /** 由测试注入固定时间戳；缺省取当前时刻 */
  at?: number
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/** 场景里智能体物体的 uuid 约定——导出场景与交接 agents 必须共用这一份 */
export const arenaAgentUuid = (agentId: string): string => `arena-agent-${agentId}`

/**
 * 时间上限（秒）→ 评测回合上限。
 *
 * 物理固定 60Hz，所以一秒钟约等于 60 步；不限时（0 / 非法）给 300 步，
 * 并按「至少 60 步」兜底——回合太短的话，智能体还没走两步就被截断。
 */
export const resolveAiLabMaxSteps = (timeLimitSeconds: number): number => {
  const limit = Number(timeLimitSeconds)
  const steps = Number.isFinite(limit) && limit > 0 ? Math.round(limit * 60) : 300
  // 后端 Gym create 的 max_steps 上限是 10000；超出会被 422 拒绝。
  return Math.min(10000, Math.max(60, steps))
}

const readTarget = (raw: unknown): { x: number; z: number } | null => {
  if (!isRecord(raw) || !isFiniteNumber(raw.x) || !isFiniteNumber(raw.z)) return null
  return { x: raw.x, z: raw.z }
}

/**
 * 场景的最低限度校验：必须是对象、objects 是数组、每个物体都有非空 uuid。
 *
 * 更细的物理字段交给后端与编辑器导入校验；这里只挡住「明显不是场景文档」的输入，
 * 损坏的物体不会在预填阶段被静默丢掉。
 */
const parseScene = (raw: unknown): SceneDocument | null => {
  if (!isRecord(raw) || !Array.isArray(raw.objects)) return null
  for (const object of raw.objects) {
    if (!isRecord(object)) return null
    if (typeof object.uuid !== 'string' || !object.uuid.trim()) return null
  }
  return raw as unknown as SceneDocument
}

const parseAgent = (raw: unknown): AiLabHandoffAgent | null => {
  if (!isRecord(raw)) return null
  if (typeof raw.uuid !== 'string' || !raw.uuid.trim()) return null
  const target = readTarget(raw.target)
  if (!target) return null
  return { uuid: raw.uuid, target }
}

const parseAiLabHandoff = (raw: unknown): AiLabHandoff | null => {
  if (!isRecord(raw)) return null
  if (raw.source !== 'ai-playground') return null

  const scene = parseScene(raw.scene)
  const target = readTarget(raw.target)
  if (!scene || !target) return null
  if (!isFiniteNumber(raw.maxSteps) || raw.maxSteps <= 0) return null
  if (!isFiniteNumber(raw.at)) return null
  if (!Array.isArray(raw.agents)) return null

  const agents: AiLabHandoffAgent[] = []
  for (const item of raw.agents) {
    const agent = parseAgent(item)
    if (!agent) return null
    agents.push(agent)
  }

  const handoff: AiLabHandoff = {
    scene,
    target,
    maxSteps: Math.max(1, Math.round(raw.maxSteps)),
    agents,
    source: 'ai-playground',
    at: raw.at,
  }
  if (typeof raw.label === 'string' && raw.label.trim()) handoff.label = raw.label
  return handoff
}

/**
 * 把演武场当前的场地与智能体折成交接数据。
 *
 * 没有智能体时返回 null——评测台会话必须至少有一只受控智能体，
 * 交一份空 agents 过去只会在创建时得到一句后端报错。
 */
export const buildArenaHandoff = (input: BuildArenaHandoffInput): AiLabHandoff | null => {
  const agents = input.agents.map((agent) => ({
    uuid: agent.uuid,
    target: { x: agent.target.x, z: agent.target.z },
  }))
  if (agents.length === 0) return null

  const handoff: AiLabHandoff = {
    scene: input.scene,
    target: { ...agents[0].target },
    maxSteps: resolveAiLabMaxSteps(input.timeLimitSeconds),
    agents,
    source: 'ai-playground',
    at: input.at ?? Date.now(),
  }
  if (input.label?.trim()) handoff.label = input.label
  return handoff
}

/**
 * 写入交接数据。
 *
 * sessionStorage 可能因隐私模式 / 配额不足直接抛错；这里统一收敛成 false，
 * 由调用方在页面上给可读提示，不静默丢数据。
 */
export const writeAiLabHandoff = (handoff: AiLabHandoff): boolean => {
  const normalized = parseAiLabHandoff(handoff)
  if (!normalized) return false
  try {
    sessionStorage.setItem(AI_LAB_HANDOFF_KEY, JSON.stringify(normalized))
    return true
  } catch {
    return false
  }
}

/** 读取交接数据；没有、不是合法 JSON、字段缺失都返回 null */
export const readAiLabHandoff = (): AiLabHandoff | null => {
  try {
    const raw = sessionStorage.getItem(AI_LAB_HANDOFF_KEY)
    if (!raw) return null
    return parseAiLabHandoff(JSON.parse(raw))
  } catch {
    return null
  }
}

/** 清除交接数据（读取后调用，避免下次进入重复预填） */
export const clearAiLabHandoff = (): void => {
  try {
    sessionStorage.removeItem(AI_LAB_HANDOFF_KEY)
  } catch {
    // 隐私模式下可能抛错；交接只是便利功能，删不掉不影响页面
  }
}
