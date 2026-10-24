import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// AI代理类型
export type AiAgentType = 'basic' | 'advanced' | 'custom'

/**
 * 智能体 id 的序号。
 *
 * ⚠️ 毫秒时间戳在**同一毫秒内**会重复——连点两次「添加代理」就会撞 id，
 * 于是 selectedAgentId 只指向其中一个、removeAgent 一次删掉两个。
 * 序号在模块作用域里单调递增，保证 id 全局唯一。
 */
let agentSequence = 0

/**
 * 单个代理的日志上限。
 *
 * ⚠️ 面板要把所有代理的日志合起来渲染，条数不封顶的话，
 * 代理一多，面板就会重到拖不动（实测 3 个代理就能堆出 200 多行）。
 */
const MAX_AGENT_LOGS = 100

/** 日志序号：全局单调递增，给面板当稳定的 key 用 */
let logSequence = 0

/** 胜利条件——当前只实现了一种，用字面量类型挡住无法判定的自由文本 */
export type AiWinCondition = '到达目标点'

// AI代理状态
export interface AiAgentLog {
  /**
   * 稳定序号——面板渲染时当 key 用。
   *
   * ⚠️ 时间戳不能当 key：同一毫秒里可能写进好几条日志，
   * 而日志列表是按时间排序的，排序一变，按下标做的 key 就整片错位，
   * Vue 会把每一行都当成新行重建。
   */
  seq: number
  timestamp: number
  message: string
  type: 'info' | 'warning' | 'error'
}

export interface AiAgent {
  id: string
  name: string
  type: AiAgentType
  active: boolean
  parameters: Record<string, number | string | boolean>
  status: 'idle' | 'running' | 'paused' | 'error'
  logs: AiAgentLog[]
}

// 环境设置
export interface AiEnvironmentSettings {
  scenario: 'navigation' | 'interaction' | 'combat' | 'custom'
  difficulty: 'easy' | 'medium' | 'hard'
  timeLimit: number // 以秒为单位，0表示无限制
  winCondition: AiWinCondition
  obstaclesDensity: number // 0-1之间
}

/** 场景类型选项 */
export interface ScenarioOption {
  value: AiEnvironmentSettings['scenario']
  label: string
  /** 系统**真的实现了**这个场景吗——没实现的不会出现在界面下拉里 */
  available: boolean
}

/**
 * 根据代理类型获取默认参数。
 * 纯函数，放在模块级以便直接单测。
 */
export const getDefaultParametersForType = (
  type: AiAgentType
): Record<string, number | string | boolean> => {
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
  /**
   * 重置令牌：每次 resetSimulation 自增。
   *
   * 物理层（刚体位置、目标点、期望速度）不在 store 里，
   * 靠这个令牌通知 useAI 把智能体真的送回出生点——只清标志不算重置。
   */
  const resetToken = ref(0)

  /**
   * LLM 决策的拍数计数——「模型到底有没有在起作用」的唯一可观测口径。
   *
   * ⚠️ 口径（动这些数字之前先想清楚，界面与测试都按这套口径断言）：
   * - `llmTicks`：每一拍**有机会**用 LLM 的次数。只在 LLM 模式且确实进了
   *   控制器的 LLM 一拍时递增——规则式模式下恒为 0。
   * - `llmApplied`：真正执行了模型给出的动作的拍数。
   * - `llmRejected`：模型这一拍**没给出可用动作**的拍数（含调用失败与返回解析不过）。
   * - `llmPending`：请求还在飞、这一拍什么都没做的拍数。
   * - `llmFallbacks`：上一次失败导致这一拍回落到规则式的拍数。
   *
   * ⚠️ 只有控制器（useAI）写这些数字，界面只读。
   */
  const llmTicks = ref(0)
  const llmApplied = ref(0)
  const llmRejected = ref(0)
  const llmPending = ref(0)
  const llmFallbacks = ref(0)

  // 计算属性
  const activeAgents = computed(() => agents.value.filter(agent => agent.active))
  /**
   * 生效拍数占比（0 ~ 1）。
   *
   * ⚠️ 一拍都还没有时返回 `null`，界面据此显示「—」——
   * 直接做除法会得到 NaN，界面不能出现 NaN。
   */
  const llmApplyRatio = computed<number | null>(() =>
    llmTicks.value === 0 ? null : llmApplied.value / llmTicks.value,
  )
  const selectedAgent = computed(() =>
    selectedAgentId.value ? agents.value.find(agent => agent.id === selectedAgentId.value) : null
  )
  /**
   * 场景类型清单。
   *
   * `available` 标出系统**真的实现了**的场景：目前只有导航挑战。
   * 物体交互与对抗模拟需要的机制（智能体间交互、对抗）并不存在，
   * 因此它们不会出现在界面下拉里——留着能选却不生效的选项比没有更糟。
   */
  const scenarioOptions = computed<ScenarioOption[]>(() => [
    { value: 'navigation', label: '导航挑战', available: true },
    { value: 'interaction', label: '物体交互', available: false },
    { value: 'combat', label: '对抗模拟', available: false },
    { value: 'custom', label: '自定义场景', available: false }
  ])
  /** 界面上可以真的选到的场景类型 */
  const selectableScenarioOptions = computed(() =>
    scenarioOptions.value.filter(option => option.available)
  )

  // 方法

  /**
   * 往某个代理的日志里追加一条——所有写日志的地方都走这里。
   *
   * ⚠️ 上限在这里统一管：每条日志最终都要进面板的 DOM，
   * 不封顶的话代理一多，面板就会重到拖不动。
   */
  const appendLog = (
    agent: AiAgent,
    message: string,
    type: 'info' | 'warning' | 'error'
  ): void => {
    agent.logs.push({ seq: logSequence++, timestamp: Date.now(), message, type })
    if (agent.logs.length > MAX_AGENT_LOGS) {
      agent.logs.shift()
    }
  }

  // 创建新AI代理
  const createAgent = (name: string, type: AiAgentType = 'basic'): AiAgent => {
    const newAgent: AiAgent = {
      id: `agent-${Date.now()}-${agentSequence++}`,
      name,
      type,
      active: true,
      parameters: getDefaultParametersForType(type),
      // 仿真进行中新建的代理直接进入运行态——否则它永远停在原地，
      // 而界面上没有单个代理的启动开关。
      status: simulationActive.value ? 'running' : 'idle',
      logs: []
    }

    agents.value.push(newAgent)

    if (agents.value.length === 1) {
      selectedAgentId.value = newAgent.id
    }

    return newAgent
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
      appendLog(agent, '仿真开始', 'info')
    })
  }

  // 暂停仿真
  const pauseSimulation = () => {
    simulationActive.value = false

    agents.value.forEach(agent => {
      if (agent.status === 'running') {
        agent.status = 'paused'
        appendLog(agent, '仿真暂停', 'info')
      }
    })
  }

  // 重置仿真
  const resetSimulation = () => {
    simulationActive.value = false
    simulationTime.value = 0
    // 通知物理层把智能体送回出生点
    resetToken.value += 1
    // LLM 拍数统计一起归零：重置之后界面上的占比不能还指着上一段仿真
    llmTicks.value = 0
    llmApplied.value = 0
    llmRejected.value = 0
    llmPending.value = 0
    llmFallbacks.value = 0

    agents.value.forEach(agent => {
      agent.status = 'idle'
      appendLog(agent, '仿真重置', 'info')
    })
  }

  // 更新代理参数
  const updateAgentParameters = (id: string, parameters: Record<string, number | string | boolean>) => {
    const agent = agents.value.find(a => a.id === id)
    if (agent) {
      agent.parameters = { ...agent.parameters, ...parameters }
      appendLog(agent, '参数已更新', 'info')
    }
  }

  // 添加代理日志
  const addAgentLog = (id: string, message: string, type: 'info' | 'warning' | 'error' = 'info') => {
    const agent = agents.value.find(a => a.id === id)
    if (agent) {
      appendLog(agent, message, type)
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
    resetToken,
    llmTicks,
    llmApplied,
    llmRejected,
    llmPending,
    llmFallbacks,
    activeAgents,
    selectedAgent,
    llmApplyRatio,
    scenarioOptions,
    selectableScenarioOptions,
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
