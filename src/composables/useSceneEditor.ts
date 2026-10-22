import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { ref, watch, type Ref, onUnmounted } from 'vue'
import { useSceneEditorStore } from '../stores/sceneEditorStore'
import { useModelStore } from '../stores/modelStore'
import { loadRapier } from './loadRapier'
import { simulationConfig } from '../config/simulation'
import { createFixedStepAccumulator } from '../utils/fixedStepAccumulator'
import type {
  World,
  RigidBody,
  Collider,
  EventQueue,
  RigidBodyDesc,
  IntegrationParameters,
} from '@dimforge/rapier3d'

// 类型定义 - 移除未使用的RapierColliderDesc接口

export interface RapierRigidBody extends RigidBody {
  userData?: { object: THREE.Object3D }
}

// 移除空的接口定义
// export interface RapierRigidBodyDesc extends RigidBodyDesc {}

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

// 定义完整的接口类型
interface Item {
  id: string
  name: string
  description?: string
  category: 'props' | 'characters' | 'environments'
  thumbnailUrl: string
  modelUrl: string // 添加路径属性，用于加载模型
}

export interface SceneObject {
  uuid: string
  type: 'cube' | 'sphere' | 'model' | string
  name?: string
  threeObject: THREE.Object3D
  modelId?: string
  position?: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  visible?: boolean
  physics?: {
    velocity: THREE.Vector3
    acceleration: THREE.Vector3
    mass: number
    isFalling: boolean
  }
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
const sharedGeometries: Record<'cube' | 'sphere', THREE.BufferGeometry> = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 32, 32),
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

      // 创建场景核心对象
      scene = new THREE.Scene()
      scene.background = new THREE.Color(0x222222)

      // 使用默认尺寸，后续会通过Viewport组件更新
      const defaultWidth = 800
      const defaultHeight = 600
      const aspect = defaultWidth / defaultHeight

      camera = new THREE.PerspectiveCamera(75, aspect, 0.1, 1000)
      camera.position.set(5, 5, 5)
      camera.lookAt(0, 0, 0)

      renderer = new THREE.WebGLRenderer({ antialias: true })
      renderer.setSize(defaultWidth, defaultHeight)
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
      renderer.shadowMap.enabled = true // 启用阴影
      // 不在这里添加renderer到DOM，让Viewport组件负责

      // 添加光源
      addLights()

      // 添加辅助工具
      addHelpers()

      // 初始化控制器
      initControls()

      // 初始化物理世界
      initPhysicsWorld()

      // 创建地面
      createGround()

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

  // 添加光源
  const addLights = (): void => {
    if (!scene) return

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.5)
    scene.add(ambientLight)

    const directionalLight = new THREE.DirectionalLight(0xffffff, 1)
    directionalLight.position.set(5, 10, 7.5)
    directionalLight.castShadow = true
    directionalLight.shadow.mapSize.width = 1024
    directionalLight.shadow.mapSize.height = 1024
    scene.add(directionalLight)
  }

  // 添加辅助工具
  const addHelpers = (): void => {
    if (!scene) return

    // 添加网格辅助线
    const gridHelper = new THREE.GridHelper(10, 10)
    scene.add(gridHelper)

    // 添加主要坐标系（更明显的坐标轴）
    const axesHelper = new THREE.AxesHelper(5)
    scene.add(axesHelper)

    // 添加次级坐标系（使用不同颜色和透明度的材质）
    const secondaryAxesHelper = new THREE.AxesHelper(10)
    secondaryAxesHelper.material.opacity = 0.3
    secondaryAxesHelper.material.transparent = true
    scene.add(secondaryAxesHelper)
  }

  // 初始化控制器
  const initControls = (): void => {
    if (!camera || !renderer) return

    controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
  }

  // 初始化物理世界
  const initPhysicsWorld = (): void => {
    if (!rapier) return

    // 创建物理世界，设置重力
    const gravity = new rapier.Vector3(0, -9.81, 0)
    physicsWorld = new rapier.World(gravity) as unknown as RapierWorld
    eventQueue = new rapier.EventQueue(true)
  }

  // 创建地面
  const createGround = (): void => {
    if (!scene || !rapier || !physicsWorld) return

    // 创建地面网格
    const groundGeometry = new THREE.PlaneGeometry(10, 10)
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x888888,
      roughness: 0.8,
      metalness: 0.2,
    })

    groundMesh = new THREE.Mesh(groundGeometry, groundMaterial)
    groundMesh.rotation.x = -Math.PI / 2
    groundMesh.receiveShadow = true
    scene.add(groundMesh)

    // 创建地面刚体
    //
    // ⚠️ 刚体要往下挪 0.1：上面的地面**网格**是 PlaneGeometry，平面就在 y=0；
    // 而 cuboid(5, 0.1, 5) 建在原点时顶面在 y=+0.1，物体就会停在半空中悬着 10 厘米。
    // 刚体下移 0.1 之后，碰撞体顶面与可见地面齐平（y=0）。
    const groundBodyDesc = rapier.RigidBodyDesc.fixed().setTranslation(0, -0.1, 0)
    groundRigidBody = physicsWorld.createRigidBody(groundBodyDesc)

    // 创建碰撞体
    const groundColliderDesc = rapier.ColliderDesc.cuboid(5, 0.1, 5)
    physicsWorld.createCollider(groundColliderDesc, groundRigidBody)
  }

  // 绑定事件
  const bindEvents = (): void => {
    if (!renderer) return

    window.addEventListener('resize', handleResize)
    // 新增：监听移除刚体事件
    window.addEventListener('remove-rigidbody', handleRemoveRigidBody)
    // 新增：监听属性面板的变换修改事件
    window.addEventListener('update-transform', handleUpdateTransform)
  }

  // 解绑事件
  const unbindEvents = (): void => {
    window.removeEventListener('resize', handleResize)
    // 新增：移除刚体事件监听器
    window.removeEventListener('remove-rigidbody', handleRemoveRigidBody)
    // 新增：移除变换修改事件监听器
    window.removeEventListener('update-transform', handleUpdateTransform)
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
    shape: 'box' | 'sphere',
  ): void => {
    object.userData.physics = {
      ...(object.userData.physics ?? {}),
      body: rigidBody,
      collider,
      type: 'dynamic',
      shape,
      mass: 1,
    }
  }

  // 创建几何体（抽象通用方法）
  const createGeometry = (
    type: 'cube' | 'sphere',
    geometry: THREE.BufferGeometry,
    size: number,
    name?: string,
  ): THREE.Mesh | null => {
    if (!isSceneInitialized || !physicsWorld || !rapier) {
      return null
    }

    // 材质每对象独立（高亮靠 material.emissive，共享会串色）
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(Math.random() * 0xffffff),
      metalness: 0.3,
      roughness: 0.4,
    })

    // 创建3D物体
    const mesh = new THREE.Mesh(geometry, material)

    mesh.name = name || `${type}-${Date.now()}`
    mesh.castShadow = true
    mesh.position.set((Math.random() - 0.5) * 5, 2, (Math.random() - 0.5) * 5)

    // 刚体一创建出来就登记进账本：否则中途抛错会留下「孤儿刚体」——
    // 它会永远参与碰撞，却不在任何账本里，再也无法被移除。
    let rigidBody: RigidBody | null = null

    try {
      // 创建动态刚体
      const rigidBodyDesc = rapier.RigidBodyDesc.dynamic().setTranslation(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
      )

      rigidBody = physicsWorld.createRigidBody(rigidBodyDesc)
      rigidBodies.set(mesh.uuid, rigidBody)

      // 创建碰撞体
      let colliderDesc: unknown // 使用unknown类型替代any
      if (type === 'cube') {
        colliderDesc = rapier.ColliderDesc.cuboid(size, size, size)
      } else {
        colliderDesc = rapier.ColliderDesc.ball(size)
      }

      const collider = physicsWorld.createCollider(colliderDesc, rigidBody)
      // 登记碰撞体基准尺寸：之后的缩放都以它为原点换算
      colliderShapes.set(
        mesh.uuid,
        type === 'cube'
          ? { kind: 'cuboid', halfExtents: { x: size, y: size, z: size } }
          : { kind: 'ball', radius: size },
      )

      // 设置userData以便反向查找
      ;(rigidBody as RapierRigidBody).userData = { object: mesh }
      attachRigidBodyToUserData(mesh, rigidBody, collider, type === 'cube' ? 'box' : 'sphere')

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

  // 添加立方体
  const addCube = (): boolean => {
    const cube = createGeometry('cube', sharedGeometries.cube, 0.5, 'Cube')
    return cube !== null
  }

  // 修复全局代码块 - 移到适当的位置或函数内部

  // 添加球体
  const addSphere = (): boolean => {
    const sphere = createGeometry('sphere', sharedGeometries.sphere, 0.5, 'Sphere')
    return sphere !== null
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

      // 设置模型位置
      model.position.set((Math.random() - 0.5) * 5, 2, (Math.random() - 0.5) * 5)
      model.castShadow = true

      // 创建物理刚体（简化处理，使用模型包围盒）
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
      // 登记碰撞体基准尺寸：模型缩放同样要作用到碰撞体上
      colliderShapes.set(model.uuid, {
        kind: 'cuboid',
        halfExtents: { x: halfExtents.x, y: halfExtents.y, z: halfExtents.z },
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
    renderer.setSize(width, height)
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
    importModel,
    updatePhysics,
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
