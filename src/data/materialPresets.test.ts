import { describe, expect, it } from 'vitest'
import {
  DEFAULT_MATERIAL_METALNESS,
  DEFAULT_MATERIAL_ROUGHNESS,
  MATERIAL_PRESETS,
  findMaterialPreset,
  hexToColorNumber,
  toHexColorString,
} from './materialPresets'

describe('材质预设数据', () => {
  it('至少有 6 个预设，覆盖金属 / 木 / 混凝土 / 哑光 / 黄铜 / 玻璃感', () => {
    expect(MATERIAL_PRESETS.length).toBeGreaterThanOrEqual(6)

    const names = MATERIAL_PRESETS.map((preset) => preset.name)
    for (const expected of ['拉丝钢', '暖木', '混凝土', '哑光黑', '黄铜', '低粗糙玻璃感']) {
      expect(names).toContain(expected)
    }
  })

  it('id 唯一且非空', () => {
    const ids = MATERIAL_PRESETS.map((preset) => preset.id)
    for (const id of ids) expect(id.trim().length).toBeGreaterThan(0)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('字段合法：颜色在 0~0xffffff，金属度 / 粗糙度在 0~1，名称与说明非空', () => {
    for (const preset of MATERIAL_PRESETS) {
      expect(preset.color).toBeGreaterThanOrEqual(0)
      expect(preset.color).toBeLessThanOrEqual(0xffffff)
      expect(preset.metalness).toBeGreaterThanOrEqual(0)
      expect(preset.metalness).toBeLessThanOrEqual(1)
      expect(preset.roughness).toBeGreaterThanOrEqual(0)
      expect(preset.roughness).toBeLessThanOrEqual(1)
      expect(preset.name.trim().length).toBeGreaterThan(0)
      expect(preset.description.trim().length).toBeGreaterThan(0)
    }
  })

  it('findMaterialPreset 按 id 命中，未知 / 空 id 返回 undefined', () => {
    expect(findMaterialPreset('brushed-steel')?.name).toBe('拉丝钢')
    expect(findMaterialPreset('not-a-preset')).toBeUndefined()
    expect(findMaterialPreset(null)).toBeUndefined()
    expect(findMaterialPreset(undefined)).toBeUndefined()
  })

  it('颜色与十六进制字符串可以互转', () => {
    expect(toHexColorString(0x4f9dff)).toBe('#4f9dff')
    expect(toHexColorString(0x0)).toBe('#000000')
    expect(hexToColorNumber('#4f9dff')).toBe(0x4f9dff)
    expect(hexToColorNumber('4f9dff')).toBe(0x4f9dff)
    expect(hexToColorNumber('#zzzzzz')).toBeNull()

    for (const preset of MATERIAL_PRESETS) {
      expect(hexToColorNumber(toHexColorString(preset.color))).toBe(preset.color)
    }
  })

  it('缺省材质参数与编辑器默认口径一致（0.08 / 0.58）', () => {
    expect(DEFAULT_MATERIAL_METALNESS).toBe(0.08)
    expect(DEFAULT_MATERIAL_ROUGHNESS).toBe(0.58)
  })
})
