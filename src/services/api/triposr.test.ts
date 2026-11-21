import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError, isApiUnavailable } from './client'
import { createTripoJob, getTripoJob, listTripoJobs, tripoModelUrl } from './triposr'

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

/** 造一张最小可用的输入图 */
const buildImage = (name = 'subject.png'): File =>
  new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, { type: 'image/png' })

describe('TripoSR 本地推理接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('提交任务发 POST multipart，图片与 label 都在表单里', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse({ jobId: 'job-1' }, 202)
    })

    const created = await createTripoJob(buildImage(), '小恐龙')

    expect(capturedUrl).toBe(`${API_BASE}/api/triposr`)
    expect(capturedInit?.method).toBe('POST')
    // multipart 的 body 是 FormData，而且不能有手工设置的 Content-Type——
    // boundary 只能交给浏览器生成，写死 application/json 会把请求打坏
    const form = capturedInit?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('image')).toBeInstanceOf(File)
    expect((form.get('image') as File).name).toBe('subject.png')
    expect(form.get('label')).toBe('小恐龙')
    const headers = new Headers(capturedInit?.headers)
    expect(headers.has('Content-Type')).toBe(false)
    expect(created.jobId).toBe('job-1')
  })

  it('提交任务时没给 label 就不发这个字段', async () => {
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      capturedInit = init
      return jsonResponse({ jobId: 'job-2' }, 202)
    })

    await createTripoJob(buildImage())

    const form = capturedInit?.body as FormData
    expect(form.get('label')).toBeNull()
  })

  it('列表端点返回最近的任务摘要', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse([
        {
          jobId: 'job-1',
          status: 'succeeded',
          label: '小恐龙',
          imageName: 'subject.png',
          createdAt: '2026-01-01T00:00:00.000Z',
          durationMs: 152000,
        },
        {
          jobId: 'job-2',
          status: 'running',
          imageName: 'chair.jpg',
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ])
    })

    const jobs = await listTripoJobs()

    expect(capturedUrl).toBe(`${API_BASE}/api/triposr`)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].jobId).toBe('job-1')
    expect(jobs[0].status).toBe('succeeded')
    expect(jobs[0].durationMs).toBe(152000)
    expect(jobs[1].status).toBe('running')
  })

  it('任务详情端点的路径带 jobId', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({
        jobId: 'job-1',
        status: 'running',
        imageName: 'subject.png',
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })

    const job = await getTripoJob('job-1')

    expect(capturedUrl).toBe(`${API_BASE}/api/triposr/job-1`)
    expect(job.status).toBe('running')
  })

  it('任务成功时详情里带产物地址', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse({
        jobId: 'job-1',
        status: 'succeeded',
        artifactUrl: '/api/triposr/job-1/model.glb',
        durationMs: 152000,
        imageName: 'subject.png',
        createdAt: '2026-01-01T00:00:00.000Z',
      }),
    )

    const job = await getTripoJob('job-1')

    expect(job.status).toBe('succeeded')
    expect(job.artifactUrl).toBe('/api/triposr/job-1/model.glb')
    expect(tripoModelUrl('job-1')).toBe(`${API_BASE}/api/triposr/job-1/model.glb`)
  })

  it('模型地址带上 jobId，并做 URL 编码', () => {
    expect(tripoModelUrl('job-1')).toBe(`${API_BASE}/api/triposr/job-1/model.glb`)
    expect(tripoModelUrl('a b/c')).toBe(`${API_BASE}/api/triposr/a%20b%2Fc/model.glb`)
  })

  it('环境没准备好时后端回 503，错误码要原样带出来', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'triposr_env_missing',
            message: '缺本地权重 —— 先用 HF_ENDPOINT=https://hf-mirror.com 下载。',
            detail: null,
          },
        },
        503,
      ),
    )

    const error = await createTripoJob(buildImage()).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('triposr_env_missing')
    expect((error as ApiError).status).toBe(503)
    // 503 在通用判断里算「上游不在」——界面层要靠错误码把它区分出来
    expect(isApiUnavailable(error)).toBe(true)
  })

  it('输入图不合法时后端回 422 triposr_image_invalid', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'triposr_image_invalid',
            message: '输入图类型不认识',
            detail: null,
          },
        },
        422,
      ),
    )

    const error = await createTripoJob(buildImage()).then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('triposr_image_invalid')
    expect((error as ApiError).status).toBe(422)
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('推理还没完成时后端回 409 tripo_not_ready', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        {
          error: {
            code: 'tripo_not_ready',
            message: '推理还没完成（当前状态：running），CPU 推理是分钟级，稍后再来。',
            detail: null,
          },
        },
        409,
      ),
    )

    const error = await getTripoJob('job-1').then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('tripo_not_ready')
    expect((error as ApiError).status).toBe(409)
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('网络层失败算「后端不在」', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await listTripoJobs().then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(TypeError)
    expect(isApiUnavailable(error)).toBe(true)
  })
})
