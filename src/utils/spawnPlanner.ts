/**
 * 新物体的出生点规划。
 *
 * 旧实现用 `createRandom(DEFAULT_SEED + spawnSeq++)`：相邻种子的 LCG 第一次
 * 输出只差约 0.0004，换算成坐标是 2 毫米——所有物体都叠在同一个点。
 * 这里改成「黄金角螺旋 + 占位检测」：不需要随机数，位置可复现，
 * 而且天然避开已有物体。
 */
import { SCENE_SPAWN_HEIGHT, SCENE_SPAWN_MIN_DISTANCE } from '@/config/sceneEditor'

export interface SpawnOccupant {
  x: number
  z: number
}

export interface SpawnOptions {
  /** 第几个新物体（从 0 开始）。同一个序号永远得到同一个落点 */
  index: number
  /** 场地边长（米） */
  worldSize: number
  /** 已有物体的水平位置 */
  occupied?: SpawnOccupant[]
  /** 最小水平间距（米） */
  minDistance?: number
}

export interface SpawnPosition {
  x: number
  y: number
  z: number
}

/** 黄金角：连续两个落点的角差，保证螺旋上的点分布均匀 */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * 规划一个不与已有物体重叠的出生点。
 *
 * 先按黄金角螺旋取候选点；候选点被占用就顺延到螺旋上的下一个点。
 * 极端拥挤时返回最后一个候选点（不抛错、不阻塞添加），由用户自行挪开。
 */
export const planSpawnPosition = (options: SpawnOptions): SpawnPosition => {
  const { index, worldSize, occupied = [], minDistance = SCENE_SPAWN_MIN_DISTANCE } = options
  // 留 1 米边距：物体有半径，贴着边缘出生会立刻滑出地面
  const half = Math.max(1, worldSize / 2 - 1)

  let candidate: SpawnPosition = { x: 0, y: SCENE_SPAWN_HEIGHT, z: 0 }

  // 最多顺延 160 个候选点：正常场景几十个物体绰绰有余
  for (let attempt = 0; attempt < 160; attempt += 1) {
    const n = Math.max(0, index) + attempt
    // 半径按 sqrt 增长：密度均匀，不会都挤在中心
    const radius = 1.2 * Math.sqrt(n + 1)
    const angle = n * GOLDEN_ANGLE
    candidate = {
      x: clamp(Math.cos(angle) * radius, -half, half),
      y: SCENE_SPAWN_HEIGHT,
      z: clamp(Math.sin(angle) * radius, -half, half),
    }

    const free = occupied.every((item) => {
      const dx = item.x - candidate.x
      const dz = item.z - candidate.z
      return Math.hypot(dx, dz) >= minDistance
    })
    if (free) return candidate
  }

  return candidate
}
