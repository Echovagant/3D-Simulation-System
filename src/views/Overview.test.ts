// @vitest-environment jsdom
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import Overview from './Overview.vue'

/**
 * 总览页的标签云在 onMounted 里起了一条 requestAnimationFrame 循环，
 * 并在 document / 标签云元素上挂了鼠标与触摸监听。
 *
 * 卸载时如果不清，路由离开后 rAF 会一直排期（实测卸载后仍以 ~120 次/2s 的频率跑），
 * document 上的监听也会残留到下一个页面。这里把这两件事钉住。
 */
describe('Overview 卸载后不留尾巴', () => {
  /** 手动接管 rAF：记录待执行帧，由用例决定何时推进 */
  let pending: Map<number, FrameRequestCallback>
  let nextId: number

  beforeEach(() => {
    pending = new Map()
    nextId = 1
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
      const id = nextId++
      pending.set(id, cb)
      return id
    })
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
      pending.delete(id)
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  const mountOverview = () => {
    // Overview 用 document.querySelector('.tag-cloud') 找元素，
    // 所以必须把宿主挂进 document，否则组件里的 onMounted 会直接 return。
    const host = document.createElement('div')
    document.body.appendChild(host)
    return mount(Overview, {
      attachTo: host,
      global: {
        // Overview 直接 import 了 RouterLink，这里用桩替掉，省掉路由实例
        stubs: { RouterLink: { template: '<a><slot /></a>' } },
      },
    })
  }

  it('挂载后会启动标签云的 rAF 循环', () => {
    const wrapper = mountOverview()
    expect(pending.size).toBe(1)
    wrapper.unmount()
  })

  it('卸载会取消待执行帧，并且不再排新帧', () => {
    const wrapper = mountOverview()
    expect(pending.size).toBe(1)

    wrapper.unmount()

    // 待执行帧被取消
    expect(pending.size).toBe(0)

    // 即使有一帧已经在派发途中（这里手动补一次回调），也不能复活循环
    const stale = [...pending.values()]
    stale.forEach((cb) => cb(0))
    expect(pending.size).toBe(0)
  })

  it('卸载后 document 上的鼠标监听不再改写标签云', () => {
    const wrapper = mountOverview()
    const tagCloud = wrapper.get('.tag-cloud').element as HTMLElement

    // 先推进一帧，让标签云拿到初始 transform
    const first = [...pending.values()][0]
    first(0)
    const before = tagCloud.style.transform
    expect(before).not.toBe('')

    // 模拟拖拽：mousedown 置位，mousemove 改写 transform
    tagCloud.dispatchEvent(new MouseEvent('mousedown', { clientX: 10, clientY: 10 }))
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 40, clientY: 10 }))
    expect(tagCloud.style.transform).not.toBe(before)

    const afterDrag = tagCloud.style.transform

    wrapper.unmount()

    // 卸载后 document 上的 mousemove 监听已被摘掉，transform 不应再变
    document.dispatchEvent(new MouseEvent('mousemove', { clientX: 120, clientY: 10 }))
    expect(tagCloud.style.transform).toBe(afterDrag)
  })
})
