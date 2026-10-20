/**
 * 固定步长累加器（fixed-step accumulator）。
 *
 * 物理必须用**固定步长**推进，否则同一个场景在不同机器上结果不可复现：
 * 可变步长会把「这一帧过了多久」渗进积分结果，帧率一变，落点就变。
 *
 * 用法：每帧把「这一帧过了多少真实时间」喂给 `advance()`，它把积压的时间
 * 切成若干个固定步长调用 `step()`。步长与显示刷新率**无关**——
 * 60Hz 屏每秒推进 60 步，30Hz 屏也是 60 步（只不过一帧多推几步）。
 *
 * 纯函数模块：不依赖 three / Rapier / Vue，因此可以在单元测试里直接验证。
 */

export interface FixedStepAccumulator {
  /**
   * 把一段真实时间切成固定步长调用 `step()`。
   *
   * @param deltaSeconds 这一帧过去的真实时间（秒）
   * @param speed 速度倍率：每秒执行多少个固定步（1 表示 1× 实时）
   * @param step 一个物理步
   * @returns 本次实际执行的步数
   */
  advance(deltaSeconds: number, speed: number, step: () => void): number
  /** 清空积压（暂停 / 重置时用） */
  reset(): void
  /** 当前积压的秒数（还没凑够一个完整步长的那部分） */
  readonly pending: number
}

/**
 * 步数的取整容差。
 *
 * 「累计时间 ÷ 步长」在浮点上可能落在整数下方一点点（例如 59.99999999999999），
 * 少了这个容差就会凭空丢掉一步、而且那一帧的时间再也补不回来。
 * 1e-9 步对应的时间误差是 1.7e-8 秒——物理上完全不可察觉。
 */
const STEP_EPSILON = 1e-9

/**
 * 创建一个固定步长累加器。
 *
 * @param fixedTimeStep 单个物理步的时长（秒），例如 1/60
 * @param maxSubSteps 单帧最多推进多少步——防止低帧率机器陷入「追帧 → 更卡 → 更少帧」的死循环
 * @param maxFrameDelta 单帧最多采纳多少真实时间（秒）。后台标签页切回来时 delta
 *   可能几十秒，不截断的话一次会补上几百步，物理瞬间炸开。
 */
export const createFixedStepAccumulator = (
  fixedTimeStep: number,
  maxSubSteps: number,
  maxFrameDelta: number = 0.25,
): FixedStepAccumulator => {
  if (!Number.isFinite(fixedTimeStep) || fixedTimeStep <= 0) {
    throw new Error('fixedTimeStep 必须是大于 0 的有限数')
  }
  if (!Number.isFinite(maxSubSteps) || maxSubSteps < 1) {
    throw new Error('maxSubSteps 必须是大于等于 1 的有限数')
  }

  // 已采纳的真实时间（秒）
  let accumulated = 0
  // 已执行的物理步数
  let stepsDone = 0

  return {
    advance(deltaSeconds: number, speed: number, step: () => void): number {
      // 单帧最多采纳 maxFrameDelta 秒
      const delta = Math.min(
        Math.max(Number.isFinite(deltaSeconds) ? deltaSeconds : 0, 0),
        maxFrameDelta,
      )
      const factor = Number.isFinite(speed) ? Math.max(speed, 0) : 0

      accumulated += delta * factor

      // 该执行到第几步：用除法一次算出来，而不是「反复减去一个步长」。
      // 反复相减会累积浮点误差——实测 144fps 下会凭空少推一步
      // （1 秒真实时间只推进 59 步），而且少掉的那一步时间再也补不回来。
      const due = Math.floor(accumulated / fixedTimeStep + STEP_EPSILON)
      let steps = due - stepsDone
      if (steps <= 0) return 0

      if (steps > maxSubSteps) {
        // 步数用尽仍有积压（低帧率机器）：丢掉剩余积压。
        // 不丢的话积压会逐帧累积，形成越追越慢、越慢越追的死循环。
        stepsDone = due
        steps = maxSubSteps
      }

      for (let i = 0; i < steps; i++) {
        step()
      }
      stepsDone = due

      return steps
    },

    reset(): void {
      accumulated = 0
      stepsDone = 0
    },

    get pending(): number {
      return Math.max(0, accumulated - stepsDone * fixedTimeStep)
    },
  }
}
