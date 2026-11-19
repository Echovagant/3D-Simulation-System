import { describe, expect, it } from 'vitest'
import { simulationPresets } from './simulationPresets'

/**
 * 课件层（A-2）的回归网：每个预设都必须带教育元数据，
 * 且钟摆的文案必须如实标注「摆约束未实现」——课件不能教错。
 */
describe('simulationPresets —— 课件层元数据', () => {
  it('每个预设都带 education（objective + 至少 1 条观察点）', () => {
    for (const preset of simulationPresets) {
      const edu = preset.education
      expect(edu, `${preset.name} 缺 education`).toBeTruthy()
      expect(edu!.objective.length, `${preset.name} objective 为空`).toBeGreaterThan(4)
      expect(
        edu!.observations.length,
        `${preset.name} observations 为空`,
      ).toBeGreaterThan(0)
      for (const item of edu!.observations) {
        expect(item.length, `${preset.name} 有空观察点`).toBeGreaterThan(4)
      }
    }
  })

  it('预设 id 唯一（深链接依据，课件卡按 id 关联）', () => {
    const ids = simulationPresets.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('钟摆课件如实标注实现边界（摆约束未实现，当前是自由落体近似）', () => {
    const pendulum = simulationPresets.find((p) => p.id === 'pendulum')
    expect(pendulum?.education).toBeTruthy()
    const text = `${pendulum!.education!.objective}${pendulum!.education!.observations.join('')}`
    expect(text).toContain('自由落体')
    expect(text).toContain('未实现')
  })
})
