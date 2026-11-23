// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import WorkbenchExecutePanel from './WorkbenchExecutePanel.vue'
import { useGymWorkbenchStore } from '@/stores/gymWorkbenchStore'
import type { GymObservation } from '@/services/api/gymWorkbench'

/**
 * 执行面板的多 Agent 协同区：
 * 多智能体观测渲染协同块与逐智能体状态，单智能体仍渲染原来的 LLM 提议块。
 */

const observation: GymObservation = {
  agent: { uuid: 'agent-1', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
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
      done: true,
    },
  ],
  objects: [],
  target: { x: 3, z: 0 },
  step: 0,
  maxSteps: 300,
  distance: 3,
}

const params = {
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

const mountPanel = () => {
  setActivePinia(createPinia())
  const store = useGymWorkbenchStore()
  store.currentSessionId = 'sess-team'
  store.currentParams = params
  return { store, wrapper: mount(WorkbenchExecutePanel) }
}

describe('WorkbenchExecutePanel 多 Agent 协同', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('多智能体观测：渲染协同块与逐智能体状态，不显示单智能体提议入口', async () => {
    const { store, wrapper } = mountPanel()
    store.lastObservation = observation
    await nextTick()

    expect(wrapper.text()).toContain('多 Agent 协同')
    expect(wrapper.text()).toContain('协同提议并执行')
    expect(wrapper.findAll('.wb-team-row')).toHaveLength(2)
    const rows = wrapper.findAll('.wb-team-row').map((row) => row.text())
    expect(rows[0]).toContain('距离 3.00 m')
    expect(rows[0]).toContain('进行中')
    expect(rows[1]).toContain('已完成')
    // 单智能体入口不该出现
    expect(wrapper.text()).not.toContain('请求提议')

    wrapper.unmount()
  })

  it('单智能体观测：仍显示原来的 LLM 提议入口', async () => {
    const { store, wrapper } = mountPanel()
    store.lastObservation = {
      ...observation,
      agents: undefined,
    }
    await nextTick()

    expect(wrapper.text()).not.toContain('多 Agent 协同')
    expect(wrapper.text()).toContain('请求提议')

    wrapper.unmount()
  })

  it('协同留档：渲染每个智能体的动作、执行状态与资料引用数', async () => {
    const { store, wrapper } = mountPanel()
    store.lastObservation = observation
    store.lastTeamRun = {
      proposals: [
        { uuid: 'agent-1', action: { forceX: 5, forceZ: 0 } },
        { uuid: 'agent-2', action: { forceX: -4, forceZ: 0.5 } },
      ],
      references: [{ id: 1, title: '力控经验' }],
      executed: true,
    }
    await nextTick()

    expect(wrapper.text()).toContain('本轮 2 个动作')
    expect(wrapper.text()).toContain('引用资料 1 条')
    expect(wrapper.text()).toContain('已同步执行')
    expect(wrapper.text()).toContain('(5.0, 0.0) N')
    expect(wrapper.text()).toContain('(-4.0, 0.5) N')

    wrapper.unmount()
  })
})
