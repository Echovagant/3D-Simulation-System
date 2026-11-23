// src/composables/useAI.ts
/**
 * AI 演武场：智能体的建场、感知、决策与物理推进。
 *
 * 规则式与 LLM 两条控制路共用同一套执行层（决策 → 期望速度 → 冲量 → Rapier）：
 * 模型只决定「往哪走」，位移永远由物理引擎积分。LLM 挂了就回落规则式，仿真不断。
 */
import { ref, watch, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import type * as RapierModule from '@dimforge/rapier3d'
import { useAiStore, type AiAgent, type AiEnvironmentSettings } from '@/stores/aiStore'
import { useLlmStore } from '@/stores/llmStore'
import { useThree } from './useThree'
import { usePhysics } from './usePhysics'
import { createFixedStepAccumulator } from '@/utils/fixedStepAccumulator'
import { formatLogParameters } from '@/utils/agentLogExport'
import { arenaAgentUuid, buildArenaHandoff, type AiLabHandoff } from '@/utils/aiLabHandoff'
import { createRandom, DEFAULT_SEED } from '@/utils/prng'
import type { AgentMetricInput } from '@/utils/agentMetrics'
import { simulationConfig } from '@/config/simulation'
import { llmConfig } from '@/config/llm'
import type { AgentSnapshot, LlmAction } from '@/services/llm/prompts'
import type {
  AiDecision,
  AiAgentState,
  SceneDocument,
  SceneDocumentObject,
} from '@/types'

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
/** 智能体允许的最大速度（米/秒）——LLM 给的速度会被夹在这个范围内 */
const LLM_MAX_SPEED = 8
/** 避障判定半径（米） */
const AVOID_DISTANCE = 3.5
/** 避障转向角（弧度） */
const AVOID_ANGLE = Math.PI / 3
/** 障碍物数量上限 */
const MAX_OBSTACLES = 12
/** 视野里没有障碍物时的距离读数 */
const NO_OBSTACLE_DISTANCE = 999

/** 感知叠加层的根节点名字（测试与排查时按名字定位） */
const PERCEPTION_GROUP_NAME = 'ai-perception-overlay'
/** 感知半径环的线段数 */
const PERCEPTION_RING_SEGMENTS = 48
/** 地面上的叠加线高度（略高于地面顶面 y = 0，避免 z-fighting） */
const PERCEPTION_GROUND_Y = 0.03
/** 目标连线颜色（绿） */
const PERCEPTION_GOAL_COLOR = 0x22c55e
/** 障碍连线的常规颜色（琥珀） */
const PERCEPTION_OBSTACLE_COLOR = 0xf59e0b
/** 接触障碍物时障碍连线的颜色（红） */
const PERCEPTION_BLOCKED_COLOR = 0xef4444
/** 朝向短线颜色 */
const PERCEPTION_HEADING_COLOR = 0xe2e8f0
/** 朝向短线长度（米） */
const PERCEPTION_HEADING_LENGTH = 1.4
/** 最近障碍点标记的半径（米） */
const PERCEPTION_MARKER_RADIUS = 0.16

/** 智能体配色（按类型区分） */
const AGENT_COLORS: Record<string, number> = {
  basic: 0xffd700,
  advanced: 0x38bdf8,
  custom: 0xa78bfa,
}

/**
 * 难度系数：按档位缩放智能体的速度与感知范围。
 *
 * ⚠️ 难度必须作用在**真实行为**上——否则它只是个装饰性的单选项。
 */
const DIFFICULTY_FACTORS: Record<
  AiEnvironmentSettings['difficulty'],
  { speed: number; awareness: number }
> = {
  easy: { speed: 0.7, awareness: 0.8 },
  medium: { speed: 1, awareness: 1 },
  hard: { speed: 1.3, awareness: 1.2 }
}

/** 智能体在物理世界里的初始反应时间（秒）——界面上滑块的最小值 */
const DEFAULT_REACTION_TIME = 0.1

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
  /** 出生点——重置时把刚体送回这里 */
  spawn: THREE.Vector3
  /** 出生时的目标点序号——重置时目标点也要回到这里 */
  spawnGoalIndex: number
  /** 是否已经抵达过目标点（胜利条件达成过） */
  goalReached: boolean
  /** 最近一次做决策的时刻（毫秒）；null 表示还没做过决策 */
  lastDecisionAt: number | null
  /** 最近一次感知时是否真的撞上了障碍物（来自物理引擎的接触流形） */
  blocked: boolean
  /** 累计走过的水平路程（米）——路径效率的分母 */
  pathLength: number
  /** 累计撞上障碍物的次数（blocked 上升沿计一次） */
  collisionCount: number
  /** 上一次执行的动作（喂给 LLM 当上下文） */
  lastAction?: string
  /** 上一次执行的动作参数 */
  lastParameters?: Record<string, unknown>
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
 * 单个智能体的感知叠加物（只属于渲染层）。
 *
 * ⚠️ 这些对象不挂到智能体网格上、不带 `userData.physics`：
 * 它们不参与物理、不算进感知，也不会被场景导出带走。
 */
interface PerceptionOverlay {
  /** 地面上的感知半径环（半径由缩放表达） */
  ring: THREE.LineLoop
  /** 智能体 → 目标点 */
  goalLine: THREE.Line
  /** 智能体 → 最近障碍点 */
  obstacleLine: THREE.Line
  /** 最近障碍点上的小标记 */
  marker: THREE.Mesh
  /** 朝向短线 */
  headingLine: THREE.Line
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
/** LLM 决策已到货、等待下一拍执行 */
const llmDecisions = new Map<string, AiDecision>()
/** 正在飞行的 LLM 请求（每个智能体最多一个） */
const llmInFlight = new Set<string>()
/** 上一拍 LLM 失败、这一拍要回落规则式的智能体 */
const llmFallbacks = new Set<string>()
/** 上一次发起 LLM 请求的时间戳（毫秒） */
let lastLlmRequestAt = 0

/**
 * 感知可视化开关。
 *
 * ⚠️ 放在模块作用域：调试面板与页面各自会调一次 useAI()，
 * 开关必须两边共用同一份，否则面板打开了、渲染那边却不知道。
 */
const perceptionVisible = ref(false)
/** 感知叠加层根节点（只属于渲染层；关闭时置空） */
let perceptionGroup: THREE.Group | null = null
/** agentId → 该智能体的感知叠加物 */
const perceptionOverlays = new Map<string, PerceptionOverlay>()
/** 更新连线时复用的临时向量，避免每帧为每个智能体新建对象 */
const perceptionFrom = new THREE.Vector3()
const perceptionTo = new THREE.Vector3()

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

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

/**
 * 第 index 个智能体的出生点（半径 5 的环上，黄金角分布）。
 *
 * ⚠️ 建场与重置必须用**同一个**出生点，否则重置后智能体会落在别的地方。
 */
const agentSpawnPosition = (index: number): THREE.Vector3 => {
  const angle = index * 2.399963 + 0.4
  return new THREE.Vector3(Math.cos(angle) * 5, AGENT_HEIGHT, Math.sin(angle) * 5)
}

export function useAI() {
  const aiStore = useAiStore()
  const llm = useLlmStore()
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

  /** 当前难度的系数（配置缺失时按中等算） */
  const difficultyFactors = () =>
    DIFFICULTY_FACTORS[aiStore.environmentSettings.difficulty] ?? DIFFICULTY_FACTORS.medium

  /**
   * 读取智能体的**有效**参数——难度系数在这里生效。
   *
   * ⚠️ 界面上的速度与感知范围是基础值，实际生效的是它们乘上难度系数的结果。
   */
  const readAgentParams = (agent: AiAgent) => {
    const factors = difficultyFactors()
    return {
      speed: (Number(agent.parameters.speed) || 5) * factors.speed,
      awareness: (Number(agent.parameters.awarenessRange) || 10) * factors.awareness,
      avoidObstacles: agent.parameters.avoidObstacles !== false,
      reactionTime: Number(agent.parameters.reactionTime) || DEFAULT_REACTION_TIME
    }
  }

  /**
   * 感知：视野内的障碍物数量与最近距离。
   *
   * ⚠️ 两个数字都来自**物理引擎的形状计算**（`collider.projectPoint` 把智能体所在点
   * 投影到障碍物表面上），不是手算的包围盒。
   *
   * ⚠️ 这里刻意**不用** `world.projectPoint` 的全局查询：那个接口的过滤回调
   * 一旦把所有碰撞体都拒掉（空场地就是如此），Rapier 0.19.3 会在 WASM 内部
   * 直接 panic 并污染整个实例。逐碰撞体查询没有这个风险，
   * 而且碰撞体最多十几个，比全局查询还快。
   */
  const senseObstacles = (position: THREE.Vector3, range: number): ObstacleSense => {
    let count = 0
    let distance = NO_OBSTACLE_DISTANCE
    let nearestPoint: THREE.Vector3 | null = null

    for (const obstacle of arenaObstacles) {
      const collider = obstacle.collider
      if (!collider) continue

      // 引擎把点投影到碰撞体表面上：得到的是"到障碍物表面的真实距离"
      const projection = collider.projectPoint(position, true)
      if (!projection) continue
      const dx = projection.point.x - position.x
      const dy = projection.point.y - position.y
      const dz = projection.point.z - position.z
      const gap = Math.hypot(dx, dy, dz)

      if (gap <= range) count += 1
      if (gap < distance) {
        distance = gap
        nearestPoint = new THREE.Vector3(
          projection.point.x,
          projection.point.y,
          projection.point.z,
        )
      }
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

  // ===================== 感知可视化（只属于渲染层） =====================

  /** 两顶点的线段几何体——之后每帧原地改顶点，不重建几何体 */
  const createSegmentGeometry = (): THREE.BufferGeometry => {
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3))
    return geometry
  }

  /** 半径为 1 的圆周顶点——实际半径用 `scale` 表达 */
  const createCircleGeometry = (segments = PERCEPTION_RING_SEGMENTS): THREE.BufferGeometry => {
    const points = new Float32Array(segments * 3)
    for (let i = 0; i < segments; i += 1) {
      const angle = (i / segments) * Math.PI * 2
      points[i * 3] = Math.cos(angle)
      points[i * 3 + 1] = 0
      points[i * 3 + 2] = Math.sin(angle)
    }
    const geometry = new THREE.BufferGeometry()
    geometry.setAttribute('position', new THREE.BufferAttribute(points, 3))
    return geometry
  }

  const createPerceptionOverlay = (agentId: string, color: number): PerceptionOverlay => {
    const ring = new THREE.LineLoop(
      createCircleGeometry(),
      new THREE.LineBasicMaterial({
        color,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
      }),
    )
    ring.name = `ai-perception-ring-${agentId}`
    ring.position.y = PERCEPTION_GROUND_Y
    ring.frustumCulled = false

    const goalLine = new THREE.Line(
      createSegmentGeometry(),
      new THREE.LineBasicMaterial({
        color: PERCEPTION_GOAL_COLOR,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    )
    goalLine.name = `ai-perception-goal-${agentId}`
    goalLine.frustumCulled = false

    const obstacleLine = new THREE.Line(
      createSegmentGeometry(),
      new THREE.LineBasicMaterial({
        color: PERCEPTION_OBSTACLE_COLOR,
        transparent: true,
        opacity: 0.9,
        depthWrite: false,
      }),
    )
    obstacleLine.name = `ai-perception-obstacle-${agentId}`
    obstacleLine.frustumCulled = false

    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(PERCEPTION_MARKER_RADIUS, 12, 8),
      new THREE.MeshBasicMaterial({ color: PERCEPTION_OBSTACLE_COLOR, depthWrite: false }),
    )
    marker.name = `ai-perception-marker-${agentId}`
    marker.frustumCulled = false

    const headingLine = new THREE.Line(
      createSegmentGeometry(),
      new THREE.LineBasicMaterial({
        color: PERCEPTION_HEADING_COLOR,
        transparent: true,
        opacity: 0.8,
        depthWrite: false,
      }),
    )
    headingLine.name = `ai-perception-heading-${agentId}`
    headingLine.frustumCulled = false

    return { ring, goalLine, obstacleLine, marker, headingLine }
  }

  /** 原地改写线段两端点（不新建几何体，也不重算包围球——它们不参与视锥剔除） */
  const setPerceptionSegment = (
    line: THREE.Line,
    from: THREE.Vector3,
    to: THREE.Vector3,
  ): void => {
    const attribute = line.geometry.getAttribute('position') as THREE.BufferAttribute
    attribute.setXYZ(0, from.x, from.y, from.z)
    attribute.setXYZ(1, to.x, to.y, to.z)
    attribute.needsUpdate = true
  }

  const disposePerceptionOverlay = (overlay: PerceptionOverlay): void => {
    const lines: THREE.Line[] = [
      overlay.ring,
      overlay.goalLine,
      overlay.obstacleLine,
      overlay.headingLine,
    ]
    for (const line of lines) {
      line.geometry.dispose()
      ;(line.material as THREE.Material).dispose()
    }
    overlay.marker.geometry.dispose()
    ;(overlay.marker.material as THREE.Material).dispose()
  }

  /** 摘掉全部感知叠加物并释放几何体/材质 */
  const disposePerceptionOverlays = (): void => {
    for (const overlay of perceptionOverlays.values()) disposePerceptionOverlay(overlay)
    perceptionOverlays.clear()
    if (perceptionGroup) {
      perceptionGroup.parent?.remove(perceptionGroup)
      perceptionGroup = null
    }
  }

  /**
   * 让叠加物跟上智能体的当前位置。
   *
   * 每帧由 `updateAgents` 调用；开关关闭、场景不存在时只做清理。
   * 这里读的是**与感知/决策同一套**数据（`readAgentParams` + `senseObstacles`），
   * 所以画出来的环就是智能体真正在用的感知半径。
   */
  const syncPerceptionOverlays = (): void => {
    const currentScene = three.scene.value
    if (!perceptionVisible.value || !currentScene) {
      disposePerceptionOverlays()
      return
    }

    if (!perceptionGroup) {
      perceptionGroup = new THREE.Group()
      perceptionGroup.name = PERCEPTION_GROUP_NAME
      // 明确标记：这不是场景内容，导出/物理都不该带上它
      perceptionGroup.userData.perceptionOverlay = true
    }
    const group = perceptionGroup
    if (group.parent !== currentScene) currentScene.add(group)

    // 智能体被删除 → 对应的叠加物一起摘掉
    for (const [agentId, overlay] of perceptionOverlays) {
      if (agentRuntimes.has(agentId)) continue
      group.remove(
        overlay.ring,
        overlay.goalLine,
        overlay.obstacleLine,
        overlay.marker,
        overlay.headingLine,
      )
      disposePerceptionOverlay(overlay)
      perceptionOverlays.delete(agentId)
    }

    for (const [agentId, runtime] of agentRuntimes) {
      const object = agentObjects.get(agentId)
      const agent = aiStore.agents.find((item) => item.id === agentId)
      if (!object || !agent) continue

      let overlay = perceptionOverlays.get(agentId)
      if (!overlay) {
        overlay = createPerceptionOverlay(
          agentId,
          AGENT_COLORS[agent.type] ?? AGENT_COLORS.basic,
        )
        group.add(
          overlay.ring,
          overlay.goalLine,
          overlay.obstacleLine,
          overlay.marker,
          overlay.headingLine,
        )
        perceptionOverlays.set(agentId, overlay)
      }

      const { awareness } = readAgentParams(agent)
      const position = object.position

      // a) 地面感知半径环
      overlay.ring.position.set(position.x, PERCEPTION_GROUND_Y, position.z)
      overlay.ring.scale.set(Math.max(awareness, 0.001), 1, Math.max(awareness, 0.001))
      overlay.ring.visible = awareness > 0.1

      // b) 智能体 → 目标点（绿）
      perceptionFrom.set(position.x, PERCEPTION_GROUND_Y, position.z)
      perceptionTo.set(runtime.goal.x, PERCEPTION_GROUND_Y, runtime.goal.z)
      setPerceptionSegment(overlay.goalLine, perceptionFrom, perceptionTo)

      // c) 智能体 → 最近障碍点（琥珀；接触中为红），并在最近点放标记
      const sense = senseObstacles(position, awareness)
      const hasNearest = sense.nearestPoint !== null
      const obstacleColor = runtime.blocked ? PERCEPTION_BLOCKED_COLOR : PERCEPTION_OBSTACLE_COLOR
      ;(overlay.obstacleLine.material as THREE.LineBasicMaterial).color.setHex(obstacleColor)
      ;(overlay.marker.material as THREE.MeshBasicMaterial).color.setHex(obstacleColor)
      overlay.obstacleLine.visible = hasNearest
      overlay.marker.visible = hasNearest
      if (sense.nearestPoint) {
        perceptionTo.set(
          sense.nearestPoint.x,
          Math.max(sense.nearestPoint.y, PERCEPTION_GROUND_Y),
          sense.nearestPoint.z,
        )
        setPerceptionSegment(overlay.obstacleLine, perceptionFrom, perceptionTo)
        overlay.marker.position.copy(perceptionTo)
      }

      // d) 朝向短线
      perceptionTo.set(
        position.x + Math.sin(runtime.heading) * PERCEPTION_HEADING_LENGTH,
        PERCEPTION_GROUND_Y,
        position.z + Math.cos(runtime.heading) * PERCEPTION_HEADING_LENGTH,
      )
      setPerceptionSegment(overlay.headingLine, perceptionFrom, perceptionTo)
    }
  }

  /** 打开/关闭感知可视化；关掉时立刻释放叠加物，不留几何体/材质 */
  const setPerceptionVisible = (visible: boolean): void => {
    perceptionVisible.value = Boolean(visible)
    syncPerceptionOverlays()
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
    mesh.position.copy(agentSpawnPosition(index))
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
      // 围墙只有 1.2 米高，二十几米外看过去太淡就等于没有——
      // 场地边界读不出来，智能体像是在无边无际的虚空里跑。
      opacity: 0.6,
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

  /** 按当前密度与种子重建场地里的障碍物（调用方要么在建新世界、要么是设置变了） */
  const rebuildObstacles = (): void => {
    const currentScene = three.scene.value
    if (!currentScene) return
    const density = clamp(Number(aiStore.environmentSettings.obstaclesDensity) || 0, 0, 1)
    const seedSetting = Number(aiStore.environmentSettings.arenaSeed)
    const seed = Number.isFinite(seedSetting) ? Math.abs(Math.floor(seedSetting)) : DEFAULT_SEED

    for (const obstacle of arenaObstacles) {
      currentScene.remove(obstacle.mesh)
      physics.removeRigidBody(obstacle.mesh)
    }
    arenaObstacles.length = 0

    const count = Math.round(density * MAX_OBSTACLES)
    const random = createRandom(seed)
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
      const spawn = agentSpawnPosition(index)
      currentScene.add(object)
      agentObjects.set(agent.id, object)
      agentRuntimes.set(agent.id, {
        heading: Math.atan2(-spawn.x, -spawn.z),
        goal: goalPosition(index + 1),
        desiredVelocity: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        goalIndex: index + 1,
        spawn,
        spawnGoalIndex: index + 1,
        goalReached: false,
        lastDecisionAt: null,
        blocked: false,
        pathLength: 0,
        collisionCount: 0,
        body: null,
        collider: null,
      })
      // 物理世界还没就绪时这是空操作；就绪之后新建的智能体会立刻有刚体
      physics.addRigidBody(object)
    })

    rebuildObstacles()
    refreshBindings()
    // 智能体增删后，感知叠加层也要跟着对齐（关闭状态时这里是空操作）
    syncPerceptionOverlays()
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
        // 地面颜色：比背景亮一档，场地才看得出是块地板而不是一片黑。
        // 太暗就分不出「地面到头了」和「背景」，智能体会像浮在虚空里。
        color: 0x2a3340,
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

      // 指标原始数据：累计水平路程 + 碰撞上升沿计数
      runtime.pathLength += runtime.velocity.length() * fixedTimeStep
      const touching = isTouchingObstacle(runtime.collider)
      if (touching && !runtime.blocked) runtime.collisionCount += 1
      runtime.blocked = touching

      // 到达目标点后换一个新目标
      const toGoal = runtime.goal.clone().sub(object.position)
      toGoal.y = 0
      if (toGoal.length() < 1.2) {
        runtime.goalIndex += 1
        runtime.goal.copy(goalPosition(runtime.goalIndex))

        // 胜利条件（目前只有「到达目标点」一种）达成：记一笔日志，
        // 并给状态快照打上 goal_reached 标记——智能体接着去下一个目标点。
        const agent = aiStore.agents.find((item) => item.id === agentId)
        if (agent?.status === 'running') {
          runtime.goalReached = true
          aiStore.addAgentLog(agentId, '胜利条件达成：到达目标点', 'info')
        }
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

    // 叠加物每帧跟随智能体，与物理步长无关（暂停时也保持在当前位置）
    syncPerceptionOverlays()
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
      // 碰撞优先；没有碰撞时看胜利条件有没有达成过
      status: blocked ? 'collided' : runtime?.goalReached ? 'goal_reached' : 'normal',
      sensors: {
        proximity: {
          type: 'proximity',
          data: { obstacles: sense.count, distance: sense.distance },
          timestamp: Date.now(),
        },
      },
    }
  }

  /** 读取一个智能体此刻的真实状态：坐标来自场景网格，感知与碰撞来自物理引擎 */
  const getAgentCurrentState = (agentId: string): AiAgentState => {
    const object = agentObjects.get(agentId)
    const runtime = agentRuntimes.get(agentId)
    const agent = aiStore.agents.find((item) => item.id === agentId)
    const awareness = agent ? readAgentParams(agent).awareness : 10

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

    const { awareness, speed, avoidObstacles } = readAgentParams(agent)
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
    // 浮点数取整后再记：原始浮点有十几位小数，一行根本放不下，
    // 面板里每条日志都要折成两三行（也就没法按固定行高做虚拟滚动了）。
    aiStore.addAgentLog(agentId, `决定: ${action} ${formatLogParameters(parameters)}`, 'info')
    // 记下这次决策的时刻——反应时间靠它算出下一次该什么时候重新决策
    runtime.lastDecisionAt = Date.now()
    return {
      agentId,
      action,
      parameters,
      confidence,
      timestamp: runtime.lastDecisionAt,
      // 时间线要展示的元数据：仿真时间、来源、当时的感知摘要
      simTime: aiStore.simulationTime,
      source: 'rule',
      agentName: agent.name,
      perception: {
        awareness,
        nearestObstacleDistance: sense.distance,
        obstaclesInRange: sense.count,
        blocked,
      },
    }
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

    // 记下这次动作——LLM 解释层与控制器都要拿它当上下文
    runtime.lastAction = decision.action
    runtime.lastParameters = { ...decision.parameters }

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

  /**
   * 把决策写进队列并执行——规则式与 LLM 两条路走的是**同一段代码**。
   *
   * 这一点很重要：LLM 只决定"往哪走"，位移照样由冲量控制器算、
   * 由 Rapier 积分。换控制器不会改变物理层的行为。
   */
  const applyDecision = (decision: AiDecision): void => {
    decisionQueue.value.push(decision)
    if (decisionQueue.value.length > 100) {
      decisionQueue.value = decisionQueue.value.slice(-50)
    }
    executeAgentDecision(decision)
  }

  /** 智能体当前状态的快照——喂给 LLM 的全部输入 */
  const buildSnapshot = (agentId: string): AgentSnapshot | null => {
    const object = agentObjects.get(agentId)
    const runtime = agentRuntimes.get(agentId)
    const agent = aiStore.agents.find((item) => item.id === agentId)
    if (!object || !runtime || !agent) return null

    const awareness = agent ? readAgentParams(agent).awareness : 10
    const sense = senseObstacles(object.position, awareness)

    const toGoal = runtime.goal.clone().sub(object.position)
    toGoal.y = 0
    const length = toGoal.length()
    const goalDirection: [number, number] =
      length > 1e-6 ? [toGoal.x / length, toGoal.z / length] : [0, 1]

    return {
      id: agent.id,
      name: agent.name,
      type: agent.type,
      position: [object.position.x, object.position.y, object.position.z],
      velocity: [runtime.velocity.x, runtime.velocity.y, runtime.velocity.z],
      goalDirection,
      goal: [runtime.goal.x, runtime.goal.y, runtime.goal.z],
      nearestObstacleDistance: sense.distance,
      obstaclesInRange: sense.count,
      awarenessRange: awareness,
      maxSpeed: LLM_MAX_SPEED,
      collided: runtime.blocked,
      lastAction: runtime.lastAction,
      lastParameters: runtime.lastParameters,
    }
  }

  /**
   * LLM 给的动作 → 仓库统一的决策结构。
   *
   * `snapshot` 是发出请求时抓到的那份感知快照，随决策一起带进时间线，
   * 这样「模型当时看到了什么」与「模型据此做了什么」能对上。
   */
  const toAiDecision = (
    agentId: string,
    action: LlmAction,
    snapshot?: AgentSnapshot,
  ): AiDecision => {
    const perception: AiDecision['perception'] = snapshot
      ? {
          awareness: snapshot.awarenessRange,
          nearestObstacleDistance: snapshot.nearestObstacleDistance,
          obstaclesInRange: snapshot.obstaclesInRange,
          blocked: snapshot.collided,
        }
      : undefined
    const base = {
      agentId,
      confidence: 0.8,
      timestamp: Date.now(),
      simTime: aiStore.simulationTime,
      source: 'llm' as const,
      agentName: aiStore.agents.find((item) => item.id === agentId)?.name,
      perception,
    }
    if (action.action === 'move' && action.direction) {
      // 难度同样作用在模型给的速度上（但不许超过系统的速度上限）
      const speed = Math.min((action.speed ?? 5) * difficultyFactors().speed, LLM_MAX_SPEED)
      return {
        ...base,
        action: 'move',
        parameters: {
          direction: [action.direction[0], 0, action.direction[1]],
          speed,
        },
      }
    }
    if (action.action === 'rotate') {
      return { ...base, action: 'rotate', parameters: { angle: action.angle ?? 0 } }
    }
    return { ...base, action: 'wait', parameters: {} }
  }

  /**
   * LLM 控制器的一拍。
   *
   * LLM 是**异步且慢**的（一次往返几秒），所以这里刻意不让它阻塞仿真：
   * - 有到货的决策 → 这一拍执行它
   * - 请求还在飞 → 这一拍什么都不做，智能体沿用上一次的期望速度
   * - 上次失败 → 这一拍回落到规则式，并把智能体标记为"已降级"
   *
   * ⚠️ 这一拍的五种结果都记进 aiStore 的计数器（llmTicks / llmApplied /
   * llmRejected / llmPending / llmFallbacks）——面板只读那些数字，
   * 「模型到底有没有在起作用」不能靠猜。
   *
   * @returns true 表示这一拍已经处理了（不需要再走规则式）
   */
  const handleLlmDecision = (agentId: string): boolean => {
    // 进了这个函数 = 这一拍有机会用 LLM（规则式模式根本到不了这里）
    aiStore.llmTicks += 1

    const ready = llmDecisions.get(agentId)
    if (ready) {
      llmDecisions.delete(agentId)
      applyDecision(ready)
      aiStore.llmApplied += 1
      return true
    }

    if (llmFallbacks.has(agentId)) {
      llmFallbacks.delete(agentId)
      // 规则式接管：这一拍由规则式控制器出主意
      aiStore.llmFallbacks += 1
      return false
    }

    if (llmInFlight.has(agentId)) {
      // 请求还在飞：这一拍什么都不做，智能体沿用上一次的期望速度
      aiStore.llmPending += 1
      return true
    }

    // 频率限制：LLM 再快也不该比这个频率更密
    const now = Date.now()
    if (now - lastLlmRequestAt < llmConfig.minIntervalMs) return true
    lastLlmRequestAt = now

    const snapshot = buildSnapshot(agentId)
    if (!snapshot) return true

    llmInFlight.add(agentId)
    llm
      .requestAction(snapshot)
      .then((action) => {
        llmInFlight.delete(agentId)
        if (!action) {
          // ⚠️ `!action` 同时覆盖两种情况：调用失败（网络/冷却/次数上限）
          // 与返回结果解析不过（厂商格式不匹配）。对控制器来说是同一件事——
          // 这一拍没有可用动作——所以都记在 `llmRejected` 上，
          // 这个数字的含义是「模型这一拍没给出可用动作」。
          aiStore.llmRejected += 1
          // 没拿到可用动作 → 这一拍回落到规则式，并把降级状态亮出来
          llmFallbacks.add(agentId)
          llm.markDegraded(llm.lastError || 'LLM 控制器不可用，已回落到规则式')
          return
        }
        llm.clearDegraded()
        // 快照是发请求时抓的，与这次动作一起进时间线
        llmDecisions.set(agentId, toAiDecision(agentId, action, snapshot))
      })
      .catch(() => {
        llmInFlight.delete(agentId)
        // 兜底路径：请求本身抛异常，同样是「这一拍没有可用动作」
        aiStore.llmRejected += 1
        llmFallbacks.add(agentId)
        llm.markDegraded('LLM 控制器调用异常，已回落到规则式')
      })
    return true
  }

  /**
   * 时间到：停止决策。
   *
   * 智能体被置为非运行态（停下），并留下一条「时间到」的日志。
   */
  const stopByTimeLimit = (timeLimit: number): void => {
    aiStore.activeAgents.forEach((agent) => {
      if (agent.status !== 'running') return
      agent.status = 'paused'
      aiStore.addAgentLog(agent.id, `时间到：已达 ${timeLimit} 秒上限，仿真停止`, 'warning')
    })
    // 整个仿真停下来——仿真开关回到「暂停」，界面与页脚状态才对得上
    aiStore.simulationActive = false
  }

  /** 决策循环：每 100ms 一拍，拍内依次处理时间上限、LLM 决策与规则式决策 */
  const startSimulationLoop = (): void => {
    stopSimulationLoop()
    let lastTime = Date.now()

    simulationTimer = setInterval(() => {
      const now = Date.now()
      const deltaTime = (now - lastTime) / 1000
      lastTime = now
      aiStore.simulationTime += deltaTime

      // 时间限制：到点就停止决策（0 表示不限制）
      const timeLimit = Number(aiStore.environmentSettings.timeLimit) || 0
      if (timeLimit > 0 && aiStore.simulationTime >= timeLimit) {
        stopByTimeLimit(timeLimit)
        return
      }

      aiStore.activeAgents.forEach((agent) => {
        if (agent.status !== 'running') return

        // LLM 控制器模式：只有用户显式切过去、且确实配了 key 才走这条路
        if (llm.mode === 'llm' && llm.configured) {
          if (handleLlmDecision(agent.id)) return
        }

        // 反应时间：每个智能体按自己的反应时间决定下一次重新决策的时刻。
        // 还没到点就沿用上一次的期望速度继续走。
        const runtime = agentRuntimes.get(agent.id)
        if (runtime && runtime.lastDecisionAt !== null) {
          const reactionMs = readAgentParams(agent).reactionTime * 1000
          if (now - runtime.lastDecisionAt < reactionMs) return
        }

        const decision = generateAgentDecision(agent.id)
        if (!decision) return
        applyDecision(decision)
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

  /**
   * 把所有智能体送回出生点。
   *
   * ⚠️ 重置必须真的复位物理状态——只把标志清掉的话，智能体会站在原地不动，
   * 看起来像"重置坏了"。位置、速度、目标点、期望速度、决策时刻一起复位。
   */
  const resetAgentsToSpawn = (): void => {
    for (const [agentId, runtime] of agentRuntimes) {
      const object = agentObjects.get(agentId)
      const body = runtime.body
      if (!object || !body) continue

      body.setTranslation({ x: runtime.spawn.x, y: runtime.spawn.y, z: runtime.spawn.z }, true)
      body.setLinvel({ x: 0, y: 0, z: 0 }, true)
      body.setAngvel({ x: 0, y: 0, z: 0 }, true)
      object.position.copy(runtime.spawn)

      runtime.velocity.set(0, 0, 0)
      runtime.desiredVelocity.set(0, 0, 0)
      runtime.heading = Math.atan2(-runtime.spawn.x, -runtime.spawn.z)
      runtime.goalIndex = runtime.spawnGoalIndex
      runtime.goal.copy(goalPosition(runtime.goalIndex))
      runtime.goalReached = false
      runtime.blocked = false
      // 重置 = 新一轮实验：里程与碰撞从零计
      runtime.pathLength = 0
      runtime.collisionCount = 0
      runtime.lastDecisionAt = null
      runtime.lastAction = undefined
      runtime.lastParameters = undefined
    }

    // 智能体回到出生点后，先释放旧的感知叠加物再按新位置重建——
    // 重置是新一轮实验，不留上一轮的几何体/材质引用
    disposePerceptionOverlays()
    syncPerceptionOverlays()
  }

  /** 清场：停掉决策循环，把智能体、障碍物、围墙从场景与物理世界里摘干净 */
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
    llmDecisions.clear()
    llmInFlight.clear()
    llmFallbacks.clear()
    lastLlmRequestAt = 0
    // 感知叠加层只属于渲染层：卸载时关掉并释放，开关回到默认关闭
    perceptionVisible.value = false
    disposePerceptionOverlays()
    accumulator.reset()
  }

  // 智能体增删 → 同步场景对象
  watch(
    () => aiStore.agents.map((agent) => agent.id).join('|'),
    () => syncScene(),
  )
  // 障碍物密度 / 种子变化 → 重建障碍物（换种子就是换场地）
  watch(
    () =>
      [
        aiStore.environmentSettings.obstaclesDensity,
        aiStore.environmentSettings.arenaSeed,
      ].join('|'),
    () => rebuildObstacles(),
  )
  // 重置令牌变化 → 把智能体送回出生点
  watch(
    () => aiStore.resetToken,
    () => resetAgentsToSpawn(),
  )
  // 场景就绪 → 补建智能体与障碍物
  watch(three.scene, (current) => {
    if (current) syncScene()
  })

  setupSimulationLoop()

  onMounted(() => initializeAiSystem())
  onUnmounted(() => cleanup())

  /**
   * 把当前场地导出成一份场景文档（障碍物 + 智能体）。
   *
   * 只做**低成本快照**：位置、旋转、尺寸都从场景对象与物理描述里读，
   * 不重新求解、不改动任何运行时状态。运行记录与评测台交接共用这份底稿。
   */
  const exportArenaSceneDocument = (): SceneDocument => {
    const now = new Date().toISOString()
    const objects: SceneDocumentObject[] = []

    arenaObstacles.forEach((obstacle, index) => {
      const mesh = obstacle.mesh
      const half = mesh.userData.physics?.halfExtents as
        | { x: number; y: number; z: number }
        | undefined
      // 障碍物的几何体本身就是 size×size×size，缩放为 1；文档里用 scale 表达尺寸
      const size = half
        ? { x: half.x * 2, y: half.y * 2, z: half.z * 2 }
        : { x: 1, y: 1, z: 1 }
      objects.push({
        uuid: `arena-obstacle-${index}`,
        type: 'cube',
        name: mesh.name || `障碍物 ${index + 1}`,
        position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
        rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
        scale: size,
        visible: true,
        color: 0x475569,
        physics: { type: 'static', shape: 'box', mass: 1 },
      })
    })

    for (const [agentId, runtime] of agentRuntimes) {
      const agent = aiStore.agents.find((item) => item.id === agentId)
      const type = agent?.type ?? 'basic'
      objects.push({
        uuid: arenaAgentUuid(agentId),
        type: 'cube',
        name: agent?.name ?? agentId,
        // 用出生点而不是当前位置：记录的是这一轮实验的初始布局
        position: { x: runtime.spawn.x, y: runtime.spawn.y, z: runtime.spawn.z },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: AGENT_SIZE, y: AGENT_SIZE, z: AGENT_SIZE },
        visible: true,
        color: AGENT_COLORS[type],
        physics: { type: 'dynamic', shape: 'box', mass: AGENT_MASS },
      })
    }

    return {
      id: `ai-arena-${Date.now().toString(36)}`,
      name: 'AI 实验室 · 实时演练场地',
      createdAt: now,
      updatedAt: now,
      version: 1,
      gravity: { ...simulationConfig.physics.defaultGravity },
      worldSize: ARENA_GROUND_HALF * 2,
      objects,
    }
  }

  /**
   * 把当前场地与智能体折成评测台交接数据。
   *
   * agents 的 uuid 与场景里的智能体物体共用同一个约定（arena-agent-<id>），
   * target 取每个智能体**当前**的目标点；场地与目标点都从运行时状态直接读出，
   * 不改动仿真。没有智能体时返回 null——评测台至少需要一只受控物体。
   */
  const exportArenaHandoff = (): AiLabHandoff | null => {
    const agents = Array.from(agentRuntimes.entries()).map(([agentId, runtime]) => ({
      uuid: arenaAgentUuid(agentId),
      target: { x: runtime.goal.x, z: runtime.goal.z },
    }))

    return buildArenaHandoff({
      scene: exportArenaSceneDocument(),
      agents,
      timeLimitSeconds: Number(aiStore.environmentSettings.timeLimit) || 0,
      label: '实时演练 · 当前场地',
    })
  }

  /** 指标快照：UI 指标条与日志导出都用它。纯数据，聚合在 agentMetrics.ts */
  const getMetricsSnapshot = (): AgentMetricInput[] =>
    Array.from(agentRuntimes.entries()).map(([agentId, runtime]) => {
      const agent = aiStore.agents.find((item) => item.id === agentId)
      const toGoal = runtime.goal.clone().sub(runtime.spawn)
      toGoal.y = 0
      return {
        agentId,
        agentName: agent?.name ?? agentId,
        goalReached: runtime.goalReached,
        collisionCount: runtime.collisionCount,
        pathLength: runtime.pathLength,
        straightDistance: toGoal.length(),
      }
    })

  return {
    decisionQueue,
    /** 感知可视化开关（模块级共享）：环 / 目标连线 / 障碍连线 / 朝向 */
    perceptionVisible,
    /** 打开或关闭感知可视化 */
    setPerceptionVisible,
    generateAgentDecision,
    executeAgentDecision,
    getAgentCurrentState,
    updateAgents,
    syncScene,
    initPhysics,
    /** 智能体当前状态快照——LLM 解释层用它当输入 */
    buildSnapshot,
    getMetricsSnapshot,
    /** 当前场地的场景文档快照——导出运行记录时顺带留档 */
    exportArenaSceneDocument,
    /** 实时演练 → 评测审计的交接数据（场地 + agents + 目标 + 回合上限） */
    exportArenaHandoff,
    cleanup,
  }
}
