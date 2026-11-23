// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import WorkbenchViewport from './WorkbenchViewport.vue'

/**
 * 3D 视口组件：jsdom 没有 WebGL，必须安静降级成一行说明，
 * 不能抛异常、不能影响工作台其余功能。
 */

const scene = {
  objects: [
    {
      uuid: 'a',
      type: 'cube',
      position: { x: 0, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
  ],
}

const observation = {
  agent: { uuid: 'a', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  agents: [
    {
      uuid: 'a',
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      target: { x: 3, z: 0 },
      distance: 3,
      done: false,
    },
  ],
  objects: [{ uuid: 'a', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } }],
  target: { x: 3, z: 0 },
  step: 0,
  maxSteps: 300,
  distance: 3,
}

describe('WorkbenchViewport', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('没有 WebGL 时安静降级，仍显示视口标题与统计', async () => {
    const wrapper = mount(WorkbenchViewport, {
      props: { scene, observation },
    })
    await nextTick()

    expect(wrapper.find('[aria-label="3D 视口"]').exists()).toBe(true)
    expect(wrapper.text()).toContain('3D 视口')
    expect(wrapper.text()).toContain('1 个物体 · 1 个受控智能体')
    expect(wrapper.text()).toContain('当前环境不支持 WebGL')

    wrapper.unmount()
  })

  it('没有会话时不崩，统计显示等待会话', async () => {
    const wrapper = mount(WorkbenchViewport, {
      props: { scene: null, observation: null },
    })
    await nextTick()

    expect(wrapper.text()).toContain('等待会话')

    wrapper.unmount()
  })
})
