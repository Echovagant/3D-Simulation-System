import { describe, it, expect } from 'vitest'
import { createFixedStepAccumulator } from './fixedStepAccumulator'

/**
 * 计划 014：固定步长累加器。
 *
 * 这里盯的是「同一个场景在不同机器上结果一致」这件事本身：
 * 真实时间怎么被切成物理步，决定了仿真结果会不会随刷新率漂移。
 */

const FIXED_DT = 1 / 60
const MAX_SUB_STEPS = 5
const GRAVITY = -9.81

/**
 * 自由落体积分（每步固定 dt）。
 *
 * 恒定加速度下这个形式是精确解（不是近似），因此可以直接拿解析解对照：
 * 跑了 n 步 ⇒ 位移 = 0.5 * g * (n * dt)^2。
 */
const simulateFreeFall = (deltaPerFrame: number, frames: number) => {
  const accumulator = createFixedStepAccumulator(FIXED_DT, MAX_SUB_STEPS, 0.25)
  let y = 0
  let v = 0
  let steps = 0

  for (let i = 0; i < frames; i++) {
    accumulator.advance(deltaPerFrame, 1, () => {
      y += v * FIXED_DT + 0.5 * GRAVITY * FIXED_DT * FIXED_DT
      v += GRAVITY * FIXED_DT
      steps++
    })
  }

  return { y, v, steps }
}

describe('固定步长累加器', () => {
  it('100ms 真实时间推进 6 个 1/60 的物理步', () => {
    // 上限给足：这里要验证的是「100ms = 6 个 1/60」这件事本身
    const accumulator = createFixedStepAccumulator(FIXED_DT, 10, 0.25)
    let steps = 0

    accumulator.advance(0.1, 1, () => {
      steps++
    })

    expect(steps).toBe(6)
    expect(accumulator.pending).toBeCloseTo(0, 10)
  })

  it('帧率不同，跑同样长的真实时间，落点与末速度完全一致', () => {
    // 三种帧率都覆盖 2 秒真实时间 = 120 个物理步
    const at60 = simulateFreeFall(FIXED_DT * 1, 120)
    const at30 = simulateFreeFall(FIXED_DT * 2, 60)
    const at144 = simulateFreeFall(FIXED_DT * 0.5, 240)

    expect(at60.steps).toBe(120)
    expect(at30.steps).toBe(120)
    expect(at144.steps).toBe(120)

    expect(at30.y).toBe(at60.y)
    expect(at144.y).toBe(at60.y)
    expect(at30.v).toBe(at60.v)
    expect(at144.v).toBe(at60.v)

    // 解析解：自由落体 2 秒
    expect(at60.y).toBeCloseTo(0.5 * GRAVITY * 4, 6)
    expect(at60.v).toBeCloseTo(GRAVITY * 2, 6)
  })

  it('低帧率下步数按真实时间补齐，而不是每帧只推进一步', () => {
    // 15fps：每帧 0.0667 秒 = 4 个物理步，1 秒真实时间应当推进 60 步
    const at15 = simulateFreeFall(1 / 15, 15)

    expect(at15.steps).toBe(60)
    // 旧的实现是「每渲染帧推进一步」：15fps 只会推进 15 步（仿真只跑 1/4 速）
    expect(at15.y).toBeCloseTo(0.5 * GRAVITY * 1, 6)
  })

  it('maxSubSteps 截断：一帧再长也只推进 maxSubSteps 步，积压被丢弃', () => {
    const accumulator = createFixedStepAccumulator(FIXED_DT, MAX_SUB_STEPS, 0.25)
    let steps = 0

    // 1 秒真实时间本该推进 60 步，但单帧上限是 5 步
    accumulator.advance(1, 1, () => {
      steps++
    })

    expect(steps).toBe(MAX_SUB_STEPS)
    // 剩余积压被丢掉：不丢的话会逐帧累积，形成「追帧 → 更卡 → 更少帧」的死循环
    expect(accumulator.pending).toBe(0)
  })

  it('单帧采纳的真实时间有上限：后台标签页切回来不会一次性补几百步', () => {
    const accumulator = createFixedStepAccumulator(FIXED_DT, MAX_SUB_STEPS, 0.25)
    let steps = 0

    accumulator.advance(10, 1, () => {
      steps++
    })

    // 10 秒真实时间被截到 0.25 秒 = 15 步，再被 maxSubSteps 截到 5 步
    expect(steps).toBe(MAX_SUB_STEPS)
    expect(accumulator.pending).toBe(0)
  })

  it('速度倍率决定每秒执行多少个固定步', () => {
    const accumulator = createFixedStepAccumulator(FIXED_DT, 20, 0.25)
    let steps = 0
    const step = () => {
      steps++
    }

    accumulator.advance(0.1, 1, step)
    expect(steps).toBe(6)

    // 2× 速度：同样 0.1 秒真实时间推进 12 步
    steps = 0
    accumulator.advance(0.1, 2, step)
    expect(steps).toBe(12)

    // 0.5× 速度：0.1 秒只够 3 步
    steps = 0
    const slow = createFixedStepAccumulator(FIXED_DT, 20, 0.25)
    slow.advance(0.1, 0.5, step)
    expect(steps).toBe(3)
  })

  it('凑不满一个步的余量会留到下一帧，不会被丢掉', () => {
    const accumulator = createFixedStepAccumulator(FIXED_DT, MAX_SUB_STEPS, 0.25)
    let steps = 0
    const step = () => {
      steps++
    }

    accumulator.advance(FIXED_DT * 1.5, 1, step)
    expect(steps).toBe(1)
    expect(accumulator.pending).toBeCloseTo(FIXED_DT * 0.5, 10)

    // 下一帧补上剩余的半步
    accumulator.advance(FIXED_DT * 0.5, 1, step)
    expect(steps).toBe(2)
    expect(accumulator.pending).toBeCloseTo(0, 10)
  })

  it('reset 清空积压：恢复时不会突然跳一大段', () => {
    const accumulator = createFixedStepAccumulator(FIXED_DT, MAX_SUB_STEPS, 0.25)
    let steps = 0
    const step = () => {
      steps++
    }

    accumulator.advance(FIXED_DT * 1.5, 1, step)
    expect(accumulator.pending).toBeGreaterThan(0)

    accumulator.reset()
    expect(accumulator.pending).toBe(0)

    // 积压没了：半帧时间推进不了任何一步
    accumulator.advance(FIXED_DT * 0.5, 1, step)
    expect(steps).toBe(1)
  })

  it('负数/非法的 delta 与 speed 不会让物理倒退', () => {
    const accumulator = createFixedStepAccumulator(FIXED_DT, MAX_SUB_STEPS, 0.25)
    let steps = 0
    const step = () => {
      steps++
    }

    accumulator.advance(-1, 1, step)
    accumulator.advance(0.1, -3, step)
    expect(steps).toBe(0)
    expect(accumulator.pending).toBe(0)
  })

  it('步长与步数上限非法时立即报错，不允许悄悄用错值', () => {
    expect(() => createFixedStepAccumulator(0, 5)).toThrow()
    expect(() => createFixedStepAccumulator(FIXED_DT, 0)).toThrow()
  })
})
