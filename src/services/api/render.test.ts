import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError, isApiUnavailable } from './client'
import {
  apiUrl,
  createRenderJob,
  getRenderJob,
  listRenderJobs,
  renderVideoUrl,
} from './render'
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

describe('服务端渲染接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('提交任务发 POST，请求体带 scene / actions / 画面参数', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse({ jobId: 'job-1' }, 202)
    })

    const created = await createRenderJob({
      label: '落球演示',
      scene: buildDocument('scene-1'),
      actions: [{ atFrame: 0, type: 'addCube', params: { size: 1 } }],
      frames: 180,
      fps: 30,
      width: 1280,
      height: 720,
    })

    expect(capturedUrl).toBe(`${API_BASE}/api/render`)
    expect(capturedInit?.method).toBe('POST')
    const body = JSON.parse(String(capturedInit?.body)) as {
      label: string
      scene: SceneDocument
      actions: { atFrame: number; type: string }[]
      frames: number
      fps: number
      width: number
      height: number
    }
    expect(body.label).toBe('落球演示')
    expect(body.scene.id).toBe('scene-1')
    expect(body.scene.objects[0].uuid).toBe('obj-1')
    expect(body.actions[0].atFrame).toBe(0)
    expect(body.actions[0].type).toBe('addCube')
    expect(body.frames).toBe(180)
    expect(body.fps).toBe(30)
    expect(body.width).toBe(1280)
    expect(body.height).toBe(720)
    expect(created.jobId).toBe('job-1')
  })

  it('提交任务时没给 label 就不发这个字段', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return jsonResponse({ jobId: 'job-2' }, 202)
    })

    await createRenderJob({ scene: buildDocument('scene-1') })

    const body = JSON.parse(capturedBody) as Record<string, unknown>
    expect('label' in body).toBe(false)
    expect('actions' in body).toBe(false)
  })

  it('列表端点返回最近的任务摘要', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse([
        {
          jobId: 'job-1',
          status: 'succeeded',
          label: '落球演示',
          createdAt: '2026-01-01T00:00:00.000Z',
          durationMs: 4200,
        },
        {
          jobId: 'job-2',
          status: 'queued',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ])
    })

    const jobs = await listRenderJobs()

    expect(capturedUrl).toBe(`${API_BASE}/api/render`)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].jobId).toBe('job-1')
    expect(jobs[0].status).toBe('succeeded')
    expect(jobs[0].durationMs).toBe(4200)
    expect(jobs[1].status).toBe('queued')
  })

  it('任务详情端点的路径带 jobId', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({
        jobId: 'job-1',
        status: 'rendering',
        progress: 0,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })

    const job = await getRenderJob('job-1')

    expect(capturedUrl).toBe(`${API_BASE}/api/render/job-1`)
    expect(job.status).toBe('rendering')
    expect(job.progress).toBe(0)
  })

  it('任务成功时详情里带产物地址', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({
        jobId: 'job-1',
        status: 'succeeded',
        progress: 100,
        artifactUrl: '/api/render/job-1/video.mp4',
        durationMs: 4200,
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const job = await getRenderJob('job-1')

    expect(job.progress).toBe(100)
    expect(job.artifactUrl).toBe('/api/render/job-1/video.mp4')
    expect(apiUrl(job.artifactUrl ?? '')).toBe(`${API_BASE}/api/render/job-1/video.mp4`)
  })

  it('视频地址带上 jobId，并做 URL 编码', () => {
    expect(renderVideoUrl('job-1')).toBe(`${API_BASE}/api/render/job-1/video.mp4`)
    expect(renderVideoUrl('a b/c')).toBe(`${API_BASE}/api/render/a%20b%2Fc/video.mp4`)
  })

  it('环境没准备好时后端回 503，错误码要原样带出来', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'render_build_missing',
            message: '找不到生产产物 dist/ —— 先跑 `npm run build` 生成它，再提交渲染任务。',
            detail: null,
          },
        },
        503,
      ),
    )

    const error = await createRenderJob({ scene: buildDocument('scene-1') }).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('render_build_missing')
    expect((error as ApiError).status).toBe(503)
    expect((error as ApiError).message).toContain('npm run build')
    // 503 在通用判断里算「上游不在」——界面层要靠错误码把它区分出来
    expect(isApiUnavailable(error)).toBe(true)
  })

  it('场景不合法时后端回 422 render_scene_invalid', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'render_scene_invalid',
            message: '场景是空的 —— 没有任何可渲染的物体。',
            detail: null,
          },
        },
        422,
      ),
    )

    const error = await createRenderJob({ scene: buildDocument('scene-1') }).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('render_scene_invalid')
    expect((error as ApiError).status).toBe(422)
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('视频还没生成好时后端回 409 render_not_ready', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'render_not_ready',
            message: '渲染还没完成（当前状态：rendering）。',
            detail: null,
          },
        },
        409,
      ),
    )

    const error = await getRenderJob('job-1').then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('render_not_ready')
    expect((error as ApiError).status).toBe(409)
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('网络层失败算「后端不在」', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await listRenderJobs().then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(TypeError)
    expect(isApiUnavailable(error)).toBe(true)
  })
})
