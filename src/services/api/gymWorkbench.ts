/**
 * Agent 工作台 · Gym 会话式环境 · 后端接口客户端。
 *
 * 契约来源：`backend/app/routers/gym.py` + openapi.json（2026-11-23 实查，
 * 全部端点已用 curl 过了一遍真实响应）。端点、字段名与后端 schema
 * 一一对应，别另造一套形状。
 *
 * 与后端实际契约的两处注意点（以实查为准）：
 * 1. `/api/gym/sessions/{id}` **只有 DELETE，没有 GET 详情端点**——
 *    参数回显（生效参数 / 丢键 / 回落键 / 力上限）来自 create（201）
 *    与 reset（200）的响应体，调用方要自己留档。
 * 2. step 的动作不是任意 JSON：单智能体是 `{ forceX, forceZ }`（牛顿），
 *    多智能体是 `{ actions: [{ agentUuid, forceX, forceZ }] }`。
 *    越界力回 422 `gym_force_out_of_range`，message 即修复指令原文。
 *
 * 多智能体：create 可带 `agents: [{ uuid, target }]`；观测里多一个
 * `agents` 数组（每个受控物体的位置/目标/距离/是否完成），单智能体字段保留为
 * 第一个智能体的兼容视图。
 *
 * 所有端点都带 `X-Owner-Token`（软身份，与 LLM 托管同一套约定）：
 * 会话与审计日志按它分区，缺失即 401 `owner_token_required`。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 所以失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import { apiRequest } from './client'

/** 三维向量（观测里的位置 / 速度） */
export interface GymVec3 {
  x: number
  y: number
  z: number
}

/** Gym 任务的目标点（水平面） */
export interface GymTarget {
  x: number
  z: number
}

/** 一步的动作：施加在智能体上的水平力（牛） */
export interface GymStepAction {
  forceX: number
  forceZ: number
}

/** 多智能体的一步动作：每个受控物体一条 */
export interface GymBatchAction {
  agentUuid: string
  forceX: number
  forceZ: number
}

/** 多智能体会话里的一个受控物体：uuid + 它自己的目标点 */
export interface GymAgentSpec {
  uuid: string
  target: GymTarget
}

/** 建会话的入参。scene 是完整的前端场景文档（与批量仿真同一口径） */
export interface GymSessionCreateInput {
  scene: Record<string, unknown>
  /** 键值对后端逐键校验（丢键/回落键在响应里如实回），类型放宽成 unknown */
  params?: Record<string, unknown>
  agentUuid?: string
  target?: GymTarget
  maxSteps?: number
  /** 非空时进入多智能体模式（每个条目一个受控物体） */
  agents?: GymAgentSpec[]
}

/** 实际生效的物理参数口径（create 与 reset 共用一份） */
export interface GymEffectiveParams {
  gravityY: number
  friction: number | null
  restitution: number | null
  dt: number
  steps: number
  trace: boolean
  initialVelocityY: number
}

/** 参数回显：生效参数 + 被丢键 + 被回落键 + 力上限（牛） */
export interface GymParamEcho {
  effectiveParams: GymEffectiveParams
  droppedParamKeys: string[]
  defaultedParamKeys: string[]
  forceLimit: number
  /** 多智能体模式下每个 uuid 各自的力上限；单智能体模式为空对象 */
  forceLimits?: Record<string, number>
}

/** 观测里的单个物体 */
export interface GymObservedObject {
  uuid: string
  position: GymVec3
  velocity: GymVec3
}

/** 多智能体观测：一个受控物体 + 它自己的目标与完成状态 */
export interface GymAgentObservation extends GymObservedObject {
  target: GymTarget
  distance: number
  done: boolean
}

/** 当前观测：智能体、全部受控智能体、全场景物体、目标、步数与距离 */
export interface GymObservation {
  agent: GymObservedObject | null
  /** 多智能体模式下的全部受控物体；单智能体模式也至少有一个（兼容视图） */
  agents?: GymAgentObservation[]
  objects: GymObservedObject[]
  target: GymTarget
  step: number
  maxSteps: number
  distance: number
}

/** 建会话成功（201）：会话 id + 初始观测 + 参数口径 */
export interface GymSessionCreated extends GymParamEcho {
  sessionId: string
  observation: GymObservation
  reward: number
  terminated: boolean
  truncated: boolean
}

/** 重建世界（reset）成功：初始观测 + 参数口径（无 sessionId） */
export interface GymResetResponse extends GymParamEcho {
  observation: GymObservation
  reward: number
  terminated: boolean
  truncated: boolean
}

/** 一步的结果：观测 + reward + terminated/truncated + info */
export interface GymStepResponse {
  observation: GymObservation
  reward: number
  terminated: boolean
  truncated: boolean
  info: Record<string, unknown>
}

/** 会话摘要（列表用） */
export interface GymSessionSummary {
  sessionId: string
  agentUuid: string
  /** 多智能体会话的全部受控物体（单智能体时只有 primary 一个） */
  agentUuids?: string[]
  step: number
  maxSteps: number
  terminated: boolean
  truncated: boolean
}

/** 一步动作的审计留档 */
export interface GymStepLogItem {
  id: number
  ts: string
  ownerToken: string
  sessionId: string
  /** 多智能体：这一行动作属于哪个受控物体；旧行为 null */
  agentUuid: string | null
  roundIndex: number
  stepIndex: number
  forceX: number
  forceZ: number
  forceLimit: number
  applied: boolean
  errorCode: string | null
  distance: number | null
  reward: number | null
  terminated: boolean
  truncated: boolean
  latencyMs: number
}

/** 审计日志的查询参数（归属过滤由 X-Owner-Token + 会话路径承担） */
export interface GymLogQuery {
  /** 只看某一回合（0 起）；不传 = 全部 */
  round?: number
  /** 最多取多少条（后端默认 200，上限 1000） */
  limit?: number
}

/** 基础路径（router prefix 是 /gym，全局前缀 /api） */
const basePath = '/api/gym/sessions'

/** 单个会话路径；sessionId 要编码，避免特殊字符把路径拆坏 */
const sessionPath = (sessionId: string): string =>
  `${basePath}/${encodeURIComponent(sessionId)}`

/** 所有端点都要带的软身份头 */
const ownerHeaders = (ownerToken: string): Record<string, string> => ({
  'X-Owner-Token': ownerToken,
})

/** 建一个 Gym 会话；后端回 201 与初始观测 */
export const createGymSession = (
  ownerToken: string,
  input: GymSessionCreateInput,
): Promise<GymSessionCreated> =>
  apiRequest<GymSessionCreated>(basePath, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({
      scene: input.scene,
      ...(input.params ? { params: input.params } : {}),
      ...(input.agentUuid ? { agentUuid: input.agentUuid } : {}),
      ...(input.target ? { target: input.target } : {}),
      ...(input.maxSteps !== undefined ? { maxSteps: input.maxSteps } : {}),
      ...(input.agents && input.agents.length > 0 ? { agents: input.agents } : {}),
    }),
  })

/** 列出本 owner 在场的会话 */
export const listGymSessions = (ownerToken: string): Promise<GymSessionSummary[]> =>
  apiRequest<GymSessionSummary[]>(basePath, {
    headers: ownerHeaders(ownerToken),
  })

/** 重建世界回到初始状态 */
export const resetGymSession = (
  ownerToken: string,
  sessionId: string,
): Promise<GymResetResponse> =>
  apiRequest<GymResetResponse>(`${sessionPath(sessionId)}/reset`, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
  })

/** 推进一步（施加水平冲量）；越界力 → 422 + 修复指令（走 ApiError 抛出） */
export const stepGymSession = (
  ownerToken: string,
  sessionId: string,
  action: GymStepAction,
): Promise<GymStepResponse> =>
  apiRequest<GymStepResponse>(`${sessionPath(sessionId)}/step`, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({ forceX: action.forceX, forceZ: action.forceZ }),
  })

/** 多智能体批量推进：同一物理步内先施加全部冲量再推进 */
export const stepGymSessionBatch = (
  ownerToken: string,
  sessionId: string,
  actions: GymBatchAction[],
): Promise<GymStepResponse> =>
  apiRequest<GymStepResponse>(`${sessionPath(sessionId)}/step`, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({ actions }),
  })

/** 取一个会话的动作审计日志（按 ts 升序，最新的在最后） */
export const listGymLogs = (
  ownerToken: string,
  sessionId: string,
  query?: GymLogQuery,
): Promise<GymStepLogItem[]> => {
  const search = new URLSearchParams()
  if (query?.round !== undefined) search.set('round', String(query.round))
  if (query?.limit !== undefined) search.set('limit', String(query.limit))
  const qs = search.toString()
  return apiRequest<GymStepLogItem[]>(`${sessionPath(sessionId)}/logs${qs ? `?${qs}` : ''}`, {
    headers: ownerHeaders(ownerToken),
  })
}

/** 销毁会话；后端回 204（无响应体） */
export const deleteGymSession = (ownerToken: string, sessionId: string): Promise<void> =>
  apiRequest<void>(sessionPath(sessionId), {
    method: 'DELETE',
    headers: ownerHeaders(ownerToken),
  })
