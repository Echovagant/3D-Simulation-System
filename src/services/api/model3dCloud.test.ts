import { afterEach, describe, expect, it, vi } from 'vitest'
import { API_BASE, ApiError } from './client'
import {
  createModel3dCloudJob,
  deleteModel3dKey,
  fetchModel3dGlb,
  getModel3dCloudJob,
  listModel3dKeys,
  listModel3dProviders,
  saveModel3dKey,
} from './model3dCloud'

const TOKEN = 'owner-token-under-test'

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

describe('云端生成 3D 接口', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('供应商目录与密钥状态都带 X-Owner-Token 软身份头', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse([])
    })

    await listModel3dProviders(TOKEN)

    expect(capturedUrl).toBe(`${API_BASE}/api/model3d/providers`)
    expect(new Headers(capturedInit?.headers).get('X-Owner-Token')).toBe(TOKEN)

    await listModel3dKeys(TOKEN)
    expect(capturedUrl).toBe(`${API_BASE}/api/model3d/keys`)
    expect(new Headers(capturedInit?.headers).get('X-Owner-Token')).toBe(TOKEN)
  })

  it('托管密钥发 POST JSON，只带给了的字段（camelCase 契约）', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse({ providerId: 'hunyuan3d', configured: true }, 201)
    })

    await saveModel3dKey(TOKEN, {
      providerId: 'hunyuan3d',
      secretId: 'sid',
      secretKey: 'skey',
    })

    expect(capturedUrl).toBe(`${API_BASE}/api/model3d/keys`)
    expect(capturedInit?.method).toBe('POST')
    expect(new Headers(capturedInit?.headers).get('X-Owner-Token')).toBe(TOKEN)
    const body = JSON.parse(String(capturedInit?.body))
    expect(body).toEqual({ providerId: 'hunyuan3d', secretId: 'sid', secretKey: 'skey' })
  })

  it('删除密钥走 DELETE 且路径做 URL 编码', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse(undefined, 204)
    })

    await deleteModel3dKey(TOKEN, 'bailian-tripo')

    expect(capturedUrl).toBe(`${API_BASE}/api/model3d/keys/bailian-tripo`)
    expect(capturedInit?.method).toBe('DELETE')
  })

  it('提交云端任务发 POST multipart：providerId / prompt / 图片都在表单里，带软身份头', async () => {
    let capturedUrl = ''
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
      capturedUrl = String(url)
      capturedInit = init
      return jsonResponse({ jobId: 'cloud-1' }, 202)
    })

    const created = await createModel3dCloudJob(TOKEN, {
      providerId: 'hunyuan3d',
      label: '小恐龙',
      image: buildImage(),
    })

    expect(capturedUrl).toBe(`${API_BASE}/api/model3d/cloud/jobs`)
    expect(capturedInit?.method).toBe('POST')
    const form = capturedInit?.body as FormData
    expect(form).toBeInstanceOf(FormData)
    expect(form.get('providerId')).toBe('hunyuan3d')
    expect(form.get('label')).toBe('小恐龙')
    expect(form.get('image')).toBeInstanceOf(File)
    // 没给的输入不发字段（prompt / imageUrl 三选一）
    expect(form.get('prompt')).toBeNull()
    expect(form.get('imageUrl')).toBeNull()
    const headers = new Headers(capturedInit?.headers)
    expect(headers.get('X-Owner-Token')).toBe(TOKEN)
    // multipart 不能有手工 Content-Type——boundary 交给浏览器
    expect(headers.has('Content-Type')).toBe(false)
    expect(created.jobId).toBe('cloud-1')
  })

  it('提交时带 prompt 就不发图片字段（输入互斥由后端兜底）', async () => {
    let capturedInit: RequestInit | undefined
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      capturedInit = init
      return jsonResponse({ jobId: 'cloud-2' }, 202)
    })

    await createModel3dCloudJob(TOKEN, {
      providerId: 'bailian-tripo',
      prompt: '一只可爱的猫',
      imageUrl: 'https://example.com/cat.jpg',
    })

    const form = capturedInit?.body as FormData
    expect(form.get('prompt')).toBe('一只可爱的猫')
    expect(form.get('imageUrl')).toBe('https://example.com/cat.jpg')
    expect(form.get('image')).toBeNull()
  })

  it('后端回统一错误信封时抛 ApiError（code 透传）', async () => {
    vi.stubGlobal('fetch', async () =>
      jsonResponse(
        { error: { code: 'model3d_quota_exceeded', message: '今天的云端生成额度用完了' } },
        429,
      ),
    )

    let caught: unknown
    try {
      await createModel3dCloudJob(TOKEN, { providerId: 'hunyuan3d', prompt: 'x' })
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ApiError)
    expect((caught as ApiError).code).toBe('model3d_quota_exceeded')
    expect((caught as ApiError).status).toBe(429)
  })

  it('任务详情路径对 jobId 做 URL 编码', async () => {
    let capturedUrl = ''
    vi.stubGlobal('fetch', async (url: string) => {
      capturedUrl = String(url)
      return jsonResponse({ jobId: 'a b/c', status: 'running', imageName: '', createdAt: '' })
    })

    await getModel3dCloudJob(TOKEN, 'a b/c')

    expect(capturedUrl).toBe(`${API_BASE}/api/model3d/cloud/jobs/a%20b%2Fc`)
  })

  it('下载产物带软身份头（产物按 owner 分区，匿名 404）', async () => {
    let capturedInit: RequestInit | undefined
    const blob = new Blob([new Uint8Array([0x67, 0x6c, 0x54, 0x46])])
    vi.stubGlobal('fetch', async (_url: string, init?: RequestInit) => {
      capturedInit = init
      return {
        ok: true,
        status: 200,
        blob: async () => blob,
      } as unknown as Response
    })

    const result = await fetchModel3dGlb(TOKEN, 'job-9')

    expect((capturedInit?.headers as Record<string, string>)['X-Owner-Token']).toBe(TOKEN)
    expect(result).toBe(blob)
  })
})
