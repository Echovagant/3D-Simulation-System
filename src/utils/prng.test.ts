import { describe, expect, it } from 'vitest'
import { createRandom, DEFAULT_SEED } from './prng'

describe('LCG 伪随机数', () => {
  it('同一种子产出逐位相同的序列——可复现的根基', () => {
    const a = createRandom(DEFAULT_SEED)
    const b = createRandom(DEFAULT_SEED)
    const seqA = Array.from({ length: 8 }, () => a())
    const seqB = Array.from({ length: 8 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('不同种子产出不同序列', () => {
    const a = createRandom(1)
    const b = createRandom(2)
    const seqA = Array.from({ length: 4 }, () => a())
    const seqB = Array.from({ length: 4 }, () => b())
    expect(seqA).not.toEqual(seqB)
  })

  it('输出落在 [0, 1) 区间', () => {
    const random = createRandom(DEFAULT_SEED)
    for (let i = 0; i < 1000; i++) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})
