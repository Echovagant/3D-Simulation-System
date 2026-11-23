import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { ref, watch, type Ref, onUnmounted } from 'vue'
import { useSceneEditorStore } from '../stores/sceneEditorStore'
import { useModelStore } from '../stores/modelStore'
import { loadRapier } from './loadRapier'
import { createWedgeGeometry, WEDGE_INDICES, WEDGE_VERTICES } from '../utils/primitiveFactory'
import type { ScenePrimitiveSpec } from '@/types'
import { simulationConfig } from '../config/simulation'
import {
  PRIMITIVE_PALETTE,
  normalizeWorldSize,
  type SceneWorldSize,
} from '../config/sceneEditor'
import { planSpawnPosition } from '../utils/spawnPlanner'
import { RENDER_POWER_PREFERENCE } from '../config/rendering'
import { createFixedStepAccumulator } from '../utils/fixedStepAccumulator'
import {
  applyCinematicRenderer,
  applySceneAtmosphere,
  createGrid,
  SCENE_PRESENTATION,
} from '../config/scenePresentation'
import { normalizeSceneCamera } from '../utils/sceneCamera'
import type {
  World,
  RigidBody,
  Collider,
  EventQueue,
  RigidBodyDesc,
  IntegrationParameters,
} from '@dimforge/rapier3d'

/**
 * 出生序号与调色板指针。
 *
 * 用黄金角螺旋而不是「拿递增序号当随机种子」：后者相邻种子产出的第一个
 * 随机数只差 0.0004，所有物体实际都落在同一个点。
 */
let spawnSeq = 0
let colorSeq = 0

/** 当前场地边长（由 store 注入，切换时重建地面与网格） */
let currentWorldSize: SceneWorldSize = normalizeWorldSize(undefined)

/**
 * 场景编辑器的组装层：three 场景、物理世界、物体账本与事件桥都在这里。
 *
 * 职责边界：sceneEditorStore 管数据与意图，**刚体与碰撞体只归本组合式所有**——
 * store 通过 window 自定义事件（update-transform / remove-rigidbody）把
 * 「属性面板改了变换」「删了物体」转进来，由这里落到 Rapier 上。
 */

// 给 Rapier 刚体反向挂上 mesh 引用：物理同步（刚体 → mesh）靠它找到要搬的对象
interface RapierRigidBody extends RigidBody {
  userData?: { object: THREE.Object3D }
}

// 使用类型别名而不是扩展接口来避免类型冲突
type RapierWorld = World & {
  gravity: { x: number; y: number; z: number }
  integrationParameters: IntegrationParameters
  step: (eventQueue: EventQueue) => void
  bodies: { len: () => number; get: (index: number) => RigidBody | null }
  createRigidBody: (desc: RigidBodyDesc) => RigidBody
  createCollider: (desc: unknown, body: RigidBody) => Collider
  removeRigidBody: (body: RigidBody) => void
}

/**
 * 碰撞体的「基准尺寸」：缩放为 1 时的尺寸。
 *
 * 缩放是绝对值（Three 的 mesh.scale 本身就是绝对缩放），所以碰撞体必须
 * 以基准尺寸为原点换算——如果在「当前尺寸」上乘，就会变成累乘
 * （0.5 → 1.5 → 4.5），与画面完全对不上。
 *
 * 基准的约定：Rapier 的 cuboid 用半长、ball 用半径；
 * 立方体 BoxGeometry(1,1,1) → 半长 0.5，球体 SphereGeometry(0.5) → 半径 0.5。
 */
type ColliderShapeSpec =
  | { kind: 'cuboid'; halfExtents: { x: number; y: number; z: number } }
  | { kind: 'ball'; radius: number }
  | { kind: 'trimesh'; vertices: Float32Array; indices: Uint32Array }

// 模型库条目在导入流程里用到的字段（modelStore.models 的元素还带缩略图等元数据，这里用不上）
interface Item {
  id: string
  name: string
  description?: string
  category: 'props' | 'characters' | 'environments'
  thumbnailUrl: string
  modelUrl: string // 添加路径属性，用于加载模型
}

/**
 * 共享几何体。
 *
 * 以前每次点击都 `new THREE.BoxGeometry(...)` / `new THREE.SphereGeometry(...)`，
 * 每点一次就多占一份显存与 GPU 资源。Three.js 共享 geometry 是标准做法
 * （缩放走 `mesh.scale`，不动顶点），因此这里提到模块级复用。
 *
 * ⚠️ 材质**不能**共享：点击高亮是通过 `material.emissive.set(0xffff00)` 实现的，
 * 共享材质会让所有同材质物体一起变黄。材质必须每对象独立。
 */
const sharedGeometries: Record<'cube' | 'sphere' | 'ramp', THREE.BufferGeometry> = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 32, 32),
  // 楔形顶点/索引来自 primitiveFactory 的同一份数据：编辑器、渲染页、物理 trimesh 三处共用
  ramp: createWedgeGeometry(),
}

export function useSceneEditor(containerRef: Ref<HTMLDivElement | null> | null) {
  const store = useSceneEditorStore()
  const modelStore = useModelStore()

  // 物理引擎核心对象
  let rapier: typeof import('@dimforge/rapier3d') | null = null // 使用更具体的类型
  let physicsWorld: RapierWorld | null = null
  const rigidBodies = new Map<string, RigidBody>()
  // 碰撞体的基准尺寸账本：与 rigidBodies 同生共死
  const colliderShapes = new Map<string, ColliderShapeSpec>()
  let eventQueue: EventQueue | null = null // 添加事件队列
  let isSceneInitialized = false
  let initError: string = ''

  /**
   * 固定步长累加器：整个场景**唯一**的物理时钟。
   *
   * 步长固定为 1/60 秒（`simulationConfig.physics.fixedTimeStep`），
   * 真实时间先累加进来，再按固定步长切成若干个物理步——
   * 因此仿真速度与显示刷新率无关：60Hz 屏每秒推进 60 步，30Hz 屏也是 60 步。
   */
  const fixedTimeStep = simulationConfig.physics.fixedTimeStep
  const maxSubSteps = simulationConfig.physics.maxSubSteps
  const accumulator = createFixedStepAccumulator(
    fixedTimeStep,
    maxSubSteps,
    simulationConfig.physics.maxFrameDelta,
  )
  // 上一帧的时间戳（毫秒）。null 表示「还没有参照点」。
  // ⚠️ 不能用 0 当哨兵：requestAnimationFrame 的第一个时间戳就可能是 0，
  // 用 0 判空会让「第一帧」被反复当成「第一帧」，物理一步都推不动。
  let lastFrameTimestamp: number | null = null

  // 核心Three.js对象
  let scene: THREE.Scene | null = null
  let camera: THREE.PerspectiveCamera | null = null
  let renderer: THREE.WebGLRenderer | null = null
  let controls: OrbitControls | null = null
  let groundMesh: THREE.Mesh | null = null
  let groundRigidBody: RigidBody | null = null
  let gridHelper: THREE.GridHelper | null = null
  let sunLight: THREE.DirectionalLight | null = null

  // 状态回调
  const onInitSuccess = ref<() => void>(() => {})
  const onInitError = ref<(err: string) => void>(() => {})

  // 异步加载物理引擎
  const loadPhysicsEngine = async (): Promise<boolean> => {
    try {
      rapier = await loadRapier()
      return true
    } catch (error) {
      const errMsg = `Rapier 物理引擎加载失败: ${error instanceof Error ? error.message : String(error)}`
      initError = errMsg
      return false
    }
  }

  // 初始化场景
  const initEditor = async (): Promise<boolean> => {
    // 重置状态
    cleanupEditor(false)
    isSceneInitialized = false
    initError = ''

    try {
      // 加载物理引擎
      const isRapierLoaded = await loadPhysicsEngine()
      if (!isRapierLoaded || !rapier) {
        throw new Error(initError || 'Rapier 未加载成功，无法初始化场景')
      }

      // 场地大小先定：相机默认机位按它算距离，否则 40×40 的场景会被
      // (5,5,5) 的老机位拍成「主体缩在画面一角」。
      currentWorldSize = normalizeWorldSize(store.worldSize)

      // 创建场景核心对象
      scene = new THREE.Scene()
      applySceneAtmosphere(scene, currentWorldSize)

      // 使用默认尺寸，后续会通过Viewport组件更新
      const defaultWidth = 800
      const defaultHeight = 600
      const aspect = defaultWidth / defaultHeight

      camera = new THREE.PerspectiveCamera(
        SCENE_PRESENTATION.defaultFov,
        aspect,
        0.1,
        1000,
      )
      resetCameraToDefault(currentWorldSize)

      renderer = new THREE.WebGLRenderer({
        antialias: true,
        // 双显卡笔记本上不让浏览器默认挑核显（见 src/config/rendering.ts）
        powerPreference: RENDER_POWER_PREFERENCE,
      })
      renderer.setSize(defaultWidth, defaultHeight, false)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      // 与「成品画面」同一套色彩管线：ACES 色调映射 + sRGB + 柔和阴影
      applyCinematicRenderer(renderer)
      renderer.shadowMap.enabled = true // 启用阴影
      // 不在这里添加renderer到DOM，让Viewport组件负责

      // 添加光源
      addLights(currentWorldSize)

      // 添加辅助工具
      addHelpers(currentWorldSize)

      // 初始化控制器
      initControls()

      // 初始化物理世界
      initPhysicsWorld()

      // 创建地面
      createGround(currentWorldSize)

      // 绑定事件
      bindEvents()

      // 初始化store
      store.initializeScene(scene, camera, renderer)

      // 标记场景初始化完成
      isSceneInitialized = true
      onInitSuccess.value()
      return true
    } catch (error) {
      const errMsg = `场景初始化失败: ${error instanceof Error ? error.message : String(error)}`
      initError = errMsg
      onInitError.value(errMsg)
      return false
    }
  }

  // 重新初始化
  const reinit = () => {
    return initEditor()
  }

  /** 阴影相机范围跟着场地走：默认 ±5 的阴影相机在 40×40 场地上只覆盖中心一小块 */
  const fitShadowCamera = (light: THREE.DirectionalLight, size: number): void => {
    const half = size / 2 + 2
    light.shadow.camera.left = -half
    light.shadow.camera.right = half
    light.shadow.camera.top = half
    light.shadow.camera.bottom = -half
    light.shadow.camera.near = 0.5
    light.shadow.camera.far = size * 4
    light.shadow.camera.updateProjectionMatrix()
  }

  /**
   * 默认机位：按场地边长退到能看见整块场地的地方。
   *
   * 旧版固定 (5,5,5) 是给 10×10 小场地配的；场地扩到 40 后主体只剩画面
   * 一角，这也是「场景看着像小学生作品」的第一层原因。
   */
  const resetCameraToDefault = (size: number): void => {
    if (!camera) return
    const distance = size * 0.42
    camera.position.set(distance, distance * 0.78, distance)
    camera.lookAt(0, 1, 0)
    if (controls) {
      controls.target.set(0, 1, 0)
      controls.update()
    }
    store.setViewTarget({ x: 0, y: 1, z: 0 })
  }

  // 添加光源
  //
  // 三点布光：暖主光负责造型与阴影，冷补光把背光面从死黑里捞回来，
  // 半球光给天空/地面一个方向差。旧版只有环境光 + 单平行光，
  // 物体背光面全黑、正面一片平，画面自然「像灰模」。
  const addLights = (size: number): void => {
    if (!scene) return

    const ambientLight = new THREE.AmbientLight(
      0xffffff,
      SCENE_PRESENTATION.ambientIntensity,
    )
    scene.add(ambientLight)

    const hemisphere = new THREE.HemisphereLight(
      SCENE_PRESENTATION.hemiSky,
      SCENE_PRESENTATION.hemiGround,
      SCENE_PRESENTATION.hemiIntensity,
    )
    scene.add(hemisphere)

    const directionalLight = new THREE.DirectionalLight(
      SCENE_PRESENTATION.keyLight,
      SCENE_PRESENTATION.keyIntensity,
    )
    directionalLight.position.set(size * 0.28, size * 0.62, size * 0.32)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 2048
    directionalLight.shadow.mapSize.height = 2048
    // 阴影偏移：斜面上的自阴影（阴影痤疮）靠这两项压掉
    directionalLight.shadow.bias = -0.0004
    directionalLight.shadow.normalBias = 0.02
    fitShadowCamera(directionalLight, size)
    scene.add(directionalLight)
    scene.add(directionalLight.target)
    sunLight = directionalLight

    // 补光不投影：它的职责是「让暗部有细节」，不是再造一套阴影
    const fillLight = new THREE.DirectionalLight(
      SCENE_PRESENTATION.fillLight,
      SCENE_PRESENTATION.fillIntensity,
    )
    fillLight.position.set(-size * 0.4, size * 0.3, -size * 0.35)
    scene.add(fillLight)

    // 轮廓光：从主体背后打冷光，把深色结构的边缘从背景里「描」出来
    const rimLight = new THREE.DirectionalLight(SCENE_PRESENTATION.rimLight, SCENE_PRESENTATION.rimIntensity)
    rimLight.position.set(-size * 0.15, size * 0.5, -size * 0.65)
    scene.add(rimLight)
  }

  // 添加辅助工具
  //
  // 只保留网格：坐标轴（AxesHelper）是调试用的，出现在作品画面里
  // 就像「没做完的工程文件」，正式场景一律不显示。
  const addHelpers = (size: number): void => {
    if (!scene) return
    gridHelper = createGrid(size)
    scene.add(gridHelper)
  }

  // 初始化控制器
  const initControls = (): void => {
    if (!camera || !renderer) return

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.minDistance = 1
    controls.maxDistance = currentWorldSize * 2.5
    // 默认机位与默认 target 必须是同一个点：OrbitControls 第一次 update()
    // 会把相机改瞄到 target，两处不一致时画面会被整体压偏。
    controls.target.set(0, 1, 0)
    controls.update()

    // 用户转完视角后把 target 记进 store：导出 / 保存场景时镜头才带得走
    controls.addEventListener('end', () => {
      if (!controls) return
      store.setViewTarget({
        x: controls.target.x,
        y: controls.target.y,
        z: controls.target.z,
      })
    })
  }

  // 初始化物理世界
  const initPhysicsWorld = (): void => {
    if (!rapier) return

    // 创建物理世界，设置重力
    const gravity = new rapier.Vector3(0, -9.81, 0)
    physicsWorld = new rapier.World(gravity) as unknown as RapierWorld
    eventQueue = new rapier.EventQueue(true)
  }

  // 创建地面（边长 = 场地边长；网格、可见地面、物理地面共用同一口径）
  const createGround = (size: number): void => {
    if (!scene || !rapier || !physicsWorld) return

    // 先把旧地面清干净：切场地时若不销账，旧碰撞体会留在物理世界里
    if (groundMesh) {
      scene.remove(groundMesh)
      groundMesh.geometry.dispose()
      ;(groundMesh.material as THREE.Material).dispose()
      groundMesh = null
    }
    if (groundRigidBody) {
      physicsWorld.removeRigidBody(groundRigidBody)
      groundRigidBody = null
    }

    // 创建地面网格
    const groundGeometry = new THREE.PlaneGeometry(size, size)
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: SCENE_PRESENTATION.groundColor,
      roughness: SCENE_PRESENTATION.groundRoughness,
      metalness: 0,
    })

    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.receiveShadow = true
    scene.add(groundMesh)

    // 创建地面刚体
    //
    // ⚠️ 刚体要往下挪 0.1：上面的地面**网格**是 PlaneGeometry，平面就在 y=0；
    // 而 cuboid(half, 0.1, half) 建在原点时顶面在 y=+0.1，物体就会停在半空中悬着 10 厘米。
    // 刚体下移 0.1 之后，碰撞体顶面与可见地面齐平（y=0）。
    const half = size / 2
    const groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0)
    groundRigidBody = physicsWorld.createRigidBody(groundBodyDesc)

    // 创建碰撞体
    const groundColliderDesc = rapier.ColliderDesc.cuboid(half, 0.1, half)
    physicsWorld.createCollider(groundColliderDesc, groundRigidBody)
  }

  /**
   * 切换场地边长：重建网格、阴影范围、可见地面与物理地面。
   *
   * ⚠️ 这个函数**不写 store**（store 是意图，这里是实现）。界面改 store，
   * 由 SceneEditor 的 watch 统一调过来，避免两边互相写导致回声。
   */
  const setWorldSize = (rawSize: number): boolean => {
    const size = normalizeWorldSize(rawSize)
    currentWorldSize = size

    if (!scene) return false

    // 背景与雾跟着场地走：40 的雾挂在 60 的场地上会把远处结构提前吃掉
    applySceneAtmosphere(scene, size)

    if (gridHelper) {
      scene.remove(gridHelper)
      gridHelper.geometry.dispose()
      ;(gridHelper.material as THREE.Material).dispose()
      gridHelper = null
    }
    // 重建网格（同时保证网格与地面同尺寸）
    gridHelper = createGrid(size)
    scene.add(gridHelper)

    if (sunLight) {
      sunLight.position.set(size * 0.28, size * 0.62, size * 0.32)
      fitShadowCamera(sunLight, size)
    }

    if (controls) controls.maxDistance = size * 2.5

    createGround(size)
    return true
  }

  /**
   * 应用场景文档里的初始镜头。
   *
   * 相机位置、fov 与轨道控制器的 target 必须一起改：只改相机不改 target，
   * 控制器下一次 update() 会把镜头拉回旧目标点，画面看起来「没生效」。
   */
  const applySceneCamera = (raw: unknown): boolean => {
    const cameraSpec = normalizeSceneCamera(raw)
    if (!cameraSpec || !camera || !controls) return false

    camera.position.set(
      cameraSpec.position.x,
      cameraSpec.position.y,
      cameraSpec.position.z,
    )
    camera.fov = cameraSpec.fov ?? SCENE_PRESENTATION.defaultFov
    camera.updateProjectionMatrix()

    controls.target.set(cameraSpec.target.x, cameraSpec.target.y, cameraSpec.target.z)
    controls.update()
    store.setViewTarget(cameraSpec.target)
    return true
  }

  const handleApplySceneCamera = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    applySceneCamera(detail)
  }

  /**
   * 聚焦场景：按所有可见物体的包围盒自动取景。
   *
   * 这是「打开场景就能看」的兜底：即使文档没带镜头，用户也不用先手动
   * 转半天找主体。空场景回到默认机位。
   *
   * ⚠️ 不能用「包围球半径 / sin(fov/2)」算距离：包围球把扁平场景
   * （长 24、高 5）当成一个球，相机要退到 45 米外，主体只剩一小块。
   * 这里逐角点投影到相机空间，分别按水平/垂直视野求所需距离，迭代收敛。
   */
  const focusScene = (): boolean => {
    if (!camera || !controls) return false

    const box = new THREE.Box3()
    let count = 0
    store.objects.forEach((item) => {
      if (!item.threeObject || item.visible === false) return
      box.expandByObject(item.threeObject)
      count += 1
    })

    if (count === 0) {
      resetCameraToDefault(currentWorldSize)
      return true
    }

    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const direction = new THREE.Vector3(1, 0.72, 1).normalize()
    const forward = direction.clone().negate()
    const worldUp = new THREE.Vector3(0, 1, 0)
    const right = new THREE.Vector3().crossVectors(forward, worldUp)
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0)
    right.normalize()
    const up = new THREE.Vector3().crossVectors(right, forward).normalize()

    const aspect = camera.aspect > 0 ? camera.aspect : 1.5
    const tanV = Math.tan(((camera.fov * Math.PI) / 180) / 2)
    const tanH = tanV * aspect

    const corners: THREE.Vector3[] = []
    for (const x of [box.min.x, box.max.x]) {
      for (const y of [box.min.y, box.max.y]) {
        for (const z of [box.min.z, box.max.z]) {
          corners.push(new THREE.Vector3(x, y, z))
        }
      }
    }

    let distance = Math.max(size.length(), 4)
    for (let attempt = 0; attempt < 5; attempt++) {
      const camPos = center.clone().addScaledVector(direction, distance)
      let maxRatio = 0
      for (const corner of corners) {
        const offset = corner.clone().sub(camPos)
        const depth = offset.dot(forward)
        if (depth <= 0.1) {
          maxRatio = Math.max(maxRatio, 2)
          continue
        }
        maxRatio = Math.max(
          maxRatio,
          Math.abs(offset.dot(right)) / depth / tanH,
          Math.abs(offset.dot(up)) / depth / tanV,
        )
      }

      if (maxRatio > 1) {
        distance *= maxRatio * 1.02
      } else if (maxRatio < 0.75) {
        // 主体只占画面一角：往近处收，但留 10% 余量
        distance *= Math.max(0.55, maxRatio / 0.9)
      } else {
        break
      }
    }

    camera.position.copy(center).addScaledVector(direction, distance)
    controls.target.copy(center)
    camera.near = Math.max(0.05, distance / 200)
    camera.far = Math.max(1000, distance * 12)
    camera.updateProjectionMatrix()
    controls.update()
    store.setViewTarget(center)
    return true
  }

  // 绑定事件
  const bindEvents = (): void => {
    if (!renderer) return

    window.addEventListener('resize', handleResize)
    // 新增：监听移除刚体事件
    window.addEventListener('remove-rigidbody', handleRemoveRigidBody)
    // 新增：监听属性面板的变换修改事件
    window.addEventListener('update-transform', handleUpdateTransform)
    // 加载带镜头的场景文档：由 store 在重建完成后派发
    window.addEventListener('apply-scene-camera', handleApplySceneCamera as EventListener)
  }

  // 解绑事件
  const unbindEvents = (): void => {
    window.removeEventListener('resize', handleResize)
    // 新增：移除刚体事件监听器
    window.removeEventListener('remove-rigidbody', handleRemoveRigidBody)
    // 新增：移除变换修改事件监听器
    window.removeEventListener('update-transform', handleUpdateTransform)
    window.removeEventListener('apply-scene-camera', handleApplySceneCamera as EventListener)
  }

  // 移除指定 uuid 对应的刚体（若存在）。返回是否真的移除了。
  // 刚体生命周期的账本在这里：谁创建谁登记，谁移除谁销账。
  const removeRigidBodyByUuid = (uuid: string): boolean => {
    if (!physicsWorld || !rapier) return false
    const rigidBody = rigidBodies.get(uuid)
    if (!rigidBody) return false

    physicsWorld.removeRigidBody(rigidBody)
    rigidBodies.delete(uuid)
    colliderShapes.delete(uuid)

    // 同步清掉 mesh 侧的引用，避免留下指向已移除刚体的悬空指针
    const target = store.objects.find((item) => item.uuid === uuid)
    const physicsData = target?.threeObject?.userData?.physics
    if (physicsData) {
      physicsData.body = null
      physicsData.collider = null
    }

    return true
  }

  // 处理移除刚体事件
  // 载荷以 uuid 为准：detail.object 只是向后兼容的附带信息，不作为判据。
  const handleRemoveRigidBody = (event: Event): void => {
    const customEvent = event as CustomEvent
    const uuid: string | undefined = customEvent.detail?.uuid
    if (!uuid) return

    removeRigidBodyByUuid(uuid)
  }

  // 找到刚体上挂着的第一个碰撞体
  const findColliderOf = (rigidBody: RigidBody): Collider | null => {
    const count = rigidBody.numColliders()
    for (let i = 0; i < count; i++) {
      const collider = rigidBody.collider(i)
      if (collider) return collider
    }
    return null
  }

  // 缩放 → 碰撞体：碰撞体形状必须跟着变，
  // 否则「看起来 3 倍宽」的箱子仍然按 1 倍碰撞，视觉与碰撞永久不一致。
  //
  // 用 setShape 原地换形状：碰撞体对象本身不变，挂在 mesh 上的引用不会失效。
  const applyScaleToCollider = (
    uuid: string,
    scale: { x: number; y: number; z: number },
  ): void => {
    if (!physicsWorld || !rapier) return
    const rigidBody = rigidBodies.get(uuid)
    const spec = colliderShapes.get(uuid)
    if (!rigidBody || !spec) return

    const collider = findColliderOf(rigidBody)
    if (!collider) return

    // 缩放取绝对值，避免负缩放把碰撞体翻转；0 视为 1（不允许把物体压成零体积）
    const sx = Math.abs(scale.x) || 1
    const sy = Math.abs(scale.y) || 1
    const sz = Math.abs(scale.z) || 1

    if (spec.kind === 'cuboid') {
      const { halfExtents } = spec
      collider.setShape(
        new rapier.Cuboid(halfExtents.x * sx, halfExtents.y * sy, halfExtents.z * sz),
      )
      return
    }

    if (spec.kind === 'trimesh') {
      // 楔形缩放：基准顶点逐轴乘缩放后重建 trimesh（Rapier 没有可缩放的 trimesh 形状）
      const scaled = new Float32Array(spec.vertices.length)
      for (let i = 0; i < spec.vertices.length; i += 3) {
        scaled[i] = spec.vertices[i] * sx
        scaled[i + 1] = spec.vertices[i + 1] * sy
        scaled[i + 2] = spec.vertices[i + 2] * sz
      }
      collider.setShape(new rapier.TriMesh(scaled, new Uint32Array(spec.indices)))
      return
    }

    // Rapier 没有椭球碰撞体：球体的非等比缩放用三轴均值近似半径
    // （等比缩放时与视觉完全一致）
    const meanScale = (sx + sy + sz) / 3
    collider.setShape(new rapier.Ball(spec.radius * meanScale))
  }

  // 把用户改过的变换写回 Rapier 刚体与碰撞体。
  //
  // 每帧的物理同步是「刚体 → mesh」的绝对覆盖：属性面板只改 mesh 的话，
  // 下一帧就被弹回原位，缩放更是压根到不了碰撞体。
  // 这里是唯一能把面板的修改写进物理世界的入口。
  const updateObjectTransform = (
    uuid: string,
    transform: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
  ): boolean => {
    if (!physicsWorld || !rapier) return false
    const rigidBody = rigidBodies.get(uuid)
    if (!rigidBody) return false

    if (transform.position) {
      const { x, y, z } = transform.position
      rigidBody.setTranslation({ x, y, z }, true)
      // 位置突变时清掉线速度，否则物体会带着旧动量飞走
      rigidBody.setLinvel({ x: 0, y: 0, z: 0 }, true)
    }

    if (transform.rotation) {
      const { x, y, z } = transform.rotation
      // Three 的旋转是欧拉角，Rapier 的旋转是四元数
      const quaternion = new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z))
      rigidBody.setRotation(
        { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
        true,
      )
      rigidBody.setAngvel({ x: 0, y: 0, z: 0 }, true)
    }

    if (transform.scale) {
      applyScaleToCollider(uuid, transform.scale)

      // 碰撞体形状跟着缩放变了，mesh 的缩放必须一起变，
      // 否则「看起来 3 倍宽」的箱子仍然按 1 倍碰撞，视觉与碰撞永久不一致。
      // （store.updateObject 也会写 mesh.scale；这里保证「物理已就绪」时两边一定一致。）
      const mesh = store.objects.find((item) => item.uuid === uuid)?.threeObject
      if (mesh) {
        mesh.scale.set(transform.scale.x, transform.scale.y, transform.scale.z)
      }
    }

    return true
  }

  /**
   * 处理属性面板的变换修改事件。
   * 这个事件只能由用户输入或「重置模拟」触发：物理同步是单向的（Rapier → mesh），绝不反过来派发。
   */
  const handleUpdateTransform = (event: Event): void => {
    const customEvent = event as CustomEvent
    const { uuid, transform } = customEvent.detail ?? {}
    if (!uuid || !transform) return

    if (!updateObjectTransform(uuid, transform)) return

    // 刚体是位置的唯一权威：变换写回后立刻把 mesh 对齐到刚体。
    // 「重置模拟」这类操作因此不需要等下一帧才看得出效果。
    syncPhysicsToObjects()
  }

  /**
   * 物理更新函数 - 供Viewport组件的渲染循环调用。
   *
   * `timestamp` 是 `requestAnimationFrame` 给的时间戳（毫秒）。
   * 有了它才能算出「这一帧过了多少真实时间」，进而按**固定步长**推进物理——
   * 步进次数由真实时间决定，与显示刷新率无关。
   */
  const updatePhysics = (timestamp?: number): void => {
    const now = timestamp ?? performance.now()

    // 第一帧没有参照点：只记时间，不推进物理
    if (lastFrameTimestamp === null) {
      lastFrameTimestamp = now
    }
    const frameDelta = (now - lastFrameTimestamp) / 1000
    lastFrameTimestamp = now

    const world = physicsWorld
    const queue = eventQueue

    if (
      store.simulationState.isPlaying &&
      !store.simulationState.isPaused &&
      world &&
      isSceneInitialized &&
      queue
    ) {
      const steps = accumulator.advance(frameDelta, store.simulationState.speed, () => {
        // 每一步都用同一个固定步长：Rapier 的 dt 不能随帧率变化，
        // 否则同一个场景在不同机器上会落到不同位置。
        world.integrationParameters.dt = fixedTimeStep
        world.step(queue)
      })

      // 仿真时钟跟着**物理步**走：currentTime 是「模拟了多久」，
      // 不是「屏幕刷了多少帧」——所以它同样与刷新率无关。
      store.simulationState.currentTime += steps * fixedTimeStep
      store.simulationState.frameCount += steps

      syncPhysicsToObjects()
    } else {
      // 没在跑物理：清掉积压，恢复时不会突然跳一大段
      accumulator.reset()
    }

    controls?.update()
  }

  // 播放/暂停切换时清掉时间基准与积压：
  // 停很久之后恢复，第一帧算出来的 delta 会是「停机时长」，
  // 不清理的话一次会补上几百个物理步，物体瞬间弹飞。
  watch(
    () => [store.simulationState.isPlaying, store.simulationState.isPaused] as const,
    () => {
      accumulator.reset()
      lastFrameTimestamp = null
    },
  )

  // 同步物理状态到3D物体
  const syncPhysicsToObjects = (): void => {
    if (!physicsWorld) return

    store.objects.forEach((item) => {
      const rigidBody = rigidBodies.get(item.uuid)
      if (rigidBody && item.threeObject) {
        // 更新位置
        const position = rigidBody.translation()
        item.threeObject.position.set(position.x, position.y, position.z)

        // 更新旋转
        const rotation = rigidBody.rotation()
        item.threeObject.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      }
    })
  }

  // 把刚体挂到 mesh 的 userData.physics 上——与 usePhysics.ts 的约定保持一致，
  // 这样「mesh → 刚体」的查找方向在场景编辑器与仿真实验室里是同一套。
  const attachRigidBodyToUserData = (
    object: THREE.Object3D,
    rigidBody: RigidBody,
    collider: Collider,
    shape: 'box' | 'sphere' | 'mesh',
    bodyType: 'dynamic' | 'static' | 'kinematic' = 'dynamic',
  ): void => {
    object.userData.physics = {
      ...(object.userData.physics ?? {}),
      body: rigidBody,
      collider,
      type: bodyType,
      shape,
      mass: 1,
    }
  }

  // 创建几何体（抽象通用方法）
  const createGeometry = (
    type: 'cube' | 'sphere' | 'ramp',
    geometry: THREE.BufferGeometry,
    size: number,
    name?: string,
    transform?: {
      position?: { x: number; y: number; z: number }
      rotation?: { x: number; y: number; z: number }
      scale?: { x: number; y: number; z: number }
    },
    options: {
      color?: number
      bodyType?: 'dynamic' | 'static' | 'kinematic'
    } = {},
  ): THREE.Mesh | null => {
    if (!isSceneInitialized || !physicsWorld || !rapier) {
      return null
    }

    const bodyType = options.bodyType ?? 'dynamic'

    // 材质每对象独立（高亮靠 material.emissive，共享会串色）
    const material = new THREE.MeshStandardMaterial({
      // 不再用纯随机色：高饱和随机色放一起会脏，精选场景也没法配色
      color: options.color ?? PRIMITIVE_PALETTE[colorSeq++ % PRIMITIVE_PALETTE.length],
      // 没有环境贴图时高金属度会把物体压成黑块：低金属 + 中粗糙度
      // 才能让主光/补光把体积读出来。
      metalness: SCENE_PRESENTATION.materialMetalness,
      roughness: SCENE_PRESENTATION.materialRoughness,
      // 楔形共享顶点会把棱角法线平均掉，逐面着色才能看出实体
      flatShading: type === 'ramp',
    })

    // 创建3D物体
    const mesh = new THREE.Mesh(geometry, material)

    mesh.name = name || `${type}-${Date.now()}`
    mesh.castShadow = true
    if (transform?.position) {
      mesh.position.set(transform.position.x, transform.position.y, transform.position.z)
    } else {
      // 黄金角螺旋出生点：与已有物体保持间距，且同一个序号永远落在同一处
      const spawn = planSpawnPosition({
        index: spawnSeq,
        worldSize: currentWorldSize,
        occupied: store.objects
          .map((item) => item.threeObject)
          .filter((object): object is THREE.Object3D => Boolean(object))
          .map((object) => ({ x: object.position.x, z: object.position.z })),
      })
      spawnSeq += 1
      mesh.position.set(spawn.x, spawn.y, spawn.z)
    }
    if (transform?.rotation) {
      mesh.rotation.set(transform.rotation.x, transform.rotation.y, transform.rotation.z)
    }
    if (transform?.scale) {
      mesh.scale.set(transform.scale.x, transform.scale.y, transform.scale.z)
    }

    // 刚体一创建出来就登记进账本：否则中途抛错会留下「孤儿刚体」——
    // 它会永远参与碰撞，却不在任何账本里，再也无法被移除。
    let rigidBody: RigidBody | null = null

    try {
      // 刚体类型：默认动态；精选场景/教学地形用 static 搭固定结构
      const bodyDesc =
        bodyType === 'static'
          ? rapier.RigidBodyDesc.fixed()
          : bodyType === 'kinematic'
            ? rapier.RigidBodyDesc.kinematicPositionBased()
            : rapier.RigidBodyDesc.dynamic()
      const rigidBodyDesc = bodyDesc.setTranslation(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
      )

      rigidBody = physicsWorld.createRigidBody(rigidBodyDesc)
      // 旋转也必须一起写进刚体：只转 mesh 的话，第一帧物理同步就会把它掰回默认朝向。
      // 默认朝向（0,0,0）不用写：测试替身不一定实现 setRotation，而真实 Rapier 里
      // 建体时的默认四元数本来就是单位四元数。
      if (mesh.rotation.x !== 0 || mesh.rotation.y !== 0 || mesh.rotation.z !== 0) {
        const quaternion = new THREE.Quaternion().setFromEuler(mesh.rotation)
        rigidBody.setRotation(
          { x: quaternion.x, y: quaternion.y, z: quaternion.z, w: quaternion.w },
          true,
        )
      }
      rigidBodies.set(mesh.uuid, rigidBody)

      // 创建碰撞体
      let colliderDesc: unknown // 使用unknown类型替代any
      if (type === 'cube') {
        colliderDesc = rapier.ColliderDesc.cuboid(size, size, size)
      } else if (type === 'ramp') {
        // 楔形用 trimesh 精确贴合斜面（cuboid 近似会让物体悬在斜面下方的空腔里）
        colliderDesc = rapier.ColliderDesc.trimesh(
          new Float32Array(WEDGE_VERTICES),
          new Uint32Array(WEDGE_INDICES),
        )
      } else {
        colliderDesc = rapier.ColliderDesc.ball(size)
      }

      const collider = physicsWorld.createCollider(colliderDesc, rigidBody)
      // 登记碰撞体基准尺寸：之后的缩放都以它为原点换算
      if (type === 'cube') {
        colliderShapes.set(mesh.uuid, {
          kind: 'cuboid',
          halfExtents: { x: size, y: size, z: size },
        })
      } else if (type === 'ramp') {
        colliderShapes.set(mesh.uuid, {
          kind: 'trimesh',
          vertices: new Float32Array(WEDGE_VERTICES),
          indices: new Uint32Array(WEDGE_INDICES),
        })
      } else {
        colliderShapes.set(mesh.uuid, { kind: 'ball', radius: size })
      }

      // 调用方给了缩放（AI 生成、场景恢复、精选场景）：碰撞体必须立刻按同一缩放重建，
      // 否则视觉放大了 3 倍、碰撞还停在基准尺寸。
      if (transform?.scale) {
        applyScaleToCollider(mesh.uuid, transform.scale)
      }

      // 设置userData以便反向查找
      ;(rigidBody as RapierRigidBody).userData = { object: mesh }
      attachRigidBodyToUserData(
        mesh,
        rigidBody,
        collider,
        type === 'cube' ? 'box' : type === 'ramp' ? 'mesh' : 'sphere',
        bodyType,
      )

      // 将物体添加到场景中
      if (scene) {
        scene.add(mesh)
      }

      // 存入store
      store.addObject({
        uuid: mesh.uuid,
        type,
        name: mesh.name,
        threeObject: mesh,
        color: material.color.getHex(),
        physicsType: bodyType,
        position: {
          x: mesh.position.x,
          y: mesh.position.y,
          z: mesh.position.z,
        },
        rotation: {
          x: mesh.rotation.x,
          y: mesh.rotation.y,
          z: mesh.rotation.z,
        },
        scale: {
          x: mesh.scale.x,
          y: mesh.scale.y,
          z: mesh.scale.z,
        },
      })

      return mesh
    } catch (error) {
      // 失败清理：几何体是共享的（dispose 会影响其它 mesh，不能动），
      // 但材质、mesh 与刚体都是本次新建的，必须释放，否则纯泄漏。
      console.error('[useSceneEditor] 创建几何体失败', error)
      scene?.remove(mesh)
      material.dispose()
      if (rigidBody) {
        physicsWorld?.removeRigidBody(rigidBody)
        rigidBodies.delete(mesh.uuid)
        colliderShapes.delete(mesh.uuid)
      }
      return null
    }
  }

  interface PrimitiveCreateOptions {
    color?: number
    bodyType?: 'dynamic' | 'static' | 'kinematic'
  }

  // 添加立方体
  const addCube = (options: PrimitiveCreateOptions = {}): boolean => {
    const cube = createGeometry(
      'cube',
      sharedGeometries.cube,
      0.5,
      'Cube',
      undefined,
      options,
    )
    return cube !== null
  }

  // 添加球体
  const addSphere = (options: PrimitiveCreateOptions = {}): boolean => {
    const sphere = createGeometry(
      'sphere',
      sharedGeometries.sphere,
      0.5,
      'Sphere',
      undefined,
      options,
    )
    return sphere !== null
  }

  // 添加斜面（楔形）：教学场景「斜面滑块/滚动」的基础地形件
  const addRamp = (options: PrimitiveCreateOptions = {}): boolean => {
    const ramp = createGeometry(
      'ramp',
      sharedGeometries.ramp,
      1,
      'Ramp',
      undefined,
      options,
    )
    return ramp !== null
  }

  // 程序化摆放基础体（LLM 场景生成、场景恢复等需要精确变换的路径）：
  // 与工具栏按钮的随机出生不同，位置/旋转/缩放/颜色完全按调用方给定
  const addPrimitive = (spec: ScenePrimitiveSpec): boolean => {
    const size = spec.type === 'ramp' ? 1 : 0.5
    const mesh = createGeometry(
      spec.type,
      sharedGeometries[spec.type],
      size,
      spec.name,
      {
        position: spec.position,
        rotation: spec.rotation,
        scale: spec.scale,
      },
      {
        color: spec.color,
        bodyType: spec.bodyType ?? 'dynamic',
      },
    )
    return mesh !== null
  }

  // 导入模型（与模型库集成）
  const importModel = async (modelId: string): Promise<boolean> => {
    if (!isSceneInitialized || !physicsWorld || !rapier || !scene) {
      return false
    }

    // 刚体一创建出来就登记进账本（与 createGeometry 同理）：
    // 否则中途抛错会留下永远无法移除的「孤儿刚体」。
    let rigidBody: RigidBody | null = null
    let model: THREE.Object3D | null = null

    try {
      // 从模型库获取模型信息
      const modelInfo = modelStore.models.find((m) => m.id === modelId) as Item
      if (!modelInfo) {
        alert(`模型库中未找到ID为${modelId}的模型`)
        return false
      }

      // 加载模型
      // 走 modelStore 的统一入口：本次会话上传的模型用的是 blob: 对象 URL，
      // 按 URL 后缀判断格式的 loadModel 认不出它，只有 loadModelById 知道怎么解析它。
      model = await modelStore.loadModelById(modelId)
      if (!model) {
        alert(`模型加载失败: ${modelInfo.name}`)
        return false
      }

      // 尺度归一：GLB 的真实尺度方差极大（实测 9 个内置模型 maxDim 0.3~8.7 单位），
      // 不归一的话 8 米级的城市/太空站会把相机整个罩住（表现为「导入成功但看不到」），
      // 小模型又几乎不可见。统一归到 maxDim = 2（与机甲这个已知可视基准一致），
      // 归一后重算包围盒——物理碰撞体与落地位置都按缩放后的来。
      const rawBox = new THREE.Box3().setFromObject(model)
      const rawSize = rawBox.getSize(new THREE.Vector3())
      const rawMaxDim = Math.max(rawSize.x, rawSize.y, rawSize.z)
      const TARGET_MAX_DIM = 2
      if (rawMaxDim > 0 && Math.abs(rawMaxDim - TARGET_MAX_DIM) > 0.01) {
        model.scale.multiplyScalar(TARGET_MAX_DIM / rawMaxDim)
        model.updateMatrixWorld(true)
      }

      // 设置模型位置（与基本体共用同一套黄金角螺旋出生点）
      const spawn = planSpawnPosition({
        index: spawnSeq++,
        worldSize: currentWorldSize,
        occupied: store.objects
          .map((item) => item.threeObject)
          .filter((object): object is THREE.Object3D => Boolean(object))
          .map((object) => ({ x: object.position.x, z: object.position.z })),
      })
      model.position.set(spawn.x, spawn.y, spawn.z)
      model.castShadow = true

      // 创建物理刚体（简化处理，使用模型包围盒）——注意在尺度归一之后取包围盒
      const box = new THREE.Box3().setFromObject(model)
      const size = box.getSize(new THREE.Vector3())
      const halfExtents = size.multiplyScalar(0.5)

      const rigidBodyDesc = rapier.RigidBodyDesc.dynamic().setTranslation(
        model.position.x,
        model.position.y,
        model.position.z,
      )
      rigidBody = physicsWorld.createRigidBody(rigidBodyDesc)
      rigidBodies.set(model.uuid, rigidBody)

      // 创建碰撞体
      const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      const collider = physicsWorld.createCollider(colliderDesc, rigidBody)
      // 登记碰撞体**基准尺寸**（缩放为 1 时的半长）：模型导入时会先做一次
      // 尺度归一，包围盒量到的是归一后的世界尺寸——要除掉当前 scale 才是基准。
      // 否则属性面板把 scale 从 0.4 改成 1 时，碰撞体会被二次缩小。
      const baseScale = {
        x: Math.abs(model.scale.x) || 1,
        y: Math.abs(model.scale.y) || 1,
        z: Math.abs(model.scale.z) || 1,
      }
      colliderShapes.set(model.uuid, {
        kind: 'cuboid',
        halfExtents: {
          x: halfExtents.x / baseScale.x,
          y: halfExtents.y / baseScale.y,
          z: halfExtents.z / baseScale.z,
        },
      })

      // 设置userData
      ;(rigidBody as RapierRigidBody).userData = { object: model }
      attachRigidBodyToUserData(model, rigidBody, collider, 'box')

      // 添加到场景和store
      scene.add(model)
      store.addObject({
        uuid: model.uuid,
        type: 'model',
        name: modelInfo.name,
        threeObject: model,
        modelId,
        position: {
          x: model.position.x,
          y: model.position.y,
          z: model.position.z,
        },
        rotation: {
          x: model.rotation.x,
          y: model.rotation.y,
          z: model.rotation.z,
        },
        scale: {
          x: model.scale.x,
          y: model.scale.y,
          z: model.scale.z,
        },
      })

      return true
    } catch (error) {
      // 失败清理：刚体已经进了物理世界，不销账的话它会永远参与碰撞却再也无法被移除；
      // 模型也要从场景里摘掉，别留下一半的残骸。
      if (rigidBody) {
        physicsWorld?.removeRigidBody(rigidBody)
        rigidBodies.delete(model?.uuid ?? '')
        colliderShapes.delete(model?.uuid ?? '')
      }
      if (model) {
        scene.remove(model)
      }
      alert(`模型导入失败: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  // 窗口大小调整
  //
  // 视口的尺寸与相机比例由 Viewport 负责（它有真实的容器尺寸，
  // 并通过 update-camera 事件把比例交回来）。拿不到真实容器时**不要**动相机：
  // 800×600 的兜底比例会把画面重新拉成 4:3。
  const handleResize = (): void => {
    if (!camera || !renderer) return

    if (!containerRef || !containerRef.value) return

    const width = containerRef.value.clientWidth
    const height = containerRef.value.clientHeight
    if (width <= 0 || height <= 0) return

    camera.aspect = width / height
    camera.updateProjectionMatrix()
    renderer.setSize(width, height, false)
    store.updateRendererSize(width, height)
  }

  // 清理资源
  const cleanupEditor = (callStoreCleanup: boolean = true) => {
    // 解绑事件
    unbindEvents()

    // 优化物理世界清理逻辑
    if (physicsWorld) {
      // 首先清除地面刚体（如果存在）
      if (groundRigidBody) {
        physicsWorld.removeRigidBody(groundRigidBody)
        groundRigidBody = null
      }

      // 逐个清除所有刚体（Rapier推荐方式）
      rigidBodies.forEach((rigidBody) => {
        try {
          physicsWorld?.removeRigidBody(rigidBody)
        } catch (error) {
          // 账本（rigidBodies）与物理世界必须一一对应：
          // 走到这里说明刚体已被移出过世界却没销账，属于账实不符，必须留痕。
          console.warn('[useSceneEditor] 清理刚体失败（该刚体可能已不在物理世界中）', error)
        }
      })

      // 清空映射表
      rigidBodies.clear()
      colliderShapes.clear()

      // 销毁物理世界
      //
      // Rapier 的 World / EventQueue 住在 WASM 堆上：把 JS 引用置空**不会**归还内存，
      // 每进出一次场景编辑器就泄漏一整份物理世界。必须显式 free()，
      // 而且要在置空引用**之前**调用——置空之后就再也拿不到它们了。
      physicsWorld.free()
      physicsWorld = null
    }

    if (eventQueue) {
      eventQueue.free()
      eventQueue = null
    }

    // 清理Three.js对象
    if (groundMesh) {
      groundMesh.geometry.dispose()
      ;(groundMesh.material as THREE.Material).dispose()
      groundMesh = null
    }
    if (gridHelper) {
      gridHelper.geometry.dispose()
      ;(gridHelper.material as THREE.Material).dispose()
      gridHelper = null
    }
    sunLight = null
    if (scene) {
      scene.clear()
      scene = null
    }
    // 注意：这里不再移除renderer.domElement，因为它可能在Viewport组件中
    renderer?.dispose()
    renderer = null
    camera = null
    controls?.dispose()
    controls = null
    groundMesh = null

    // 清理状态
    isSceneInitialized = false
    rapier = null

    // 清理store
    if (callStoreCleanup) {
      store.cleanup()
    }
  }

  // 生命周期清理
  onUnmounted(() => {
    cleanupEditor()
  })

  return {
    initEditor,
    reinit,
    cleanupEditor,
    addCube,
    addSphere,
    addRamp,
    addPrimitive,
    importModel,
    updatePhysics,
    setWorldSize,
    // 取景：聚焦当前场景 / 应用场景文档里的镜头
    focusScene,
    applySceneCamera,
    getIsSceneInitialized: () => isSceneInitialized,
    // 刚体账本：刚体生命周期的唯一所有者在这里，外部只能读、不能改
    removeRigidBodyByUuid,
    getRigidBodyCount: () => rigidBodies.size,
    hasRigidBody: (uuid: string) => rigidBodies.has(uuid),
    // 变换写回：把属性面板的修改写进刚体与碰撞体
    updateObjectTransform,
    onInitSuccess,
    onInitError,
    // 暴露scene、camera、renderer对象给store使用
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
  }
}
