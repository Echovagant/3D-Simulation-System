import type * as RapierModule from '@dimforge/rapier3d'

/** compat 构建的初始化 Promise——只跑一次 */
let initPromise: Promise<void> | null = null

/**
 * 物理引擎按需加载：Rapier 带 WASM，体积大，不能进主包。
 *
 * 单独成模块（而不是直接写在 useSceneEditor 里）的唯一原因是可测性——
 * 测试可以用替身替换掉这一层动态 import，从而在 jsdom 里跑通
 * 「创建物体 → 删除物体 → 刚体离开物理世界」的完整链路。
 * 生产环境的行为与之前完全一致：仍然是运行时才加载 Rapier。
 *
 * ⚠️ 官方包（`@dimforge/rapier3d`）在 import 时就自己完成了 WASM 初始化，
 * 压根不导出 `init`；compat 包（`@dimforge/rapier3d-compat`）则必须显式
 * `await init()` 才会加载内联的 WASM。测试环境把官方包别名到了 compat，
 * 所以这里按"有没有 init"来区分——两条路径都能用，且官方路径不会触发
 * compat 内部那条弃用警告。
 */
export const loadRapier = async (): Promise<typeof RapierModule> => {
  const rapierModule = await import('@dimforge/rapier3d')
  const maybeInit = (rapierModule as { init?: () => Promise<void> }).init
  if (typeof maybeInit === 'function') {
    // compat 的 init() 只能跑一次：重复调用会重复解一遍内联的 WASM
    initPromise = initPromise ?? maybeInit()
    await initPromise
  }
  return rapierModule
}
