import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// AI代理类型
export type AiAgentType = 'basic' | 'advanced' | 'custom'

// AI代理状态
export interface AiAgent {
  id: string
  name: string
  type: AiAgentType
  active: boolean
  parameters: Record<string, number | string | boolean>
  status: 'idle' | 'running' | 'paused' | 'error'
  logs: Array<{ timestamp: number; message: string; type: 'info' | 'warning' | 'error' }>
}

// 环境设置
export interface AiEnvironmentSettings {
  scenario: 'navigation' | 'interaction' | 'combat' | 'custom'
  difficulty: 'easy' | 'medium' | 'hard'
  timeLimit: number // 以秒为单位，0表示无限制
  winCondition: string
  obstaclesDensity: number // 0-1之间
}

export const useAiStore = defineStore('ai', () => {
  // 状态
  const agents = ref<AiAgent[]>([])
  const environmentSettings = ref<AiEnvironmentSettings>({
    scenario: 'navigation',
    difficulty: 'medium',
    timeLimit: 0,
    winCondition: '到达目标点',
    obstaclesDensity: 0.5
  })
  const simulationActive = ref(false)
  const simulationTime = ref(0) // 以秒为单位
  const selectedAgentId = ref<string | null>(null)

  // 计算属性
  const activeAgents = computed(() => agents.value.filter(agent => agent.active))
  const selectedAgent = computed(() =>
    selectedAgentId.value ? agents.value.find(agent => agent.id === selectedAgentId.value) : null
  )
  const scenarioOptions = computed(() => [
    { value: 'navigation', label: '导航挑战' },
    { value: 'interaction', label: '物体交互' },
    { value: 'combat', label: '对抗模拟' },
    { value: 'custom', label: '自定义场景' }
  ])

  // 方法
  // 创建新AI代理
  const createAgent = (name: string, type: AiAgentType = 'basic'): AiAgent => {
    const newAgent: AiAgent = {
      id: `agent-${Date.now()}`,
      name,
      type,
      active: true,
      parameters: getDefaultParametersForType(type),
      status: 'idle',
      logs: []
    }

    agents.value.push(newAgent)

    if (agents.value.length === 1) {
      selectedAgentId.value = newAgent.id
    }

    return newAgent
  }

  // 根据代理类型获取默认参数
  const getDefaultParametersForType = (type: AiAgentType): Record<string, number | string | boolean> => {
    switch (type) {
      case 'basic':
        return {
          speed: 5,
          reactionTime: 0.5,
          awarenessRange: 10,
          avoidObstacles: true
        }
      case 'advanced':
        return {
          speed: 7,
          reactionTime: 0.2,
          awarenessRange: 15,
          avoidObstacles: true,
          learningEnabled: true,
          memoryRetention: 60, // 秒
          teamwork: false
        }
      case 'custom':
        return {
          // 自定义代理的默认参数
        }
      default:
        return {}
    }
  }

  // 移除AI代理
  const removeAgent = (id: string) => {
    agents.value = agents.value.filter(agent => agent.id !== id)

    if (selectedAgentId.value === id) {
      selectedAgentId.value = agents.value.length > 0 ? agents.value[0].id : null
    }
  }

  // 启动仿真
  const startSimulation = () => {
    simulationActive.value = true
    simulationTime.value = 0

    // 重置所有代理状态
    agents.value.forEach(agent => {
      agent.status = 'running'
      agent.logs.push({
        timestamp: Date.now(),
        message: '仿真开始',
        type: 'info'
      })
    })
  }

  // 暂停仿真
  const pauseSimulation = () => {
    simulationActive.value = false

    agents.value.forEach(agent => {
      if (agent.status === 'running') {
        agent.status = 'paused'
        agent.logs.push({
          timestamp: Date.now(),
          message: '仿真暂停',
          type: 'info'
        })
      }
    })
  }

  // 重置仿真
  const resetSimulation = () => {
    simulationActive.value = false
    simulationTime.value = 0

    agents.value.forEach(agent => {
      agent.status = 'idle'
      agent.logs.push({
        timestamp: Date.now(),
        message: '仿真重置',
        type: 'info'
      })
    })
  }

  // 更新代理参数
  const updateAgentParameters = (id: string, parameters: Record<string, number | string | boolean>) => {
    const agent = agents.value.find(a => a.id === id)
    if (agent) {
      agent.parameters = { ...agent.parameters, ...parameters }
      agent.logs.push({
        timestamp: Date.now(),
        message: '参数已更新',
        type: 'info'
      })
    }
  }

  // 添加代理日志
  const addAgentLog = (id: string, message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    const agent = agents.value.find(a => a.id === id)
    if (agent) {
      agent.logs.push({
        timestamp: Date.now(),
        message,
        type
      })

      // 限制日志数量，保持性能
      if (agent.logs.length > 100) {
        agent.logs.shift()
      }
    }
  }

  // 更新环境设置
  const updateEnvironmentSettings = (settings: Partial<AiEnvironmentSettings>) => {
    environmentSettings.value = { ...environmentSettings.value, ...settings }
  }

  // 初始化默认代理
  const initializeDefaultAgents = () => {
    if (agents.value.length === 0) {
      createAgent('导航机器人', 'basic')
    }
  }

  return {
    agents,
    environmentSettings,
    simulationActive,
    simulationTime,
    selectedAgentId,
    activeAgents,
    selectedAgent,
    scenarioOptions,
    createAgent,
    removeAgent,
    startSimulation,
    pauseSimulation,
    resetSimulation,
    updateAgentParameters,
    addAgentLog,
    updateEnvironmentSettings,
    initializeDefaultAgents
  }
})
