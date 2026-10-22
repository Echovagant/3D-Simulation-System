import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError, isApiUnavailable } from './client'
import {
  createSimulationJob,
  getSimulationJob,
  getSimulationResults,
  listSimulationJobs,
} from './simulations'
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

describe('批量仿真接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('提交任务发 POST，请求体带 scene / params / sweep', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse({ jobId: 'job-1' }, 202)
    })

    const created = await createSimulationJob({
      label: '摩擦扫描',
      scene: buildDocument('scene-1'),
      params: { gravityY: -9.81, dt: 1 / 60, steps: 240 },
      sweep: { param: 'friction', values: [0.1, 0.5, 0.9] },
    })

    expect(capturedUrl).toBe(`${API_BASE}/api/simulations`)
    expect(capturedInit?.method).toBe('POST')
    const body = JSON.parse(String(capturedInit?.body)) as {
      label: string
      scene: SceneDocument
      params: { gravityY: number; dt: number; steps: number }
      sweep: { param: string; values: number[] }
    }
    expect(body.label).toBe('摩擦扫描')
    expect(body.scene.id).toBe('scene-1')
    expect(body.scene.objects[0].uuid).toBe('obj-1')
    expect(body.params.gravityY).toBe(-9.81)
    expect(body.params.steps).toBe(240)
    expect(body.sweep.param).toBe('friction')
    expect(body.sweep.values).toEqual([0.1, 0.5, 0.9])
    expect(created.jobId).toBe('job-1')
  })

  it('提交任务时没给 label 就不发这个字段', async () => {
    let capturedBody = ''
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      capturedBody = String(init?.body)
      return jsonResponse({ jobId: 'job-2' }, 202)
    })

    await createSimulationJob({ scene: buildDocument('scene-1') })

    const body = JSON.parse(capturedBody) as Record<string, unknown>
    expect('label' in body).toBe(false)
    expect('sweep' in body).toBe(false)
  })

  it('列表端点返回最近的任务摘要', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse([
        {
          jobId: 'job-1',
          status: 'succeeded',
          total: 3,
          done: 3,
          createdAt: '2026-01-01T00:00:00.000Z',
          label: '摩擦扫描',
        },
        {
          jobId: 'job-2',
          status: 'queued',
          total: 2,
          done: 0,
          createdAt: '2026-01-02T00:00:00.000Z',
        },
      ])
    })

    const jobs = await listSimulationJobs()

    expect(capturedUrl).toBe(`${API_BASE}/api/simulations`)
    expect(jobs).toHaveLength(2)
    expect(jobs[0].jobId).toBe('job-1')
    expect(jobs[0].status).toBe('succeeded')
    expect(jobs[0].done).toBe(3)
    expect(jobs[0].total).toBe(3)
    expect(jobs[1].status).toBe('queued')
  })

  it('任务详情端点的路径带 jobId', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({
        jobId: 'job-1',
        status: 'running',
        total: 5,
        done: 2,
        createdAt: '2026-01-01T00:00:00.000Z',
      })
    })

    const job = await getSimulationJob('job-1')

    expect(capturedUrl).toBe(`${API_BASE}/api/simulations/job-1`)
    expect(job.status).toBe('running')
    expect(job.done).toBe(2)
    expect(job.total).toBe(5)
  })

  it('结果端点的路径带 /results 后缀', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({
        runs: [
          {
            index: 0,
            params: { friction: 0.1 },
            durationMs: 42,
            objects: [
              {
                uuid: 'obj-1',
                type: 'sphere',
                resting: true,
                finalPosition: { x: 0, y: 0.5, z: 0 },
                finalVelocity: { x: 0, y: 0, z: 0 },
                penetrationDepth: 0,
              },
            ],
            metrics: { settledAtFrame: 96, maxPenetration: 0, totalFallDistance: 1.5 },
          },
        ],
        summary: { runs: 1, settledRuns: 1, maxPenetration: 0 },
      })
    })

    const results = await getSimulationResults('job-1')

    expect(capturedUrl).toBe(`${API_BASE}/api/simulations/job-1/results`)
    expect(results.runs).toHaveLength(1)
    expect(results.runs[0].params.friction).toBe(0.1)
    expect(results.runs[0].metrics.settledAtFrame).toBe(96)
    expect(results.summary.runs).toBe(1)
    expect(results.summary.settledRuns).toBe(1)
  })

  it('jobId 里的特殊字符会被 URL 编码', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({ runs: [], summary: { runs: 0, settledRuns: 0, maxPenetration: 0 } })
    })

    await getSimulationResults('a b/c')

    expect(capturedUrl).toBe(`${API_BASE}/api/simulations/a%20b%2Fc/results`)
  })

  it('后端回了业务错误时抛 ApiError，不算「后端不在」', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'simulation_not_found', message: '任务不存在：job-9', detail: null } },
        404,
      ),
    )

    const error = await getSimulationJob('job-9').then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('simulation_not_found')
    expect((error as ApiError).status).toBe(404)
    expect(isApiUnavailable(error)).toBe(false)
  })

  it('网络层失败算「后端不在」', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('Failed to fetch')
    })

    const error = await listSimulationJobs().then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(TypeError)
    expect(isApiUnavailable(error)).toBe(true)
  })
})
