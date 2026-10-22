// @vitest-environment jsdom
/**
 * 批量仿真面板的回归网。
 *
 * 盯的是**用户能看见的行为**：后端缺席时安静降级、任务跑完后停下轮询、
 * 轮询有上限——这三条是面板存在的底线（后端是可选增强）。
 *
 * ⚠️ 全程不联网：fetch 被替身掉，时钟被换成可控的假定时器，
 * 否则轮询的节奏没法断言。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import SimulationBatchPanel from './SimulationBatchPanel.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import type { SceneDocument } from '@/types'

/** 造一个只会说 JSON 的 Response 替身 */
const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

/** 一份最小可用的场景文档 */
const buildDocument = (id: string): SceneDocument => ({
  id,
  name: '落球实验',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  version: 1,
  gravity: { x: 0, y: -9.8, z: 0 },
  objects: [
    {
      uuid: 'obj-1',
      type: 'sphere',
      name: '小球',
      position: { x: 0, y: 5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
    },
  ],
})

/** 跑完一轮的结果 */
const resultsFixture = {
  runs: [
    {
      index: 0,
      params: { friction: 0.1 },
      durationMs: 42,
      objects: [],
      metrics: { settledAtFrame: 96, maxPenetration: 0, totalFallDistance: 1.5 },
    },
    {
      index: 1,
      params: { friction: 0.5 },
      durationMs: 47,
      objects: [],
      metrics: { settledAtFrame: 101, maxPenetration: 0, totalFallDistance: 1.5 },
    },
  ],
  summary: { runs: 2, settledRuns: 2, maxPenetration: 0 },
}

let wrappers: VueWrapper[] = []

/** 让挂起的 Promise 链跑完（面板里的请求都是异步的） */
const settle = async (): Promise<void> => {
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve()
  }
  await nextTick()
}

/** 挂上面板：本地场景库里放一个场景，面板默认就选中它 */
const mountPanel = (): VueWrapper => {
  setActivePinia(createPinia())
  const store = useSceneEditorStore()
  store.importSceneDocument(buildDocument('scene-1'))
  const wrapper = mount(SimulationBatchPanel)
  wrappers.push(wrapper)
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  wrappers = []
  vi.useFakeTimers()
})

afterEach(() => {
  while (wrappers.length) {
    wrappers.pop()?.unmount()
  }
  vi.unstubAllGlobals()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('批量仿真面板 —— 后端缺席时的降级', () => {
  it('后端不在时给出明确提示，页面不崩也不报未捕获异常', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const rejections: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => rejections.push(event.reason)
    window.addEventListener('unhandledrejection', onUnhandled)

    const wrapper = mountPanel()
    await settle()

    window.removeEventListener('unhandledrejection', onUnhandled)

    const banner = wrapper.find('.sim-backend-missing')
    expect(banner.exists()).toBe(true)
    expect(banner.text()).toContain('后端不在，批量仿真暂不可用')
    expect(errorSpy).not.toHaveBeenCalled()
    expect(warnSpy).not.toHaveBeenCalled()
    expect(rejections).toEqual([])
  })

  it('后端不在时提交任务只给提示，不抛异常', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch')
      }),
    )

    const rejections: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => rejections.push(event.reason)
    window.addEventListener('unhandledrejection', onUnhandled)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('.sim-submit').trigger('click')
    await settle()

    window.removeEventListener('unhandledrejection', onUnhandled)

    expect(wrapper.find('.sim-notice').exists()).toBe(true)
    expect(wrapper.find('.sim-notice').text()).toContain('后端不在')
    expect(rejections).toEqual([])
  })
})

describe('批量仿真面板 —— 数字输入与本地错误', () => {
  it('用户改过数字输入框后仍然能提交，参数是数字', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ jobId: 'job-1' }, 202)
      if (url.endsWith('/results')) return jsonResponse(resultsFixture)
      if (url.endsWith('/api/simulations')) return jsonResponse([])
      return jsonResponse({
        jobId: 'job-1',
        status: 'running',
        total: 1,
        done: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    // 用户改输入框：`<input type="number">` 的 v-model 会把值变成 number，
    // 只当字符串处理的话这里就会抛 `raw.trim is not a function`
    await wrapper.find('#sim-steps').setValue('360')
    await wrapper.find('#sim-friction').setValue('0.5')
    await settle()

    await wrapper.find('.sim-submit').trigger('click')
    await settle()

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
    expect(post).toBeTruthy()
    const body = JSON.parse((post![1] as RequestInit).body as string)
    expect(body.params.steps).toBe(360)
    expect(body.params.friction).toBe(0.5)
    expect(typeof body.params.dt).toBe('number')

    // 本地取值失败时不能把界面说成「后端不在」
    expect(wrapper.find('.sim-backend-missing').exists()).toBe(false)
    const notice = wrapper.find('.sim-notice')
    if (notice.exists()) expect(notice.text()).not.toContain('后端不在')
  })

  it('内容序列化不了时提示内容问题，不说「后端不在」', async () => {
    const fetchMock = vi.fn(async () => jsonResponse([]))
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    const originalStringify = JSON.stringify
    const stringifySpy = vi.spyOn(JSON, 'stringify').mockImplementation((value: unknown) => {
      const isPayload =
        typeof value === 'object' && value !== null && 'scene' in (value as Record<string, unknown>)
      if (isPayload) throw new TypeError('Converting circular structure to JSON')
      return originalStringify(value)
    })

    await wrapper.find('.sim-submit').trigger('click')
    await settle()
    stringifySpy.mockRestore()

    expect(wrapper.find('.sim-notice').text()).toContain('请求内容有问题')
    expect(wrapper.find('.sim-notice').text()).not.toContain('后端不在')
    expect(wrapper.find('.sim-backend-missing').exists()).toBe(false)
  })
})

describe('批量仿真面板 —— 轮询', () => {
  it('任务跑完后停下轮询，并展示结果与汇总', async () => {
    let detailCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ jobId: 'job-1' }, 202)
      if (url.endsWith('/results')) return jsonResponse(resultsFixture)
      if (url.endsWith('/api/simulations')) return jsonResponse([])
      detailCalls += 1
      return jsonResponse(
        detailCalls === 1
          ? {
              jobId: 'job-1',
              status: 'running',
              total: 2,
              done: 1,
              createdAt: '2026-01-01T00:00:00.000Z',
            }
          : {
              jobId: 'job-1',
              status: 'succeeded',
              total: 2,
              done: 2,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('.sim-submit').trigger('click')
    await settle()

    // 第一次轮询：还在跑
    expect(wrapper.find('.sim-status').text()).toBe('运行中')
    expect(wrapper.find('.sim-progress-text').text()).toBe('1 / 2')

    // 第二次轮询：跑完了
    await vi.advanceTimersByTimeAsync(2000)
    await settle()

    expect(wrapper.find('.sim-status').text()).toBe('已完成')
    expect(wrapper.find('.sim-progress-text').text()).toBe('2 / 2')
    expect(wrapper.find('.sim-results').exists()).toBe(true)
    expect(wrapper.find('.sim-summary').text()).toContain('2 次运行')
    expect(wrapper.findAll('.sim-run-row')).toHaveLength(2)
    expect(wrapper.findAll('.sim-run-row')[0].text()).toContain('friction=0.1')

    // 跑完就不再轮询了
    const callsAfterDone = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(fetchMock.mock.calls.length).toBe(callsAfterDone)
  })

  it('轮询有上限：任务一直不落地时停止轮询', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ jobId: 'job-1' }, 202)
      if (url.endsWith('/results')) return jsonResponse(resultsFixture)
      if (url.endsWith('/api/simulations')) return jsonResponse([])
      return jsonResponse({
        jobId: 'job-1',
        status: 'running',
        total: 2,
        done: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('.sim-submit').trigger('click')
    await settle()

    // 推进很久：轮询次数必须有上限，不能一直打后端
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await settle()

    const callsWhenStopped = fetchMock.mock.calls.length
    expect(wrapper.find('.sim-poll-stopped').exists()).toBe(true)
    expect(callsWhenStopped).toBeLessThanOrEqual(130)

    // 停了之后继续等，次数不再增长
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    await settle()
    expect(fetchMock.mock.calls.length).toBe(callsWhenStopped)
  })
})
