import { shallowRef, type Ref, onUnmounted } from 'vue'
import { Object3D, Vector3 } from 'three'
import * as THREE from 'three'
import type * as RapierModule from '@dimforge/rapier3d'
import { loadRapier } from './loadRapier'

type Rapier = typeof RapierModule

/**
 * Rapier 模块：**整个应用共用一份**，且是运行时才加载的。
 *
 * ⚠️ 不要再用 `@dimforge/rapier3d-compat`：它把 1.5MB 的 WASM 以 base64 内联进
 * JS，产物里会多出一个 2.2MB 的 chunk。官方包把 WASM 拆成独立资源，多个页面共享同一份。
 */
let rapier: Rapier | null = null
let rapierPromise: Promise<Rapier> | null = null

/** 取 Rapier 模块（只加载一次；失败时清空缓存，允许下次重试） */
const getRapier = (): Promise<Rapier> => {
  if (!rapierPromise) {
    rapierPromise = loadRapier()
      .then((module) => {
        rapier = module
        return module
      })
      .catch((error) => {
        rapierPromise = null
        throw error
      })
  }
  return rapierPromise
}

/** 1. 定义与Rapier实际实现匹配的刚体接口 */
interface RapierRigidBody extends RapierModule.RigidBody {
  userData?: { object: Object3D }
}

/** 带场景引用的物理世界（场景本身不是 Rapier 的概念，只是我们用来回写对象的锚点） */
type WorldWithScene = RapierModule.World & { scene?: Object3D }

/**
 * 地面配置。
 *
 * 默认是 20×20 的地面；仿真实验室之外的场景（例如 AI 演武场的 60×60 场地）
 * 可以换成自己的尺寸、材质与摩擦参数。
 */
export interface GroundOptions {
  /** 地面网格的名字（默认 `Ground`） */
  name?: string
  /** 碰撞盒半尺寸（米）。默认 `{ x: 10, y: 0.5, z: 10 }` → 20×20×1 的板 */
  halfExtents?: { x: number; y: number; z: number }
  /** 地面颜色 */
  color?: number
  /** 不透明度（1 = 不透明） */
  opacity?: number
  /** 摩擦系数 */
  friction?: number
  /** 恢复系数（弹性） */
  restitution?: number
}

/** `initPhysics` 的可选参数 */
export interface PhysicsInitOptions {
  /**
   * 地面配置。
   *
   * - 不传 → 用默认的 20×20 地面（保持既有行为）
   * - 传 `null` → **不建地面**（场景自带地面，或根本不需要地面）
   */
  ground?: GroundOptions | null
}

// 2. 定义完整的物理实例接口
interface PhysicsInstance {
  world: Ref<RapierModule.World | null>
  initPhysics: (scene?: Object3D, options?: PhysicsInitOptions) => Promise<void>
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
  /** 已加载的 Rapier 模块（没加载完时为 `null`）——需要查询形状等底层 API 时用 */
  getRapierModule: () => typeof RapierModule | null
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
  const world: Ref<RapierModule.World | null> = shallowRef(null)
  const eventQueue: Ref<RapierModule.EventQueue | null> = shallowRef(null)
  const gravity = { x: 0, y: -9.81, z: 0 }

  /**
   * 地面网格：整个物理实例只建一次。
   *
   * `initPhysics` 会被反复调用（挂载、加载预设、重置……），每次都新建地面的话
   * 场景里会叠出好几个地面——重叠的地面会 z-fighting 闪烁，而且每个地面
   * 还带一个固定刚体，白白多一份碰撞开销。
   */
  let groundMesh: THREE.Mesh | null = null

  /**
   * 地面配置。
   *
   * `undefined` = 还没配置过（走默认地面）；`null` = 明确不要地面。
   * 记在实例上而不是每次传参，是为了让 `resetPhysics` 重建时沿用同一套配置。
   */
  let groundConfig: GroundOptions | null | undefined

  // 等待 Rapier 初始化完成的函数
  const ready = async (): Promise<void> => {
    await getRapier()
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

    const oldScene = (world.value as WorldWithScene).scene
    oldScene?.traverse((object: Object3D) => {
      const physicsData = object.userData?.physics
      if (physicsData) {
        physicsData.body = null
        physicsData.collider = null
      }
    })

    // 地面是这个物理世界的一部分：世界释放了，它也要从场景里撤掉。
    // ⚠️ 不撤的话，下一次 initPhysics 会在同一个位置再放一块新地面——
    // 两块共面的地面会 z-fighting，而且它们各自带一个碰撞体，
    // 物体会被两个地面同时托着，摩擦冲量翻倍，轨迹也跟着变。
    if (groundMesh) {
      const groundPhysics = groundMesh.userData?.physics
      if (groundPhysics) {
        groundPhysics.body = null
        groundPhysics.collider = null
      }
      groundMesh.parent?.remove(groundMesh)
    }

    world.value.free()
    world.value = null
    eventQueue.value?.free()
    eventQueue.value = null
  }

  const initPhysics = async (scene?: Object3D) => {
    // 先确保 Rapier 已加载
    await getRapier()
    const engine = rapier
    if (!engine) return

    try {
      // 复用之前先把旧世界释放掉：每次都 new 一个 World 会把 WASM 内存漏光
      disposeWorld()

      world.value = new engine.World(gravity)
      eventQueue.value = new engine.EventQueue(true)

      // 为world添加scene属性
      if (scene) {
        ;(world.value as WorldWithScene).scene = scene

        // 创建地面（幂等：地面已存在就不重建网格，只把它重新绑到当前世界）
        createGroundPlane(scene)

        // 遍历场景添加所有物理物体。
        // ⚠️ 跳过地面本身——它已经被 createGroundPlane 绑过了，再绑一次会出现两个碰撞体。
        scene.traverse((object: Object3D) => {
          if (object.userData.physics && object !== groundMesh) {
            addRigidBody(object)
          }
        })

        // 预热一步。
        //
        // ⚠️ Rapier 的场景查询（projectPoint / intersectionsWithShape / contactPair）
        // 读的是宽相位的 AABB 树与窄相位的交互图，这两样东西**只在 step() 里更新**。
        // 世界刚建好、一步都还没走过的时候去查询，WASM 内部会直接 panic，
        // 而且 panic 之后整个 WASM 实例都被污染——后面每一次调用都会报同一个错。
        // 所以：世界一建好就先走一步，让它处于"可查询"状态。
        world.value.step()
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
    world.value.forEachRigidBody((body) => {
      const userData = (body as RapierRigidBody).userData
      if (userData?.object && userData.object instanceof Object3D) {
        const position = body.translation()
        const rotation = body.rotation()
        userData.object.position.set(position.x, position.y, position.z)
        userData.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w)
      }
    })
  }

  // 将updatePhysics重命名为stepPhysics以匹配调用
  const stepPhysics = updatePhysics

  const createGroundPlane = (scene: Object3D) => {
    if (!world.value) return
    // 明确不要地面：场景自带，或者这块场景根本不需要地面
    if (groundConfig === null) return

    // 地面已经建过：只把它挂回场景（scene 可能被换过）并把刚体重新绑到当前世界，
    // 绝不重建网格——重建会在场景里叠出一堆重叠的地面。
    if (groundMesh) {
      if (!scene.children.includes(groundMesh)) {
        scene.add(groundMesh)
      }
      addRigidBody(groundMesh)
      return
    }

    const half = groundConfig?.halfExtents ?? { x: 10, y: 0.5, z: 10 }
    const opacity = groundConfig?.opacity ?? 0.8

    // 创建地面网格
    const groundGeometry = new THREE.BoxGeometry(half.x * 2, half.y * 2, half.z * 2)
    const groundMaterial = new THREE.MeshStandardMaterial({
      color: groundConfig?.color ?? 0x2c3e50,
      transparent: opacity < 1,
      opacity,
    })
    const ground = new THREE.Mesh(groundGeometry, groundMaterial)
    ground.name = groundConfig?.name ?? 'Ground'
    // 顶面贴在 y = 0：场景里其他东西都以 y = 0 为地面
    ground.position.set(0, -half.y, 0)
    ground.userData.physics = {
      type: 'static',
      shape: 'box',
      halfExtents: half,
      friction: groundConfig?.friction ?? 0.5,
      restitution: groundConfig?.restitution ?? 0.3,
    }

    // 添加到场景
    scene.add(ground)
    groundMesh = ground

    // 添加物理刚体
    addRigidBody(ground)
  }

  const addRigidBody = (object: Object3D) => {
    const engine = rapier
    if (!world.value || !engine || !object.userData.physics) {
      return
    }
    // 已经建过刚体就不要再建一个：否则场景里会出现两个碰撞体，
    // 物体会被重复推挤。
    if (object.userData.physics.body) return

    const physicsData = object.userData.physics

    let shape: RapierModule.ColliderDesc
    switch (physicsData.shape || 'box') {
      case 'box':
        const boxHalfExtents = physicsData.halfExtents || {
          x: object.scale.x * 0.5,
          y: object.scale.y * 0.5,
          z: object.scale.z * 0.5,
        }
        shape = engine.ColliderDesc.cuboid(boxHalfExtents.x, boxHalfExtents.y, boxHalfExtents.z)
        break
      case 'sphere':
        const radius = physicsData.radius || object.scale.x * 0.5
        shape = engine.ColliderDesc.ball(radius)
        break
      case 'cylinder':
        const radiusCyl = physicsData.radius || object.scale.x * 0.5
        const heightCyl = physicsData.height || object.scale.y
        shape = engine.ColliderDesc.cylinder(heightCyl * 0.5, radiusCyl)
        break
      default:
        shape = engine.ColliderDesc.cuboid(0.5, 0.5, 0.5)
    }

    shape.setFriction(physicsData.friction || 0.5)
    shape.setRestitution(physicsData.restitution || 0.2)

    const isStatic = physicsData.type === 'static' || physicsData.mass === 0
    let rigidBodyDesc: RapierModule.RigidBodyDesc
    if (isStatic) {
      rigidBodyDesc = engine.RigidBodyDesc.fixed()
    } else {
      rigidBodyDesc = engine.RigidBodyDesc.dynamic()
      if (physicsData.mass) {
        const volume = calculateVolume(physicsData.shape, object.scale)
        if (volume) {
          shape.setDensity(physicsData.mass / volume)
        }
      }
    }

    // 刚体要落在网格所在的位置。
    // ⚠️ 固定体也必须设：早期版本只给动态体设了位置，固定体一律建在原点——
    // 于是场景里摆在 (12, 1, -7) 的箱子，碰撞体却堆在 (0,0,0)，
    // 看起来"挡路"的箱子其实根本没参与碰撞。
    rigidBodyDesc.setTranslation(object.position.x, object.position.y, object.position.z)
    rigidBodyDesc.setRotation({
      x: object.quaternion.x,
      y: object.quaternion.y,
      z: object.quaternion.z,
      w: object.quaternion.w,
    })

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
    const scene = (world.value as WorldWithScene).scene
    if (!scene) return

    // 清空现有世界的刚体。
    // 倒着删：删除会让 RigidBodySet 的下标前移，正着删会漏掉一半。
    const bodies = world.value.bodies
    for (let i = bodies.len() - 1; i >= 0; i--) {
      const body = bodies.get(i)
      if (body) world.value.removeRigidBody(body)
    }

    // 刚体已经随世界一起没了，网格上的引用必须清干净，
    // 否则 addRigidBody 会以为"这个对象已经有刚体了"而跳过重建。
    scene.traverse((object: Object3D) => {
      const physicsData = object.userData?.physics
      if (physicsData) {
        physicsData.body = null
        physicsData.collider = null
      }
    })

    // 重新绑定刚体（地面由 createGroundPlane 负责，不要重复加）
    createGroundPlane(scene)
    scene.traverse((object: Object3D) => {
      if (object.userData.physics && object !== groundMesh) {
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
      const scene = (world.value as WorldWithScene).scene
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
    initPhysics: async (scene?: Object3D, options?: PhysicsInitOptions) => {
      // 地面配置记在实例上：resetPhysics 重建世界时要用同一套参数
      if (options?.ground !== undefined) {
        groundConfig = options.ground
      }
      await initPhysics(scene)
    },
    updatePhysics,
    stepPhysics,
    resetPhysics,
    addRigidBody,
    removeRigidBody,
    updatePhysicsParameters,
    ready,
    getRapierModule: () => rapier,
  }
}
