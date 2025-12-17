import { ref, watch, onMounted, onUnmounted } from 'vue'
import { useAiStore } from '@/stores/aiStore'
// import { useThree } from './useThree' // 注释未使用的导入
// import { useSimulation } from './useSimulation' // 注释未使用的导入
import type { AiDecision, AiAgentState } from '@/types'

export function useAI() {
  const aiStore = useAiStore()
  // const { scene, camera, renderer } = useThree() // 注释未使用的解构
  // const { physicsWorld } = useSimulation() // 注释报错的解构

  const decisionQueue = ref<AiDecision[]>([])
  let simulationTimer: NodeJS.Timeout | null = null

  const initializeAiSystem = () => {
    aiStore.initializeDefaultAgents()
    setupSimulationLoop()
  }

  const setupSimulationLoop = () => {
    watch(
      () => aiStore.simulationActive,
      (isActive) => {
        if (isActive) startSimulationLoop()
        else if (simulationTimer) clearInterval(simulationTimer)
      }
    )
  }

  const startSimulationLoop = () => {
    if (simulationTimer) clearInterval(simulationTimer)
    const lastTime = ref(Date.now())

    simulationTimer = setInterval(() => {
      const deltaTime = (Date.now() - lastTime.value) / 1000
      lastTime.value = Date.now()
      aiStore.simulationTime += deltaTime

      aiStore.activeAgents.forEach(agent => {
        if (agent.status === 'running') {
          const decision = generateAgentDecision(agent.id)
          if (decision) decisionQueue.value.push(decision)
        }
      })

      if (decisionQueue.value.length > 100)
        decisionQueue.value = decisionQueue.value.slice(-50)
    }, 100)
  }

  const generateAgentDecision = (agentId: string): AiDecision | null => {
    const agent = aiStore.agents.find(a => a.id === agentId)
    if (!agent) return null

    const agentState = getAgentCurrentState(agentId)
    let action: 'move' | 'rotate' | 'interact' | 'wait' = 'wait'
    let parameters: Record<string, any> = {}

    switch (agent.type) {
      case 'basic':
        action = 'move'
        parameters = {
          direction: [Math.random() * 2 - 1, 0, Math.random() * 2 - 1],
          speed: agent.parameters.speed || 5
        }
        break
      case 'advanced':
        const random = Math.random()
        if (random < 0.7) {
          action = 'move'
          parameters = {
            direction: [Math.sin(Date.now() / 1000), 0, Math.cos(Date.now() / 1000)],
            speed: agent.parameters.speed || 7
          }
        } else if (random < 0.9) {
          action = 'rotate'
          parameters = { angle: Math.random() * Math.PI / 2 }
        }
        break
      case 'custom':
        action = 'move'
        parameters = { direction: [0, 0, 1], speed: 3 }
        break
    }

    aiStore.addAgentLog(agentId, `决定: ${action} ${JSON.stringify(parameters)}`, 'info')
    return { agentId, action, parameters, confidence: Math.random() * 0.5 + 0.5, timestamp: Date.now() }
  }

  const getAgentCurrentState = (agentId: string): AiAgentState => ({
    id: agentId,
    position: [Math.random() * 10 - 5, 0, Math.random() * 10 - 5],
    rotation: [0, Math.random() * Math.PI * 2, 0],
    velocity: [0, 0, 0],
    status: 'normal',
    sensors: {
      proximity: {
        type: 'proximity',
        data: { obstacles: Math.floor(Math.random() * 3), distance: Math.random() * 5 + 1 },
        timestamp: Date.now()
      }
    }
  })

  const executeAgentDecision = (decision: AiDecision) => {
    switch (decision.action) {
      case 'move': break
      case 'rotate': break
      case 'interact': break
      case 'wait': break
    }
  }

  const cleanup = () => {
    if (simulationTimer) {
      clearInterval(simulationTimer)
      simulationTimer = null
    }
  }

  onMounted(() => initializeAiSystem())
  onUnmounted(() => cleanup())

  return { decisionQueue, generateAgentDecision, executeAgentDecision, getAgentCurrentState, cleanup }
}
