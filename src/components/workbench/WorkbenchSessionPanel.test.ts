// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkbenchSessionPanel from './WorkbenchSessionPanel.vue'

/**
 * 会话面板的两个入口：
 * - 「填入双智能体示例」把场景与 agents 一起换好，创建时 agents 原样进请求体；
 * - 从实时演练交接过来时预填场景/目标/步数/agents，但不自动创建会话。
 */

/** 路由只用到 query.from；用可变对象让每个用例自己决定来源 */
const routeMock = vi.hoisted(() => ({
  query: {} as Record<string, string>,
  params: {} as Record<string, string>,
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
}))

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

const createdBody = {
  sessionId: 'sess-team',
  observation: {
    agent: { uuid: 'agent-1', position: { x: -1, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
    agents: [
      {
        uuid: 'agent-1',
        position: { x: -1, y: 1, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        target: { x: 4, z: 0 },
        distance: 5,
        done: false,
      },
      {
        uuid: 'agent-2',
        position: { x: 1, y: 1, z: 0 },
        velocity: { x: 0, y: 0, z: 0 },
        target: { x: -4, z: 0 },
        distance: 5,
        done: false,
      },
    ],
    objects: [],
    target: { x: 4, z: 0 },
    step: 0,
    maxSteps: 300,
    distance: 5,
  },
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
  forceLimits: { 'agent-1': 30, 'agent-2': 30 },
}

const installFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/gym/sessions' && init?.method === 'POST') {
      return jsonResponse(createdBody, 201)
    }
    if (path === '/api/gym/sessions') return jsonResponse([])
    return jsonResponse({ error: { code: 'http_error', message: path, detail: null } }, 500)
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const findButton = (wrapper: ReturnType<typeof mount>, label: string) =>
  wrapper.findAll('button').find((button) => button.text().includes(label))

describe('WorkbenchSessionPanel 多智能体入口', () => {
  beforeEach(() => {
    sessionStorage.clear()
    routeMock.query = {}
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('填入双智能体示例：场景与 agents 一起填好', async () => {
    installFetch()
    setActivePinia(createPinia())
    const wrapper = mount(WorkbenchSessionPanel)

    await findButton(wrapper, '填入双智能体示例')!.trigger('click')

    const scene = (wrapper.find('#wb-scene-json').element as HTMLTextAreaElement).value
    const agents = (wrapper.find('#wb-agents-json').element as HTMLTextAreaElement).value
    expect(scene).toContain('agent-1')
    expect(scene).toContain('agent-2')
    expect(JSON.parse(agents)).toEqual([
      { uuid: 'agent-1', target: { x: 4, z: 0 } },
      { uuid: 'agent-2', target: { x: -4, z: 0 } },
    ])

    wrapper.unmount()
  })

  it('创建会话：agents 数组进请求体，场景里有两条动态物体', async () => {
    const fetchMock = installFetch()
    setActivePinia(createPinia())
    const wrapper = mount(WorkbenchSessionPanel)

    await findButton(wrapper, '填入双智能体示例')!.trigger('click')
    await findButton(wrapper, '创建会话')!.trigger('click')
    await flushPromises()

    const createCall = fetchMock.mock.calls.find(
      ([, init]) => init?.method === 'POST',
    )
    expect(createCall).toBeDefined()
    const body = JSON.parse(String(createCall?.[1]?.body)) as {
      scene: { objects: unknown[] }
      agents: Array<{ uuid: string; target: { x: number; z: number } }>
    }
    expect(body.scene.objects).toHaveLength(2)
    expect(body.agents).toHaveLength(2)
    expect(body.agents[0]).toEqual({ uuid: 'agent-1', target: { x: 4, z: 0 } })

    wrapper.unmount()
  })

  it('agents JSON 不合法：行内报错，不发创建请求', async () => {
    const fetchMock = installFetch()
    setActivePinia(createPinia())
    const wrapper = mount(WorkbenchSessionPanel)

    await wrapper.find('#wb-agents-json').setValue('[{"uuid": 1}]')
    await findButton(wrapper, '创建会话')!.trigger('click')
    await flushPromises()

    expect(wrapper.text()).toContain('agents 每一项都要有 uuid 与 target')
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    wrapper.unmount()
  })
})

// ───────────────────────── 实时演练交接 ─────────────────────────

const HANDOFF_KEY = 'ai-lab-handoff'

const staticObstacle = (index: number) => ({
  uuid: `arena-obstacle-${index}`,
  type: 'cube',
  name: `障碍物 ${index + 1}`,
  position: { x: index * 2 - 2, y: 0.7, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1.4, y: 1.4, z: 1.4 },
  visible: true,
  physics: { type: 'static', shape: 'box', mass: 1 },
})

const agentObject = {
  uuid: 'arena-agent-a1',
  type: 'cube',
  name: '导航机器人',
  position: { x: 5, y: 0.4, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 0.8, y: 0.8, z: 0.8 },
  visible: true,
  physics: { type: 'dynamic', shape: 'box', mass: 2 },
}

/** 与 useAI.exportArenaHandoff 同形的交接数据；withAgent=false 用于验证「无动态物体」警告 */
const createHandoffPayload = (withAgent = true) => ({
  scene: {
    id: 'ai-arena-handoff',
    name: 'AI 实验室 · 实时演练场地',
    createdAt: '2026-11-23T10:00:00.000Z',
    updatedAt: '2026-11-23T10:00:00.000Z',
    version: 1,
    objects: [staticObstacle(0), staticObstacle(1), ...(withAgent ? [agentObject] : [])],
  },
  target: { x: 4, z: -2 },
  maxSteps: 120,
  agents: withAgent ? [{ uuid: 'arena-agent-a1', target: { x: 4, z: -2 } }] : [],
  label: '实时演练 · 当前场地',
  source: 'ai-playground',
  at: 1_700_000_000_000,
})

const readValue = (wrapper: ReturnType<typeof mount>, selector: string): string =>
  (wrapper.find(selector).element as HTMLInputElement | HTMLTextAreaElement).value

describe('WorkbenchSessionPanel 实时演练交接', () => {
  beforeEach(() => {
    sessionStorage.clear()
    routeMock.query = {}
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('预填场景/目标/步数/agents，显示横幅并清除 key，不自动创建会话', async () => {
    const fetchMock = installFetch()
    setActivePinia(createPinia())
    routeMock.query = { from: 'playground' }
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(createHandoffPayload()))

    const wrapper = mount(WorkbenchSessionPanel)
    await flushPromises()

    const scene = JSON.parse(readValue(wrapper, '#wb-scene-json')) as { objects: unknown[] }
    expect(scene.objects).toHaveLength(3)
    expect(readValue(wrapper, '#wb-target-x')).toBe('4')
    expect(readValue(wrapper, '#wb-target-z')).toBe('-2')
    expect(readValue(wrapper, '#wb-max-steps')).toBe('120')
    expect(JSON.parse(readValue(wrapper, '#wb-agents-json'))).toEqual([
      { uuid: 'arena-agent-a1', target: { x: 4, z: -2 } },
    ])

    expect(wrapper.text()).toContain('已从实时演练载入：2 个障碍 + 1 个智能体')
    expect(wrapper.text()).toContain('检查参数后点创建会话')
    expect(sessionStorage.getItem(HANDOFF_KEY)).toBeNull()
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

    wrapper.unmount()
  })

  it('场景里没有动态物体：仍预填并给出警告', async () => {
    installFetch()
    setActivePinia(createPinia())
    routeMock.query = { from: 'playground' }
    sessionStorage.setItem(HANDOFF_KEY, JSON.stringify(createHandoffPayload(false)))

    const wrapper = mount(WorkbenchSessionPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('已从实时演练载入：2 个障碍 + 0 个智能体')
    expect(wrapper.text()).toContain('场景里没有动态物体')
    expect(readValue(wrapper, '#wb-agents-json')).toBe('')

    wrapper.unmount()
  })

  it('带 from=playground 但没有交接数据：给出重送指引', async () => {
    installFetch()
    setActivePinia(createPinia())
    routeMock.query = { from: 'playground' }

    const wrapper = mount(WorkbenchSessionPanel)
    await flushPromises()

    expect(wrapper.text()).toContain('没有找到可用的实时演练交接数据')
    expect(wrapper.text()).not.toContain('已从实时演练载入')

    wrapper.unmount()
  })
})
