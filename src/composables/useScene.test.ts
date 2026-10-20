// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { useThree } from './useThree'
import { useScene } from './useScene'

let wrapper: VueWrapper | null = null

const countNamed = (name: string): number => {
  const scene = useThree().scene.value
  if (!scene) return 0
  let total = 0
  scene.traverse((object) => {
    if (object.name === name) total += 1
  })
  return total
}

describe('useScene —— 布景只建一次', () => {
  beforeEach(() => {
    const three = useThree()
    three.disposeThree()
    three.initThree()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
  })

  it('重复 initScene 不会造出第二个地面或第二盏灯', () => {
    let sceneApi!: ReturnType<typeof useScene>
    wrapper = mount(
      defineComponent({
        setup() {
          sceneApi = useScene()
          return () => h('div')
        },
      }),
    )

    // 组件挂载时已经 initScene 过一次
    sceneApi.initScene()
    sceneApi.initScene()
    sceneApi.addGround()
    sceneApi.addLights()

    expect(countNamed('ai-arena-ground')).toBe(1)
    expect(countNamed('ai-arena-grid')).toBe(1)
    expect(countNamed('ai-arena-ambient-light')).toBe(1)
    expect(countNamed('ai-arena-directional-light')).toBe(1)
  })

  it('场景里有地面与网格（渲染内容不是空的）', () => {
    let sceneApi!: ReturnType<typeof useScene>
    wrapper = mount(
      defineComponent({
        setup() {
          sceneApi = useScene()
          return () => h('div')
        },
      }),
    )
    sceneApi.initScene()

    const scene = useThree().scene.value
    expect(scene).not.toBeNull()
    expect(countNamed('ai-arena-ground')).toBe(1)
    expect(countNamed('ai-arena-grid')).toBe(1)
  })
})
