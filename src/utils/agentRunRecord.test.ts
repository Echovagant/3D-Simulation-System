/**
 * 运行记录组装函数。
 *
 * 守的是导出文件里**字段齐、口径对**：环境/智能体是快照（导出后再改界面
 * 不会改到已导出的内容），日志只保留最近若干条但总数照实记，指标缺失时
 * 给 null 而不是编 0。这些都是随后能复查「那次演练跑成什么样」的前提。
 */
import { describe, it, expect } from 'vitest'
import {
  buildAgentRunRecord,
  MAX_RUN_RECORD_LOGS,
  type BuildAgentRunRecordInput,
} from './agentRunRecord'
import type { AiAgent, AiAgentLog, AiEnvironmentSettings } from '@/stores/aiStore'
import type { AgentMetrics } from './agentMetrics'

const environment: AiEnvironmentSettings = {
  scenario: 'navigation',
  difficulty: 'medium',
  timeLimit: 60,
  winCondition: '到达目标点',
  obstaclesDensity: 0.5,
  arenaSeed: 42,
}

const agent = (overrides: Partial<AiAgent> = {}): AiAgent => ({
  id: 'agent-1',
  name: '导航机器人',
  type: 'basic',
  active: true,
  status: 'running',
  parameters: { speed: 5, reactionTime: 0.5, avoidObstacles: true },
  ...overrides,
})

const log = (seq: number): AiAgentLog => ({
  seq,
  timestamp: Date.UTC(2026, 10, 23, 10, 0, seq),
  message: `第 ${seq} 条`,
  type: 'info',
  agentId: 'agent-1',
  agentName: '导航机器人',
})

const metrics: AgentMetrics = {
  totalAgents: 2,
  goalReachedCount: 1,
  successRate: 0.5,
  collisionCountTotal: 3,
  meanPathEfficiency: 0.8,
  perAgent: [],
}

const buildInput = (
  overrides: Partial<BuildAgentRunRecordInput> = {},
): BuildAgentRunRecordInput => ({
  environment,
  agents: [agent()],
  metrics,
  logs: [log(1), log(2)],
  startedAt: '2026-11-23T10:00:00.000Z',
  endedAt: Date.UTC(2026, 10, 23, 10, 1, 0),
  runId: 'run-fixed',
  ...overrides,
})

describe('buildAgentRunRecord —— 运行记录字段', () => {
  it('字段完整：runId / 起止时间 / 环境 / 智能体 / 指标 / 日志 / 总数', () => {
    const record = buildAgentRunRecord(
      buildInput({
        sceneDocument: {
          id: 'scene-1',
          name: '演武场当前场地',
          createdAt: '2026-11-23T10:00:00.000Z',
          updatedAt: '2026-11-23T10:00:00.000Z',
          version: 1,
          objects: [],
        },
      }),
    )

    expect(record.runId).toBe('run-fixed')
    expect(record.startedAt).toBe('2026-11-23T10:00:00.000Z')
    expect(record.endedAt).toBe('2026-11-23T10:01:00.000Z')
    expect(record.environment).toEqual(environment)
    expect(record.agents).toEqual([
      {
        id: 'agent-1',
        name: '导航机器人',
        type: 'basic',
        status: 'running',
        parameters: { speed: 5, reactionTime: 0.5, avoidObstacles: true },
      },
    ])
    expect(record.metrics).toEqual({
      successRate: 0.5,
      collisions: 3,
      efficiency: 0.8,
      goals: 1,
    })
    expect(record.logs).toHaveLength(2)
    expect(record.logCount).toBe(2)
    expect(record.sceneDocument?.objects).toEqual([])
  })

  it('runId 每次自动生成都不同', () => {
    const first = buildAgentRunRecord(buildInput({ runId: undefined }))
    const second = buildAgentRunRecord(buildInput({ runId: undefined }))

    expect(first.runId).toBeTruthy()
    expect(second.runId).toBeTruthy()
    expect(first.runId).not.toBe(second.runId)
  })

  it('指标缺失时给 null，不编 0', () => {
    const record = buildAgentRunRecord(buildInput({ metrics: null }))

    expect(record.metrics).toEqual({
      successRate: null,
      collisions: null,
      efficiency: null,
      goals: null,
    })
  })

  it('没有场地快照时记录里不出现 sceneDocument', () => {
    const record = buildAgentRunRecord(buildInput({ sceneDocument: null }))
    expect('sceneDocument' in record).toBe(false)
  })
})

describe('buildAgentRunRecord —— 日志截断', () => {
  it(`只保留最近 ${MAX_RUN_RECORD_LOGS} 条，logCount 记截断前总数`, () => {
    const logs = Array.from({ length: 250 }, (_, index) => log(index))
    const record = buildAgentRunRecord(buildInput({ logs }))

    expect(record.logs).toHaveLength(MAX_RUN_RECORD_LOGS)
    expect(record.logs[0].message).toBe('第 50 条')
    expect(record.logs[record.logs.length - 1].message).toBe('第 249 条')
    expect(record.logCount).toBe(250)
  })

  it('可以自定义保留条数', () => {
    const logs = Array.from({ length: 10 }, (_, index) => log(index))
    const record = buildAgentRunRecord(buildInput({ logs, maxLogs: 3 }))

    expect(record.logs.map((item) => item.message)).toEqual(['第 7 条', '第 8 条', '第 9 条'])
    expect(record.logCount).toBe(10)
  })

  it('日志不足上限时原样保留', () => {
    const record = buildAgentRunRecord(buildInput())
    expect(record.logs.map((item) => item.message)).toEqual(['第 1 条', '第 2 条'])
  })
})

describe('buildAgentRunRecord —— 快照隔离', () => {
  it('导出后再改环境 / 智能体参数，不影响已组装的记录', () => {
    const mutableEnvironment = { ...environment }
    const mutableAgent = agent()
    const record = buildAgentRunRecord(
      buildInput({ environment: mutableEnvironment, agents: [mutableAgent] }),
    )

    mutableEnvironment.difficulty = 'hard'
    mutableAgent.parameters.speed = 99
    mutableAgent.status = 'error'

    expect(record.environment.difficulty).toBe('medium')
    expect(record.agents[0].parameters.speed).toBe(5)
    expect(record.agents[0].status).toBe('running')
  })
})
