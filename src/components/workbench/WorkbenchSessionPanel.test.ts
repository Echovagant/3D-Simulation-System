// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import WorkbenchSessionPanel from './WorkbenchSessionPanel.vue'

/**
 * 会话面板的多智能体入口：
 * 「填入双智能体示例」把场景与 agents 一起换好，创建时 agents 原样进请求体。
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
