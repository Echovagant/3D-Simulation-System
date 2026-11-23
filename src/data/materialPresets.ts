/**
 * 场景编辑器的材质预设。
 *
 * 预设只描述「表面观感」——颜色 + 金属度 + 粗糙度，三者都是
 * MeshStandardMaterial 的直通参数，不涉及贴图与透明度，也不改物理属性。
 * 资源中心用来展示与挑选，场景编辑器用来一键套到选中物体上。
 */

import type { SceneMaterialSettings } from '@/types'

/** 材质参数：与 SceneObject / SceneDocumentObject 的 material 字段同一口径 */
export type MaterialSettings = SceneMaterialSettings

export interface MaterialPreset extends MaterialSettings {
  id: string
  name: string
  /** 一句话说明这组参数像什么材料 */
  description: string
  /** 十六进制颜色（0xrrggbb） */
  color: number
}

/**
 * 缺省材质参数。
 *
 * 与 SCENE_PRESENTATION.materialMetalness / materialRoughness 取同一组值：
 * 没有环境贴图时高金属度会把物体压成黑块，低金属 + 中粗糙度才读得出体积。
 */
export const DEFAULT_MATERIAL_METALNESS = 0.08
export const DEFAULT_MATERIAL_ROUGHNESS = 0.58

export const MATERIAL_PRESETS: readonly MaterialPreset[] = [
  {
    id: 'brushed-steel',
    name: '拉丝钢',
    description: '冷灰色中高金属度，窄高光，适合机械外壳与框架。',
    color: 0xb8bcc2,
    metalness: 0.85,
    roughness: 0.35,
  },
  {
    id: 'warm-wood',
    name: '暖木',
    description: '无金属感的暖棕色，粗糙度高，适合桌面、地板与箱体。',
    color: 0xa9703f,
    metalness: 0,
    roughness: 0.72,
  },
  {
    id: 'concrete',
    name: '混凝土',
    description: '接近无金属的灰调，粗糙度很高，适合墙体与地台。',
    color: 0x9b9b93,
    metalness: 0.02,
    roughness: 0.92,
  },
  {
    id: 'matte-black',
    name: '哑光黑',
    description: '低反射的深色面，适合仪器底座与暗部结构。',
    color: 0x1c1f24,
    metalness: 0.15,
    roughness: 0.85,
  },
  {
    id: 'brass',
    name: '黄铜',
    description: '暖金色高金属度，高光集中，适合装饰件与小配件。',
    color: 0xc9a227,
    metalness: 0.9,
    roughness: 0.28,
  },
  {
    id: 'frosted-glass',
    name: '低粗糙玻璃感',
    description: '低粗糙度 + 轻微金属感的冷色面；不是真正的透明玻璃，只是接近玻璃的高光。',
    color: 0xa9d6e5,
    metalness: 0.25,
    roughness: 0.12,
  },
]

/** 按 id 找预设；找不到返回 undefined */
export const findMaterialPreset = (id: string | null | undefined): MaterialPreset | undefined =>
  id ? MATERIAL_PRESETS.find((preset) => preset.id === id) : undefined

/** 0xrrggbb → '#rrggbb'（<input type="color"> 的取值格式） */
export const toHexColorString = (color: number): string =>
  `#${(color & 0xffffff).toString(16).padStart(6, '0')}`

/** '#rrggbb' → 0xrrggbb；格式不合法返回 null */
export const hexToColorNumber = (hex: string): number | null => {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  return match ? Number.parseInt(match[1], 16) : null
}
