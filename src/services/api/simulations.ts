/**
 * 批量仿真与回归基准 · 后端接口客户端。
 *
 * 契约来源：`backend-plan/backend-03-batch-simulation.md` §2。
 * 端点、字段名、状态机都按那份文档写死——不要另造一套形状，
 * 否则前后端两边对不上，批量仿真就失去意义。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 所以失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import type { SceneDocument } from '@/types'
import { apiRequest } from './client'

/** 任务状态机：queued → running → succeeded | failed */
export type SimulationJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** 可被扫描的参数维度（一次只扫一个维度，不做笛卡尔积） */
export type SimulationSweepParam = 'gravityY' | 'friction' | 'restitution' | 'initialVelocityY'

/**
 * 单次运行的参数。
 *
 * 摩擦/弹性**可以不给**：缺省时后端用 Rapier 的默认值，
 * 前端不要自作主张填一个数塞进去——那会让两端行为对不上。
 */
export interface SimulationParams {
  gravityY?: number
  friction?: number
  restitution?: number
  initialVelocityY?: number
  dt?: number
  steps?: number
  /** 是否回传逐帧轨迹（默认不回：几百个点会撑爆响应） */
  trace?: boolean
}

/** 参数扫描：对 `param` 的每个取值各跑一次 */
export interface SimulationSweep {
  param: SimulationSweepParam
  values: number[]
}

/** 提交任务的请求体 */
export interface SimulationJobRequest {
  /** 给人看的名字，可选 */
  label?: string
  /** 完整场景文档，必填 */
  scene: SceneDocument
  params?: SimulationParams
  sweep?: SimulationSweep
}

/** 提交成功（202）的应答 */
export interface SimulationJobCreated {
  jobId: string
}

/** 任务摘要：列表与详情共用的字段 */
export interface SimulationJobSummary {
  jobId: string
  status: SimulationJobStatus
  total: number
  done: number
  createdAt: string
  label?: string
}

/** 任务详情 */
export interface SimulationJobDetail extends SimulationJobSummary {
  error?: string | null
}

/** 轨迹上的一个采样点 */
export interface SimulationTracePoint {
  frame: number
  position: { x: number; y: number; z: number }
}

/** 一次运行里的单个物体 */
export interface SimulationRunObject {
  uuid: string
  type: string
  /** 是否已经静止落地 */
  resting: boolean
  finalPosition: { x: number; y: number; z: number }
  finalVelocity: { x: number; y: number; z: number }
  /** 最大穿透深度：不为 0 说明物理配置错了 */
  penetrationDepth: number
  /** 只有 `params.trace = true` 时才有 */
  trace?: SimulationTracePoint[]
  /** 被跳过的原因（如后端不支持的物体类型） */
  skipped?: string
}

/** 一次运行的关键指标 */
export interface SimulationRunMetrics {
  settledAtFrame?: number | null
  maxPenetration: number
  totalFallDistance: number
}

/** 一次运行 */
export interface SimulationRun {
  index: number
  /** 这一轮实际生效的扫描参数 */
  params: Record<string, number>
  durationMs: number
  objects: SimulationRunObject[]
  metrics: SimulationRunMetrics
}

/** 结果汇总 */
export interface SimulationSummary {
  runs: number
  settledRuns: number
  maxPenetration: number
}

/** 结果集 */
export interface SimulationResults {
  runs: SimulationRun[]
  summary: SimulationSummary
}

/** 任务集合路径 */
const simulationsPath = '/api/simulations'

/** 单个任务路径；jobId 要编码，避免特殊字符把路径拆坏 */
const jobPath = (jobId: string): string => `${simulationsPath}/${encodeURIComponent(jobId)}`

/** 提交批量仿真任务；后端回 202 与 jobId */
export const createSimulationJob = (payload: SimulationJobRequest): Promise<SimulationJobCreated> =>
  apiRequest<SimulationJobCreated>(simulationsPath, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

/** 最近的任务列表（后端最多回 50 条） */
export const listSimulationJobs = (): Promise<SimulationJobSummary[]> =>
  apiRequest<SimulationJobSummary[]>(simulationsPath)

/** 读取单个任务的状态与进度 */
export const getSimulationJob = (jobId: string): Promise<SimulationJobDetail> =>
  apiRequest<SimulationJobDetail>(jobPath(jobId))

/** 读取任务的结果明细 */
export const getSimulationResults = (jobId: string): Promise<SimulationResults> =>
  apiRequest<SimulationResults>(`${jobPath(jobId)}/results`)
