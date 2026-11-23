/**
 * 场景编辑器的场地口径。
 *
 * 场地是正方形：网格、可见地面、物理地面碰撞体三者共用同一个边长，
 * 改这里就不会再出现「看着有地面、实际掉下去」的错位。
 */

/** 可选的场地边长（米）。默认 40：比旧的 10×10 大 16 倍，教学演示和障碍场都够用 */
export const SCENE_WORLD_SIZES = [20, 40, 60] as const
export type SceneWorldSize = (typeof SCENE_WORLD_SIZES)[number]
export const DEFAULT_SCENE_WORLD_SIZE: SceneWorldSize = 40

/** 物体掉到这条线以下就视为「已离开场地」，召回时按初始变换放回 */
export const SCENE_FALL_LIMIT_Y = -8

/** 新物体出生高度：留出下落时间，也避免和已有物体叠在一起 */
export const SCENE_SPAWN_HEIGHT = 3

/** 新物体之间的最小水平间距（米） */
export const SCENE_SPAWN_MIN_DISTANCE = 1.6

/**
 * 基础体配色。
 *
 * 编辑器新增物体从这里轮换取色，不再用 `Math.random() * 0xffffff`：
 * 纯随机高饱和色放一起很容易脏，精选场景也没法配色。
 */
export const PRIMITIVE_PALETTE = [
  0x4f9dff,
  0xff7043,
  0x66bb6a,
  0xffc107,
  0xab47bc,
  0x26c6da,
  0xef5350,
  0x8d6e63,
  0x90a4ae,
  0xffee58,
] as const

/** 把任意输入收敛成合法场地边长；不认识的值回落到默认值 */
export const normalizeWorldSize = (value: unknown): SceneWorldSize => {
  if (typeof value === 'number' && SCENE_WORLD_SIZES.includes(value as SceneWorldSize)) {
    return value as SceneWorldSize
  }
  return DEFAULT_SCENE_WORLD_SIZE
}
