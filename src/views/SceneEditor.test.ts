// @vitest-environment jsdom
/**
 * 场景编辑器的深链加载（`?sceneId=`）。
 *
 * ⚠️ 这里守的是一个真实发生过的缺陷：带 `?sceneId=` 打开时，
 * 场景在「我的场景」列表里能看见，3D 视图却是空的。
 *
 * 根因是**加载时机**：`loadScene` 靠基本体工厂把物体连同刚体一起重建，
 * 而工厂用的 `addCube` 来自 `ThreeScene` 暴露的方法——
 * 那要等场景初始化完成（`expose-methods` 事件）才拿得到。
 * 早一步调用，建体用的还是占位实现，返回 false，物体就没了。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import SceneEditor from './SceneEditor.vue'

/** 路由查询参数：每个用例改它 */
const routeQuery = ref<Record<string, string>>({})

vi.mock('vue-router', () => ({
  useRouter: () => ({ currentRoute: { value: { query: routeQuery.value } } }),
}))

/** loadScene 的调用记录：记下场景 id 与调用时刻 */
const loadSceneCalls: string[] = []
/** expose-methods 事件是否已经发过 */
let methodsExposed = false

/**
 * ThreeScene 的替身。
 *
 * ⚠️ 它必须**延迟**暴露方法，才能复现真实时序：
 * 真实组件要等 Three.js 初始化完成才发 `expose-methods`。
 */
vi.mock('@/components/three/core/ThreeScene.vue', () => ({
  default: {
    name: 'ThreeScene',
    props: ['scene', 'camera', 'renderer'],
    emits: ['expose-methods', 'init-success', 'init-error'],
    setup(_props: unknown, { emit }: { emit: (event: string, payload?: unknown) => void }) {
      // 真实初始化是异步的：暴露方法发生在 onMounted 之后的 promise 里
      void Promise.resolve().then(() => {
        methodsExposed = true
        emit('expose-methods', {
          addCube: () => true,
          addSphere: () => true,
          importModel: async () => true,
          getIsSceneInitialized: () => true,
          updatePhysics: () => {},
        })
        emit('init-success')
      })
      return {}
    },
    template: '<div />',
  },
}))

// 其余重组件在这个用例里不参与断言，替身掉省去 WebGL / DOM 依赖
vi.mock('@/components/three/panels/Toolbar.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/three/panels/PropertyPanel.vue', () => ({ default: { template: '<div />' } }))
vi.mock('@/components/three/panels/Viewport.vue', () => ({ default: { template: '<div />' } }))

describe('SceneEditor · 深链加载场景', () => {
  /** 整个用例共用一个 pinia —— 替身打桩要打在组件真正用的那个 store 上 */
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    routeQuery.value = {}
    loadSceneCalls.length = 0
    methodsExposed = false

    // loadScene 换成只记录不真加载的桩：这里盯的是「什么时候请求加载」
    vi.spyOn(useSceneEditorStore(), 'loadScene').mockImplementation(async (id: string) => {
      loadSceneCalls.push(id)
      return true
    })
  })

  it('路由带 sceneId 时会请求加载那个场景', async () => {
    routeQuery.value = { sceneId: 'demo-scene' }
    mount(SceneEditor, { global: { plugins: [pinia] } })
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(loadSceneCalls).toContain('demo-scene')
  })

  it('路由不带 sceneId 时不加载任何场景', async () => {
    mount(SceneEditor, { global: { plugins: [pinia] } })
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(loadSceneCalls).toHaveLength(0)
  })

  it('场景加载请求发生在物理方法就绪之后', async () => {
    // ⚠️ 这是防回归的那条：方法没暴露之前加载场景，
    // 建体走的是占位实现 → 场景在列表里、3D 视图却是空的。
    routeQuery.value = { sceneId: 'demo-scene' }
    const order: string[] = []
    vi.spyOn(useSceneEditorStore(), 'loadScene').mockImplementation(async (id: string) => {
      order.push(`load:${methodsExposed ? 'after' : 'before'}`)
      loadSceneCalls.push(id)
      return true
    })

    mount(SceneEditor, { global: { plugins: [pinia] } })
    await nextTick()
    await new Promise((r) => setTimeout(r, 0))

    expect(order.length).toBeGreaterThan(0)
    expect(order[0]).toBe('load:after')
  })
})
