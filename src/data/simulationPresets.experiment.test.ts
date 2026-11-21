import { describe, expect, it } from 'vitest'
import { simulationPresets } from './simulationPresets'

/**
 * 实验说明层的回归网：每个预设都必须带实验元数据与作业题，
 * 且钟摆的文案必须如实标注「摆约束未实现」——说明卡不能教错。
 */
describe('simulationPresets —— 实验说明元数据', () => {
  it('每个预设都带 experiment（purpose + 至少 1 条观察点）', () => {
    for (const preset of simulationPresets) {
      const exp = preset.experiment
      expect(exp, `${preset.name} 缺 experiment`).toBeTruthy()
      expect(exp!.purpose.length, `${preset.name} purpose 为空`).toBeGreaterThan(4)
      expect(exp!.observations.length, `${preset.name} observations 为空`).toBeGreaterThan(0)
      for (const item of exp!.observations) {
        expect(item.length, `${preset.name} 有空观察点`).toBeGreaterThan(4)
      }
    }
  })

  it('每个预设至少带一道作业题（实现边界也写成可动手的题目）', () => {
    for (const preset of simulationPresets) {
      expect(
        preset.experiment?.assignments?.length ?? 0,
        `${preset.name} 缺作业题`,
      ).toBeGreaterThan(0)
      for (const item of preset.experiment?.assignments ?? []) {
        expect(item.length, `${preset.name} 有空作业题`).toBeGreaterThan(4)
      }
    }
  })

  it('预设 id 唯一（深链接依据，实验说明卡按 id 关联）', () => {
    const ids = simulationPresets.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('钟摆说明如实标注实现边界（摆约束未实现，当前是自由落体近似）', () => {
    const pendulum = simulationPresets.find((p) => p.id === 'pendulum')
    expect(pendulum?.experiment).toBeTruthy()
    const text = `${pendulum!.experiment!.purpose}${pendulum!.experiment!.observations.join('')}`
    expect(text).toContain('自由落体')
    expect(text).toContain('未实现')
  })
})
