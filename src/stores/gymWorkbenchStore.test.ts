import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGymWorkbenchStore, AUDIT_POLL_INTERVAL_MS } from './gymWorkbenchStore'
import { useLlmStore } from './llmStore'
import type { GymStepLogItem } from '@/services/api/gymWorkbench'
import type { KnowledgeItem } from '@/services/api/knowledge'

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

/** 双智能体观测：两个受控物体各自的目标与完成状态 */
const teamObservation = {
  ...observation,
  agents: [
    {
      uuid: 'agent-1',
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      target: { x: 3, z: 0 },
      distance: 3,
      done: false,
    },
    {
      uuid: 'agent-2',
      position: { x: 1, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      target: { x: -1, z: 0 },
      distance: 2,
      done: false,
    },
  ],
}

const teamCreatedBody = {
  ...createdBody,
  observation: teamObservation,
  forceLimits: { 'agent-1': 30, 'agent-2': 30 },
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
  agentUuid: 'agent-1',
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
/** 决策注入的资料注册表（默认空；用例里按需塞） */
let knowledgeNow: KnowledgeItem[] = []
/** 资料检索是否失败（验证「检索失败不拦决策」） */
let knowledgeFails = false

const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), 'http://localhost')
    const path = url.pathname
    const method = init?.method ?? 'GET'
    if (path === '/api/gym/sessions' && method === 'POST') {
      sessionsNow = [
        { sessionId: 'sess-1', agentUuid: 'agent-1', step: 0, maxSteps: 300, terminated: false, truncated: false },
      ]
      const body = init?.body ? (JSON.parse(String(init.body)) as { agents?: unknown[] }) : {}
      if (Array.isArray(body.agents) && body.agents.length > 0) {
        return jsonResponse(teamCreatedBody, 201)
      }
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
      const body = init?.body ? (JSON.parse(String(init.body)) as { actions?: unknown[] }) : {}
      if (Array.isArray(body.actions)) {
        return jsonResponse({
          observation: { ...teamObservation, step: 1 },
          reward: 0.2,
          terminated: false,
          truncated: false,
          info: { step: 1, maxSteps: 300, distance: 2.9, agents: [] },
        })
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
    if (path === '/api/knowledge/entries' && method === 'GET') {
      if (knowledgeFails) {
        return jsonResponse(
          { error: { code: 'http_error', message: '资料库不可用', detail: null } },
          500,
        )
      }
      return jsonResponse({ items: knowledgeNow })
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

/** 数一数打到 step 端点的请求数 */
const countStepCalls = (fetchMock: ReturnType<typeof vi.fn>): number =>
  fetchMock.mock.calls.filter(
    ([input, init]) =>
      String(input).includes('/api/gym/sessions/sess-1/step') && init?.method === 'POST',
  ).length

/** LLM 出网口替身：正常返回一段模型正文 */
const stubInvokeOk = (content: string) =>
  vi.spyOn(useLlmStore(), 'invoke').mockResolvedValue({ ok: true, content, error: '' })

/** apiRequest 会把 headers 包成 Headers 实例再传给 fetch：按 Headers 读 */
const headerOf = (init: RequestInit | undefined, name: string): string | null =>
  new Headers(init?.headers).get(name)

describe('gymWorkbenchStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    stepMode = 'ok'
    sessionsNow = []
    knowledgeNow = []
    knowledgeFails = false
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

  describe('autoDecide（LLM 自动决策）', () => {
    it('提议成功：动作自动送进执行面，来源记为 LLM，提议留档 executed', async () => {
      const fetchMock = installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      stubInvokeOk('{"forceX": 5, "forceZ": 0}')

      const ok = await store.autoDecide()

      expect(ok).toBe(true)
      expect(store.decisionError).toBe('')
      expect(store.lastProposal?.action).toEqual({ forceX: 5, forceZ: 0 })
      expect(store.lastProposal?.executed).toBe(true)
      expect(store.lastProposal?.clamped).toBe(false)
      expect(store.lastProposal?.references).toEqual([])
      expect(store.lastActionSource).toBe('llm')
      expect(store.lastStep?.reward).toBe(0.1)
      expect(countStepCalls(fetchMock)).toBe(1)
    })

    it('决策注入：检索到的 gym 资料进提示词，引用标题留档', async () => {
      installFetch()
      knowledgeNow = [
        {
          id: 9,
          title: '力控经验',
          content: '接近目标时减小力度，避免冲过头。',
          tags: 'gym, 力控',
          importance: 0.8,
          createdAt: '2026-11-23T10:00:00',
          updatedAt: '2026-11-23T10:00:00',
          lastAccessedAt: '2026-11-23T10:00:00',
        },
      ]
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      const invoke = stubInvokeOk('{"forceX": 5, "forceZ": 0}')

      const ok = await store.autoDecide()

      expect(ok).toBe(true)
      expect(store.lastProposal?.references).toEqual([{ id: 9, title: '力控经验' }])

      const [messages] = invoke.mock.calls[0] as [
        Array<{ role: string; content: string }>,
        number,
      ]
      const payload = JSON.parse(messages[1].content) as {
        references: Array<{ title: string; content: string }>
      }
      expect(payload.references).toEqual([
        { title: '力控经验', content: '接近目标时减小力度，避免冲过头。' },
      ])
      expect(messages[0].content).toContain('references')
    })

    it('资料检索失败不拦决策：照常出网，引用为空', async () => {
      installFetch()
      knowledgeFails = true
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      const invoke = stubInvokeOk('{"forceX": 5, "forceZ": 0}')

      const ok = await store.autoDecide()

      expect(ok).toBe(true)
      expect(invoke).toHaveBeenCalledTimes(1)
      expect(store.lastProposal?.references).toEqual([])
      expect(store.decisionError).toBe('')
    })

    it('超安全上限的提议：等比缩回后执行，原始值留档', async () => {
      installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      // 力上限 30 → 安全线 24；模型提议 30
      stubInvokeOk('{"forceX": 30, "forceZ": 0}')

      const ok = await store.autoDecide()

      expect(ok).toBe(true)
      expect(store.lastProposal?.clamped).toBe(true)
      expect(store.lastProposal?.action).toEqual({ forceX: 24, forceZ: 0 })
      expect(store.lastProposal?.original).toEqual({ forceX: 30, forceZ: 0 })
      expect(store.lastProposal?.executed).toBe(true)
    })

    it('畸形输出：decisionError 如实报，不发 step、不静默降级', async () => {
      const fetchMock = installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      stubInvokeOk('我觉得应该往左推一点')

      const ok = await store.autoDecide()

      expect(ok).toBe(false)
      expect(store.decisionError).toContain('JSON')
      expect(store.lastProposal).toBeNull()
      // 只有建会话时的初始结果，没有新的执行
      expect(store.lastStep?.info).toEqual({})
      expect(countStepCalls(fetchMock)).toBe(0)
    })

    it('提议成功但 step 422：修复指令透传，提议记 executed=false', async () => {
      installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      stubInvokeOk('{"forceX": 5, "forceZ": 0}')
      stepMode = 'over'

      const ok = await store.autoDecide()

      expect(ok).toBe(false)
      expect(store.repairHint?.code).toBe('gym_force_out_of_range')
      expect(store.decisionError).toBe('')
      expect(store.lastProposal?.executed).toBe(false)
      // 没有成功的一步：来源口径保持空，不拿失败动作冒充「最近一步」
      expect(store.lastActionSource).toBeNull()
      expect(store.lastStep?.info).toEqual({})
    })

    it('出网口失败（未配 key / 冷却）：错误原样透传，不发 step', async () => {
      const fetchMock = installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      vi.spyOn(useLlmStore(), 'invoke').mockResolvedValue({
        ok: false,
        content: '',
        error: '未配置测试商的 API Key',
      })

      const ok = await store.autoDecide()

      expect(ok).toBe(false)
      expect(store.decisionError).toContain('未配置')
      expect(store.lastProposal).toBeNull()
      expect(countStepCalls(fetchMock)).toBe(0)
    })

    it('没有会话 / 没有观测：如实报错，不请求模型', async () => {
      installFetch()
      const store = useGymWorkbenchStore()
      const invokeSpy = stubInvokeOk('{"forceX": 1, "forceZ": 0}')

      const ok = await store.autoDecide()

      expect(ok).toBe(false)
      expect(store.decisionError).toContain('还没有选中会话')
      expect(invokeSpy).not.toHaveBeenCalled()
    })

    it('多智能体协同：每个智能体各请求一次，动作批量提交同一步', async () => {
      const fetchMock = installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({
        scene: { objects: [{}] },
        agents: [
          { uuid: 'agent-1', target: { x: 3, z: 0 } },
          { uuid: 'agent-2', target: { x: -1, z: 0 } },
        ],
      })
      const invoke = vi
        .spyOn(useLlmStore(), 'invoke')
        .mockResolvedValueOnce({ ok: true, content: '{"forceX": 5, "forceZ": 0}', error: '' })
        .mockResolvedValueOnce({ ok: true, content: '{"forceX": -4, "forceZ": 0}', error: '' })

      const ok = await store.autoDecideTeam()

      expect(ok).toBe(true)
      expect(invoke).toHaveBeenCalledTimes(2)
      expect(store.lastTeamRun?.proposals).toEqual([
        { uuid: 'agent-1', action: { forceX: 5, forceZ: 0 } },
        { uuid: 'agent-2', action: { forceX: -4, forceZ: 0 } },
      ])
      expect(store.lastTeamRun?.executed).toBe(true)
      expect(store.lastActionSource).toBe('llm')

      const batchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes('/step') &&
          init?.method === 'POST' &&
          String(init.body).includes('actions'),
      )
      expect(batchCall).toBeDefined()
      const body = JSON.parse(String(batchCall?.[1]?.body)) as {
        actions: Array<{ agentUuid: string; forceX: number; forceZ: number }>
      }
      expect(body.actions).toEqual([
        { agentUuid: 'agent-1', forceX: 5, forceZ: 0 },
        { agentUuid: 'agent-2', forceX: -4, forceZ: 0 },
      ])
    })

    it('协同里任一提议失败：整队不动，错误指明是哪个智能体', async () => {
      const fetchMock = installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({
        scene: { objects: [{}] },
        agents: [
          { uuid: 'agent-1', target: { x: 3, z: 0 } },
          { uuid: 'agent-2', target: { x: -1, z: 0 } },
        ],
      })
      vi.spyOn(useLlmStore(), 'invoke')
        .mockResolvedValueOnce({ ok: true, content: '{"forceX": 5, "forceZ": 0}', error: '' })
        .mockResolvedValueOnce({ ok: true, content: '我觉得往左推', error: '' })

      const ok = await store.autoDecideTeam()

      expect(ok).toBe(false)
      expect(store.teamDecisionError).toContain('agent-2')
      expect(store.lastTeamRun).toBeNull()
      const batchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          String(input).includes('/step') &&
          init?.method === 'POST' &&
          String(init.body).includes('actions'),
      )
      expect(batchCall).toBeUndefined()
    })

    it('单智能体会话不能走协同：如实拒绝', async () => {
      installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      const invokeSpy = stubInvokeOk('{"forceX": 1, "forceZ": 0}')

      const ok = await store.autoDecideTeam()

      expect(ok).toBe(false)
      expect(store.teamDecisionError).toContain('不是多智能体会话')
      expect(invokeSpy).not.toHaveBeenCalled()
    })
  })

  describe('buildProposalContext（上下文预览）', () => {
    it('没有会话 / 观测：返回可读原因，不请求模型', async () => {
      installFetch()
      const store = useGymWorkbenchStore()
      const invokeSpy = stubInvokeOk('{"forceX": 1, "forceZ": 0}')

      const noSession = await store.buildProposalContext()
      expect(noSession.ok).toBe(false)
      if (!noSession.ok) expect(noSession.error).toContain('还没有选中会话')

      // 有会话但没观测（模拟被清空）：也要给出可读原因
      store.currentSessionId = 'sess-1'
      store.lastObservation = null
      const noObservation = await store.buildProposalContext()
      expect(noObservation.ok).toBe(false)
      if (!noObservation.ok) expect(noObservation.error).toContain('还没有观测')

      expect(invokeSpy).not.toHaveBeenCalled()
    })

    it('有会话与观测：快照、messages、provider/model、forceLimit 完整', async () => {
      installFetch()
      knowledgeNow = [
        {
          id: 9,
          title: '力控经验',
          content: '接近目标时减小力度，避免冲过头。',
          tags: 'gym, 力控',
          importance: 0.8,
          createdAt: '2026-11-23T10:00:00',
          updatedAt: '2026-11-23T10:00:00',
          lastAccessedAt: '2026-11-23T10:00:00',
        },
      ]
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      const llmStore = useLlmStore()

      const built = await store.buildProposalContext()

      expect(built.ok).toBe(true)
      if (!built.ok) return
      const { context } = built
      expect(context.snapshot.distance).toBe(3)
      expect(context.snapshot.forceLimit).toBe(30)
      expect(context.forceLimit).toBe(30)
      expect(context.provider).toBe(llmStore.provider.name)
      expect(context.model).toBe(llmStore.model)
      expect(context.references).toEqual([
        { id: 9, title: '力控经验', content: '接近目标时减小力度，避免冲过头。' },
      ])
      expect(context.messages.map((message) => message.role)).toEqual(['system', 'user'])
      expect(context.messages[0].content).toContain('references')
      const payload = JSON.parse(context.messages[1].content) as {
        force_limit: number
        safe_force_limit: number
        references: Array<{ title: string }>
      }
      expect(payload.force_limit).toBe(30)
      expect(payload.safe_force_limit).toBeCloseTo(24, 8)
      expect(payload.references[0].title).toBe('力控经验')
    })

    it('预览只读：不调用模型，也不发 step', async () => {
      const fetchMock = installFetch()
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })
      const invokeSpy = stubInvokeOk('{"forceX": 5, "forceZ": 0}')
      const stepsBefore = countStepCalls(fetchMock)

      await store.buildProposalContext()

      expect(invokeSpy).not.toHaveBeenCalled()
      expect(countStepCalls(fetchMock)).toBe(stepsBefore)
      expect(store.lastProposal).toBeNull()
    })

    it('资料检索失败不影响预览：资料为空数组', async () => {
      installFetch()
      knowledgeFails = true
      const store = useGymWorkbenchStore()
      await store.createSession({ scene: { objects: [{}] } })

      const built = await store.buildProposalContext()

      expect(built.ok).toBe(true)
      if (!built.ok) return
      expect(built.context.references).toEqual([])
      expect(built.context.messages[0].content).not.toContain('references')
    })
  })
})
