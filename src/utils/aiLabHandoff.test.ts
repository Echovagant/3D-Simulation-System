// @vitest-environment jsdom
/**
 * 实时演练 → 评测审计的交接数据。
 *
 * 守的是三件事：写读清除的往返、坏数据（非法 JSON / 缺字段 / 类型不对）一律 null、
 * 以及回合上限的换算口径——没有智能体时不能交出一份注定建不了会话的数据。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SceneDocument } from '@/types'
import {
  AI_LAB_HANDOFF_KEY,
  arenaAgentUuid,
  buildArenaHandoff,
  clearAiLabHandoff,
  readAiLabHandoff,
  resolveAiLabMaxSteps,
  writeAiLabHandoff,
  type AiLabHandoff,
} from './aiLabHandoff'

const ISO = '2026-11-23T10:00:00.000Z'

/** 与 useAI.exportArenaSceneDocument 同形的场地：两个静态障碍 + 一个动态智能体 */
const createScene = (): SceneDocument => ({
  id: 'ai-arena-test',
  name: 'AI 实验室 · 实时演练场地',
  createdAt: ISO,
  updatedAt: ISO,
  version: 1,
  objects: [
    {
      uuid: 'arena-obstacle-0',
      type: 'cube',
      name: '障碍物 1',
      position: { x: 3, y: 0.7, z: -2 },
      rotation: { x: 0, y: 0.4, z: 0 },
      scale: { x: 1.4, y: 1.4, z: 1.4 },
      visible: true,
      physics: { type: 'static', shape: 'box', mass: 1 },
    },
    {
      uuid: 'arena-obstacle-1',
      type: 'cube',
      name: '障碍物 2',
      position: { x: -4, y: 0.6, z: 1 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.2, y: 1.2, z: 1.2 },
      visible: true,
      physics: { type: 'static', shape: 'box', mass: 1 },
    },
    {
      uuid: 'arena-agent-a1',
      type: 'cube',
      name: '导航机器人',
      position: { x: 5, y: 0.4, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.8, y: 0.8, z: 0.8 },
      visible: true,
      physics: { type: 'dynamic', shape: 'box', mass: 2 },
    },
  ],
})

const createHandoff = (): AiLabHandoff => {
  const handoff = buildArenaHandoff({
    scene: createScene(),
    agents: [{ uuid: arenaAgentUuid('a1'), target: { x: 4, z: -2 } }],
    timeLimitSeconds: 2,
    label: '实时演练 · 当前场地',
    at: 1_700_000_000_000,
  })
  if (!handoff) throw new Error('测试数据应当能生成交接')
  return handoff
}

afterEach(() => {
  sessionStorage.clear()
  vi.restoreAllMocks()
})

describe('aiLabHandoff —— 写读清除', () => {
  it('写入后能原样读回，清除后为 null', () => {
    const handoff = createHandoff()

    expect(writeAiLabHandoff(handoff)).toBe(true)
    expect(sessionStorage.getItem(AI_LAB_HANDOFF_KEY)).not.toBeNull()
    expect(readAiLabHandoff()).toEqual(handoff)

    clearAiLabHandoff()
    expect(readAiLabHandoff()).toBeNull()
    expect(sessionStorage.getItem(AI_LAB_HANDOFF_KEY)).toBeNull()
  })

  it('存储不可用时写入返回 false，不抛异常', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(() => writeAiLabHandoff(createHandoff())).not.toThrow()
    expect(writeAiLabHandoff(createHandoff())).toBe(false)
  })

  it('字段不合法的数据拒绝写入', () => {
    const broken = { ...createHandoff(), source: 'scene-editor' } as unknown as AiLabHandoff
    expect(writeAiLabHandoff(broken)).toBe(false)
    expect(sessionStorage.getItem(AI_LAB_HANDOFF_KEY)).toBeNull()
  })
})

describe('aiLabHandoff —— 坏数据读取', () => {
  const seed = (value: unknown) => sessionStorage.setItem(AI_LAB_HANDOFF_KEY, JSON.stringify(value))

  it('不是合法 JSON 时返回 null', () => {
    sessionStorage.setItem(AI_LAB_HANDOFF_KEY, '{ 坏数据')
    expect(readAiLabHandoff()).toBeNull()
  })

  it('没有 key 时返回 null', () => {
    expect(readAiLabHandoff()).toBeNull()
  })

  it('缺 maxSteps / source / at / agents 时返回 null', () => {
    const handoff = createHandoff()
    seed({ ...handoff, maxSteps: undefined })
    expect(readAiLabHandoff()).toBeNull()

    seed({ ...handoff, source: undefined })
    expect(readAiLabHandoff()).toBeNull()

    seed({ ...handoff, at: undefined })
    expect(readAiLabHandoff()).toBeNull()

    seed({ ...handoff, agents: undefined })
    expect(readAiLabHandoff()).toBeNull()
  })

  it('target 不是有限数字时返回 null', () => {
    const handoff = createHandoff()
    seed({ ...handoff, target: { x: '4', z: -2 } })
    expect(readAiLabHandoff()).toBeNull()

    seed({ ...handoff, target: { x: 4, z: Number.NaN } })
    expect(readAiLabHandoff()).toBeNull()
  })

  it('objects 不是数组或物体缺 uuid 时返回 null', () => {
    const handoff = createHandoff()
    seed({ ...handoff, scene: { ...handoff.scene, objects: 'nope' } })
    expect(readAiLabHandoff()).toBeNull()

    seed({
      ...handoff,
      scene: { ...handoff.scene, objects: [{ type: 'cube', name: '没有 uuid' }] },
    })
    expect(readAiLabHandoff()).toBeNull()
  })

  it('agents 里有一项不合法时整份数据返回 null', () => {
    const handoff = createHandoff()
    seed({ ...handoff, agents: [{ uuid: '', target: { x: 0, z: 0 } }] })
    expect(readAiLabHandoff()).toBeNull()

    seed({ ...handoff, agents: [{ uuid: 'arena-agent-a1', target: { x: 0 } }] })
    expect(readAiLabHandoff()).toBeNull()
  })
})

describe('aiLabHandoff —— 回合上限换算', () => {
  it('时间上限（秒）× 60，向下取整', () => {
    expect(resolveAiLabMaxSteps(3)).toBe(180)
    expect(resolveAiLabMaxSteps(2.5)).toBe(150)
  })

  it('不限时（0 / 负数 / 非数字）给 300', () => {
    expect(resolveAiLabMaxSteps(0)).toBe(300)
    expect(resolveAiLabMaxSteps(-5)).toBe(300)
    expect(resolveAiLabMaxSteps(Number.NaN)).toBe(300)
  })

  it('至少 60 步——时间上限很短也不至于两步就截断', () => {
    expect(resolveAiLabMaxSteps(0.5)).toBe(60)
    expect(resolveAiLabMaxSteps(0.1)).toBe(60)
  })

  it('不超过后端的 10000 步上限', () => {
    expect(resolveAiLabMaxSteps(1000)).toBe(10000)
    expect(resolveAiLabMaxSteps(999)).toBe(10000)
  })
})

describe('aiLabHandoff —— buildArenaHandoff 形状', () => {
  it('target 取第一只智能体的目标，uuid / source / label / at 按契约填好', () => {
    const handoff = buildArenaHandoff({
      scene: createScene(),
      agents: [
        { uuid: 'arena-agent-a1', target: { x: 4, z: -2 } },
        { uuid: 'arena-agent-a2', target: { x: -3, z: 1 } },
      ],
      timeLimitSeconds: 5,
      label: '实时演练 · 当前场地',
      at: 1_700_000_000_000,
    })

    expect(handoff).toEqual({
      scene: createScene(),
      target: { x: 4, z: -2 },
      maxSteps: 300,
      agents: [
        { uuid: 'arena-agent-a1', target: { x: 4, z: -2 } },
        { uuid: 'arena-agent-a2', target: { x: -3, z: 1 } },
      ],
      label: '实时演练 · 当前场地',
      source: 'ai-playground',
      at: 1_700_000_000_000,
    })
  })

  it('没有智能体时返回 null，不交空 agents 给评测台', () => {
    const handoff = buildArenaHandoff({
      scene: createScene(),
      agents: [],
      timeLimitSeconds: 0,
    })
    expect(handoff).toBeNull()
  })

  it('label 缺省时不出现该字段', () => {
    const handoff = buildArenaHandoff({
      scene: createScene(),
      agents: [{ uuid: 'arena-agent-a1', target: { x: 0, z: 0 } }],
      timeLimitSeconds: 0,
      at: 1,
    })
    expect(handoff).not.toBeNull()
    expect('label' in handoff!).toBe(false)
  })

  it('智能体 uuid 约定与场景物体一致', () => {
    expect(arenaAgentUuid('a1')).toBe('arena-agent-a1')
    const scene = createScene()
    expect(scene.objects.map((object) => object.uuid)).toContain(arenaAgentUuid('a1'))
  })
})
