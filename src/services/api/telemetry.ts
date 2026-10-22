/**
 * 遥测上报。
 *
 * ⚠️ 原则：**上报永远不能影响主流程**。
 * 所有失败都静默吞掉——遥测挂了，用户不该有任何感知。
 */
import { apiRequest, isApiUnavailable } from './client'

export type TelemetryKind = 'error' | 'event'

export interface TelemetryEventInput {
  kind: TelemetryKind
  path: string
  message: string
  payload?: Record<string, unknown>
}

/** 队列上限：超过就丢最旧的，不能无限长。 */
const MAX_QUEUE = 100
/** 攒够这么多条就发。 */
const FLUSH_THRESHOLD = 20
/** 或者最多攒这么久（毫秒）。 */
const FLUSH_INTERVAL_MS = 5000
/** 后端不可达时暂停上报多久（毫秒）——别对着一个死掉的端点反复撞。 */
const UNAVAILABLE_COOLDOWN_MS = 30_000

const queue: TelemetryEventInput[] = []
let timer: number | null = null
/** 后端缺席到什么时候为止（时间戳） */
let unavailableUntil = 0

const post = (events: TelemetryEventInput[]): void => {
  if (events.length === 0) return
  if (Date.now() < unavailableUntil) return

  void apiRequest<{ accepted: number }>('/api/telemetry', {
    method: 'POST',
    body: JSON.stringify({ events }),
  })
    .then(() => {
      unavailableUntil = 0
    })
    .catch((error: unknown) => {
      if (isApiUnavailable(error)) {
        // 后端不在：暂停一段时间，别再撞
        unavailableUntil = Date.now() + UNAVAILABLE_COOLDOWN_MS
      }
      // 上报失败：静默丢弃，不打扰用户
    })
}

export const flushTelemetry = (): void => {
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  if (queue.length === 0) return
  const batch = queue.splice(0, queue.length)
  post(batch)
}

const enqueue = (event: TelemetryEventInput): void => {
  queue.push(event)
  if (queue.length > MAX_QUEUE) queue.splice(0, queue.length - MAX_QUEUE)
  if (queue.length >= FLUSH_THRESHOLD) {
    flushTelemetry()
    return
  }
  if (timer === null) {
    timer = window.setTimeout(() => {
      timer = null
      flushTelemetry()
    }, FLUSH_INTERVAL_MS)
  }
}

/** 上报一个错误。 */
export const reportError = (error: unknown, path: string): void => {
  const message = error instanceof Error ? error.message : String(error)
  const stack = error instanceof Error && error.stack ? error.stack.slice(0, 500) : ''
  enqueue({ kind: 'error', path, message, payload: { stack } })
}

/** 上报一个行为事件。 */
export const reportEvent = (
  path: string,
  message: string,
  payload: Record<string, unknown> = {},
): void => {
  enqueue({ kind: 'event', path, message, payload })
}

/**
 * 装上全局错误捕获。
 *
 * 返回卸载函数——组件卸载时必须调，否则监听器会越挂越多。
 */
export const installTelemetryReporter = (): (() => void) => {
  const onError = (event: ErrorEvent) => {
    reportError(event.error ?? event.message, window.location.pathname)
  }
  const onRejection = (event: PromiseRejectionEvent) => {
    reportError(event.reason, window.location.pathname)
  }
  const onPageHide = () => {
    flushTelemetry()
  }

  window.addEventListener('error', onError)
  window.addEventListener('unhandledrejection', onRejection)
  window.addEventListener('pagehide', onPageHide)

  return () => {
    window.removeEventListener('error', onError)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('pagehide', onPageHide)
    flushTelemetry()
  }
}

/** 清空队列与定时器——只给测试用。 */
export const resetTelemetry = (): void => {
  queue.length = 0
  if (timer !== null) {
    window.clearTimeout(timer)
    timer = null
  }
  unavailableUntil = 0
}
