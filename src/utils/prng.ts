/**
 * 线性同余伪随机数（LCG）。
 *
 * 为什么自己写而不用 Math.random：**可复现**。同一颗种子喂进去，
 * 吐出来的序列逐位相同——场地布局、随机出生点这些「实验条件」
 * 就能写进报告、跑回归，而不是每次刷新换一副样子。
 *
 * 使用方：AI 演武场的障碍布局（useAI）与场景编辑器的随机出生点
 * （useSceneEditor）——M4 种子参数化把两者都收到这一颗 PRNG 上。
 */

/** 默认种子：不指定时全场共用这一颗（沿用原 ARENA_SEED 的值，保持既有布局不变） */
export const DEFAULT_SEED = 20260101

export const createRandom = (seed: number): (() => number) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}
