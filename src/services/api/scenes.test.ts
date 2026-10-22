import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError } from './client'
import { createScene, deleteScene, getScene, listScenes, updateScene } from './scenes'
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

/** 造一个 204 替身：真响应没有响应体，json() 必须不被调用 */
const emptyResponse = (status = 204): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'No Content',
    headers: new Headers(),
    json: async () => {
      throw new SyntaxError('Unexpected end of JSON input')
    },
    text: async () => '',
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

/** 一条场景摘要 */
const buildSummary = (id: string, objectCount: number) => ({
  id,
  name: '落球实验',
  objectCount,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
})

describe('场景接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('列表返回摘要数组，objectCount 按后端给的来', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse([buildSummary('scene-1', 3), buildSummary('scene-2', 0)]),
    )

    const scenes = await listScenes()

    expect(scenes).toHaveLength(2)
    expect(scenes[0].id).toBe('scene-1')
    expect(scenes[0].objectCount).toBe(3)
    expect(scenes[1].objectCount).toBe(0)
  })

  it('创建场景时把完整 document 放进请求体，document.id 正确', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse(buildSummary('scene-1', 1), 201)
    })

    const document = buildDocument('scene-1')
    const created = await createScene({ name: '落球实验', document })

    expect(capturedUrl).toBe(`${API_BASE}/api/scenes`)
    expect(capturedInit?.method).toBe('POST')
    const body = JSON.parse(String(capturedInit?.body)) as {
      name: string
      document: SceneDocument
    }
    expect(body.name).toBe('落球实验')
    expect(body.document.id).toBe('scene-1')
    expect(body.document.objects).toHaveLength(1)
    expect(body.document.objects[0].uuid).toBe('obj-1')
    expect(created.objectCount).toBe(1)
  })

  it('删除场景发 DELETE，204 时不抛错', async () => {
    let capturedUrl = ''
    let capturedMethod = ''
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedMethod = init?.method ?? ''
      return emptyResponse(204)
    })
    vi.stubGlobal('fetch', fetchMock)

    await expect(deleteScene('scene-1')).resolves.toBeUndefined()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(capturedUrl).toBe(`${API_BASE}/api/scenes/scene-1`)
    expect(capturedMethod).toBe('DELETE')
  })

  it('场景 id 会做 URL 编码', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return emptyResponse(204)
    })

    await deleteScene('a b/c')

    expect(capturedUrl).toBe(`${API_BASE}/api/scenes/a%20b%2Fc`)
  })

  it('更新场景发 PUT，请求体带完整 document', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse(buildSummary('scene-1', 2))
    })

    const document = buildDocument('scene-1')
    await updateScene('scene-1', { name: '落球实验', document })

    expect(capturedUrl).toBe(`${API_BASE}/api/scenes/scene-1`)
    expect(capturedInit?.method).toBe('PUT')
    const body = JSON.parse(String(capturedInit?.body)) as { document: SceneDocument }
    expect(body.document.id).toBe('scene-1')
  })

  it('场景不存在时抛 ApiError，错误码与后端一致', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'scene_not_found', message: '场景不存在：scene-1', detail: null } },
        404,
      ),
    )

    const error = await getScene('scene-1').then(
      () => {
        throw new Error('这次请求本该失败，但它成功了')
      },
      (reason: unknown) => reason,
    )

    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).code).toBe('scene_not_found')
    expect((error as ApiError).status).toBe(404)
  })
})
