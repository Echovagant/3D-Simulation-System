import { describe, it, expect } from 'vitest'
import { calculateVolume } from './usePhysics'

describe('calculateVolume', () => {
  it('长方体体积是三边之积', () => {
    expect(calculateVolume('box', { x: 2, y: 3, z: 4 })).toBe(24)
  })

  it('球体体积按半径的三次方计算', () => {
    const volume = calculateVolume('sphere', { x: 2, y: 2, z: 2 })
    expect(volume).toBeCloseTo((4 / 3) * Math.PI, 6)
  })

  it('圆柱体体积按底面积乘高计算', () => {
    const volume = calculateVolume('cylinder', { x: 2, y: 3, z: 2 })
    expect(volume).toBeCloseTo(Math.PI * 3, 6)
  })

  it('未知形状退化成 1', () => {
    expect(calculateVolume('mesh', { x: 1, y: 1, z: 1 })).toBe(1)
  })
})
