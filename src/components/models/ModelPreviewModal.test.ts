// @vitest-environment jsdom
/**
 * 模型 3D 预览弹窗的最小回归网。
 *
 * jsdom 没有 WebGL：只桩掉 WebGLRenderer 与 OrbitControls，
 * 场景图与 Box3 仍用真实 three——这样测的是「加载 → 居中归一 → 渲染循环」
 * 这条真实链路，而不是把整个 three 都替换成假对象。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const { renderMock, disposeMock } = vi.hoisted(() => ({
  renderMock: vi.fn(),
  disposeMock: vi.fn(),
}))

vi.mock('three', async () => {
  const actual = await vi.importActual<typeof import('three')>('three')
  class WebGLRenderer {
    domElement = document.createElement('canvas')
    setPixelRatio = vi.fn()
    setClearColor = vi.fn()
    setSize = vi.fn()
    render = renderMock
    dispose = disposeMock
    forceContextLoss = vi.fn()
  }
  return { ...actual, WebGLRenderer }
})

vi.mock('three/examples/jsm/controls/OrbitControls.js', () => ({
  OrbitControls: class {
    target = { set: vi.fn() }
    enableDamping = false
    dampingFactor = 0.08
    minDistance = 0
    maxDistance = Infinity
    update = vi.fn()
    dispose = vi.fn()
  },
}))

import * as THREE from 'three'
import ModelPreviewModal from './ModelPreviewModal.vue'
import { useModelStore } from '@/stores/modelStore'

describe('ModelPreviewModal', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    renderMock.mockClear()
    disposeMock.mockClear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  const mountWith = (load: () => Promise<THREE.Object3D | null>) => {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useModelStore()
    const spy = vi.spyOn(store, 'loadModelById').mockImplementation(load)
    const wrapper = mount(ModelPreviewModal, {
      props: { model: { id: 'char-001', name: '机甲' } },
      global: { plugins: [pinia] },
    })
    return { wrapper, spy }
  }

  it('按 id 加载模型，成功后进入可交互状态并持续渲染', async () => {
    const { wrapper, spy } = mountWith(async () => {
      const group = new THREE.Group()
      group.add(
        new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()),
      )
      return group
    })

    await flushPromises()

    expect(spy).toHaveBeenCalledWith('char-001')
    expect(wrapper.text()).toContain('机甲')
    expect(wrapper.find('.preview-stage canvas').exists()).toBe(true)
    expect(wrapper.text()).toContain('拖拽旋转')
    expect(renderMock).toHaveBeenCalled()
  })

  it('加载失败显示可读错误，不静默吞掉', async () => {
    const { wrapper } = mountWith(async () => {
      throw new Error('文件不存在')
    })

    await flushPromises()

    expect(wrapper.text()).toContain('模型加载失败')
    expect(wrapper.text()).toContain('文件不存在')
  })

  it('关闭按钮 emit close；卸载时 dispose 渲染器', async () => {
    const { wrapper } = mountWith(async () => new THREE.Group())

    await flushPromises()
    await wrapper.find('.preview-close').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)

    wrapper.unmount()
    expect(disposeMock).toHaveBeenCalled()
  })
})
