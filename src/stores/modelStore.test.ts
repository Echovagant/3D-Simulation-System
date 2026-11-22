import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useModelStore } from './modelStore'
import type { ModelUploadItem } from '@/services/api/models'

/** 服务端上传应答的桩（字段与后端 ModelUploadItem 对齐；id 是 uuid4.hex 形状） */
const SERVER_ITEM: ModelUploadItem = {
  id: 'abc123deabc123deabc123deabc123de',
  name: '服务端模型',
  category: 'props',
  format: 'glb',
  size: 128,
  modelUrl: '/api/models/abc123deabc123deabc123deabc123de/file',
  createdAt: '2026-11-22T00:00:00Z',
  polyCount: 0,
  materialCount: 0,
  hasAnimation: false,
  persisted: true,
}

/** Response 桩：只要 apiRequest / uploadModelFile 用到的 ok / status / json */
const jsonResponse = (status: number, body: unknown) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
})

const makeFile = (name = 'server.glb'): File =>
  new File([new Uint8Array([1, 2, 3])], name, { type: 'model/gltf-binary' })

describe('useModelStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始模型列表来自 createModelLibrary 的副本', () => {
    const store = useModelStore()

    expect(store.models).toHaveLength(24)
    expect(store.getModelsByCategory('characters')).toHaveLength(7)
  })

  it('两个 store 实例的 models 数组互不影响', () => {
    setActivePinia(createPinia())
    const first = useModelStore()

    setActivePinia(createPinia())
    const second = useModelStore()

    // 第一个 store 追加一条，第二个 store 不应该被污染
    first.models.push({ ...first.models[0], id: 'extra' })

    expect(first.models).toHaveLength(25)
    expect(second.models).toHaveLength(24)
  })

  it('deleteModel 只影响当前 store', () => {
    setActivePinia(createPinia())
    const first = useModelStore()

    setActivePinia(createPinia())
    const second = useModelStore()

    first.deleteModel('char-001')

    expect(first.getModelById('char-001')).toBeUndefined()
    expect(second.getModelById('char-001')).toBeDefined()
  })
})

/**
 * 上传持久化（服务端优先，blob 回退如实标注）。
 *
 * fetch 用桩：后端是可选增强，这里的用例覆盖「在」与「不在」两条路。
 * jsdom 没有实现 URL.createObjectURL，同样用桩替代（与 modelStore.upload.test.ts 同法）。
 */
describe('上传持久化', () => {
  const originalCreate = URL.createObjectURL
  const originalRevoke = URL.revokeObjectURL
  let fetchMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    setActivePinia(createPinia())
    // 默认拒绝：模拟「后端不在」。每个用例再按需排队 ResolvedValue。
    fetchMock = vi.fn().mockRejectedValue(new TypeError('backend down'))
    vi.stubGlobal('fetch', fetchMock)
    URL.createObjectURL = vi.fn(
      () => 'blob:http://localhost/mock-blob',
    ) as unknown as typeof URL.createObjectURL
    URL.revokeObjectURL = vi.fn() as unknown as typeof URL.revokeObjectURL
  })

  afterEach(() => {
    URL.createObjectURL = originalCreate
    URL.revokeObjectURL = originalRevoke
    vi.unstubAllGlobals()
  })

  it('store 初始化拉取服务端列表并合并（去重按 id，内置条目不受影响）', async () => {
    // 第 1 次 fetch 是初始化同步的 GET /api/models
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { items: [SERVER_ITEM] }))

    const store = useModelStore()
    // syncFromServer 是 store 内部的异步任务：等一个宏任务让它跑完微任务链
    await new Promise((resolve) => setTimeout(resolve, 0))

    const merged = store.getModelById(SERVER_ITEM.id)
    expect(merged?.persisted).toBe(true)
    expect(merged?.modelUrl).toBe(SERVER_ITEM.modelUrl)
    expect(store.models).toHaveLength(25) // 24 内置 + 1 服务端
  })

  it('上传成功 → 插入持久化条目，POST 发到 /api/models/upload', async () => {
    const store = useModelStore() // 触发初始化 GET（吃掉默认拒绝）
    fetchMock.mockResolvedValueOnce(jsonResponse(201, SERVER_ITEM))

    const model = await store.uploadModel({
      name: '服务端模型',
      category: 'props',
      file: makeFile(),
    })

    expect(model.persisted).toBe(true)
    expect(model.sessionOnly).toBeUndefined()
    expect(model.id).toBe(SERVER_ITEM.id)
    expect(model.modelUrl).toBe(SERVER_ITEM.modelUrl)
    expect(store.models[0].id).toBe(SERVER_ITEM.id)

    // POST multipart：地址、方法、软身份头
    const uploadCalls = fetchMock.mock.calls.filter(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    )
    expect(uploadCalls).toHaveLength(1)
    const [url, init] = uploadCalls[0] as [string, RequestInit]
    expect(url).toBe('/api/models/upload')
    expect(init.body).toBeInstanceOf(FormData)
    const token = (init.headers as Record<string, string>)['X-Owner-Token']
    expect(typeof token).toBe('string')
    expect(token.length).toBeGreaterThan(0)
  })

  it('上传失败（后端不可达）→ 回退 blob 条目并如实标注 sessionOnly', async () => {
    const store = useModelStore() // 初始化 GET 吃掉默认拒绝
    fetchMock.mockRejectedValueOnce(new TypeError('network down'))

    const model = await store.uploadModel({
      name: '会话模型',
      category: 'props',
      file: makeFile('local.glb'),
    })

    expect(model.sessionOnly).toBe(true)
    expect(model.persisted).toBeUndefined()
    expect(model.modelUrl.startsWith('blob:')).toBe(true)
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1)
    // 回退条目也要进列表（实测拆分 prepend 时丢过这一步）
    expect(store.models[0].id).toBe(model.id)
  })

  it('删除持久化条目 → 发出 DELETE /api/models/{id}，本地条目同步移除', async () => {
    const store = useModelStore()
    fetchMock.mockResolvedValueOnce(jsonResponse(201, SERVER_ITEM))
    await store.uploadModel({ name: '服务端模型', category: 'props', file: makeFile() })

    fetchMock.mockResolvedValueOnce(jsonResponse(204, undefined))
    // fetch 在 deleteModel 内同步发起，调用一返回就能断言
    store.deleteModel(SERVER_ITEM.id)

    const deleteCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'DELETE',
    )
    expect(deleteCall).toBeDefined()
    const [url] = deleteCall as [string, RequestInit]
    expect(url).toBe(`/api/models/${SERVER_ITEM.id}`)
    expect(store.getModelById(SERVER_ITEM.id)).toBeUndefined()
  })
})
