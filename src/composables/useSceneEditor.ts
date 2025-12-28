import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { ref, type Ref, onUnmounted } from 'vue'
import { useSceneEditorStore } from '../stores/sceneEditorStore'
import { useModelStore } from '../stores/modelStore'
import { loadModel } from '../utils/modelLoader'
import type {
  World,
  RigidBody,
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
  createCollider: (desc: unknown, body: RigidBody) => unknown
  removeRigidBody: (body: RigidBody) => void
}

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

export function useSceneEditor(containerRef: Ref<HTMLDivElement | null> | null) {
  const store = useSceneEditorStore()
  const modelStore = useModelStore()

  // 物理引擎核心对象
  let rapier: typeof import('@dimforge/rapier3d') | null = null // 使用更具体的类型
  let physicsWorld: RapierWorld | null = null
  const rigidBodies = new Map<string, RigidBody>()
  let eventQueue: EventQueue | null = null // 添加事件队列
  let isSceneInitialized = false
  let initError: string = ''

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
      const rapierModule = await import('@dimforge/rapier3d')
      rapier = rapierModule
      console.log('Rapier 物理引擎加载成功')
      return true
    } catch (error) {
      const errMsg = `Rapier 物理引擎加载失败: ${error instanceof Error ? error.message : String(error)}`
      console.error('❌', errMsg)
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
      console.log('场景初始化完成')
      onInitSuccess.value()
      return true
    } catch (error) {
      const errMsg = `场景初始化失败: ${error instanceof Error ? error.message : String(error)}`
      console.error(errMsg)
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
    console.log('物理世界初始化成功')
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
    const groundBodyDesc = rapier.RigidBodyDesc.fixed()
    groundRigidBody = physicsWorld.createRigidBody(groundBodyDesc)

    // 创建碰撞体
    const groundColliderDesc = rapier.ColliderDesc.cuboid(5, 0.1, 5)
    physicsWorld.createCollider(groundColliderDesc, groundRigidBody)
  }

  // 绑定事件
  const bindEvents = (): void => {
    if (!renderer) return

    renderer.domElement.addEventListener('click', handleObjectClick)
    window.addEventListener('resize', handleResize)
    // 新增：监听移除刚体事件
    window.addEventListener('remove-rigidbody', handleRemoveRigidBody)
  }

  // 解绑事件
  const unbindEvents = (): void => {
    if (renderer?.domElement) {
      renderer.domElement.removeEventListener('click', handleObjectClick)
    }
    window.removeEventListener('resize', handleResize)
    // 新增：移除刚体事件监听器
    window.removeEventListener('remove-rigidbody', handleRemoveRigidBody)
  }

  // 处理移除刚体事件
  const handleRemoveRigidBody = (event: Event): void => {
    const customEvent = event as CustomEvent
    const object = customEvent.detail?.object

    if (object && physicsWorld && rapier) {
      // 从物理引擎中移除刚体
      if (object.userData?.physics?.body) {
        physicsWorld.removeRigidBody(object.userData.physics.body)
        object.userData.physics.body = null
        object.userData.physics.collider = null
      }

      // 从rigidBodies映射表中移除
      if (object.uuid) {
        rigidBodies.delete(object.uuid)
      }
    }
  }

  // 物理更新函数 - 供Viewport组件的渲染循环调用
  const updatePhysics = (): void => {
    if (
      store.simulationState.isPlaying &&
      !store.simulationState.isPaused &&
      physicsWorld &&
      isSceneInitialized &&
      eventQueue
    ) {
      // 应用模拟速度到物理世界
      if (physicsWorld.integrationParameters) {
        physicsWorld.integrationParameters.dt = (1 / 60) * store.simulationState.speed
      }
      physicsWorld.step(eventQueue)
      syncPhysicsToObjects()
    }
    controls?.update()
  }

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

  // 物体点击选中
  const handleObjectClick = (event: MouseEvent): void => {
    if (!scene || !camera || !renderer) return

    const rect = renderer.domElement.getBoundingClientRect()
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    )

    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(mouse, camera)

    const intersectableObjects = store.objects
      .filter((item) => item.visible !== false && item.threeObject)
      .map((item) => item.threeObject!)

    const intersects = raycaster.intersectObjects(intersectableObjects)

    // 重置所有物体的高亮
    store.objects.forEach((item) => {
      if (item.threeObject && item.threeObject instanceof THREE.Mesh) {
        const material = item.threeObject.material as THREE.MeshStandardMaterial
        if (material.emissive) {
          material.emissive.set(0x000000)
        }
      }
    })

    if (intersects.length > 0) {
      const selected = intersects[0].object
      if (selected instanceof THREE.Mesh) {
        store.setSelectedObject(selected.uuid)

        const material = selected.material as THREE.MeshStandardMaterial
        if (material.emissive) {
          material.emissive.set(0xffff00)
        }
      }
    } else {
      store.setSelectedObject(null)
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
      console.warn('场景/物理引擎未初始化完成，无法添加物体')
      return null
    }

    // 创建3D物体
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(Math.random() * 0xffffff),
        metalness: 0.3,
        roughness: 0.4,
      }),
    )

    mesh.name = name || `${type}-${Date.now()}`
    mesh.castShadow = true
    mesh.position.set((Math.random() - 0.5) * 5, 2, (Math.random() - 0.5) * 5)

    try {
      // 创建动态刚体
      const rigidBodyDesc = rapier.RigidBodyDesc.dynamic().setTranslation(
        mesh.position.x,
        mesh.position.y,
        mesh.position.z,
      )

      const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc)

      // 创建碰撞体
      let colliderDesc: unknown // 使用unknown类型替代any
      if (type === 'cube') {
        colliderDesc = rapier.ColliderDesc.cuboid(size, size, size)
      } else {
        colliderDesc = rapier.ColliderDesc.ball(size)
      }

      physicsWorld.createCollider(colliderDesc, rigidBody)
      rigidBodies.set(mesh.uuid, rigidBody)

      // 设置userData以便反向查找
      ;(rigidBody as RapierRigidBody).userData = { object: mesh }

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
      console.error(`创建${type}物理刚体失败:`, error)
      return null
    }
  }

  // 添加立方体
  const addCube = (): boolean => {
    const cube = createGeometry('cube', new THREE.BoxGeometry(1, 1, 1), 0.5, 'Cube')
    return cube !== null
  }

  // 修复全局代码块 - 移到适当的位置或函数内部

  // 添加球体
  const addSphere = (): boolean => {
    const sphere = createGeometry('sphere', new THREE.SphereGeometry(0.5, 32, 32), 0.5, 'Sphere')
    return sphere !== null
  }

  // 导入模型（与模型库集成）
  const importModel = async (modelId: string): Promise<boolean> => {
    if (!isSceneInitialized || !physicsWorld || !rapier || !scene) {
      console.warn('场景未初始化完成，无法导入模型')
      return false
    }

    try {
      // 从模型库获取模型信息
      const modelInfo = modelStore.models.find((m) => m.id === modelId) as Item
      if (!modelInfo) {
        console.error(`模型库中未找到ID为${modelId}的模型`)
        alert(`模型库中未找到ID为${modelId}的模型`)
        return false
      }

      // 显示加载提示
      console.log(`开始加载模型: ${modelInfo.name}`)

      // 加载模型
      const model = await loadModel(modelInfo.modelUrl)
      if (!model) {
        console.error(`模型加载失败: ${modelInfo.modelUrl}`)
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
      const rigidBody = physicsWorld.createRigidBody(rigidBodyDesc)

      // 创建碰撞体
      const colliderDesc = rapier.ColliderDesc.cuboid(halfExtents.x, halfExtents.y, halfExtents.z)
      physicsWorld.createCollider(colliderDesc, rigidBody)
      rigidBodies.set(model.uuid, rigidBody)

      // 设置userData
      ;(rigidBody as RapierRigidBody).userData = { object: model }

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

      console.log(`模型 ${modelInfo.name} 导入成功`)
      return true
    } catch (error) {
      console.error('模型导入失败:', error)
      alert(`模型导入失败: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  // 窗口大小调整
  const handleResize = (): void => {
    if (!camera || !renderer) return

    // 如果有容器引用，使用容器尺寸；否则使用默认尺寸
    let width: number = 800
    let height: number = 600

    if (containerRef && containerRef.value) {
      width = containerRef.value.clientWidth
      height = containerRef.value.clientHeight
    }

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
    if (physicsWorld && rapier) {
      // 首先清除地面刚体（如果存在）
      if (groundRigidBody) {
        physicsWorld.removeRigidBody(groundRigidBody)
        groundRigidBody = null
      }

      // 逐个清除所有刚体（Rapier推荐方式）
      rigidBodies.forEach((rigidBody) => {
        physicsWorld?.removeRigidBody(rigidBody)
      })

      // 清空映射表
      rigidBodies.clear()

      // 销毁物理世界
      physicsWorld = null
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
    onInitSuccess,
    onInitError,
    // 暴露scene、camera、renderer对象给store使用
    getScene: () => scene,
    getCamera: () => camera,
    getRenderer: () => renderer,
  }
}
