/**
 * 后端 API 客户端。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作。
 * 所以这里把失败明确分成两类，让上层能安静降级：
 * - 网络层失败（连不上 / 超时）→ `isApiUnavailable(error)` 为 true
 * - 后端应答了但状态码不对（404 / 409 / 500）→ 正常的 `ApiError`，**不算**「不可用」
 */

/** 单次请求的超时时间（毫秒）——后端是可选增强，不能让页面无限等下去 */
const REQUEST_TIMEOUT_MS = 8000

/**
 * 后端地址前缀。
 *
 * 未配置 `VITE_API_BASE_URL` 时为空串，请求走同源相对路径；
 * 结尾斜杠一律去掉，避免拼出 `//api/scenes`。
 */
export const API_BASE = String(import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '')

/** 后端统一的错误信封：`{ error: { code, message, detail } }` */
interface ApiErrorEnvelope {
  error?: {
    code?: string
    message?: string
    detail?: unknown
  }
}

/**
 * 客户端侧的失败：后端应答了，但这次请求没成功。
 *
 * `code` 优先用后端给的错误码（如 `scene_not_found`），
 * 后端没给时统一是 `http_error`。
 */
export class ApiError extends Error {
  /** 错误码 */
  readonly code: string
  /** HTTP 状态码 */
  readonly status: number
  /** 后端给的补充信息，没有时为 null */
  readonly detail: unknown

  constructor(message: string, info: { code: string; status: number; detail?: unknown }) {
    super(message)
    this.name = 'ApiError'
    this.code = info.code
    this.status = info.status
    this.detail = info.detail ?? null
  }
}

/** 取错误的 name：跨 realm 时 instanceof 不可靠，name 更稳 */
const errorName = (error: unknown): string => {
  if (typeof error !== 'object' || error === null) return ''
  const name = (error as { name?: unknown }).name
  return typeof name === 'string' ? name : ''
}

/**
 * 代理层「上游不在」的状态码。
 *
 * 开发期走 vite 代理、生产走反向代理：后端挂了时代理会回 502/503/504，
 * 这些和「连不上」是一回事，都该降级，而不是当成业务错误。
 */
const UPSTREAM_DOWN_STATUSES = new Set([502, 503, 504])

/**
 * 判断这次失败是不是「后端不在」。
 *
 * 只有网络层失败（TypeError）、超时（AbortError）与代理层的上游错误算后端缺席；
 * 后端回了 404 / 409 / 500 说明它好好地应答了，是这次请求本身的问题，不该降级。
 */
export const isApiUnavailable = (error: unknown): boolean => {
  if (error instanceof ApiError) {
    return UPSTREAM_DOWN_STATUSES.has(error.status)
  }
  if (error instanceof TypeError) return true
  const name = errorName(error)
  return name === 'TypeError' || name === 'AbortError'
}

/** 读响应体；后端返回非 JSON 时不抛解析异常，只标记失败 */
const readJsonSafely = async (response: Response): Promise<{ value: unknown; failed: boolean }> => {
  try {
    return { value: await response.json(), failed: false }
  } catch {
    return { value: null, failed: true }
  }
}

/** 从统一错误信封里取 code / message / detail，字段缺失时退回通用值 */
const parseErrorEnvelope = (
  payload: unknown,
  status: number,
): { code: string; message: string; detail: unknown } => {
  const fallbackCode = 'http_error'
  const fallbackMessage = `请求失败：HTTP ${status}`
  const envelope = (payload as ApiErrorEnvelope | null)?.error
  if (!envelope || typeof envelope !== 'object') {
    return { code: fallbackCode, message: fallbackMessage, detail: null }
  }
  return {
    code: typeof envelope.code === 'string' && envelope.code ? envelope.code : fallbackCode,
    message:
      typeof envelope.message === 'string' && envelope.message ? envelope.message : fallbackMessage,
    detail: envelope.detail ?? null,
  }
}

/**
 * 发一次请求并解析响应。
 *
 * - 8 秒超时，超时算「后端不在」
 * - 204 直接返回 undefined
 * - 非 2xx 抛 `ApiError`，错误码与文案优先用后端给的
 * - 响应体不是合法 JSON 时同样抛 `ApiError`（状态码取真实值），
 *   不让底层的解析异常漏到上层
 */
export const apiRequest = async <T>(path: string, init?: RequestInit): Promise<T> => {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  // 调用方自带的 signal 不能被吞掉：它中断时本次请求也要跟着停
  const callerSignal = init?.signal ?? null
  if (callerSignal) {
    if (callerSignal.aborted) controller.abort()
    else callerSignal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  try {
    const headers = new Headers(init?.headers)
    if (!headers.has('Content-Type')) headers.set('Content-Type', 'application/json')

    const url = `${API_BASE}${path.startsWith('/') ? path : `/${path}`}`
    const response = await fetch(url, { ...init, headers, signal: controller.signal })

    // 204 没有响应体，直接返回，避免 response.json() 抛解析异常
    if (response.status === 204) return undefined as T

    const { value, failed } = await readJsonSafely(response)

    if (!response.ok) {
      const { code, message, detail } = parseErrorEnvelope(value, response.status)
      throw new ApiError(message, { code, status: response.status, detail })
    }

    if (failed) {
      // 状态码是成功的，但响应体不是 JSON——多半是中间有网关塞了别的东西。
      // 这类失败与「后端不在」无关，得单独一个码，不能混进 http_error。
      throw new ApiError('后端返回的不是合法 JSON', {
        code: 'invalid_response',
        status: response.status,
        detail: null,
      })
    }

    return value as T
  } finally {
    clearTimeout(timer)
  }
}
