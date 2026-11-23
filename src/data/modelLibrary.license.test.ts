import { describe, expect, it } from 'vitest'
import { createModelLibrary } from './modelLibrary'

/**
 * 内置模型的许可证 / 来源 / 作者字段。
 *
 * 这组字段决定「这个资产能不能商用、要不要署名」，必须在界面上如实展示。
 * 数据来源：NOTICE（9 个自制模型 = Apache-2.0；Kenney / Poly Haven = CC0-1.0）
 * 与 scripts/check-asset-licenses.mjs 的资产清单。
 */

/** 本仓库程序化生成的 9 个模型 */
const SELF_GENERATED = new Set([
  '机甲',
  '无人机',
  '悬浮守卫',
  '太空站内部',
  '森林场景',
  '城市街道',
  '科幻武器',
  '魔法书',
  '控制台',
])

describe('内置模型许可证与来源', () => {
  const models = createModelLibrary()

  it('24 个模型全部有许可证，没有留空', () => {
    expect(models).toHaveLength(24)
    for (const model of models) {
      expect(model.license, `${model.name} 缺少许可证`).toBeTruthy()
    }
  })

  it('9 个自制模型为 Apache-2.0，作者为本项目', () => {
    const self = models.filter((model) => SELF_GENERATED.has(model.name))
    expect(self).toHaveLength(9)
    for (const model of self) {
      expect(model.license).toBe('Apache-2.0')
      expect(model.author).toBe('3D Simulation System')
      // 自制模型没有外部来源页；界面应按「来源未记录」处理，而不是编造 URL
      expect(model.sourceUrl).toBeUndefined()
    }
  })

  it('15 个第三方模型为 CC0-1.0，作者与来源来自 NOTICE', () => {
    const thirdParty = models.filter((model) => !SELF_GENERATED.has(model.name))
    expect(thirdParty).toHaveLength(15)
    for (const model of thirdParty) {
      expect(model.license).toBe('CC0-1.0')
      expect(['Kenney', 'Poly Haven']).toContain(model.author)
      expect(model.sourceUrl).toMatch(/^https:\/\/(kenney\.nl|polyhaven\.com)\/$/)
    }
  })

  it('许可证分布：Apache-2.0 × 9，CC0-1.0 × 15', () => {
    const apache = models.filter((model) => model.license === 'Apache-2.0')
    const cc0 = models.filter((model) => model.license === 'CC0-1.0')
    expect(apache).toHaveLength(9)
    expect(cc0).toHaveLength(15)
  })

  it('内置模型默认不是 AI 生成', () => {
    expect(models.every((model) => model.aiGenerated !== true)).toBe(true)
  })
})
