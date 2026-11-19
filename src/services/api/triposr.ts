/**
 * TripoSR 本地推理（单图 → 3D）· 后端接口客户端。
 *
 * 契约来源：`backend/app/routers/triposr.py`——端点、字段名、状态机与后端
 * schema 一一对应，别另造一套形状。
 *
 * 提交是 multipart（文件上传），**不能走 `apiRequest`**：它会把
 * Content-Type 定死成 application/json，multipart 的 boundary 就没了。
 * 这里单独发 fetch，但错误信封与 `client.ts` 是同一种——
 * 上层照样能用 `ApiError.code` 与 `isApiUnavailable` 判别。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 所以失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import { API_BASE, ApiError, apiRequest } from './client'

/** 任务状态机：queued → running → succeeded | failed */
export type TripoJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** 提交成功（202）的应答 */
export interface TripoJobCreated {
  jobId: string
}

/** 任务摘要：列表用 */
export interface TripoJobSummary {
  jobId: string
  status: TripoJobStatus
  label?: string
  imageName: string
  createdAt: string
  durationMs?: number
}

/** 任务详情 */
export interface TripoJobDetail {
  jobId: string
  status: TripoJobStatus
  label?: string
  imageName: string
  error?: string | null
  /** 产物地址（相对路径），只有成功才有 */
  artifactUrl?: string | null
  durationMs?: number
  createdAt: string
}

/** 任务集合路径 */
const tripoPath = '/api/triposr'

/** 单个任务路径；jobId 要编码，避免特殊字符把路径拆坏 */
const jobPath = (jobId: string): string => `${tripoPath}/${encodeURIComponent(jobId)}`

/** 生成模型的地址：下载与「导入进模型库」都从它拿字节 */
export const tripoModelUrl = (jobId: string): string =>
  `${API_BASE}${jobPath(jobId)}/model.glb`

/** 提交的 multipart 请求超时（毫秒）。提交本身很快——推理在后台跑 */
const SUBMIT_TIMEOUT_MS = 15000

/** 后端统一的错误信封：`{ error: { code, message, detail } }` */
interface ApiErrorEnvelope {
  error?: {
    code?: string
    message?: string
    detail?: unknown
  }
}

/**
 * 从统一错误信封造 ApiError。
 *
 * 与 client.ts 的解析规则一致：信封缺字段时退回通用值；
 * 响应体不是 JSON 时给 invalid_response——应答的不是我们的后端。
 */
const errorFromResponse = async (response: Response): Promise<ApiError> => {
  let payload: unknown = null
  try {
    payload = await response.json()
  } catch {
    return new ApiError('后端返回的不是合法 JSON', {
      code: 'invalid_response',
      status: response.status,
      detail: null,
    })
  }
  const envelope = (payload as ApiErrorEnvelope | null)?.error
  return new ApiError(
    (typeof envelope?.message === 'string' && envelope.message) ||
      `请求失败：HTTP ${response.status}`,
    {
      code: (typeof envelope?.code === 'string' && envelope.code) || 'http_error',
      status: response.status,
      detail: envelope?.detail ?? null,
    },
  )
}

/** 提交一次单图生成；后端回 202 与 jobId */
export const createTripoJob = async (image: File, label?: string): Promise<TripoJobCreated> => {
  const form = new FormData()
  form.append('image', image, image.name)
  if (label) form.append('label', label)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${tripoPath}`, {
      method: 'POST',
      body: form,
      signal: controller.signal,
    })
    if (!response.ok) throw await errorFromResponse(response)
    let value: unknown
    try {
      value = await response.json()
    } catch {
      throw new ApiError('后端返回的不是合法 JSON', {
        code: 'invalid_response',
        status: response.status,
        detail: null,
      })
    }
    return value as TripoJobCreated
  } finally {
    clearTimeout(timer)
  }
}

/** 最近的任务列表（后端最多回 50 条） */
export const listTripoJobs = (): Promise<TripoJobSummary[]> =>
  apiRequest<TripoJobSummary[]>(tripoPath)

/** 读取单个任务的状态 */
export const getTripoJob = (jobId: string): Promise<TripoJobDetail> =>
  apiRequest<TripoJobDetail>(jobPath(jobId))
