/**
 * 服务端渲染（场景 → 视频）· 后端接口客户端。
 *
 * 契约来源：`backend-plan/backend-04-server-render.md` §3。
 * 端点、字段名、状态机都按那份文档写死，类型与后端 schema 一一对应——
 * 别另造一套形状，否则前后端两边对不上，渲染就失去意义。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 所以失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import type { SceneDocument } from '@/types'
import { API_BASE, apiRequest } from './client'

/** 任务状态机：queued → rendering → succeeded | failed */
export type RenderJobStatus = 'queued' | 'rendering' | 'succeeded' | 'failed'

/** 动作脚本支持的动作类型（规格 §2.3：就这四种，不发明新的） */
export type RenderActionType = 'addCube' | 'addSphere' | 'setCamera' | 'setSpeed'

/** 动作参数里的一个三维向量 */
export interface RenderVector {
  x: number
  y: number
  z: number
}

/** 动作脚本里的一条动作 */
export interface RenderAction {
  /** 在第几帧执行——录制器逐帧推进，帧号要与物理步严格对应 */
  atFrame: number
  type: RenderActionType
  params: Record<string, unknown>
}

/** 提交任务的请求体 */
export interface RenderJobRequest {
  /** 给人看的名字，可选 */
  label?: string
  /** 完整场景文档，必填 */
  scene: SceneDocument
  /** 动作脚本，可选 */
  actions?: RenderAction[]
  /** 总帧数：180 帧 @30fps = 6 秒 */
  frames?: number
  fps?: number
  width?: number
  height?: number
}

/** 提交成功（202）的应答 */
export interface RenderJobCreated {
  jobId: string
}

/** 任务摘要：列表用 */
export interface RenderJobSummary {
  jobId: string
  status: RenderJobStatus
  label?: string
  createdAt: string
  durationMs?: number
}

/** 任务详情 */
export interface RenderJobDetail {
  jobId: string
  status: RenderJobStatus
  /** 进度百分比（0-100）。渲染过程中后端拿不到真实帧数，给的是 0 */
  progress: number
  error?: string | null
  /** 产物地址（相对路径），只有成功才有 */
  artifactUrl?: string | null
  durationMs?: number
  createdAt: string
}

/** 任务集合路径 */
const renderPath = '/api/render'

/** 单个任务路径；jobId 要编码，避免特殊字符把路径拆坏 */
const jobPath = (jobId: string): string => `${renderPath}/${encodeURIComponent(jobId)}`

/** 把后端给的相对地址补成可以直接用的地址 */
export const apiUrl = (path: string): string =>
  path.startsWith('http') ? path : `${API_BASE}${path}`

/** 提交渲染任务；后端回 202 与 jobId */
export const createRenderJob = (payload: RenderJobRequest): Promise<RenderJobCreated> =>
  apiRequest<RenderJobCreated>(renderPath, {
    method: 'POST',
    body: JSON.stringify(payload),
  })

/** 最近的任务列表（后端最多回 50 条） */
export const listRenderJobs = (): Promise<RenderJobSummary[]> =>
  apiRequest<RenderJobSummary[]>(renderPath)

/** 读取单个任务的状态与进度 */
export const getRenderJob = (jobId: string): Promise<RenderJobDetail> =>
  apiRequest<RenderJobDetail>(jobPath(jobId))

/** 视频地址（<video> 的 src 与下载链接都用它） */
export const renderVideoUrl = (jobId: string): string =>
  `${API_BASE}${jobPath(jobId)}/video.mp4`
