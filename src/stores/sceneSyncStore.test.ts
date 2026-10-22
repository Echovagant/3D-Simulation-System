import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useSceneSyncStore } from './sceneSyncStore'
import type { SceneDocument } from '@/types'

const document: SceneDocument = {
  id: 's1',
  name: 'A',
  createdAt: 'x',
  updatedAt: 'y',
  version: 1,
  objects: [],
}

const summary = (id: string) => ({
  id,
  name: 'A',
  objectCount: 0,
  createdAt: 'x',
  updatedAt: 'y',
})

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

describe('sceneSyncStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('后端不可达时状态变成 offline 而不是抛错', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const store = useSceneSyncStore()

    await expect(store.refresh()).resolves.toBeUndefined()
    expect(store.state).toBe('offline')
  })

  it('后端可达时状态是 online 并带上远端列表', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse([{ id: 'a', name: 'A', objectCount: 1, createdAt: 'x', updatedAt: 'y' }]),
        ),
    )
    const store = useSceneSyncStore()
    await store.refresh()

    expect(store.state).toBe('online')
    expect(store.remoteScenes).toHaveLength(1)
  })

  it('推送失败不影响本地状态，返回 false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const store = useSceneSyncStore()

    await expect(store.pushScene(document)).resolves.toBe(false)
    expect(store.state).toBe('offline')
  })

  it('已存在时推送走更新而不是新建', async () => {
    const fetchMock = vi.fn()
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({ error: { code: 'scene_conflict', message: 'x', detail: null } }, 409),
      )
      .mockResolvedValueOnce(jsonResponse(summary('s1')))
    vi.stubGlobal('fetch', fetchMock)

    const store = useSceneSyncStore()
    await expect(store.pushScene(document)).resolves.toBe(true)

    // 方法在 init 上，URL 里没有 POST/PUT
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('PUT')
  })

  it('推送成功后远端列表里出现这条场景', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(summary('s1'), 201)))
    const store = useSceneSyncStore()

    await expect(store.pushScene(document)).resolves.toBe(true)
    expect(store.remoteScenes.map((item) => item.id)).toEqual(['s1'])
  })

  it('推送成功后不会在列表里留下重复项', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(summary('s1'), 201)))
    const store = useSceneSyncStore()

    await store.pushScene(document)
    await store.pushScene(document)

    expect(store.remoteScenes.filter((item) => item.id === 's1')).toHaveLength(1)
  })

  it('后端返回真错误时状态是 error，并留下错误信息', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          jsonResponse({ error: { code: 'http_error', message: '炸了', detail: null } }, 500),
        ),
    )
    const store = useSceneSyncStore()

    await expect(store.pushScene(document)).resolves.toBe(false)
    expect(store.state).toBe('error')
    expect(store.lastError).toContain('炸了')
  })

  it('删除远端场景后列表里不再有它', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([summary('s1')])))
    const store = useSceneSyncStore()
    await store.refresh()

    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(null, 204)))
    await expect(store.removeScene('s1')).resolves.toBe(true)
    expect(store.remoteScenes).toHaveLength(0)
  })

  it('probe 只判断后端在不在，不动远端列表', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse([])))
    const store = useSceneSyncStore()

    await expect(store.probe()).resolves.toBe(true)
    expect(store.state).toBe('online')
    expect(store.remoteScenes).toHaveLength(0)
  })
})
