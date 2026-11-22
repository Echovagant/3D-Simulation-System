import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGymWorkbenchStore, AUDIT_POLL_INTERVAL_MS } from './gymWorkbenchStore'
import type { GymStepLogItem } from '@/services/api/gymWorkbench'

/**
 * Agent 工作台 store 的回归网。
 *
 * 盯四件事：创建会话、step 成功、step 422 修复指令透传、审计轮询与卸载清理。
 * fetch 全部用替身——store 层不碰网络。
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

const observation = {
  agent: { uuid: 'agent-1', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  objects: [{ uuid: 'agent-1', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
  target: { x: 3, z: 0 },
  step: 0,
  maxSteps: 300,
  distance: 3,
}

const createdBody = {
  sessionId: 'sess-1',
  observation,
  reward: 0,
  terminated: false,
  truncated: false,
  effectiveParams: {
    gravityY: -9.81,
    friction: null,
    restitution: null,
    dt: 1 / 60,
    steps: 240,
    trace: false,
    initialVelocityY: 0,
  },
  droppedParamKeys: [],
  defaultedParamKeys: [],
  forceLimit: 30,
}

const stepOkBody = {
  observation: { ...observation, step: 1, distance: 2.9 },
  reward: 0.1,
  terminated: false,
  truncated: false,
  info: { step: 1, maxSteps: 300, distance: 2.9 },
}

const repairEnvelope = {
  error: {
    code: 'gym_force_out_of_range',
    message: '力上限 = 30 × 质量 1.00kg = 30.00N，收到 999.00N，请减小',
    detail: null,
  },
}

const logItem = (overrides: Partial<GymStepLogItem> = {}): GymStepLogItem => ({
  id: 1,
  ts: '2026-11-23T10:00:00',
  ownerToken: 'owner',
  sessionId: 'sess-1',
  roundIndex: 0,
  stepIndex: 0,
  forceX: 5,
  forceZ: 0,
  forceLimit: 30,
  applied: true,
  errorCode: null,
  distance: 2.9,
  reward: 0.1,
  terminated: false,
  truncated: false,
  latencyMs: 12,
  ...overrides,
})

/**
 * 按路径+方法路由的 fetch 替身。step 的返回由 `stepMode` 控制，
 * 用例里改它就能切换 200 / 422 / 409，不用重装替身。
 * 会话注册表跟着建/删走——真实后端里建完的会话会出现在列表里。
 */
let stepMode: 'ok' | 'over' | 'done' = 'ok'
let sessionsNow: Array<{
  sessionId: string
  agentUuid: string
  step: number
  maxSteps: number
  terminated: boolean
  truncated: boolean
}> = []

const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/gym/sessions' && method === 'POST') {
      sessionsNow = [
        { sessionId: 'sess-1', agentUuid: 'agent-1', step: 0, maxSteps: 300, terminated: false, truncated: false },
      ]
      return jsonResponse(createdBody, 201)
    }
    if (path === '/api/gym/sessions' && method === 'GET') {
      return jsonResponse(sessionsNow)
    }
    if (path === '/api/gym/sessions/sess-1/step' && method === 'POST') {
      if (stepMode === 'over') return jsonResponse(repairEnvelope, 422)
      if (stepMode === 'done') {
        return jsonResponse(
          {
            error: { code: 'gym_episode_done', message: '本回合已结束（terminated/truncated），先 reset 再继续。', detail: null },
          },
          409,
        )
      }
      return jsonResponse(stepOkBody)
    }
    if (path === '/api/gym/sessions/sess-1/reset' && method === 'POST') {
      const { ...rest } = createdBody
      delete (rest as { sessionId?: string }).sessionId
      return jsonResponse(rest)
    }
    if (path === '/api/gym/sessions/sess-1/logs' && method === 'GET') {
      return jsonResponse([logItem()])
    }
    if (path === '/api/gym/sessions/sess-1' && method === 'DELETE') {
      sessionsNow = []
      return jsonResponse(null, 204)
    }
    return jsonResponse({ error: { code: 'http_error', message: `意外路径 ${method} ${path}`, detail: null } }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/** 数一数打到审计日志端点的请求数 */
const countLogCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
  fetchMock.mock.calls.filter(
    ([input]) => String(input).includes('/api/gym/sessions/sess-1/logs'),
  ).length

/** apiRequest 会把 headers 包成 Headers 实例再传给 fetch：按 Headers 读 */
const headerOf = (init: RequestInit | undefined, name: string): string | null =>
  new Headers(init?.headers).get(name)

describe('gymWorkbenchStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stepMode = 'ok'
    sessionsNow = []
    vi.restoreAllMocks()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  it('创建会话成功：当前会话、参数回显、观测都落位，审计轮询启动', async () => {
    const fetchMock = installFetch()
    const store = useGymWorkbenchStore()

    const ok = await store.createSession({
      scene: { name: 'demo', objects: [{ uuid: 'agent-1' }] },
      target: { x: 3, z: 0 },
    })

    expect(ok).toBe(true)
    expect(store.currentSessionId).toBe('sess-1')
    expect(store.currentParams?.forceLimit).toBe(30)
    expect(store.currentParams?.effectiveParams.gravityY).toBe(-9.81)
    expect(store.lastObservation?.distance).toBe(3)
    expect(store.auditPollingActive).toBe(true)

    // 软身份头必须带上；请求体里是场景文档
    const createCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/gym/sessions') && init?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    expect(headerOf(createCall?.[1], 'X-Owner-Token')).toBeTruthy()
    const body = JSON.parse(createCall?.[1]?.body as string) as Record<string, unknown>
    expect(body.scene).toEqual({ name: 'demo', objects: [{ uuid: 'agent-1' }] })
  })

  it('step 成功：结果与观测落位，审计流立刻刷新一次', async () => {
    const fetchMock = installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })
    const logsBefore = countLogCalls(fetchMock)

    const ok = await store.stepCurrent(5, 0)

    expect(ok).toBe(true)
    expect(store.lastStep?.reward).toBe(0.1)
    expect(store.lastObservation?.step).toBe(1)
    expect(store.stepError).toBe('')
    expect(store.repairHint).toBeNull()
    // step 之后不等下一次轮询，立刻拉一次日志
    expect(countLogCalls(fetchMock)).toBe(logsBefore + 1)
  })

  it('step 422 越界力：修复指令原文透传，上一次成功结果不被清掉', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })
    await store.stepCurrent(5, 0)

    stepMode = 'over'
    const ok = await store.stepCurrent(999, 0)

    expect(ok).toBe(false)
    expect(store.repairHint?.code).toBe('gym_force_out_of_range')
    expect(store.repairHint?.message).toBe('力上限 = 30 × 质量 1.00kg = 30.00N，收到 999.00N，请减小')
    expect(store.stepError).toBe(store.repairHint?.message)
    // 上一次成功的执行结果还在，界面能对照着看
    expect(store.lastStep?.reward).toBe(0.1)
  })

  it('step 409 回合已结束：进 stepError，不算修复指令', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })

    stepMode = 'done'
    const ok = await store.stepCurrent(5, 0)

    expect(ok).toBe(false)
    expect(store.repairHint).toBeNull()
    expect(store.stepError).toContain('本回合已结束')
  })

  it('reset 成功：参数回显与观测刷新', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })
    await store.stepCurrent(5, 0)

    const ok = await store.resetCurrent()

    expect(ok).toBe(true)
    expect(store.currentParams?.forceLimit).toBe(30)
    expect(store.lastObservation?.step).toBe(0)
  })

  it('审计轮询按 3 秒节奏打日志端点，回合过滤生效', async () => {
    vi.useFakeTimers()
    const fetchMock = installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })

    expect(store.auditPollingActive).toBe(true)
    const baseline = countLogCalls(fetchMock)

    await vi.advanceTimersByTimeAsync(AUDIT_POLL_INTERVAL_MS)
    expect(countLogCalls(fetchMock)).toBe(baseline + 1)

    await vi.advanceTimersByTimeAsync(AUDIT_POLL_INTERVAL_MS * 2)
    expect(countLogCalls(fetchMock)).toBe(baseline + 3)

    // 回合过滤立刻生效：URL 带上 round 参数
    store.setLogRoundFilter(1)
    await vi.advanceTimersByTimeAsync(0)
    const filtered = fetchMock.mock.calls.filter(
      ([input]) => String(input).includes('/logs?round=1'),
    )
    expect(filtered.length).toBeGreaterThan(0)
  })

  it('卸载清理：stop 之后不再轮询', async () => {
    vi.useFakeTimers()
    const fetchMock = installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })
    const baseline = countLogCalls(fetchMock)

    store.stopAuditPolling()
    expect(store.auditPollingActive).toBe(false)

    await vi.advanceTimersByTimeAsync(AUDIT_POLL_INTERVAL_MS * 3)
    expect(countLogCalls(fetchMock)).toBe(baseline)
  })

  it('selectSession(空串) 也会收掉轮询并清空痕迹', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })
    expect(store.auditPollingActive).toBe(true)

    store.selectSession('')

    expect(store.currentSessionId).toBe('')
    expect(store.logs).toHaveLength(0)
    expect(store.currentParams).toBeNull()
    expect(store.auditPollingActive).toBe(false)
  })

  it('刷新列表发现当前会话没了（后端重启清空）：如实摘除当前状态', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })
    expect(store.currentSessionId).toBe('sess-1')

    sessionsNow = []
    await store.refreshSessions()

    expect(store.currentSessionId).toBe('')
    expect(store.sessions).toHaveLength(0)
  })

  it('后端缺席：create 返回 false 并记错误，不启动轮询', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const store = useGymWorkbenchStore()

    const ok = await store.createSession({ scene: { objects: [{}] } })

    expect(ok).toBe(false)
    expect(store.currentSessionId).toBe('')
    expect(store.listError).toContain('后端不可达')
    expect(store.auditPollingActive).toBe(false)
  })

  it('删除当前会话：清空当前状态并刷新列表', async () => {
    installFetch()
    const store = useGymWorkbenchStore()
    await store.createSession({ scene: { objects: [{}] } })

    const ok = await store.deleteCurrent()

    expect(ok).toBe(true)
    expect(store.currentSessionId).toBe('')
    expect(store.sessions).toHaveLength(0)
    expect(store.auditPollingActive).toBe(false)
  })
})
