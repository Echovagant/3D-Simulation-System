// src/composables/useAI.ts
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { useAiStore, type AiAgent } from '@/stores/aiStore'
import { useThree } from './useThree'
import type { AiDecision, AiAgentState } from '@/types'

/** 场地半边长（米）——智能体被限制在这个范围内 */
const ARENA_HALF_SIZE = 24
/** 智能体碰撞半径（米） */
const AGENT_RADIUS = 0.6
/** 智能体网格的半高（米），也就是它站在地面上的高度 */
const AGENT_HEIGHT = 0.4
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
  /** 上一帧实际速度 */
  velocity: THREE.Vector3
  /** 目标点序号 */
  goalIndex: number
  /** 上一帧是否被障碍物挡住 */
  blocked: boolean
}

/** 场地里的一个障碍物 */
interface ArenaObstacle {
  mesh: THREE.Object3D
  /** 障碍物自身的包围盒 */
  box: THREE.Box3
  /** 膨胀了智能体半径后的阻挡盒 */
  blockBox: THREE.Box3
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

  const decisionQueue = ref<AiDecision[]>([])
  let simulationTimer: ReturnType<typeof setInterval> | null = null

  /** 感知：视野内的障碍物数量与最近距离——全部来自真实场景几何 */
  const senseObstacles = (position: THREE.Vector3, range: number) => {
    let count = 0
    let nearest = NO_OBSTACLE_DISTANCE
    for (const obstacle of arenaObstacles) {
      const distance = obstacle.box.distanceToPoint(position)
      if (distance < nearest) nearest = distance
      if (distance <= range) count++
    }
    return { count, distance: nearest }
  }

  /** 位置是否落在某个障碍物的阻挡盒里 */
  const isBlocked = (x: number, z: number): boolean => {
    const probe = new THREE.Vector3(x, AGENT_HEIGHT, z)
    return arenaObstacles.some((obstacle) => obstacle.blockBox.containsPoint(probe))
  }

  /** 最近的障碍物 */
  const nearestObstacle = (position: THREE.Vector3): ArenaObstacle | null => {
    let nearest: ArenaObstacle | null = null
    let best = Number.POSITIVE_INFINITY
    for (const obstacle of arenaObstacles) {
      const distance = obstacle.box.distanceToPoint(position)
      if (distance < best) {
        best = distance
        nearest = obstacle
      }
    }
    return nearest
  }

  /** 构建智能体的场景网格 */
  const createAgentObject = (agent: AiAgent, index: number): THREE.Object3D => {
    const color = AGENT_COLORS[agent.type] ?? AGENT_COLORS.basic
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 0.8, 0.8),
      new THREE.MeshStandardMaterial({ color, roughness: 0.45, metalness: 0.1 }),
    )
    const angle = index * 2.399963 + 0.4
    mesh.position.set(Math.cos(angle) * 5, AGENT_HEIGHT, Math.sin(angle) * 5)
    mesh.name = `ai-agent-${agent.id}`
    mesh.userData.agentId = agent.id
    return mesh
  }

  /** 按障碍物密度重建场地里的障碍物 */
  const rebuildObstacles = (force = false): void => {
    const currentScene = three.scene.value
    if (!currentScene) return
    const density = clamp(Number(aiStore.environmentSettings.obstaclesDensity) || 0, 0, 1)
    if (!force && density === lastObstacleDensity) return
    lastObstacleDensity = density

    for (const obstacle of arenaObstacles) currentScene.remove(obstacle.mesh)
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
      currentScene.add(mesh)
      mesh.updateMatrixWorld(true)
      const box = new THREE.Box3().setFromObject(mesh)
      arenaObstacles.push({ mesh, box, blockBox: box.clone().expandByScalar(AGENT_RADIUS) })
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
      })
    })

    rebuildObstacles()
  }

  /**
   * 一步移动：撞上障碍物时尝试沿单轴滑动，都不行就停在原地。
   *
   * 位移超过智能体半径时会拆成子步——否则一帧走太远会直接穿过障碍物。
   */
  const resolveMove = (
    from: THREE.Vector3,
    step: THREE.Vector3,
  ): { position: THREE.Vector3; blocked: boolean } => {
    const limit = ARENA_HALF_SIZE - AGENT_RADIUS
    const length = step.length()
    const subSteps = Math.max(1, Math.ceil(length / AGENT_RADIUS))
    const subStep = step.clone().divideScalar(subSteps)
    let current = from.clone()
    let blocked = false

    for (let i = 0; i < subSteps; i++) {
      const targetX = clamp(current.x + subStep.x, -limit, limit)
      const targetZ = clamp(current.z + subStep.z, -limit, limit)
      if (!isBlocked(targetX, targetZ)) {
        current = new THREE.Vector3(targetX, current.y, targetZ)
        continue
      }
      blocked = true
      if (!isBlocked(targetX, current.z)) {
        current = new THREE.Vector3(targetX, current.y, current.z)
        continue
      }
      if (!isBlocked(current.x, targetZ)) {
        current = new THREE.Vector3(current.x, current.y, targetZ)
        continue
      }
      break
    }

    return { position: current, blocked }
  }

  /**
   * 每帧推进智能体运动。由渲染循环调用。
   *
   * 只有状态为 `running` 的智能体会移动（暂停/重置时自动停下）。
   */
  const updateAgents = (deltaSeconds: number): void => {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return

    for (const [agentId, runtime] of agentRuntimes) {
      const object = agentObjects.get(agentId)
      const agent = aiStore.agents.find((item) => item.id === agentId)
      if (!object || !agent) continue

      if (agent.status !== 'running') {
        runtime.velocity.set(0, 0, 0)
        continue
      }

      // 到达目标点后换一个新目标
      const toGoal = runtime.goal.clone().sub(object.position)
      toGoal.y = 0
      if (toGoal.length() < 1.2) {
        runtime.goalIndex += 1
        runtime.goal.copy(goalPosition(runtime.goalIndex))
      }

      const from = object.position.clone()
      const outcome = resolveMove(
        from,
        runtime.desiredVelocity.clone().multiplyScalar(deltaSeconds),
      )
      const next = outcome.position
      runtime.blocked = outcome.blocked
      object.position.x = next.x
      object.position.z = next.z
      runtime.velocity.set((next.x - from.x) / deltaSeconds, 0, (next.z - from.z) / deltaSeconds)

      // 朝向：让网格的 +Z 轴指向当前速度方向
      if (runtime.velocity.lengthSq() > 1e-6) {
        const target = Math.atan2(runtime.velocity.x, runtime.velocity.z)
        object.rotation.y = lerpAngle(object.rotation.y, target, 1 - Math.exp(-8 * deltaSeconds))
      }
    }
  }

  /** 读取智能体的真实状态——坐标来自场景对象，感知来自真实几何 */
  const getAgentCurrentState = (agentId: string): AiAgentState => {
    const object = agentObjects.get(agentId)
    const runtime = agentRuntimes.get(agentId)
    const agent = aiStore.agents.find((item) => item.id === agentId)
    const awareness = Number(agent?.parameters.awarenessRange) || 10

    const position = object ? object.position : new THREE.Vector3()
    const rotation = object ? object.rotation : new THREE.Euler()
    const velocity = runtime ? runtime.velocity : new THREE.Vector3()
    const proximity = senseObstacles(position, awareness)

    return {
      id: agentId,
      position: [position.x, position.y, position.z],
      rotation: [rotation.x, rotation.y, rotation.z],
      velocity: [velocity.x, velocity.y, velocity.z],
      status: runtime?.blocked ? 'collided' : 'normal',
      sensors: {
        proximity: {
          type: 'proximity',
          data: { obstacles: proximity.count, distance: proximity.distance },
          timestamp: Date.now(),
        },
      },
    }
  }

  /** 选一个"离障碍物更远"的转向角 */
  const chooseAvoidAngle = (position: THREE.Vector3, heading: number): number => {
    const nearest = nearestObstacle(position)
    const toObstacle = new THREE.Vector3()
    if (nearest) {
      toObstacle.copy(nearest.box.getCenter(new THREE.Vector3())).sub(position)
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

    const state = getAgentCurrentState(agentId)
    const proximity = state.sensors.proximity.data as { obstacles: number; distance: number }

    let action: AiDecision['action'] = 'move'
    let parameters: Record<string, unknown> = {}

    if (avoidObstacles && proximity.distance < avoidRadius) {
      action = 'rotate'
      parameters = { angle: chooseAvoidAngle(object.position, runtime.heading) }
    } else {
      const direction = runtime.goal.clone().sub(object.position)
      direction.y = 0
      if (direction.lengthSq() < 1e-6) direction.set(0, 0, 1)
      direction.normalize()
      action = 'move'
      parameters = { direction: [direction.x, 0, direction.z], speed }
    }

    const confidence = clamp(1 - (proximity.distance / Math.max(avoidRadius, 1)) * 0.5, 0.5, 1)
    aiStore.addAgentLog(agentId, `决定: ${action} ${JSON.stringify(parameters)}`, 'info')
    return { agentId, action, parameters, confidence, timestamp: Date.now() }
  }

  /**
   * 执行决策：**真的作用到场景对象上**（不再四个分支全是空的）。
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
      agentObjects.forEach((object) => currentScene.remove(object))
      arenaObstacles.forEach((obstacle) => currentScene.remove(obstacle.mesh))
    }
    agentObjects.clear()
    agentRuntimes.clear()
    arenaObstacles.length = 0
    lastObstacleDensity = null
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
    cleanup,
  }
}
