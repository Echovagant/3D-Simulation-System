// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import * as THREE from 'three'
import { useAiStore } from '@/stores/aiStore'
import { useThree } from './useThree'
import { useAI } from './useAI'
import type { AiDecision } from '@/types'

type AIApi = ReturnType<typeof useAI>

const AGENT_MESH_PREFIX = 'ai-agent-'
const OBSTACLE_MESH_PREFIX = 'ai-obstacle-'

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

describe('useAI —— 智能体与场景的真实联动', () => {
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

  it('getAgentCurrentState 返回的是场景对象的真实坐标，而不是随机数', () => {
    const api = mountAI()
    api.syncScene()

    const store = useAiStore()
    const agent = store.agents[0]
    const mesh = findAgentMesh(agent.id)
    expect(mesh).not.toBeNull()

    mesh!.position.set(3.5, 0.4, -7.25)

    const state = api.getAgentCurrentState(agent.id)
    expect(state.position).toEqual([3.5, 0.4, -7.25])
    expect(state.id).toBe(agent.id)
  })

  it('executeAgentDecision 的 move 分支真的推动场景对象移动', () => {
    const api = mountAI()
    api.syncScene()

    const store = useAiStore()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!
    mesh.position.set(0, 0.4, 0)

    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [1, 0, 0], speed: 5 }))
    api.updateAgents(0.5)

    // 速度 5 m/s × 0.5 s = 2.5 m
    expect(mesh.position.x).toBeCloseTo(2.5, 5)
    expect(mesh.position.z).toBeCloseTo(0, 5)
  })

  it('executeAgentDecision 的 rotate 分支把智能体掉头（两次 180° 转向产生相反位移）', () => {
    const api = mountAI()
    api.syncScene()

    const store = useAiStore()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!
    const start = new THREE.Vector3(0, 0.4, 0)
    mesh.position.copy(start)

    // 先用 move 把朝向钉在 +Z
    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [0, 0, 1], speed: 5 }))
    api.updateAgents(0.5)
    const firstStep = mesh.position.clone().sub(start)

    // 再转 180°，应当朝反方向走
    api.executeAgentDecision(makeDecision(agent.id, 'rotate', { angle: Math.PI }))
    api.updateAgents(0.5)
    const secondStep = mesh.position.clone().sub(start).sub(firstStep)

    expect(firstStep.z).toBeGreaterThan(0)
    expect(secondStep.z).toBeLessThan(0)
    expect(firstStep.dot(secondStep)).toBeLessThan(0)
  })

  it('proximity 感知与场景里的障碍物几何一致（不是随机数）', () => {
    const api = mountAI()
    api.syncScene()

    const store = useAiStore()
    const agent = store.agents[0]
    const mesh = findAgentMesh(agent.id)!
    const obstacles = findObstacleMeshes()
    expect(obstacles.length).toBeGreaterThan(0)

    const state = api.getAgentCurrentState(agent.id)
    const data = state.sensors.proximity.data as { obstacles: number; distance: number }

    const distances = obstacles.map((obstacle) =>
      new THREE.Box3().setFromObject(obstacle).distanceToPoint(mesh.position),
    )
    expect(data.distance).toBeCloseTo(Math.min(...distances), 4)

    const range = Number(agent.parameters.awarenessRange) || 10
    expect(data.obstacles).toBe(distances.filter((distance) => distance <= range).length)
  })

  it('智能体撞上障碍物时不会穿过去（哪怕一步跨过整个障碍物）', () => {
    const api = mountAI()
    api.syncScene()

    const store = useAiStore()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!

    const obstacle = findObstacleMeshes()[0]
    const box = new THREE.Box3().setFromObject(obstacle)
    const center = box.getCenter(new THREE.Vector3())
    const obstacleWidth = box.max.x - box.min.x

    // 一步跨过整个障碍物还多出 3 米——没有子步化的话，智能体会直接传到障碍物另一侧
    const stepDistance = obstacleWidth + 3
    const speed = stepDistance / 0.5
    mesh.position.set(box.min.x - 1.5, 0.4, center.z)
    api.executeAgentDecision(makeDecision(agent.id, 'move', { direction: [1, 0, 0], speed }))

    for (let step = 0; step < 10; step += 1) {
      api.updateAgents(0.5)
      // 不能停在障碍物内部
      expect(box.containsPoint(mesh.position)).toBe(false)
      // 也不能直接传到障碍物另一侧（那说明碰撞检测被跳过了）
      expect(mesh.position.x).toBeLessThan(box.max.x)
    }
  })

  it('挂载时仿真已经开启，决策循环也会启动（immediate 的回归保护）', () => {
    vi.useFakeTimers()

    const store = useAiStore()
    store.simulationActive = true

    const api = mountAI()
    api.syncScene()
    const agent = store.agents[0]
    agent.status = 'running'

    vi.advanceTimersByTime(500)

    expect(store.simulationTime).toBeGreaterThan(0)
    expect(agent.logs.length).toBeGreaterThan(0)
    expect(agent.logs.some((log) => log.message.startsWith('决定:'))).toBe(true)
  })

  it('仿真运行时智能体确实在场景里移动（决策 → 执行 → 位置变化）', () => {
    vi.useFakeTimers()

    const store = useAiStore()
    store.simulationActive = true

    const api = mountAI()
    api.syncScene()
    const agent = store.agents[0]
    agent.status = 'running'
    const mesh = findAgentMesh(agent.id)!
    const start = mesh.position.clone()

    vi.advanceTimersByTime(200)
    api.updateAgents(0.2)

    expect(mesh.position.distanceTo(start)).toBeGreaterThan(0)
  })

  it('移除智能体后对应的场景对象也被移除', () => {
    const api = mountAI()
    api.syncScene()

    const store = useAiStore()
    const agent = store.agents[0]
    expect(findAgentMesh(agent.id)).not.toBeNull()

    store.removeAgent(agent.id)
    api.syncScene()

    expect(findAgentMesh(agent.id)).toBeNull()
  })
})
