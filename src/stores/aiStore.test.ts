import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAiStore, getDefaultParametersForType } from './aiStore'

describe('getDefaultParametersForType', () => {
  it('basic 返回默认速度 5', () => {
    expect(getDefaultParametersForType('basic').speed).toBe(5)
  })
  it('advanced 返回默认速度 7', () => {
    expect(getDefaultParametersForType('advanced').speed).toBe(7)
  })
  it('custom 返回空对象', () => {
    expect(getDefaultParametersForType('custom')).toEqual({})
  })
  it('basic 的参数集合固定', () => {
    expect(getDefaultParametersForType('basic')).toEqual({
      speed: 5,
      reactionTime: 0.5,
      awarenessRange: 10,
      avoidObstacles: true,
    })
  })
})

describe('useAiStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('createAgent 用默认参数创建代理并自动选中第一个', () => {
    const store = useAiStore()
    const agent = store.createAgent('导航机器人', 'basic')

    expect(store.agents).toHaveLength(1)
    expect(agent.parameters.speed).toBe(5)
    expect(store.selectedAgentId).toBe(agent.id)
  })

  it('createAgent 支持 advanced 的扩展参数', () => {
    const store = useAiStore()
    const agent = store.createAgent('高级代理', 'advanced')

    expect(agent.parameters.learningEnabled).toBe(true)
    expect(agent.parameters.teamwork).toBe(false)
  })

  it('activeAgents 只统计 active 的代理', () => {
    const store = useAiStore()
    const agent = store.createAgent('a', 'basic')
    store.createAgent('b', 'basic')

    expect(store.activeAgents).toHaveLength(2)

    store.agents[1].active = false
    expect(store.activeAgents).toHaveLength(1)
    expect(store.activeAgents[0].id).toBe(agent.id)
  })

  it('removeAgent 删除代理并重置选中状态', () => {
    const store = useAiStore()
    const agent = store.createAgent('a', 'basic')

    store.removeAgent(agent.id)

    expect(store.agents).toHaveLength(0)
    expect(store.selectedAgentId).toBeNull()
  })

  it('startSimulation / pauseSimulation / resetSimulation 切换状态', () => {
    const store = useAiStore()
    store.createAgent('a', 'basic')

    store.startSimulation()
    expect(store.simulationActive).toBe(true)
    expect(store.agents[0].status).toBe('running')

    store.pauseSimulation()
    expect(store.simulationActive).toBe(false)
    expect(store.agents[0].status).toBe('paused')

    store.resetSimulation()
    expect(store.simulationTime).toBe(0)
    expect(store.agents[0].status).toBe('idle')
  })

  it('updateAgentParameters 合并参数', () => {
    const store = useAiStore()
    const agent = store.createAgent('a', 'basic')

    store.updateAgentParameters(agent.id, { speed: 9 })

    expect(store.agents[0].parameters.speed).toBe(9)
    expect(store.agents[0].parameters.awarenessRange).toBe(10)
  })

  it('addAgentLog 记录日志', () => {
    const store = useAiStore()
    const agent = store.createAgent('a', 'basic')

    store.addAgentLog(agent.id, '出发', 'warning')

    expect(store.agents[0].logs).toHaveLength(1)
    expect(store.agents[0].logs[0].message).toBe('出发')
    expect(store.agents[0].logs[0].type).toBe('warning')
  })

  it('updateEnvironmentSettings 合并环境设置', () => {
    const store = useAiStore()

    store.updateEnvironmentSettings({ difficulty: 'hard' })

    expect(store.environmentSettings.difficulty).toBe('hard')
    expect(store.environmentSettings.scenario).toBe('navigation')
  })

  it('initializeDefaultAgents 只在没有任何代理时创建默认代理', () => {
    const store = useAiStore()

    store.initializeDefaultAgents()
    expect(store.agents).toHaveLength(1)

    store.initializeDefaultAgents()
    expect(store.agents).toHaveLength(1)
  })

  it('scenarioOptions 覆盖四种场景', () => {
    const store = useAiStore()
    expect(store.scenarioOptions.map((o) => o.value)).toEqual([
      'navigation',
      'interaction',
      'combat',
      'custom',
    ])
  })
})
