import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGymWorkbenchStore } from './gymWorkbenchStore'
import type { MemoryItem } from '@/services/api/memory'

/**
 * 工作台 store 记忆侧的回归网（）。
 *
 * 盯四件事：列表/检索、手动写入、审计提炼、删除（含 404 收尾）。
 * fetch 全部用替身——store 层不碰网络；记忆数据按路径+方法路由，
 * 与真实后端一样「删了就真的没了」。
 */

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

let nextId = 1
/** 记忆注册表跟着建/删走——真实后端里写完的记忆会出现在列表里 */
let memoriesNow: MemoryItem[] = []
/** 提炼端点的应答（用例里可改，模拟「审计里没有失败模式」） */
let consolidateBody: Record<string, unknown> = {
  scannedLogs: 12,
  created: 1,
  updated: 1,
  patterns: [
    { sessionId: 'sess-1', errorCode: 'gym_force_out_of_range', occurrences: 3, memoryId: 5, action: 'created' },
    { sessionId: 'sess-1', errorCode: 'gym_episode_done', occurrences: 2, memoryId: 6, action: 'updated' },
  ],
}

const memoryItem = (overrides: Partial<MemoryItem> = {}): MemoryItem => ({
  id: nextId++,
  kind: 'semantic',
  content: '一条记忆',
  source: 'manual',
  importance: 0.5,
  dedupeKey: null,
  createdAt: '2026-11-23T10:00:00',
  lastAccessedAt: '2026-11-23T10:00:00',
  ...overrides,
})

/** 记忆侧的 fetch 替身：按路径+方法路由，出错路径回 500（测试能发现打错端点） */
const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/memory' && method === 'GET') {
      const keyword = url.searchParams.get('query')
      const items = keyword
        ? memoriesNow.filter((item) => item.content.includes(keyword))
        : memoriesNow
      return jsonResponse({ items })
    }
    if (path === '/api/memory' && method === 'POST') {
      const body = JSON.parse(init?.body as string) as Partial<MemoryItem>
      const created = memoryItem({
        kind: body.kind ?? 'semantic',
        content: body.content ?? '',
        importance: body.importance ?? 0.5,
      })
      memoriesNow = [created, ...memoriesNow]
      return jsonResponse(created, 201)
    }
    if (path === '/api/memory/consolidate' && method === 'POST') {
      const created = memoryItem({
        kind: 'procedural',
        source: 'audit_distilled',
        dedupeKey: 'owner:0:sess-1:gym_force_out_of_range',
        content: '失败模式：gym_force_out_of_range',
      })
      memoriesNow = [created, ...memoriesNow]
      return jsonResponse(consolidateBody)
    }
    const deleteMatch = /^\/api\/memory\/(\d+)$/.exec(path)
    if (deleteMatch && method === 'DELETE') {
      const id = Number(deleteMatch[1])
      if (!memoriesNow.some((item) => item.id === id)) {
        return jsonResponse(
          { error: { code: 'memory_not_found', message: `记忆不存在：${id}`, detail: null } },
          404,
        )
      }
      memoriesNow = memoriesNow.filter((item) => item.id !== id)
      return jsonResponse(null, 204)
    }
    return jsonResponse(
      { error: { code: 'http_error', message: `意外路径 ${method} ${path}`, detail: null } },
      500,
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 数一数打到记忆列表端点的请求数（提炼成功后应紧跟一次刷新） */
const countListCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
  fetchMock.mock.calls.filter(([input, init]) => {
    const url = new URL(String(input), 'http://localhost')
    return url.pathname === '/api/memory' && (init?.method ?? 'GET') === 'GET'
  }).length

describe('gymWorkbenchStore · 记忆侧', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    nextId = 1
    memoriesNow = []
    consolidateBody = {
      scannedLogs: 12,
      created: 1,
      updated: 1,
      patterns: [
        { sessionId: 'sess-1', errorCode: 'gym_force_out_of_range', occurrences: 3, memoryId: 5, action: 'created' },
        { sessionId: 'sess-1', errorCode: 'gym_episode_done', occurrences: 2, memoryId: 6, action: 'updated' },
      ],
    }
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('fetchMemories：无关键词拉最近列表，列表形状原样落位', async () => {
    const fetchMock = installFetch()
    const store = useGymWorkbenchStore()
    memoriesNow = [memoryItem({ kind: 'procedural', source: 'audit_distilled' }), memoryItem()]

    const ok = await store.fetchMemories()

    expect(ok).toBe(true)
    expect(store.memories).toHaveLength(2)
    expect(store.memories[0].kind).toBe('procedural')
    expect(store.memoriesError).toBe('')
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(new URL(String(url), 'http://localhost').pathname).toBe('/api/memory')
    expect(new Headers(init?.headers).get('X-Owner-Token')).toBeTruthy()
  })

  it('fetchMemories：有关键词走检索端点，只留命中项', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    memoriesNow = [memoryItem({ content: '力上限公式' }), memoryItem({ content: '别的东西' })]

    const ok = await store.fetchMemories('力上限')

    expect(ok).toBe(true)
    expect(store.memories).toHaveLength(1)
    expect(store.memories[0].content).toBe('力上限公式')
  })

  it('createMemory：成功后新条目插到列表最前', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    memoriesNow = [memoryItem({ content: '旧记忆' })]
    await store.fetchMemories()

    const ok = await store.createMemory({
      kind: 'semantic',
      content: '新记忆',
      importance: 0.8,
    })

    expect(ok).toBe(true)
    expect(store.memories[0].content).toBe('新记忆')
    expect(store.memories[0].importance).toBe(0.8)
    expect(store.memories).toHaveLength(2)
    expect(store.memoryWriting).toBe(false)
    expect(store.memoryActionError).toBe('')
  })

  it('后端缺席：fetchMemories 不清空旧列表，只记错误', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const store = useGymWorkbenchStore()
    store.memories = [memoryItem()]

    const ok = await store.fetchMemories()

    expect(ok).toBe(false)
    expect(store.memories).toHaveLength(1)
    expect(store.memoriesError).toContain('后端不可达')
  })

  it('deleteMemory：204 后本地同步移除', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    const target = memoryItem({ id: 3 })
    memoriesNow = [memoryItem({ id: 1 }), target]
    await store.fetchMemories()

    const ok = await store.deleteMemory(3)

    expect(ok).toBe(true)
    expect(store.memories).toHaveLength(1)
    expect(store.memories[0].id).toBe(1)
    expect(store.memoryDeletingIds).toHaveLength(0)
  })

  it('deleteMemory：404（已不存在）也算删成，条目照常摘掉', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    memoriesNow = [memoryItem({ id: 9 })]
    await store.fetchMemories()
    // 本地有、后端没有：后端重启清空数据的典型场景
    store.memories = [memoryItem({ id: 9 }), memoryItem({ id: 10 })]

    const ok = await store.deleteMemory(9)

    expect(ok).toBe(true)
    expect(store.memories.map((item) => item.id)).toEqual([10])
    expect(store.memoryActionError).toBe('')
  })

  it('consolidate：结果落位，列表跟着刷新一次', async () => {
    const fetchMock = installFetch()
    const store = useGymWorkbenchStore()

    const ok = await store.consolidate()

    expect(ok).toBe(true)
    expect(store.consolidateResult?.scannedLogs).toBe(12)
    expect(store.consolidateResult?.created).toBe(1)
    expect(store.consolidateResult?.patterns).toHaveLength(2)
    expect(store.consolidateResult?.patterns[0].errorCode).toBe('gym_force_out_of_range')
    // 提炼会新建/更新记忆，列表不等下一次手动刷新
    expect(countListCalls(fetchMock)).toBe(1)
    expect(store.memories[0].source).toBe('audit_distilled')
    expect(store.consolidating).toBe(false)
  })

  it('consolidate：审计里没有失败模式时 created/updated/patterns 全零也照常展示', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    consolidateBody = { scannedLogs: 5, created: 0, updated: 0, patterns: [] }

    const ok = await store.consolidate()

    expect(ok).toBe(true)
    expect(store.consolidateResult?.patterns).toEqual([])
    expect(store.consolidateResult?.created).toBe(0)
  })
})
