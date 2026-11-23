import { describe, expect, it } from 'vitest'
import { planSpawnPosition } from './spawnPlanner'
import { SCENE_SPAWN_HEIGHT, SCENE_SPAWN_MIN_DISTANCE } from '@/config/sceneEditor'

describe('planSpawnPosition', () => {
  it('连续添加 12 个物体时两两间距不小于最小值', () => {
    const occupied: { x: number; z: number }[] = []
    for (let index = 0; index < 12; index += 1) {
      const spot = planSpawnPosition({ index, worldSize: 40, occupied })
      for (const item of occupied) {
        expect(Math.hypot(spot.x - item.x, spot.z - item.z)).toBeGreaterThanOrEqual(
          SCENE_SPAWN_MIN_DISTANCE - 1e-6,
        )
      }
      occupied.push({ x: spot.x, z: spot.z })
    }
  })

  it('同一个序号 + 同一份占位得到完全相同的落点（可复现）', () => {
    const occupied = [{ x: 1, z: 1 }]
    const a = planSpawnPosition({ index: 3, worldSize: 40, occupied })
    const b = planSpawnPosition({ index: 3, worldSize: 40, occupied })
    expect(a).toEqual(b)
    expect(a.y).toBe(SCENE_SPAWN_HEIGHT)
  })

  it('落点始终在场地内（留 1 米边距）', () => {
    for (let index = 0; index < 80; index += 1) {
      const spot = planSpawnPosition({ index, worldSize: 20 })
      expect(Math.abs(spot.x)).toBeLessThanOrEqual(9 + 1e-6)
      expect(Math.abs(spot.z)).toBeLessThanOrEqual(9 + 1e-6)
    }
  })

  it('已占满螺旋候选时仍会返回一个场地内的点，而不是抛错或返回 undefined', () => {
    // 用一个极大的占位集合逼它走完 160 个候选
    const occupied = Array.from({ length: 400 }, () => ({ x: 0, z: 0 }))
    const spot = planSpawnPosition({ index: 0, worldSize: 40, occupied })
    expect(Number.isFinite(spot.x)).toBe(true)
    expect(Number.isFinite(spot.z)).toBe(true)
    expect(Math.abs(spot.x)).toBeLessThanOrEqual(19 + 1e-6)
    expect(Math.abs(spot.z)).toBeLessThanOrEqual(19 + 1e-6)
  })
})
