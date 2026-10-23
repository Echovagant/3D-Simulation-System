/**
 * 渲染页的浏览器入口（vite 的第二个入口）。
 *
 * 这个页面**不挂 Vue**：它是一个被录制器驱动的哑画面。
 *
 * 三条约定：
 *
 * 1. 场景来自 `window.__RENDER_SCENE__`——录制器在打开页面前注入。
 * 2. **页面自己不跑 requestAnimationFrame**：物理只在 `window.__RENDER__.step()`
 *    被调用时推进。录制器要逐帧确定性地推进，「抓到的第 N 帧」必须严格对应
 *    「物理的第 N 步」，页面自己跑循环就做不到这件事。
 * 3. 相机、灯光、地面网格照 `src/views/SceneEditor.vue` 的摆法复刻，
 *    这样渲染出来的画面与编辑器里看到的是同一套。
 */
import * as THREE from 'three'
import { loadRapier } from '@/composables/loadRapier'
import { createRenderController, type RenderApi } from './renderPage'

/**
 * 取注入的场景。
 *
 * 录制器注入的是场景文档本身；也接受 `{ scene: {...} }` 的包装形式，
 * 免得调用方把整个请求体塞进来时页面读不到 objects。
 */
const readInjectedScene = (): unknown => {
  const injected = window.__RENDER_SCENE__
  if (!injected || typeof injected !== 'object') return null
  const wrapper = injected as { objects?: unknown; scene?: unknown }
  if (!Array.isArray(wrapper.objects) && wrapper.scene && typeof wrapper.scene === 'object') {
    return wrapper.scene
  }
  return injected
}

/** 搭相机、灯光、地面网格——与场景编辑器同一套摆法 */
const buildStage = (): {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
} => {
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x222222)

  const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000)
  camera.position.set(5, 5, 5)
  camera.lookAt(0, 0, 0)

  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.shadowMap.enabled = true

  // 灯光
  scene.add(new THREE.AmbientLight(0xffffff, 0.5))
  const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
  directionalLight.position.set(5, 10, 7.5)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 1024
  directionalLight.shadow.mapSize.height = 1024
  scene.add(directionalLight)

  // 辅助线
  scene.add(new THREE.GridHelper(10, 10))
  scene.add(new THREE.AxesHelper(5))
  const secondaryAxes = new THREE.AxesHelper(10)
  secondaryAxes.material.opacity = 0.3
  secondaryAxes.material.transparent = true
  scene.add(secondaryAxes)

  // 地面网格：平面在 y=0，与物理地面的碰撞体顶面齐平
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, metalness: 0.2 }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  return { scene, camera, renderer }
}

const bootstrap = async (): Promise<void> => {
  const container = document.getElementById('render-root')
  if (!container) throw new Error('渲染页缺少 #render-root 容器')

  const { scene, camera, renderer } = buildStage()
  container.appendChild(renderer.domElement)

  const resize = (): void => {
    const width = window.innerWidth || 1280
    const height = window.innerHeight || 720
    renderer.setSize(width, height, false)
    camera.aspect = width / height
    camera.updateProjectionMatrix()
  }
  resize()
  window.addEventListener('resize', resize)

  const rapier = await loadRapier()

  const controller = createRenderController({
    rapier,
    scene,
    camera,
    draw: () => renderer.render(scene, camera),
    sceneDocument: readInjectedScene(),
  })

  // 先把 API 挂上去（ready=false），再置为 true：
  // 录制器看到「有 API 但还没 ready」和「根本没有 API」是两回事，
  // 报错信息不能混成一句。
  const api: RenderApi = {
    ready: false,
    step: () => controller.step(),
    frames: () => controller.frames(),
    apply: (action) => controller.apply(action),
    screenshotReady: () => controller.screenshotReady(),
  }
  window.__RENDER__ = api

  // 先画一帧（**不推进物理**）：录制器拿到 ready 之后可能立刻截图，
  // 那时候画布上不能还是一片空白；而这一步不能算进物理步数，
  // 否则「抓到的第 N 帧」就对不上「物理的第 N 步」了。
  controller.paint()
  api.ready = true
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error('[render] 渲染页初始化失败：', message)
})
