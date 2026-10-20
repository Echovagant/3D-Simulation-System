// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import * as THREE from 'three'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import Viewport from './Viewport.vue'

// jsdom 未实现 ResizeObserver 时提供最小桩
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
}

type PerfWarning = { message: string; timestamp: number; details?: Record<string, unknown> }

// 视口尺寸：与下面给容器打的桩保持一致
const VIEWPORT_WIDTH = 800
const VIEWPORT_HEIGHT = 600

const mountedApps: App[] = []

/** 造一个只够渲染循环使用的假渲染器；slow=true 时模拟一帧超过 16ms 的慢渲染 */
const createFakeRenderer = (slow = false) =>
  ({
    domElement: document.createElement('canvas'),
    setSize: () => {},
    render: () => {
      if (slow) {
        const start = performance.now()
        while (performance.now() - start < 20) {
          // 忙等，模拟慢帧
        }
      }
    },
  }) as unknown as THREE.WebGLRenderer

/** 挂载 Viewport 并等 onMounted 里的 nextTick 回调跑完（其中会启动渲染循环） */
const mountViewport = async (
  options: {
    updatePhysics?: () => void
    slow?: boolean
    onWarning?: (warning: PerfWarning) => void
    scene?: THREE.Scene
    camera?: THREE.Camera
    onViewportClick?: (object: THREE.Object3D | null) => void
  } = {},
) => {
  const host = document.createElement('div')
  document.body.appendChild(host)

  const pinia = createPinia()
  setActivePinia(pinia)

  const app = createApp(Viewport, {
    scene: options.scene ?? new THREE.Scene(),
    camera: options.camera ?? new THREE.PerspectiveCamera(),
    renderer: createFakeRenderer(options.slow),
    updatePhysics: options.updatePhysics ?? (() => {}),
    onPerformanceWarning: options.onWarning,
    onViewportClick: options.onViewportClick,
  })
  app.use(pinia)
  mountedApps.push(app)
  app.mount(host)

  // 组件根节点此时已挂载，给它一个尺寸，避免 initRenderer 走重试分支
  const container = host.firstElementChild as HTMLElement | null
  if (container) {
    Object.defineProperty(container, 'clientWidth', { value: VIEWPORT_WIDTH })
    Object.defineProperty(container, 'clientHeight', { value: VIEWPORT_HEIGHT })
    // jsdom 的 getBoundingClientRect 恒为 0 尺寸，拾取要靠它把
    // clientX/clientY 换算成归一化设备坐标，这里补一个真实矩形
    container.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: VIEWPORT_WIDTH,
        bottom: VIEWPORT_HEIGHT,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect
  }

  await nextTick()
  await nextTick()
  return { host, container }
}

/**
 * 造一个可拾取的场景：
 * - 地面（不在 store 里，属于「不该被选中」的非 store 对象）
 * - 立方体（稍后登记进 store，属于可被选中的对象）
 */
const buildPickScene = () => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(
    75,
    VIEWPORT_WIDTH / VIEWPORT_HEIGHT,
    0.1,
    1000,
  )
  camera.position.set(0, 2, 6)
  camera.lookAt(0, 1, 0)
  camera.updateMatrixWorld(true)

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(20, 20),
    new THREE.MeshStandardMaterial({ color: 0x888888 }),
  )
  ground.rotation.x = -Math.PI / 2
  scene.add(ground)

  const cube = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshStandardMaterial({ color: 0x00ff00 }),
  )
  cube.position.set(0, 1, 0)
  scene.add(cube)

  scene.updateMatrixWorld(true)

  return { scene, camera, ground, cube }
}

/** 把世界坐标投影成容器内的 client 坐标（与 Viewport 的 NDC 换算互为逆运算） */
const toClientCoords = (point: THREE.Vector3, camera: THREE.Camera) => {
  const ndc = point.clone().project(camera)
  return {
    clientX: ((ndc.x + 1) / 2) * VIEWPORT_WIDTH,
    clientY: ((1 - ndc.y) / 2) * VIEWPORT_HEIGHT,
  }
}

afterEach(() => {
  while (mountedApps.length) {
    mountedApps.pop()?.unmount()
  }
  document.body.innerHTML = ''
  vi.restoreAllMocks()
})

describe('Viewport', () => {
  it('挂载时不产生注入警告', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await mountViewport()

    const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]))
    expect(messages.some((m: string) => m.includes('injection'))).toBe(false)
  })

  it('渲染时把渲染状态写回 store', async () => {
    await mountViewport()

    expect(useSceneEditorStore().renderState.isRendering).toBe(true)
  })

  it('物理更新抛错时记录到 store 而不是被吞掉', async () => {
    await mountViewport({
      updatePhysics: () => {
        throw new Error('plan006-probe')
      },
    })

    const store = useSceneEditorStore()
    const messages = store.renderState.physicsErrors.map((e) => e.message)
    expect(messages).toContain('Viewport物理更新失败')
  })

  it('渲染超时时上报性能警告到 store 并广播事件', async () => {
    const emitted: PerfWarning[] = []

    await mountViewport({ slow: true, onWarning: (w) => emitted.push(w) })

    const warnings = useSceneEditorStore().renderState.performanceWarnings
    expect(warnings.length).toBeGreaterThan(0)
    expect(warnings[0].message).toContain('渲染耗时超过阈值')
    expect(emitted.length).toBeGreaterThan(0)
    expect(emitted[0].message).toContain('渲染耗时超过阈值')
  })
})

describe('Viewport 拾取', () => {
  it('点击 store 里的立方体时把该对象作为拾取结果发出', async () => {
    const { scene, camera, cube } = buildPickScene()
    const emitted: Array<THREE.Object3D | null> = []

    const { container } = await mountViewport({
      scene,
      camera,
      onViewportClick: (object) => emitted.push(object),
    })

    const store = useSceneEditorStore()
    store.addObject({
      uuid: cube.uuid,
      name: 'Cube',
      type: 'cube',
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      threeObject: cube,
    })

    const { clientX, clientY } = toClientCoords(new THREE.Vector3(0, 1, 0), camera)
    container?.dispatchEvent(new MouseEvent('click', { clientX, clientY, bubbles: true }))

    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.uuid).toBe(cube.uuid)
  })

  it('点击地面等非 store 对象时不发出拾取结果（不会产生悬空选中）', async () => {
    const { scene, camera, cube } = buildPickScene()
    const emitted: Array<THREE.Object3D | null> = []

    const { container } = await mountViewport({
      scene,
      camera,
      onViewportClick: (object) => emitted.push(object),
    })

    const store = useSceneEditorStore()
    store.addObject({
      uuid: cube.uuid,
      name: 'Cube',
      type: 'cube',
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      threeObject: cube,
    })

    // 地面上偏离立方体的一个点：视线只会打到地面
    const { clientX, clientY } = toClientCoords(new THREE.Vector3(3, 0, 0), camera)
    container?.dispatchEvent(new MouseEvent('click', { clientX, clientY, bubbles: true }))

    expect(emitted).toHaveLength(1)
    expect(emitted[0]).toBeNull()
    expect(store.selectedObjectUuid).toBeNull()
  })

  it('容器不在视口左上角时也能正确换算坐标', async () => {
    const { scene, camera, cube } = buildPickScene()
    const emitted: Array<THREE.Object3D | null> = []

    const { container } = await mountViewport({
      scene,
      camera,
      onViewportClick: (object) => emitted.push(object),
    })

    const store = useSceneEditorStore()
    store.addObject({
      uuid: cube.uuid,
      name: 'Cube',
      type: 'cube',
      position: { x: 0, y: 1, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      threeObject: cube,
    })

    // 把容器挪到视口偏移 (120, 60) 处，clientX/clientY 必须加上这个偏移
    const offsetX = 120
    const offsetY = 60
    container!.getBoundingClientRect = () =>
      ({
        left: offsetX,
        top: offsetY,
        right: offsetX + VIEWPORT_WIDTH,
        bottom: offsetY + VIEWPORT_HEIGHT,
        width: VIEWPORT_WIDTH,
        height: VIEWPORT_HEIGHT,
        x: offsetX,
        y: offsetY,
        toJSON: () => ({}),
      }) as DOMRect

    const { clientX, clientY } = toClientCoords(new THREE.Vector3(0, 1, 0), camera)
    container?.dispatchEvent(
      new MouseEvent('click', {
        clientX: clientX + offsetX,
        clientY: clientY + offsetY,
        bubbles: true,
      }),
    )

    expect(emitted).toHaveLength(1)
    expect(emitted[0]?.uuid).toBe(cube.uuid)
  })
})
