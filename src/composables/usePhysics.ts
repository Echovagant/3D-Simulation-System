import { shallowRef, type Ref, onUnmounted } from 'vue'
import { Object3D, Vector3 } from 'three'
import * as THREE from 'three'
import { RigidBodyDesc, ColliderDesc, RigidBody } from '@dimforge/rapier3d-compat'
import * as RAPIER from '@dimforge/rapier3d-compat'

// 初始化状态
let rapierInitialized = false
let rapierInitPromise: Promise<void> | null = null

// 初始化 Rapier（只初始化一次）
const initRapier = (): Promise<void> => {
  if (rapierInitialized) {
    return Promise.resolve()
  }

  if (!rapierInitPromise) {
    rapierInitPromise = RAPIER.init()
      .then(() => {
        rapierInitialized = true
      })
      .catch((error) => {
        rapierInitPromise = null
        throw error
      })
  }

  return rapierInitPromise
}

// 1. 定义与Rapier实际实现匹配的刚体接口
interface RapierRigidBody extends RigidBody {
  userData?: { object: Object3D }
}

// 2. 定义完整的物理实例接口
interface PhysicsInstance {
  world: Ref<RAPIER.World | null>
  initPhysics: (scene?: Object3D) => Promise<void>
  updatePhysics: (deltaTime: number) => void
  stepPhysics: (deltaTime: number) => void
  resetPhysics: () => void
  addRigidBody: (object: Object3D) => void
  removeRigidBody: (object: Object3D) => void
  updatePhysicsParameters: (params: {
    gravity?: Vector3
    friction?: number
    restitution?: number
  }) => void
  ready: () => Promise<void>
}

/**
 * 按形状与缩放计算体积（用于由质量反推密度）。
 * 纯函数，不依赖物理世界，因此可在模块级单测。
 */
export const calculateVolume = (shape: string, scale: { x: number; y: number; z: number }) => {
  switch (shape) {
    case 'box':
      return scale.x * scale.y * scale.z
    case 'sphere':
      return (4 / 3) * Math.PI * Math.pow(scale.x / 2, 3)
    case 'cylinder':
      return Math.PI * Math.pow(scale.x / 2, 2) * scale.y
    default:
      return 1
  }
}

export function usePhysics(): PhysicsInstance {
  // 3. 明确使用实际World类型的ref
  // Rapier 的 World / EventQueue 是 WASM 侧对象：一旦被 Vue 深度代理，
  // 每次跨界调用都要穿过 Proxy 拦截，既有性能损耗也可能破坏 WASM 边界语义。
  // 因此这里用 shallowRef：整体替换、不做深层响应式。
  const world: Ref<RAPIER.World | null> = shallowRef(null)
  const eventQueue: Ref<RAPIER.EventQueue | null> = shallowRef(null)
  const gravity = { x: 0, y: -9.81, z: 0 }

  /**
   * 地面网格：整个物理实例只建一次。
   *
   * `initPhysics` 会被反复调用（挂载、加载预设、重置……），每次都新建地面的话
   * 场景里会叠出好几个地面——重叠的地面会 z-fighting 闪烁，而且每个地面
   * 还带一个固定刚体，白白多一份碰撞开销。
   */
  let groundMesh: THREE.Mesh | null = null

  // 等待 Rapier 初始化完成的函数
  const ready = async (): Promise<void> => {
    await initRapier()
  }

  /**
   * 释放当前物理世界。
   *
   * Rapier 的 World / EventQueue 是 WASM 对象，不 free 就把引用丢掉等于把内存
   * 漏在 WASM 堆里。释放前先把场景对象上挂的 body / collider 引用清空——
   * 它们指向即将被释放的世界，留着会变成悬空指针。
   */
  const disposeWorld = () => {
    if (!world.value) return

    const oldScene = (world.value as RAPIER.World & { scene?: Object3D }).scene
    oldScene?.traverse((object: Object3D) => {
      const physicsData = object.userData?.physics
      if (physicsData) {
        physicsData.body = null
        physicsData.collider = null
      }
    })

    world.value.free()
    world.value = null
    eventQueue.value?.free()
    eventQueue.value = null
  }

  const initPhysics = async (scene?: Object3D) => {
    // 先确保 Rapier 已初始化
    await initRapier()

    try {
      // 复用之前先把旧世界释放掉：每次都 new 一个 World 会把 WASM 内存漏光
      disposeWorld()

      world.value = new RAPIER.World(gravity)
      eventQueue.value = new RAPIER.EventQueue(true)

      // 为world添加scene属性
      if (scene) {
        ;(world.value as RAPIER.World & { scene?: Object3D }).scene = scene

        // 创建地面（幂等：地面已存在就不重建网格，只把它重新绑到当前世界）
        createGroundPlane(scene)

        // 遍历场景添加所有物理物体
        scene.traverse((object: Object3D) => {
          if (object.userData.physics && object.name !== 'Ground') {
            addRigidBody(object)
          }
        })
      }
    } catch (error) {
      // 初始化失败：不要留下半成品世界（stepPhysics 会因为 world 为空而空转）
      disposeWorld()
      console.warn('[usePhysics] 物理世界初始化失败', error)
    }
  }

  const updatePhysics = (deltaTime: number) => {
    if (!world.value || !eventQueue.value) return

    world.value.integrationParameters.dt = deltaTime
    world.value.step(eventQueue.value)

    // 同步刚体位置到 Three.js 对象
    let syncedCount = 0
    world.value.forEachRigidBody((body) => {
      const userData = (body as RapierRigidBody).userData
      if (userData?.object && userData.object instanceof Object3D) {
        const position = body.translation()
        const rotation = body.rotation()
        userData.object.position.set(position.x, position.y, position.z)
        userData.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
        syncedCount++
      }
    })
  }

  // 将updatePhysics重命名为stepPhysics以匹配调用
  const stepPhysics = updatePhysics

  const createGroundPlane = (scene: Object3D) => {
    if (!world.value) return

    // 地面已经建过：只把它挂回场景（scene 可能被换过）并把刚体重新绑到当前世界，
    // 绝不重建网格——重建会在场景里叠出一堆重叠的地面。
    if (groundMesh) {
      if (!scene.children.includes(groundMesh)) {
        scene.add(groundMesh)
      }
      addRigidBody(groundMesh)
      return
    }

    // 创建地面网格
    const groundGeometry = new THREE.BoxGeometry(20, 1, 20)
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c3e50,
      transparent: true,
      opacity: 0.8,
    })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.name = 'Ground'
    ground.position.set(0, -0.5, 0)
    ground.userData.physics = {
      type: 'static',
      shape: 'box',
      halfExtents: { x: 10, y: 0.5, z: 10 },
      friction: 0.5,
      restitution: 0.3,
    }

    // 添加到场景
    scene.add(ground)
    groundMesh = ground

    // 添加物理刚体
    addRigidBody(ground)
  }

  const addRigidBody = (object: Object3D) => {
    if (!world.value || !object.userData.physics) {
      return
    }

    const physicsData = object.userData.physics

    let shape: ColliderDesc
    switch (physicsData.shape || 'box') {
      case 'box':
        const boxHalfExtents = physicsData.halfExtents || {
          x: object.scale.x * 0.5,
          y: object.scale.y * 0.5,
          z: object.scale.z * 0.5,
        }
        shape = ColliderDesc.cuboid(boxHalfExtents.x, boxHalfExtents.y, boxHalfExtents.z)
        break
      case 'sphere':
        const radius = physicsData.radius || object.scale.x * 0.5
        shape = ColliderDesc.ball(radius)
        break
      case 'cylinder':
        const radiusCyl = physicsData.radius || object.scale.x * 0.5
        const heightCyl = physicsData.height || object.scale.y
        shape = ColliderDesc.cylinder(heightCyl * 0.5, radiusCyl)
        break
      default:
        shape = ColliderDesc.cuboid(0.5, 0.5, 0.5)
    }

    shape.setFriction(physicsData.friction || 0.5)
    shape.setRestitution(physicsData.restitution || 0.2)

    let rigidBodyDesc: RigidBodyDesc
    if (physicsData.type === 'static' || physicsData.mass === 0) {
      rigidBodyDesc = RigidBodyDesc.fixed()
    } else {
      rigidBodyDesc = RigidBodyDesc.dynamic()
        .setTranslation(object.position.x, object.position.y, object.position.z)
        .setRotation({
          x: object.rotation.x,
          y: object.rotation.y,
          z: object.rotation.z,
          w: 1,
        })

      if (physicsData.mass) {
        const volume = calculateVolume(physicsData.shape, object.scale)
        if (volume) {
          shape.setDensity(physicsData.mass / volume)
        }
      }
    }

    const rigidBody = world.value.createRigidBody(rigidBodyDesc)
    const collider = world.value.createCollider(shape, rigidBody)

    object.userData.physics.body = rigidBody
    object.userData.physics.collider = collider
    ;(rigidBody as RapierRigidBody).userData = { object }
  }

  const removeRigidBody = (object: Object3D) => {
    if (!world.value || !object.userData.physics?.body) return
    world.value.removeRigidBody(object.userData.physics.body)
    object.userData.physics.body = null
    object.userData.physics.collider = null
  }

  const resetPhysics = () => {
    if (!world.value) return

    // 获取scene引用
    const scene = (world.value as RAPIER.World & { scene?: Object3D }).scene
    if (!scene) return

    // 清空现有世界的刚体。
    // 倒着删：删除会让 RigidBodySet 的下标前移，正着删会漏掉一半。
    const bodies = world.value.bodies
    for (let i = bodies.len() - 1; i >= 0; i--) {
      const body = bodies.get(i)
      if (body) world.value.removeRigidBody(body)
    }

    // 重新绑定刚体（地面由 createGroundPlane 负责，不要重复加）
    createGroundPlane(scene)
    scene.traverse((object: Object3D) => {
      if (object.userData.physics && object.name !== 'Ground') {
        addRigidBody(object)
      }
    })
  }

  const updatePhysicsParameters = (params: {
    gravity?: Vector3
    friction?: number
    restitution?: number
  }) => {
    if (!world.value) return

    // 更新重力
    if (params.gravity) {
      world.value.gravity = params.gravity
    }

    // 优化：直接更新现有刚体的摩擦力和恢复系数，而不是重置整个物理世界
    if (params.friction !== undefined || params.restitution !== undefined) {
      const scene = (world.value as RAPIER.World & { scene?: Object3D }).scene
      if (scene) {
        scene.traverse((object: Object3D) => {
          if (object.userData.physics?.collider) {
            const collider = object.userData.physics.collider

            // 直接更新碰撞器的摩擦力
            if (params.friction !== undefined) {
              collider.setFriction(params.friction)
              object.userData.physics.friction = params.friction
            }

            // 直接更新碰撞器的恢复系数
            if (params.restitution !== undefined) {
              collider.setRestitution(params.restitution)
              object.userData.physics.restitution = params.restitution
            }
          }
        })
      }
    }
  }

  onUnmounted(() => {
    // 组件卸载：释放整个物理世界。
    // 只把 world.value 置空等于把 WASM 内存漏在堆里——刚体、碰撞体都还在里面。
    disposeWorld()
  })

  return {
    world,
    initPhysics,
    updatePhysics,
    stepPhysics,
    resetPhysics,
    addRigidBody,
    removeRigidBody,
    updatePhysicsParameters,
    ready,
  }
}
