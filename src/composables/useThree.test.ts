// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { isReactive } from 'vue'
import { useThree } from './useThree'

describe('useThree —— 模块级单例', () => {
  beforeEach(() => {
    const three = useThree()
    three.disposeThree()
    three.initThree()
  })

  it('不同调用方拿到的是同一套上下文', () => {
    const first = useThree()
    const second = useThree()

    expect(first.scene).toBe(second.scene)
    expect(first.camera).toBe(second.camera)
    expect(first.renderer).toBe(second.renderer)
  })

  it('three 对象不会被 Vue 深度代理', () => {
    const three = useThree()

    expect(isReactive(three.scene.value)).toBe(false)
    expect(isReactive(three.camera.value)).toBe(false)
  })

  it('initThree 重复调用不会把已经建好的场景清空', () => {
    const three = useThree()
    const scene = three.scene.value
    expect(scene).not.toBeNull()

    three.initThree()

    expect(three.scene.value).toBe(scene)
  })

  it('initThree 之后场景与相机都已就绪', () => {
    const three = useThree()

    expect(three.scene.value).toBeInstanceOf(Object)
    expect(three.scene.value?.background).not.toBeNull()
    expect(three.camera.value).not.toBeNull()
    expect(three.renderer.value).toBeNull()
  })
})
