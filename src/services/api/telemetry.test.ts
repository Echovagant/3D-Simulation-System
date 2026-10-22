import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushTelemetry, reportError, reportEvent, resetTelemetry } from './telemetry'

/** 造一个只会说 JSON 的 Response 替身 */
const jsonResponse = (body: unknown, status = 202): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'Accepted',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

describe('telemetry', () => {
  beforeEach(() => {
    resetTelemetry()
    vi.restoreAllMocks()
  })

  afterEach(() => {
    resetTelemetry()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('上报失败不会抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    reportError(new Error('boom'), '/simulation-lab')
    expect(() => flushTelemetry()).not.toThrow()
  })

  it('错误事件带 kind=error 与路径', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    reportError(new Error('加载场景失败'), '/scene-editor')
    flushTelemetry()

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.events[0].kind).toBe('error')
    expect(body.events[0].path).toBe('/scene-editor')
    expect(body.events[0].message).toBe('加载场景失败')
  })

  it('行为事件带 kind=event 与路径', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    reportEvent('/docs', 'clicked', { n: 1 })
    flushTelemetry()

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.events[0].kind).toBe('event')
    expect(body.events[0].path).toBe('/docs')
    expect(body.events[0].payload).toEqual({ n: 1 })
  })

  it('错误现场（堆栈）会一并带上', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ accepted: 1 }))
    vi.stubGlobal('fetch', fetchMock)

    reportError(new Error('炸了'), '/scene-editor')
    flushTelemetry()

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body))
    expect(body.events[0].payload.stack).toContain('Error')
  })

  it('后端不可达时暂停上报，不再对着死端点反复撞', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 'backend_unavailable' } }, 503))
    vi.stubGlobal('fetch', fetchMock)

    reportError(new Error('第一次'), '/scene-editor')
    flushTelemetry()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 失败结果是异步回来的：等一拍，熔断才生效
    await vi.advanceTimersByTimeAsync(0)

    reportError(new Error('第二次'), '/scene-editor')
    flushTelemetry()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('熔断窗口过后恢复上报', async () => {
    vi.useFakeTimers()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ error: { code: 'backend_unavailable' } }, 503))
    vi.stubGlobal('fetch', fetchMock)

    reportError(new Error('第一次'), '/scene-editor')
    flushTelemetry()
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // 熔断窗口过去，后端也好了
    fetchMock.mockResolvedValue(jsonResponse({ accepted: 1 }))
    await vi.advanceTimersByTimeAsync(31_000)

    reportError(new Error('第二次'), '/scene-editor')
    flushTelemetry()
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
