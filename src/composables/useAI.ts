// src/composables/useAI.ts
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import type * as RapierModule from '@dimforge/rapier3d'
import { useAiStore, type AiAgent } from '@/stores/aiStore'
import { useThree } from './useThree'
import { usePhysics } from './usePhysics'
import { createFixedStepAccumulator } from '@/utils/fixedStepAccumulator'
import { simulationConfig } from '@/config/simulation'
import type { AiDecision, AiAgentState } from '@/types'

/** 场地半边长（米）——智能体被限制在这个范围内（由四面墙挡住） */
const ARENA_HALF_SIZE = 24
/** 场地地面半边长（米）——与视觉地面同尺寸，60×60 */
const ARENA_GROUND_HALF = 30
/** 智能体边长（米） */
const AGENT_SIZE = 0.8
/** 智能体网格的半高（米），也就是它站在地面上的高度 */
const AGENT_HEIGHT = 0.4
/** 智能体质量（千克） */
const AGENT_MASS = 2
/** 智能体摩擦系数 */
const AGENT_FRICTION = 0.35
/** 智能体恢复系数（弹性） */
const AGENT_RESTITUTION = 0.15
/** 障碍物摩擦系数 */
const OBSTACLE_FRICTION = 0.6
/** 障碍物恢复系数（弹性） */
const OBSTACLE_RESTITUTION = 0.25
/** 地面摩擦系数 */
const GROUND_FRICTION = 0.8
/** 地面恢复系数（弹性） */
const GROUND_RESTITUTION = 0.05
/** 转向加速度上限（米/秒²）——决定智能体追上期望速度的快慢 */
const MAX_ACCELERATION = 30
/** 围墙高度（米） */
const WALL_HEIGHT = 1.2
/** 围墙厚度（米） */
const WALL_THICKNESS = 0.5
/** 决策周期（毫秒） */
const DECISION_INTERVAL_MS = 100
/** 避障判定半径（米） */
const AVOID_DISTANCE = 3.5
/** 避障转向角（弧度） */
const AVOID_ANGLE = Math.PI / 3
/** 障碍物数量上限 */
const MAX_OBSTACLES = 12
/** 视野里没有障碍物时的距离读数 */
const NO_OBSTACLE_DISTANCE = 999
/** 障碍物布局的随机种子——同一密度下场地布局稳定可复现 */
const ARENA_SEED = 20260101

/** 智能体配色（按类型区分） */
const AGENT_COLORS: Record<string, number> = {
  basic: 0xffd700,
  advanced: 0x38bdf8,
  custom: 0xa78bfa,
}

/** 单个智能体的运行时状态 */
interface AgentRuntime {
  /** 当前朝向（弧度，0 指向 +Z） */
  heading: number
  /** 当前目标点 */
  goal: THREE.Vector3
  /** 期望速度（由最近一次决策写入） */
  desiredVelocity: THREE.Vector3
  /** 上一帧实际速度（来自刚体的 linvel） */
  velocity: THREE.Vector3
  /** 目标点序号 */
  goalIndex: number
  /** 最近一次感知时是否真的撞上了障碍物（来自物理引擎的接触流形） */
  blocked: boolean
  /** 智能体在物理世界里的刚体 */
  body: RapierModule.RigidBody | null
  /** 智能体在物理世界里的碰撞体 */
  collider: RapierModule.Collider | null
}

/** 场地里的一个障碍物 */
interface ArenaObstacle {
  mesh: THREE.Object3D
  /** 障碍物在物理世界里的碰撞体 */
  collider: RapierModule.Collider | null
}

/** 一次感知的结果 */
interface ObstacleSense {
  /** 感知范围内的障碍物数量 */
  count: number
  /** 最近障碍物的距离 */
  distance: number
  /** 最近障碍物上的落点（用来判断该往哪边躲） */
  nearestPoint: THREE.Vector3 | null
}

/**
 * agentId → 场景中的智能体网格。
 *
 * ⚠️ 这个映射**刻意不放进 aiStore**：aiStore 的状态结构是与页面、文档共用的契约，
 * 而"场景对象"只属于运行时，放在 composable 的模块作用域里刚好。
 */
const agentObjects = new Map<string, THREE.Object3D>()
/** agentId → 运行时行为状态 */
const agentRuntimes = new Map<string, AgentRuntime>()
/** 场地里的障碍物 */
const arenaObstacles: ArenaObstacle[] = []
/** 场地围墙 */
const arenaWalls: THREE.Object3D[] = []
/** 障碍物碰撞体的句柄集合——感知查询靠它把"障碍物"和"地面/围墙/其它智能体"区分开 */
const obstacleColliderHandles = new Set<number>()
/** 上一次构建障碍物时的密度，用来判断需不需要重建 */
let lastObstacleDensity: number | null = null

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** 线性同余伪随机数：让场地布局可复现，而不是每次刷新都换一副样子 */
const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

/** 角度插值（走最短弧） */
const lerpAngle = (from: number, to: number, factor: number): number => {
  const diff = Math.atan2(Math.sin(to - from), Math.cos(to - from))
  return from + diff * factor
}

/** 第 index 个目标点的位置（黄金角分布，避免所有智能体挤在同一处） */
const goalPosition = (index: number): THREE.Vector3 => {
  const angle = index * 2.399963
  const radius = 13
  return new THREE.Vector3(Math.cos(angle) * radius, AGENT_HEIGHT, Math.sin(angle) * radius)
}

export function useAI() {
  const aiStore = useAiStore()
  const three = useThree()
  const physics = usePhysics()

  const decisionQueue = ref<AiDecision[]>([])
  let simulationTimer: ReturnType<typeof setInterval> | null = null

  /**
   * 固定步长累加器：演武场的**唯一**物理时钟。
   *
   * 真实时间先累加进来，再按 1/60 秒切成整步——仿真速度与显示刷新率无关，
   * 同一个种子在不同帧率下得到同一套轨迹。
   */
  const fixedTimeStep = simulationConfig.physics.fixedTimeStep
  const accumulator = createFixedStepAccumulator(
    fixedTimeStep,
    simulationConfig.physics.maxSubSteps,
    simulationConfig.physics.maxFrameDelta,
  )

  /** 感知查询用的球形查询体，按半径缓存（同一个半径复用同一个 WASM 对象） */
  const senseBalls = new Map<number, RapierModule.Ball>()
  const getSenseBall = (radius: number): RapierModule.Ball | null => {
    const cached = senseBalls.get(radius)
    if (cached) return cached
    const engine = physics.getRapierModule()
    if (!engine) return null
    const ball = new engine.Ball(radius)
    senseBalls.set(radius, ball)
    return ball
  }

  /**
   * 感知：视野内的障碍物数量与最近距离。
   *
   * ⚠️ 两个数字都来自**物理引擎的查询**，不是手算的包围盒：
   * - 数量：`world.intersectionsWithShape` 用一个半径等于感知范围的球做形状查询；
   * - 最近距离：`world.projectPoint` 把智能体所在点投影到最近的障碍物碰撞体上。
   */
  const senseObstacles = (position: THREE.Vector3, range: number): ObstacleSense => {
    const world = physics.world.value
    if (!world) return { count: 0, distance: NO_OBSTACLE_DISTANCE, nearestPoint: null }

    const isObstacle = (collider: RapierModule.Collider | null): boolean =>
      Boolean(collider) && obstacleColliderHandles.has(collider!.handle)

    // 最近障碍物：把当前点投影到最近的障碍物表面上
    let distance = NO_OBSTACLE_DISTANCE
    let nearestPoint: THREE.Vector3 | null = null
    const projection = world.projectPoint(
      { x: position.x, y: position.y, z: position.z },
      true,
      undefined,
      undefined,
      undefined,
      undefined,
      isObstacle,
    )
    if (projection) {
      nearestPoint = new THREE.Vector3(
        projection.point.x,
        projection.point.y,
        projection.point.z,
      )
      distance = nearestPoint.distanceTo(position)
    }

    // 视野内的障碍物数量：一次球形形状查询
    let count = 0
    const ball = getSenseBall(range)
    if (ball) {
      world.intersectionsWithShape(
        { x: position.x, y: position.y, z: position.z },
        { x: 0, y: 0, z: 0, w: 1 },
        ball,
        (collider) => {
          if (isObstacle(collider)) count += 1
          return true
        },
        undefined,
        undefined,
        undefined,
        undefined,
        isObstacle,
      )
    }

    return { count, distance, nearestPoint }
  }

  /**
   * 是否真的撞上了障碍物。
   *
   * 用的是物理引擎的**窄相位接触流形**：接触点数量大于 0 才算撞上，
   * 而不是"距离够近就算撞上"。
   */
  const isTouchingObstacle = (collider: RapierModule.Collider | null): boolean => {
    const world = physics.world.value
    if (!world || !collider) return false

    for (const handle of obstacleColliderHandles) {
      const other = world.getCollider(handle)
      if (!other) continue
      let touching = false
      world.contactPair(collider, other, (manifold) => {
        if (manifold.numContacts() > 0) touching = true
      })
      if (touching) return true
    }
    return false
  }

  /** 构建智能体的场景网格 */
  const createAgentObject = (agent: AiAgent, index: number): THREE.Object3D => {
    const color = AGENT_COLORS[agent.type] ?? AGENT_COLORS.basic
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 }),
    )
    // 用「单位立方体 + 缩放」而不是直接建 0.8 的立方体：
    // 碰撞盒的半尺寸与质量密度都从 scale 推算，缩放写法两者天然一致。
    mesh.scale.setScalar(AGENT_SIZE)
    const angle = index * 2.399963 + 0.4
    mesh.position.set(Math.cos(angle) * 5, AGENT_HEIGHT, Math.sin(angle) * 5)
    mesh.name = `ai-agent-${agent.id}`
    mesh.userData.agentId = agent.id
    mesh.userData.physics = {
      type: 'dynamic',
      shape: 'box',
      mass: AGENT_MASS,
      friction: AGENT_FRICTION,
      restitution: AGENT_RESTITUTION,
    }
    return mesh
  }

  /** 造四面围墙——场地边界由碰撞体守住，而不是由代码里的坐标裁剪 */
  const buildWalls = (): void => {
    const currentScene = three.scene.value
    if (!currentScene) return

    for (const wall of arenaWalls) {
      currentScene.remove(wall)
      physics.removeRigidBody(wall)
    }
    arenaWalls.length = 0

    const material = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.7,
      metalness: 0.1,
      transparent: true,
      opacity: 0.35,
    })
    const halfHeight = WALL_HEIGHT / 2
    const halfThickness = WALL_THICKNESS / 2
    const specs: Array<{
      name: string
      position: [number, number, number]
      halfExtents: { x: number; y: number; z: number }
    }> = [
      {
        name: 'ai-arena-wall-north',
        position: [0, halfHeight, -ARENA_HALF_SIZE],
        halfExtents: { x: ARENA_HALF_SIZE + WALL_THICKNESS, y: halfHeight, z: halfThickness },
      },
      {
        name: 'ai-arena-wall-south',
        position: [0, halfHeight, ARENA_HALF_SIZE],
        halfExtents: { x: ARENA_HALF_SIZE + WALL_THICKNESS, y: halfHeight, z: halfThickness },
      },
      {
        name: 'ai-arena-wall-west',
        position: [-ARENA_HALF_SIZE, halfHeight, 0],
        halfExtents: { x: halfThickness, y: halfHeight, z: ARENA_HALF_SIZE + WALL_THICKNESS },
      },
      {
        name: 'ai-arena-wall-east',
        position: [ARENA_HALF_SIZE, halfHeight, 0],
        halfExtents: { x: halfThickness, y: halfHeight, z: ARENA_HALF_SIZE + WALL_THICKNESS },
      },
    ]

    for (const spec of specs) {
      const wall = new THREE.Mesh(
        new THREE.BoxGeometry(
          spec.halfExtents.x * 2,
          spec.halfExtents.y * 2,
          spec.halfExtents.z * 2,
        ),
        material,
      )
      wall.name = spec.name
      wall.position.set(...spec.position)
      wall.userData.physics = {
        type: 'static',
        shape: 'box',
        halfExtents: spec.halfExtents,
        friction: 0.4,
        restitution: 0.2,
      }
      currentScene.add(wall)
      arenaWalls.push(wall)
      physics.addRigidBody(wall)
    }
  }

  /** 按障碍物密度重建场地里的障碍物 */
  const rebuildObstacles = (force = false): void => {
    const currentScene = three.scene.value
    if (!currentScene) return
    const density = clamp(Number(aiStore.environmentSettings.obstaclesDensity) || 0, 0, 1)
    if (!force && density === lastObstacleDensity) return
    lastObstacleDensity = density

    for (const obstacle of arenaObstacles) {
      currentScene.remove(obstacle.mesh)
      physics.removeRigidBody(obstacle.mesh)
    }
    arenaObstacles.length = 0

    const count = Math.round(density * MAX_OBSTACLES)
    const random = createRandom(ARENA_SEED)
    for (let i = 0; i < count; i++) {
      const angle = (i / MAX_OBSTACLES) * Math.PI * 2 + (random() - 0.5) * 0.4
      const radius = 9 + random() * 6
      const size = 1.4 + random() * 1.2
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(size, size, size),
        new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.8, metalness: 0.05 }),
      )
      mesh.name = `ai-obstacle-${i}`
      mesh.position.set(Math.cos(angle) * radius, size / 2, Math.sin(angle) * radius)
      mesh.rotation.y = random() * Math.PI
      mesh.userData.physics = {
        type: 'static',
        shape: 'box',
        halfExtents: { x: size / 2, y: size / 2, z: size / 2 },
        friction: OBSTACLE_FRICTION,
        restitution: OBSTACLE_RESTITUTION,
      }
      currentScene.add(mesh)
      physics.addRigidBody(mesh)
      arenaObstacles.push({ mesh, collider: null })
    }
  }

  /**
   * 把刚体/碰撞体重新挂回运行时状态。
   *
   * 物理世界重建（`initPhysics`）之后，网格上的 `userData.physics` 会被重新填一遍，
   * 这里把最新的句柄同步过来——否则状态里拿着的是上一批世界的悬空引用。
   */
  const refreshBindings = (): void => {
    obstacleColliderHandles.clear()
    for (const obstacle of arenaObstacles) {
      obstacle.collider = obstacle.mesh.userData.physics?.collider ?? null
      if (obstacle.collider) obstacleColliderHandles.add(obstacle.collider.handle)
    }
    for (const [agentId, runtime] of agentRuntimes) {
      const object = agentObjects.get(agentId)
      runtime.body = object?.userData.physics?.body ?? null
      runtime.collider = object?.userData.physics?.collider ?? null
      // 智能体是一个"滑块"而不是"滚动的箱子"：锁死自转，
      // 朝向由速度方向决定，免得撞一下就翻跟头。
      runtime.body?.lockRotations(true, true)
    }
  }

  /**
   * 把 aiStore 里的智能体和场景对象对齐：
   * 新增智能体 → 建网格；删除智能体 → 移除网格。
   */
  const syncScene = (): void => {
    const currentScene = three.scene.value
    if (!currentScene) return

    for (const [agentId, object] of agentObjects) {
      if (!aiStore.agents.some((agent) => agent.id === agentId)) {
        currentScene.remove(object)
        physics.removeRigidBody(object)
        agentObjects.delete(agentId)
        agentRuntimes.delete(agentId)
      }
    }

    aiStore.agents.forEach((agent, index) => {
      if (agentObjects.has(agent.id)) return
      const object = createAgentObject(agent, index)
      currentScene.add(object)
      agentObjects.set(agent.id, object)
      agentRuntimes.set(agent.id, {
        heading: Math.atan2(-object.position.x, -object.position.z),
        goal: goalPosition(index + 1),
        desiredVelocity: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        goalIndex: index + 1,
        blocked: false,
        body: null,
        collider: null,
      })
      // 物理世界还没就绪时这是空操作；就绪之后新建的智能体会立刻有刚体
      physics.addRigidBody(object)
    })

    rebuildObstacles()
    refreshBindings()
  }

  /**
   * 建物理世界：地面 + 围墙 + 智能体/障碍物的刚体。
   *
   * 必须等场景建好之后再调用——刚体的初始位置来自网格的实际位置。
   */
  const initPhysics = async (): Promise<void> => {
    const currentScene = three.scene.value
    if (!currentScene) return

    await physics.ready()
    await physics.initPhysics(currentScene, {
      ground: {
        name: 'ai-arena-ground',
        halfExtents: { x: ARENA_GROUND_HALF, y: 0.5, z: ARENA_GROUND_HALF },
        color: 0x1f2530,
        opacity: 1,
        friction: GROUND_FRICTION,
        restitution: GROUND_RESTITUTION,
      },
    })

    buildWalls()
    refreshBindings()

    // 让世界先走一步：Rapier 的宽相位/窄相位只有 step() 之后才建好，
    // 而围墙是刚加进来的——不预热的话，第一次查询可能拿不到它们。
    physics.updatePhysics(fixedTimeStep)
  }

  /**
   * 转向：把期望速度变成一次冲量。
   *
   * ⚠️ 这里**不直接改坐标**。位移完全交给物理引擎的接触求解器：
   * 智能体撞上箱子时，是求解器把它的速度分量吃掉、让它沿着箱子滑开，
   * 而不是代码里手写的"沿单轴滑动"。
   */
  const applySteering = (dt: number): void => {
    for (const [agentId, runtime] of agentRuntimes) {
      const body = runtime.body
      if (!body) continue

      const agent = aiStore.agents.find((item) => item.id === agentId)
      const velocity = body.linvel()
      const running = Boolean(agent) && agent?.status === 'running'
      const desired = running ? runtime.desiredVelocity : null

      // 期望速度 - 实际速度 = 这一步要补的速度增量
      let dvx = desired ? desired.x - velocity.x : -velocity.x
      let dvz = desired ? desired.z - velocity.z : -velocity.z

      // 加速度上限：一步最多改多少速度
      const maxDelta = MAX_ACCELERATION * dt
      const length = Math.hypot(dvx, dvz)
      if (length > maxDelta && length > 1e-6) {
        dvx = (dvx / length) * maxDelta
        dvz = (dvz / length) * maxDelta
      }

      const mass = body.mass()
      if (mass <= 0) continue
      body.applyImpulse({ x: dvx * mass, y: 0, z: dvz * mass }, true)
    }
  }

  /** 物理步之后同步状态：速度、目标点、朝向 */
  const syncAfterStep = (): void => {
    for (const [agentId, runtime] of agentRuntimes) {
      const object = agentObjects.get(agentId)
      const body = runtime.body
      if (!object || !body) continue

      const velocity = body.linvel()
      runtime.velocity.set(velocity.x, 0, velocity.z)

      // 到达目标点后换一个新目标
      const toGoal = runtime.goal.clone().sub(object.position)
      toGoal.y = 0
      if (toGoal.length() < 1.2) {
        runtime.goalIndex += 1
        runtime.goal.copy(goalPosition(runtime.goalIndex))
      }

      // 朝向：让网格的 +Z 轴指向当前速度方向
      if (runtime.velocity.lengthSq() > 1e-6) {
        const target = Math.atan2(runtime.velocity.x, runtime.velocity.z)
        object.rotation.y = lerpAngle(object.rotation.y, target, 1 - Math.exp(-8 * fixedTimeStep))
      }
    }
  }

  /**
   * 每帧推进智能体运动。由渲染循环调用。
   *
   * 真实时间按固定步长切分：每一步先施加转向冲量，再让物理引擎推进一步。
   * 只有状态为 `running` 的智能体会移动（暂停/重置时自动停下）。
   */
  const updateAgents = (deltaSeconds: number): void => {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return

    accumulator.advance(deltaSeconds, 1, () => {
      applySteering(fixedTimeStep)
      physics.updatePhysics(fixedTimeStep)
      syncAfterStep()
    })
  }

  /** 读取智能体的真实状态——坐标来自场景对象，感知来自物理引擎 */
  const buildAgentState = (
    agentId: string,
    sense: ObstacleSense,
    blocked: boolean,
  ): AiAgentState => {
    const object = agentObjects.get(agentId)
    const runtime = agentRuntimes.get(agentId)

    const position = object ? object.position : new THREE.Vector3()
    const rotation = object ? object.rotation : new THREE.Euler()
    const velocity = runtime ? runtime.velocity : new THREE.Vector3()

    return {
      id: agentId,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      status: blocked ? 'collided' : 'normal',
      sensors: {
        proximity: {
          type: 'proximity',
          data: { obstacles: sense.count, distance: sense.distance },
          timestamp: Date.now(),
        },
      },
    }
  }

  const getAgentCurrentState = (agentId: string): AiAgentState => {
    const object = agentObjects.get(agentId)
    const runtime = agentRuntimes.get(agentId)
    const agent = aiStore.agents.find((item) => item.id === agentId)
    const awareness = Number(agent?.parameters.awarenessRange) || 10

    const position = object ? object.position : new THREE.Vector3()
    const sense = senseObstacles(position, awareness)
    const blocked = isTouchingObstacle(runtime?.collider ?? null)
    if (runtime) runtime.blocked = blocked

    return buildAgentState(agentId, sense, blocked)
  }

  /** 选一个"离障碍物更远"的转向角 */
  const chooseAvoidAngle = (
    position: THREE.Vector3,
    heading: number,
    nearestPoint: THREE.Vector3 | null,
  ): number => {
    const toObstacle = new THREE.Vector3()
    if (nearestPoint) {
      toObstacle.copy(nearestPoint).sub(position)
      toObstacle.y = 0
    }
    if (toObstacle.lengthSq() < 1e-6) toObstacle.set(0, 0, 1)
    toObstacle.normalize()

    const left = new THREE.Vector3(
      Math.sin(heading + AVOID_ANGLE),
      0,
      Math.cos(heading + AVOID_ANGLE),
    )
    const right = new THREE.Vector3(
      Math.sin(heading - AVOID_ANGLE),
      0,
      Math.cos(heading - AVOID_ANGLE),
    )
    return left.dot(toObstacle) <= right.dot(toObstacle) ? AVOID_ANGLE : -AVOID_ANGLE
  }

  /**
   * 生成决策：规则式，**由真实感知驱动**（不再是随机数）。
   *
   * - 前方有障碍 → 转向（挑离障碍更远的一侧）
   * - 否则 → 朝当前目标点移动
   */
  const generateAgentDecision = (agentId: string): AiDecision | null => {
    const agent = aiStore.agents.find((item) => item.id === agentId)
    const object = agentObjects.get(agentId)
    const runtime = agentRuntimes.get(agentId)
    if (!agent || !object || !runtime) return null

    const awareness = Number(agent.parameters.awarenessRange) || 10
    const speed = Number(agent.parameters.speed) || 5
    const avoidObstacles = agent.parameters.avoidObstacles !== false
    const avoidRadius = Math.min(awareness, AVOID_DISTANCE)

    const sense = senseObstacles(object.position, awareness)
    const blocked = isTouchingObstacle(runtime.collider)
    runtime.blocked = blocked

    let action: AiDecision['action'] = 'move'
    let parameters: Record<string, unknown> = {}

    if (avoidObstacles && sense.distance < avoidRadius) {
      action = 'rotate'
      parameters = { angle: chooseAvoidAngle(object.position, runtime.heading, sense.nearestPoint) }
    } else {
      const direction = runtime.goal.clone().sub(object.position)
      direction.y = 0
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1)
      direction.normalize()
      action = 'move'
      parameters = { direction: [direction.x, 0, direction.z], speed }
    }

    const confidence = clamp(1 - (sense.distance / Math.max(avoidRadius, 1)) * 0.5, 0.5, 1)
    aiStore.addAgentLog(agentId, `决定: ${action} ${JSON.stringify(parameters)}`, 'info')
    return { agentId, action, parameters, confidence, timestamp: Date.now() }
  }

  /**
   * 执行决策：**真的作用到物理刚体上**。
   *
   * 这里只写"期望速度"，位移由转向控制器换算成冲量，再由物理引擎积分。
   */
  const executeAgentDecision = (decision: AiDecision): void => {
    const runtime = agentRuntimes.get(decision.agentId)
    const object = agentObjects.get(decision.agentId)
    if (!runtime || !object) return

    switch (decision.action) {
      case 'move': {
        const direction = decision.parameters.direction
        const speed = Number(decision.parameters.speed) || 5
        if (Array.isArray(direction) && direction.length >= 3) {
          const x = Number(direction[0]) || 0
          const z = Number(direction[2]) || 0
          const length = Math.hypot(x, z)
          if (length > 1e-6) {
            runtime.heading = Math.atan2(x / length, z / length)
            runtime.desiredVelocity.set((x / length) * speed, 0, (z / length) * speed)
          }
        }
        break
      }
      case 'rotate': {
        const angle = Number(decision.parameters.angle) || 0
        const speed = Number(decision.parameters.speed) || runtime.desiredVelocity.length() || 5
        runtime.heading += angle
        runtime.desiredVelocity.set(
          Math.sin(runtime.heading) * speed,
          0,
          Math.cos(runtime.heading) * speed,
        )
        break
      }
      case 'interact': {
        aiStore.addAgentLog(
          decision.agentId,
          '交互动作尚未实现：当前智能体只会在场地里移动与转向',
          'warning',
        )
        runtime.desiredVelocity.set(0, 0, 0)
        break
      }
      case 'wait': {
        runtime.desiredVelocity.set(0, 0, 0)
        break
      }
    }
  }

  const stopSimulationLoop = (): void => {
    if (simulationTimer) {
      clearInterval(simulationTimer)
      simulationTimer = null
    }
  }

  const startSimulationLoop = (): void => {
    stopSimulationLoop()
    let lastTime = Date.now()

    simulationTimer = setInterval(() => {
      const now = Date.now()
      const deltaTime = (now - lastTime) / 1000
      lastTime = now
      aiStore.simulationTime += deltaTime

      aiStore.activeAgents.forEach((agent) => {
        if (agent.status !== 'running') return
        const decision = generateAgentDecision(agent.id)
        if (!decision) return
        decisionQueue.value.push(decision)
        if (decisionQueue.value.length > 100) {
          decisionQueue.value = decisionQueue.value.slice(-50)
        }
        executeAgentDecision(decision)
      })
    }, DECISION_INTERVAL_MS)
  }

  /**
   * 监听仿真开关。
   *
   * ⚠️ `immediate: true` 是必需的：挂载时 `simulationActive` 已经是 true 的话，
   * 没有它回调永远不会触发，循环也就永远不启动。
   */
  const setupSimulationLoop = (): void => {
    watch(
      () => aiStore.simulationActive,
      (isActive) => {
        if (isActive) startSimulationLoop()
        else stopSimulationLoop()
      },
      { immediate: true },
    )
  }

  const initializeAiSystem = (): void => {
    aiStore.initializeDefaultAgents()
    syncScene()
  }

  const cleanup = (): void => {
    stopSimulationLoop()
    const currentScene = three.scene.value
    if (currentScene) {
      agentObjects.forEach((object) => {
        currentScene.remove(object)
        physics.removeRigidBody(object)
      })
      arenaObstacles.forEach((obstacle) => {
        currentScene.remove(obstacle.mesh)
        physics.removeRigidBody(obstacle.mesh)
      })
      arenaWalls.forEach((wall) => {
        currentScene.remove(wall)
        physics.removeRigidBody(wall)
      })
    }
    agentObjects.clear()
    agentRuntimes.clear()
    arenaObstacles.length = 0
    arenaWalls.length = 0
    obstacleColliderHandles.clear()
    lastObstacleDensity = null
    accumulator.reset()
  }

  // 智能体增删 → 同步场景对象
  watch(
    () => aiStore.agents.map((agent) => agent.id).join('|'),
    () => syncScene(),
  )
  // 障碍物密度变化 → 重建障碍物
  watch(
    () => aiStore.environmentSettings.obstaclesDensity,
    () => rebuildObstacles(true),
  )
  // 场景就绪 → 补建智能体与障碍物
  watch(three.scene, (current) => {
    if (current) syncScene()
  })

  setupSimulationLoop()

  onMounted(() => initializeAiSystem())
  onUnmounted(() => cleanup())

  return {
    decisionQueue,
    generateAgentDecision,
    executeAgentDecision,
    getAgentCurrentState,
    updateAgents,
    syncScene,
    initPhysics,
    cleanup,
  }
}
