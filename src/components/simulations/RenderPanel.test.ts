// @vitest-environment jsdom
/**
 * 服务端渲染面板的回归网。
 *
 * 盯的是**用户能看见的行为**：后端缺席时安静降级、跑完后停下轮询并给出预览、
 * 失败时如实显示后端的错误文案——这三条是面板存在的底线（后端是可选增强）。
 *
 * ⚠️ 全程不联网：fetch 被替身掉，时钟被换成可控的假定时器。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import RenderPanel from './RenderPanel.vue'
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
  const wrapper = mount(RenderPanel)
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

describe('渲染面板 —— 后端缺席时的降级', () => {
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
    expect(banner.text()).toContain('后端不在')
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

    await wrapper.find('.sim-render-submit').trigger('click')
    await settle()

    window.removeEventListener('unhandledrejection', onUnhandled)

    expect(wrapper.find('.sim-render-notice').exists()).toBe(true)
    expect(wrapper.find('.sim-render-notice').text()).toContain('后端不在')
    expect(rejections).toEqual([])
  })
})

describe('渲染面板 —— 数字输入与本地错误', () => {
  it('用户改过数字输入框后仍然能提交，参数是数字', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ jobId: 'job-1' }, 202)
      if (url.endsWith('/api/render')) return jsonResponse([])
      return jsonResponse({
        jobId: 'job-1',
        status: 'rendering',
        progress: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    // 用户改输入框：`<input type="number">` 的 v-model 会把值变成 number，
    // 只当字符串处理的话这里就会抛 `raw.trim is not a function`
    await wrapper.find('#rnd-frames').setValue('90')
    await wrapper.find('#rnd-width').setValue('640')
    await settle()

    await wrapper.find('.sim-render-submit').trigger('click')
    await settle()

    const post = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'POST')
    expect(post).toBeTruthy()
    const body = JSON.parse((post![1] as RequestInit).body as string)
    expect(body.frames).toBe(90)
    expect(body.width).toBe(640)
    expect(typeof body.fps).toBe('number')

    // 本地取值失败时不能把界面说成「后端不在」
    expect(wrapper.find('.sim-backend-missing').exists()).toBe(false)
  })

  it('动作脚本不是合法 JSON 时提示内容问题，不说「后端不在」', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('/api/render')) return jsonResponse([])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('#rnd-actions').setValue('{ 这不是数组')
    await wrapper.find('.sim-render-submit').trigger('click')
    await settle()

    const notice = wrapper.find('.sim-render-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('动作脚本')
    expect(notice.text()).not.toContain('后端不在')
    expect(wrapper.find('.sim-backend-missing').exists()).toBe(false)
  })
})

describe('渲染面板 —— 轮询与产物', () => {
  it('任务跑完后停下轮询，并给出可预览的视频', async () => {
    let detailCalls = 0
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ jobId: 'job-1' }, 202)
      if (url.endsWith('/api/render')) return jsonResponse([])
      detailCalls += 1
      return jsonResponse(
        detailCalls === 1
          ? {
              jobId: 'job-1',
              status: 'rendering',
              progress: 0,
              createdAt: '2026-01-01T00:00:00.000Z',
            }
          : {
              jobId: 'job-1',
              status: 'succeeded',
              progress: 100,
              artifactUrl: '/api/render/job-1/video.mp4',
              durationMs: 4200,
              createdAt: '2026-01-01T00:00:00.000Z',
            },
      )
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('.sim-render-submit').trigger('click')
    await settle()

    // 第一次轮询：还在渲染
    expect(wrapper.find('.sim-render-status').text()).toBe('渲染中')
    expect(wrapper.find('.sim-render-progress-text').text()).toBe('0%')

    // 第二次轮询：跑完了
    await vi.advanceTimersByTimeAsync(2000)
    await settle()

    expect(wrapper.find('.sim-render-status').text()).toBe('已完成')
    expect(wrapper.find('.sim-render-progress-text').text()).toBe('100%')
    const video = wrapper.find('.sim-render-video')
    expect(video.exists()).toBe(true)
    expect(video.attributes('src')).toContain('/api/render/job-1/video.mp4')
    expect(wrapper.find('.sim-render-download').exists()).toBe(true)

    // 跑完就不再轮询了
    const callsAfterDone = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(60_000)
    await settle()
    expect(fetchMock.mock.calls.length).toBe(callsAfterDone)
  })

  it('任务失败时如实显示后端给的错误文案', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') return jsonResponse({ jobId: 'job-1' }, 202)
      if (url.endsWith('/api/render')) return jsonResponse([])
      return jsonResponse({
        jobId: 'job-1',
        status: 'failed',
        progress: 0,
        error: '录制失败：ffmpeg: invalid argument',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('.sim-render-submit').trigger('click')
    await settle()

    expect(wrapper.find('.sim-render-status').text()).toBe('失败')
    expect(wrapper.find('.sim-render-error').text()).toContain('ffmpeg')
    expect(wrapper.find('.sim-render-video').exists()).toBe(false)
  })

  it('环境没准备好（503）时说明缺什么，不说「后端不在」', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET'
      if (method === 'POST') {
        return jsonResponse(
          {
            error: {
              code: 'render_build_missing',
              message: '找不到生产产物 dist/ —— 先跑 `npm run build` 生成它。',
              detail: null,
            },
          },
          503,
        )
      }
      if (url.endsWith('/api/render')) return jsonResponse([])
      return jsonResponse([])
    })
    vi.stubGlobal('fetch', fetchMock)

    const wrapper = mountPanel()
    await settle()

    await wrapper.find('.sim-render-submit').trigger('click')
    await settle()

    const notice = wrapper.find('.sim-render-notice')
    expect(notice.exists()).toBe(true)
    expect(notice.text()).toContain('npm run build')
    expect(wrapper.find('.sim-backend-missing').exists()).toBe(false)
  })
})
