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
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { loadRapier } from '@/composables/loadRapier'
import { RENDER_POWER_PREFERENCE } from '@/config/rendering'
import { createModelLibrary } from '@/data/modelLibrary'
import {
  createRenderController,
  normalizeRenderScene,
  resolveRenderCamera,
  resolveRenderWorldSize,
  type RenderApi,
  type RenderObjectSpec,
} from './renderPage'
import {
  applyCinematicRenderer,
  applySceneAtmosphere,
  createGrid,
  SCENE_PRESENTATION,
} from '@/config/scenePresentation'

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
const buildStage = (worldSize: number): {
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  renderer: THREE.WebGLRenderer
} => {
  const scene = new THREE.Scene()
  applySceneAtmosphere(scene, worldSize)

  const camera = new THREE.PerspectiveCamera(
    SCENE_PRESENTATION.defaultFov,
    16 / 9,
    0.1,
    2000,
  )
  const distance = worldSize * 0.42
  camera.position.set(distance, distance * 0.78, distance)
  camera.lookAt(0, 1, 0)

  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: true,
    // 双显卡笔记本上不让浏览器默认挑核显（见 src/config/rendering.ts）
    powerPreference: RENDER_POWER_PREFERENCE,
  })
  renderer.setPixelRatio(1)
  // 与编辑器视口同一套色彩管线：ACES + sRGB + PCFSoft
  applyCinematicRenderer(renderer)
  renderer.shadowMap.enabled = true

  // 灯光与编辑器一致：环境只托底，半球光给方向，暖主光造型，冷补光提暗部
  scene.add(new THREE.AmbientLight(0xffffff, SCENE_PRESENTATION.ambientIntensity))
  scene.add(
    new THREE.HemisphereLight(
      SCENE_PRESENTATION.hemiSky,
      SCENE_PRESENTATION.hemiGround,
      SCENE_PRESENTATION.hemiIntensity,
    ),
  )

  const directionalLight = new THREE.DirectionalLight(
    SCENE_PRESENTATION.keyLight,
    SCENE_PRESENTATION.keyIntensity,
  )
  directionalLight.position.set(worldSize * 0.28, worldSize * 0.62, worldSize * 0.32)
  directionalLight.castShadow = true
  directionalLight.shadow.mapSize.width = 2048
  directionalLight.shadow.mapSize.height = 2048
  directionalLight.shadow.bias = -0.0004
  directionalLight.shadow.normalBias = 0.02
  const shadowHalf = worldSize / 2 + 2
  directionalLight.shadow.camera.left = -shadowHalf
  directionalLight.shadow.camera.right = shadowHalf
  directionalLight.shadow.camera.top = shadowHalf
  directionalLight.shadow.camera.bottom = -shadowHalf
  directionalLight.shadow.camera.far = worldSize * 4
  directionalLight.shadow.camera.updateProjectionMatrix()
  scene.add(directionalLight)

  const fillLight = new THREE.DirectionalLight(
    SCENE_PRESENTATION.fillLight,
    SCENE_PRESENTATION.fillIntensity,
  )
  fillLight.position.set(-worldSize * 0.4, worldSize * 0.3, -worldSize * 0.35)
  scene.add(fillLight)

  // 轮廓光：与编辑器同一套三点布光，导出画面才不会比编辑器暗一档
  const rimLight = new THREE.DirectionalLight(
    SCENE_PRESENTATION.rimLight,
    SCENE_PRESENTATION.rimIntensity,
  )
  rimLight.position.set(-worldSize * 0.15, worldSize * 0.5, -worldSize * 0.65)
  scene.add(rimLight)

  // 网格：不再画坐标轴（作品画面里不该出现调试 gizmo）
  scene.add(createGrid(worldSize))

  // 地面网格：平面在 y=0，与物理地面的碰撞体顶面齐平
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(worldSize, worldSize),
    new THREE.MeshStandardMaterial({
      color: SCENE_PRESENTATION.groundColor,
      roughness: SCENE_PRESENTATION.groundRoughness,
      metalness: 0,
    }),
  )
  ground.rotation.x = -Math.PI / 2
  ground.receiveShadow = true
  scene.add(ground)

  return { scene, camera, renderer }
}

const bootstrap = async (): Promise<void> => {
  const container = document.getElementById('render-root')
  if (!container) throw new Error('渲染页缺少 #render-root 容器')

  const sceneDocument = readInjectedScene()
  const worldSize = resolveRenderWorldSize(sceneDocument)
  const { scene, camera, renderer } = buildStage(worldSize)

  // 文档带镜头时用它：与编辑器打开该场景看到的构图一致
  const cameraSpec = resolveRenderCamera(sceneDocument)
  if (cameraSpec) {
    camera.position.set(
      cameraSpec.position.x,
      cameraSpec.position.y,
      cameraSpec.position.z,
    )
    camera.fov = cameraSpec.fov ?? SCENE_PRESENTATION.defaultFov
    camera.updateProjectionMatrix()
    camera.lookAt(cameraSpec.target.x, cameraSpec.target.y, cameraSpec.target.z)
  }

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

  // 模型：GLB 异步加载必须在 ready 之前完成（录制器等 ready 才开始逐帧驱动）。
  // 模型目录用静态数据（modelLibrary），渲染页不依赖 pinia。
  const specs = normalizeRenderScene(sceneDocument)
  const modelCatalog = createModelLibrary()
  const loader = new GLTFLoader()
  const loadedModels: {
    spec: RenderObjectSpec & { kind: 'model'; modelId: string }
    scene: THREE.Object3D
  }[] = []
  for (const spec of specs) {
    if (spec.kind !== 'model') continue
    try {
      const info = modelCatalog.find((m) => m.id === spec.modelId)
      if (!info) continue
      const gltf = await loader.loadAsync(info.modelUrl)
      loadedModels.push({
        spec: spec as RenderObjectSpec & { kind: 'model'; modelId: string },
        scene: gltf.scene,
      })
    } catch {
      // 单个模型加载失败：跳过，不让一个坏 GLB 卡死整段渲染。
      // 跳过本身是确定性行为：同一场景重跑，跳过的还是同一个。
    }
  }

  const controller = createRenderController({
    rapier,
    scene,
    camera,
    draw: () => renderer.render(scene, camera),
    sceneDocument,
    models: loadedModels,
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
