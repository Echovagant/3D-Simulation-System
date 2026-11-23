import { describe, expect, it } from 'vitest'
import type { SimulationRun } from '@/services/api/simulations'
import type { SceneDocument } from '@/types'
import {
  buildSimulationBatchPayload,
  buildSweeps,
  parseRandomization,
  parseSeeds,
  parseSweepValues,
  summarizeBySeed,
} from './simulationBatch'

const buildDocument = (): SceneDocument => ({
  id: 'scene-1',
  name: '落球实验',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
  version: 1,
  gravity: { x: 0, y: -9.8, z: 0 },
  objects: [],
})

const buildRun = (
  seed: number | undefined,
  maxPenetration: number,
  totalFallDistance: number,
  settledAtFrame: number | null,
  index = 0,
): SimulationRun => ({
  index,
  params: seed === undefined ? {} : { seed },
  durationMs: 10,
  objects: [],
  metrics: { settledAtFrame, maxPenetration, totalFallDistance },
})

describe('parseSweepValues', () => {
  it('支持中英文逗号、分号与空白分隔', () => {
    expect(parseSweepValues('0.1, 0.5 0.9；1，2')).toEqual([0.1, 0.5, 0.9, 1, 2])
  })

  it('忽略空段与非法值', () => {
    expect(parseSweepValues(' 0.1, ,abc, -2 ')).toEqual([0.1, -2])
  })
})

describe('parseSeeds', () => {
  it('空串表示不传', () => {
    expect(parseSeeds('   ')).toEqual({})
  })

  it('逗号与空格分隔的整数都收下', () => {
    expect(parseSeeds('1, 2 3，-4')).toEqual({ seeds: [1, 2, 3, -4] })
  })

  it('出现非整数时报错', () => {
    expect(parseSeeds('1, 2.5').error).toContain('整数')
  })
})

describe('parseRandomization', () => {
  it('空串不传', () => {
    expect(parseRandomization('')).toEqual({})
  })

  it('数字输入转成 number', () => {
    expect(parseRandomization('0.2')).toEqual({ value: 0.2 })
    expect(parseRandomization(0.4)).toEqual({ value: 0.4 })
  })

  it('负数与非法值报错', () => {
    expect(parseRandomization('-0.1').error).toContain('负数')
    expect(parseRandomization('abc').error).toContain('数字')
  })
})

describe('buildSweeps', () => {
  it('忽略 none 行，保留各自取值', () => {
    const result = buildSweeps([
      { param: 'none', values: '9,9' },
      { param: 'friction', values: '0.1, 0.5' },
      { param: 'gravityY', values: '-9.81 -1.62' },
    ])
    expect(result.error).toBeUndefined()
    expect(result.sweeps).toEqual([
      { param: 'friction', values: [0.1, 0.5] },
      { param: 'gravityY', values: [-9.81, -1.62] },
    ])
  })

  it('选了维度但没给合法值时报错', () => {
    const result = buildSweeps([{ param: 'friction', values: ' , ' }])
    expect(result.sweeps).toEqual([])
    expect(result.error).toContain('friction')
  })

  it('同一维度重复时报错', () => {
    const result = buildSweeps([
      { param: 'friction', values: '0.1' },
      { param: 'friction', values: '0.5' },
    ])
    expect(result.sweeps).toEqual([])
    expect(result.error).toContain('重复')
  })
})

describe('buildSimulationBatchPayload', () => {
  it('统一发 sweeps，不发旧版 sweep；空字段省略', () => {
    const payload = buildSimulationBatchPayload({
      label: ' 摩擦扫描 ',
      scene: buildDocument(),
      params: { steps: 240 },
      sweeps: [{ param: 'friction', values: [0.1, 0.5] }],
      seeds: [1, 2],
      randomization: 0.2,
    })

    expect(payload.label).toBe('摩擦扫描')
    expect(payload.sweeps).toEqual([{ param: 'friction', values: [0.1, 0.5] }])
    expect(payload.seeds).toEqual([1, 2])
    expect(payload.randomization).toBe(0.2)
    expect('sweep' in payload).toBe(false)
  })

  it('没有扫描 / 种子 / 扰动时不发这些字段', () => {
    const payload = buildSimulationBatchPayload({
      scene: buildDocument(),
      sweeps: [],
    })

    expect('sweep' in payload).toBe(false)
    expect('sweeps' in payload).toBe(false)
    expect('seeds' in payload).toBe(false)
    expect('randomization' in payload).toBe(false)
    expect('label' in payload).toBe(false)
  })

  it('randomization 为 0 时仍显式发送（0 是有效幅度）', () => {
    const payload = buildSimulationBatchPayload({ scene: buildDocument(), randomization: 0 })
    expect(payload.randomization).toBe(0)
  })
})

describe('summarizeBySeed', () => {
  it('按 seed 分组并计算均值 / 最大值 / 落地数', () => {
    const rows = summarizeBySeed([
      buildRun(1, 0.01, 2, 10, 0),
      buildRun(1, 0.03, 4, 12, 1),
      buildRun(2, 0.05, 6, null, 2),
    ])

    expect(rows).toHaveLength(2)
    expect(rows[0]).toEqual({
      seed: 1,
      runs: 2,
      settledRuns: 2,
      maxPenetrationAvg: 0.02,
      maxPenetrationMax: 0.03,
      avgFallDistance: 3,
    })
    expect(rows[1]).toEqual({
      seed: 2,
      runs: 1,
      settledRuns: 0,
      maxPenetrationAvg: 0.05,
      maxPenetrationMax: 0.05,
      avgFallDistance: 6,
    })
  })

  it('缺省 seed 归到 0，结果按 seed 升序', () => {
    const rows = summarizeBySeed([buildRun(2, 0, 0, 1), buildRun(undefined, 0, 0, 1)])
    expect(rows.map((row) => row.seed)).toEqual([0, 2])
    expect(rows[0].runs).toBe(1)
  })

  it('没有运行时返回空表', () => {
    expect(summarizeBySeed([])).toEqual([])
  })
})
