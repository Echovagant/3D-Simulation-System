import type * as RapierModule from '@dimforge/rapier3d'

/**
 * 物理引擎按需加载：Rapier 带 WASM，体积大，不能进主包。
 *
 * 单独成模块（而不是直接写在 useSceneEditor 里）的唯一原因是可测性——
 * 测试可以用替身替换掉这一层动态 import，从而在 jsdom 里跑通
 * 「创建物体 → 删除物体 → 刚体离开物理世界」的完整链路。
 * 生产环境的行为与之前完全一致：仍然是运行时才加载 Rapier。
 */
export const loadRapier = async (): Promise<typeof RapierModule> => {
  const rapierModule = await import('@dimforge/rapier3d')
  return rapierModule
}
