/**
 * 云端「生成 3D」（混元生 3D / 百炼 Tripo）· 后端接口客户端。
 *
 * 契约来源：`backend/app/routers/model3d.py`——端点、字段名、状态机与后端
 * schema 一一对应，别另造一套形状。
 *
 * 所有端点都要带 `X-Owner-Token`（软身份，与 LLM 托管同一套约定）：
 * 密钥库与任务列表都按它分区。
 *
 * 提交是 multipart（可带图片文件），**不能走 `apiRequest`**：它会把
 * Content-Type 定死成 application/json，multipart 的 boundary 就没了。
 * 这里单独发 fetch，但错误信封与 `client.ts` 是同一种——
 * 上层照样能用 `ApiError.code` 与 `isApiUnavailable` 判别。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 所以失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import { API_BASE, ApiError, apiRequest } from './client'

/** 任务状态机：queued → running → succeeded | failed（与本地推理同一口径） */
export type Model3dJobStatus = 'queued' | 'running' | 'succeeded' | 'failed'

/** 一家云端 3D 供应商的目录条目（计费 / 授权 / 限制如实标注） */
export interface Model3dProviderInfo {
  providerId: string
  name: string
  /** "tc3"（SecretId+SecretKey）或 "bearer"（单把 API Key） */
  authKind: 'tc3' | 'bearer'
  /** 这家当前能不能调 API（Rodin 免费档无 API → false） */
  available: boolean
  supportsPrompt: boolean
  /** 能不能收上传的本地文件（false = 只收公网 URL） */
  supportsImageUpload: boolean
  freeTier?: string
  costNote?: string
  licenseNote?: string
  note?: string
  docsUrl?: string
  /** 这个 owner 有没有托管 key（只有布尔，没有明文） */
  configured: boolean
}

/** 密钥状态：只回「配没配」 */
export interface Model3dKeyStatus {
  providerId: string
  configured: boolean
  updatedAt?: string | null
}

/** 托管一把密钥的入参（形状按供应商分，后端当场校验） */
export interface Model3dKeyInput {
  providerId: string
  secretId?: string
  secretKey?: string
  apiKey?: string
  workspaceId?: string
  passphrase?: string
}

/** 提交成功（202）的应答 */
export interface Model3dJobCreated {
  jobId: string
}

/** 任务摘要：列表用（只看自己的） */
export interface Model3dJobSummary {
  jobId: string
  providerId: string
  status: Model3dJobStatus
  label?: string
  prompt?: string
  imageName: string
  createdAt: string
  durationMs?: number
}

/** 任务详情 */
export interface Model3dJobDetail {
  jobId: string
  providerId: string
  status: Model3dJobStatus
  label?: string
  prompt?: string
  imageName: string
  /** 厂商侧的任务 id（混元 JobId / 百炼 task_id），对账用 */
  remoteTaskId?: string
  error?: string | null
  errorCode?: string | null
  /** 产物地址（相对路径），只有成功才有 */
  artifactUrl?: string | null
  durationMs?: number
  createdAt: string
}

/** 提交一次云端生成的入参：图片文件 / 公网 URL / 提示词三选一 */
export interface Model3dJobInput {
  providerId: string
  prompt?: string
  imageUrl?: string
  image?: File | null
  label?: string
}

/** 基础路径 */
const basePath = '/api/model3d'

/** 单个任务路径；jobId 要编码，避免特殊字符把路径拆坏 */
const jobPath = (jobId: string): string =>
  `${basePath}/cloud/jobs/${encodeURIComponent(jobId)}`

/** 所有端点都要带的软身份头 */
const ownerHeaders = (ownerToken: string): Record<string, string> => ({
  'X-Owner-Token': ownerToken,
})

/** 提交的 multipart 请求超时（毫秒）。提交本身很快——生成在厂商侧跑 */
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
 * 从统一错误信封造 ApiError（与 client.ts / triposr.ts 的解析规则一致）。
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

/** 供应商目录（含这个 owner 的 key 配置状态） */
export const listModel3dProviders = (
  ownerToken: string,
): Promise<Model3dProviderInfo[]> =>
  apiRequest<Model3dProviderInfo[]>(`${basePath}/providers`, {
    headers: ownerHeaders(ownerToken),
  })

/** 各家密钥配没配（只回状态，不回明文） */
export const listModel3dKeys = (ownerToken: string): Promise<Model3dKeyStatus[]> =>
  apiRequest<Model3dKeyStatus[]>(`${basePath}/keys`, {
    headers: ownerHeaders(ownerToken),
  })

/** 托管（或覆盖）一把云端密钥；后端回 201 */
export const saveModel3dKey = (
  ownerToken: string,
  input: Model3dKeyInput,
): Promise<{ providerId: string; configured: boolean }> =>
  apiRequest<{ providerId: string; configured: boolean }>(`${basePath}/keys`, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({
      providerId: input.providerId,
      ...(input.secretId !== undefined ? { secretId: input.secretId } : {}),
      ...(input.secretKey !== undefined ? { secretKey: input.secretKey } : {}),
      ...(input.apiKey !== undefined ? { apiKey: input.apiKey } : {}),
      ...(input.workspaceId !== undefined
        ? { workspaceId: input.workspaceId }
        : {}),
      ...(input.passphrase !== undefined ? { passphrase: input.passphrase } : {}),
    }),
  })

/** 删掉某家的 key；后端回 204（无响应体） */
export const deleteModel3dKey = (
  ownerToken: string,
  providerId: string,
): Promise<void> =>
  apiRequest<void>(
    `${basePath}/keys/${encodeURIComponent(providerId)}`,
    { method: 'DELETE', headers: ownerHeaders(ownerToken) },
  )

/** 提交一次云端生成；后端回 202 与 jobId */
export const createModel3dCloudJob = async (
  ownerToken: string,
  input: Model3dJobInput,
): Promise<Model3dJobCreated> => {
  const form = new FormData()
  form.append('providerId', input.providerId)
  if (input.prompt) form.append('prompt', input.prompt)
  if (input.imageUrl) form.append('imageUrl', input.imageUrl)
  if (input.label) form.append('label', input.label)
  if (input.image) form.append('image', input.image, input.image.name)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), SUBMIT_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${basePath}/cloud/jobs`, {
      method: 'POST',
      body: form,
      headers: ownerHeaders(ownerToken),
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
    return value as Model3dJobCreated
  } finally {
    clearTimeout(timer)
  }
}

/** 自己最近的云端生成任务（后端最多回 50 条） */
export const listModel3dCloudJobs = (
  ownerToken: string,
): Promise<Model3dJobSummary[]> =>
  apiRequest<Model3dJobSummary[]>(`${basePath}/cloud/jobs`, {
    headers: ownerHeaders(ownerToken),
  })

/** 读取单个云端任务的状态 */
export const getModel3dCloudJob = (
  ownerToken: string,
  jobId: string,
): Promise<Model3dJobDetail> =>
  apiRequest<Model3dJobDetail>(jobPath(jobId), {
    headers: ownerHeaders(ownerToken),
  })

/**
 * 把生成好的 GLB 拉回来（带软身份头）。
 *
 * 产物下载不是公开静态文件——它按 owner 分区，匿名请求会 404。
 * 返回 Blob 交给上层包成 File 走模型库上传链路。
 */
export const fetchModel3dGlb = async (
  ownerToken: string,
  jobId: string,
): Promise<Blob> => {
  const response = await fetch(`${API_BASE}${jobPath(jobId)}/model.glb`, {
    headers: ownerHeaders(ownerToken),
  })
  if (!response.ok) throw await errorFromResponse(response)
  return response.blob()
}
