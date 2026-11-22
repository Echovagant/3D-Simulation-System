/**
 * 模型库上传持久化 · 后端接口客户端。
 *
 * 契约来源：`backend/app/routers/models.py`——端点、字段名、错误码与后端
 * schema 一一对应，别另造一套形状。
 *
 * 所有端点都要带 `X-Owner-Token`（软身份，与 LLM 托管同一套约定）：
 * 列表与文件端点都按 owner 分区，别人的模型既看不见也下不动。
 *
 * 上传是 multipart（50MB 上限的模型文件），**不能走 `apiRequest`**：它会把
 * Content-Type 定死成 application/json，multipart 的 boundary 就没了。
 * 这里单独发 fetch，但错误信封与 `client.ts` 是同一种——
 * 上层照样能用 `ApiError.code` 与 `isApiUnavailable` 判别。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作（回退 blob 会话态），
 * 所以失败一律以异常抛给调用方，由 modelStore 判断是「后端不在」还是业务错误。
 */
import { API_BASE, ApiError, apiRequest } from './client'

/** 一个已持久化的上传模型条目（与后端 ModelUploadItem 逐字段对齐） */
export interface ModelUploadItem {
  /** 服务端 publicId（uuid4.hex），前端列表去重与加载都认它 */
  id: string
  name: string
  category: 'characters' | 'environments' | 'props'
  /** glb / gltf / obj / fbx（小写） */
  format: string
  /** 文件大小（字节） */
  size: number
  /** 持久文件地址（相对路径，如 /api/models/{id}/file） */
  modelUrl: string
  createdAt: string
  /** 服务端不解析模型内容：几何信息如实为 0 / false */
  polyCount: number
  materialCount: number
  hasAnimation: boolean
  /** 恒为 true：前端靠它区分「已落库」与「会话内 blob」 */
  persisted: boolean
}

/** 列表端点的应答形状 */
export interface ModelUploadList {
  items: ModelUploadItem[]
}

/** 基础路径 */
const basePath = '/api/models'

/** 所有端点都要带的软身份头 */
const ownerHeaders = (ownerToken: string): Record<string, string> => ({
  'X-Owner-Token': ownerToken,
})

/** 上传超时（毫秒）。上限 50MB 的文件在慢链路上要给足时间 */
const UPLOAD_TIMEOUT_MS = 60000

/** 后端统一的错误信封：`{ error: { code, message, detail } }` */
interface ApiErrorEnvelope {
  error?: {
    code?: string
    message?: string
    detail?: unknown
  }
}

/**
 * 从统一错误信封造 ApiError（与 client.ts / model3dCloud.ts 的解析规则一致）。
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

/**
 * 上传一个模型文件（multipart）；后端回 201 与持久化条目。
 *
 * 服务端只校验扩展名（glb/gltf/obj/fbx）与大小（上限 50MB），
 * 不解析内容——能不能渲染归前端的三种 loader 管。
 */
export const uploadModelFile = async (
  ownerToken: string,
  file: File,
  name: string,
  category: ModelUploadItem['category'],
): Promise<ModelUploadItem> => {
  const form = new FormData()
  form.append('file', file, file.name)
  form.append('name', name)
  form.append('category', category)

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), UPLOAD_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_BASE}${basePath}/upload`, {
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
    return value as ModelUploadItem
  } finally {
    clearTimeout(timer)
  }
}

/** 自己的上传列表（created_at 倒序） */
export const listUploadedModels = (ownerToken: string): Promise<ModelUploadList> =>
  apiRequest<ModelUploadList>(basePath, {
    headers: ownerHeaders(ownerToken),
  })

/** 删除一个上传模型（记录与文件一起删）；后端回 204（无响应体） */
export const deleteUploadedModel = (
  ownerToken: string,
  publicId: string,
): Promise<void> =>
  apiRequest<void>(
    `${basePath}/${encodeURIComponent(publicId)}`,
    { method: 'DELETE', headers: ownerHeaders(ownerToken) },
  )
