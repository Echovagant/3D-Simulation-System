// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h, nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import * as THREE from 'three'
import { useAiStore } from '@/stores/aiStore'
import { useLlmStore } from '@/stores/llmStore'
import { useThree } from './useThree'
import { useAI } from './useAI'
import type { AiDecision } from '@/types'

type AIApi = ReturnType<typeof useAI>

const AGENT_MESH_PREFIX = 'ai-agent-'
const OBSTACLE_MESH_PREFIX = 'ai-obstacle-'
/** 场地半边长（米） */
const ARENA_HALF_SIZE = 24

let wrapper: VueWrapper | null = null

/** 挂载一个只调用 useAI 的宿主组件（composable 需要组件上下文才能用 onMounted） */
const mountAI = (): AIApi => {
  let api!: AIApi
  wrapper = mount(
    defineComponent({
      setup() {
        api = useAI()
        return () => h('div')
      },
    }),
  )
  return api
}

/** 从场景里按名字取智能体网格 */
const findAgentMesh = (agentId: string): THREE.Object3D | null => {
  const scene = useThree().scene.value
  return scene ? (scene.getObjectByName(`${AGENT_MESH_PREFIX}${agentId}`) ?? null) : null
}

/** 场景里的全部障碍物网格 */
const findObstacleMeshes = (): THREE.Object3D[] => {
  const scene = useThree().scene.value
  if (!scene) return []
  const result: THREE.Object3D[] = []
  scene.traverse((object) => {
    if (object.name.startsWith(OBSTACLE_MESH_PREFIX)) result.push(object)
  })
  return result
}

const makeDecision = (
  agentId: string,
  action: AiDecision['action'],
  parameters: Record<string, unknown>,
): AiDecision => ({
  agentId,
  action,
  parameters,
  confidence: 1,
  timestamp: Date.now(),
})

/**
 * 起一个演武场。
 *
 * @param density 障碍物密度（0 = 空场地，方便断言纯运动学）
 */
const setupArena = async (density = 0): Promise<{ api: AIApi; store: ReturnType<typeof useAiStore> }> => {
  const store = useAiStore()
  store.updateEnvironmentSettings({ obstaclesDensity: density })
  await nextTick()

  const api = mountAI()
  await api.initPhysics()
  return { api, store }
}

/** 推进仿真若干秒（按固定步长喂真实时间） */
const advance = (api: AIApi, seconds: number): void => {
  const steps = Math.round(seconds * 60)
  for (let i = 0; i < steps; i += 1) api.updateAgents(1 / 60)
}

/** 造一个最小可用的 Response 替身（LLM 客户端会读 choices[0].message.content） */
const jsonResponse = (content: string): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    headers: { get: () => null },
    json: async () => ({ id: 'r1', choices: [{ message: { content } }] }),
    text: async () => '',
  }) as unknown as Response

describe('useAI —— 智能体跑在 Rapier 真物理上', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    const three = useThree()
    three.disposeThree()
    three.initThree()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
  })

  it('智能体是真正的动态刚体：有质量、位置来自物理世界', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    const mesh = findAgentMesh(agent.id)!

    const body = mesh.userData.physics?.body
    expect(body).toBeTruthy()
    expect(body.isDynamic()).toBe(true)
    // 质量是 2 千克（由密度 × 碰撞体体积反推）
    expect(body.mass()).toBeCloseTo(2, 1)

    // 网格位置是刚体的镜像：改刚体，网格跟着走
    body.setTranslation({ x: 3.5, y: 0.4, z: -7.25 }, true)
    api.updateAgents(1 / 60)
    expect(mesh.position.x).toBeCloseTo(3.5, 3)
    expect(mesh.position.z).toBeCloseTo(-7.25, 3)
  })

  it('executeAgentDecision 的 move 分支真的推动智能体沿期望方向移动', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!
    const start = mesh.position.clone()

    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [1, 0, 0], speed: 5 }))
    advance(api, 1)

    expect(mesh.position.x - start.x).toBeGreaterThan(3)
    expect(mesh.position.z - start.z).toBeCloseTo(0, 1)
  })

  it('executeAgentDecision 的 rotate 分支把智能体掉头（两次相反朝向产生相反位移）', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!
    const start = mesh.position.clone()

    // 先用 move 把朝向钉在 +Z
    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [0, 0, 1], speed: 5 }))
    advance(api, 1)
    const firstStep = mesh.position.clone().sub(start)

    // 再转 180°，应当朝反方向走
    api.executeAgentDecision(makeDecision(agent.id, 'rotate', { angle: Math.PI }))
    advance(api, 1)
    const secondStep = mesh.position.clone().sub(start).sub(firstStep)

    expect(firstStep.z).toBeGreaterThan(0)
    expect(secondStep.z).toBeLessThan(0)
    expect(firstStep.dot(secondStep)).toBeLessThan(0)
  })

  it('智能体撞上障碍物时不会被穿过去（碰撞由物理引擎的接触求解器处理）', async () => {
    const { api, store } = await setupArena(0.5)
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!

    const obstacles = findObstacleMeshes()
    expect(obstacles.length).toBeGreaterThan(0)
    const obstacle = obstacles[0]
    const box = new THREE.Box3().setFromObject(obstacle)

    // 朝障碍物中心冲过去
    const direction = obstacle.position.clone().sub(mesh.position)
    direction.y = 0
    direction.normalize()
    api.executeAgentDecision(
      makeDecision(agent.id, 'move', { direction: [direction.x, 0, direction.z], speed: 8 }),
    )

    let minSpeed = Number.POSITIVE_INFINITY
    for (let i = 0; i < 240; i += 1) {
      api.updateAgents(1 / 60)
      // 一步都不能进到障碍物内部
      expect(box.containsPoint(mesh.position)).toBe(false)
      const velocity = mesh.userData.physics.body.linvel()
      minSpeed = Math.min(minSpeed, Math.hypot(velocity.x, velocity.z))
    }

    // 撞上的那一刻，物理引擎吃掉了正对着障碍物的速度分量
    expect(minSpeed).toBeLessThan(8 * 0.8)
  })

  it('撞上障碍物时状态变成 collided（信号来自接触流形，不是坐标判定）', async () => {
    const { api, store } = await setupArena(0.5)
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!

    const obstacle = findObstacleMeshes()[0]
    const direction = obstacle.position.clone().sub(mesh.position)
    direction.y = 0
    direction.normalize()
    api.executeAgentDecision(
      makeDecision(agent.id, 'move', { direction: [direction.x, 0, direction.z], speed: 8 }),
    )

    let sawCollision = false
    for (let i = 0; i < 240; i += 1) {
      api.updateAgents(1 / 60)
      if (api.getAgentCurrentState(agent.id).status === 'collided') sawCollision = true
    }
    expect(sawCollision).toBe(true)
  })

  it('proximity 感知来自物理引擎：与碰撞体自己算出来的距离一致', async () => {
    const { api, store } = await setupArena(0.5)
    const agent = store.agents[0]
    const mesh = findAgentMesh(agent.id)!

    const state = api.getAgentCurrentState(agent.id)
    const data = state.sensors.proximity.data as { obstacles: number; distance: number }

    // 用碰撞体独立算一遍最近距离与视野内数量
    const distances = findObstacleMeshes().map((obstacle) => {
      const collider = obstacle.userData.physics.collider
      const projection = collider.projectPoint(mesh.position, true)
      return Math.hypot(
        projection.point.x - mesh.position.x,
        projection.point.y - mesh.position.y,
        projection.point.z - mesh.position.z,
      )
    })
    const range = Number(agent.parameters.awarenessRange) || 10

    expect(data.distance).toBeCloseTo(Math.min(...distances), 3)
    expect(data.obstacles).toBe(distances.filter((distance) => distance <= range).length)
  })

  it('固定步长：同样的总时间，切成不同步数推进的结果完全一致', async () => {
    // 第一遍：60 次 1/60 秒
    const first = await setupArena()
    const agent1 = first.store.agents[0]
    agent1.status = 'running'
    const mesh1 = findAgentMesh(agent1.id)!
    first.api.executeAgentDecision(makeDecision(agent1.id, 'move', { direction: [1, 0, 0], speed: 5 }))
    for (let i = 0; i < 60; i += 1) first.api.updateAgents(1 / 60)
    const fine = mesh1.position.clone()

    // 拆掉重来：换一个全新的物理世界，避免求解器的热启动状态干扰对比
    wrapper?.unmount()
    wrapper = null

    // 第二遍：30 次 1/30 秒（同样是一秒，但一步顶两步）
    const second = await setupArena()
    const agent2 = second.store.agents[0]
    agent2.status = 'running'
    const mesh2 = findAgentMesh(agent2.id)!
    second.api.executeAgentDecision(makeDecision(agent2.id, 'move', { direction: [1, 0, 0], speed: 5 }))
    for (let i = 0; i < 30; i += 1) second.api.updateAgents(1 / 30)
    const coarse = mesh2.position.clone()

    // 步数相同 → 轨迹逐位相同：仿真速度与显示帧率无关
    expect(coarse.x).toBeCloseTo(fine.x, 6)
    expect(coarse.z).toBeCloseTo(fine.z, 6)
  })

  it('围墙把智能体挡在场地里（边界由碰撞体守住）', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!

    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [1, 0, 0], speed: 8 }))
    advance(api, 12)

    // 墙的内表面在 x = 23.75，智能体半宽 0.4 → 中心最多到 23.35 附近
    expect(mesh.position.x).toBeLessThan(ARENA_HALF_SIZE)
    expect(mesh.position.x).toBeGreaterThan(ARENA_HALF_SIZE - 1.5)
  })

  it('暂停时智能体会停下来', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!

    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [1, 0, 0], speed: 5 }))
    advance(api, 1)
    const before = mesh.position.clone()

    agent.status = 'paused'
    advance(api, 1)

    expect(mesh.position.distanceTo(before)).toBeLessThan(1)
  })

  it('空场地（障碍物密度 0）时感知不炸——Rapier 的全局投影查询在"过滤器全拒"时会 panic', async () => {
    const { api, store } = await setupArena(0)
    const agent = store.agents[0]

    const state = api.getAgentCurrentState(agent.id)
    const data = state.sensors.proximity.data as { obstacles: number; distance: number }
    expect(data.obstacles).toBe(0)
    expect(data.distance).toBe(999)

    // 喂给 LLM 的快照也不能炸
    const snapshot = api.buildSnapshot(agent.id)
    expect(snapshot).not.toBeNull()
    expect(snapshot?.nearestObstacleDistance).toBe(999)
  })

  it('移除智能体后对应的场景对象与刚体一起被移除', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    const mesh = findAgentMesh(agent.id)
    expect(mesh).not.toBeNull()
    const body = mesh!.userData.physics.body

    store.removeAgent(agent.id)
    api.syncScene()

    expect(findAgentMesh(agent.id)).toBeNull()
    expect(body.isValid()).toBe(false)
  })

  it('LLM 控制器模式下动作来自模型，而不是规则式', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    agent.status = 'running'

    const llm = useLlmStore()
    llm.applyKey('unit-test-key')
    llm.mode = 'llm'

    // 模型说"转 180 度"——空场地里规则式只会说 move，所以出现 rotate 就证明动作来自模型
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse('{"action":"rotate","angle":3.14159}')),
    )

    // ⚠️ 假时钟必须在决策循环创建**之前**换上：循环是 setInterval，
    // 之后再换假时钟，那个真实的定时器不会被接管。
    vi.useFakeTimers()
    store.simulationActive = true
    await nextTick()

    await vi.advanceTimersByTimeAsync(150) // 决策循环跑一拍 → 发出请求
    await vi.advanceTimersByTimeAsync(150) // 模型回复到货 → 下一拍执行

    expect(api.decisionQueue.value.some((decision) => decision.action === 'rotate')).toBe(true)
    vi.unstubAllGlobals()
  })

  it('LLM 调用失败时自动回落到规则式，智能体照样动', async () => {
    const { api, store } = await setupArena()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!

    const llm = useLlmStore()
    llm.applyKey('unit-test-key')
    llm.mode = 'llm'
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down')
      }),
    )

    vi.useFakeTimers()
    store.simulationActive = true
    await nextTick()

    await vi.advanceTimersByTimeAsync(150)
    await vi.advanceTimersByTimeAsync(150)

    // 降级状态被点亮
    expect(llm.degraded).toBe(true)
    // 规则式接管：智能体继续朝目标点走
    expect(api.decisionQueue.value.some((decision) => decision.action === 'move')).toBe(true)
    const before = mesh.position.clone()
    vi.useRealTimers()
    advance(api, 1)
    expect(mesh.position.distanceTo(before)).toBeGreaterThan(0)
    vi.unstubAllGlobals()
  })

  it('挂载时仿真已经开启，决策循环也会启动（immediate 的回归保护）', async () => {
    // ⚠️ 假时钟必须在挂载**之前**换上：决策循环是在 setup 里用 setInterval 建的，
    // 之后再换假时钟，那个真实的定时器不会被接管。
    vi.useFakeTimers()

    const store = useAiStore()
    store.simulationActive = true

    const api = mountAI()
    await api.initPhysics()
    const agent = store.agents[0]
    agent.status = 'running'

    vi.advanceTimersByTime(500)

    expect(store.simulationTime).toBeGreaterThan(0)
    expect(agent.logs.length).toBeGreaterThan(0)
    expect(agent.logs.some((log) => log.message.startsWith('决定:'))).toBe(true)
  })

  it('仿真运行时智能体确实在场景里移动（决策 → 执行 → 位置变化）', async () => {
    vi.useFakeTimers()

    const store = useAiStore()
    store.simulationActive = true

    const api = mountAI()
    await api.initPhysics()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!
    const start = mesh.position.clone()

    vi.advanceTimersByTime(200)
    vi.useRealTimers()
    api.updateAgents(0.2)

    expect(mesh.position.distanceTo(start)).toBeGreaterThan(0)
  })
})
