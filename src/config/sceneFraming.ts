/**
 * 3D 场景的取景参数。
 *
 * ⚠️ 相机位置、视野角、**目标点**必须放在一起，因为它们是配套的：
 * 轨道控制器的 `target` 和相机的 `lookAt` 必须是**同一个点**。
 *
 * 不一致时不会立刻报错——控制器会在第一次 `update()` 时把相机改瞄到 target 那个点，
 * 于是画面里的内容整体被压偏（就是「场景偏下」那一下）。
 * 仿真实验室之前就踩过：相机 `lookAt(0,0,0)`，控制器 `target.set(0,2,0)`。
 *
 * 写成一份、两个地方都从这儿取，就不会再对不上。
 */

/** 一组取景参数 */
export interface SceneFraming {
  /** 相机位置 */
  position: { x: number; y: number; z: number }
  /** 视野角（度） */
  fov: number
  /** 相机与轨道控制器共用的目标点 */
  target: { x: number; y: number; z: number }
}

/**
 * 仿真实验室的取景。
 *
 * 正对场地中心、俯角 45°、视野 60°：20×20 米的地面整块铺进画面，
 * 物体在画面里够大，上半屏不留一片黑。
 */
export const labFraming: SceneFraming = {
  position: { x: 0, y: 6, z: 6 },
  fov: 60,
  target: { x: 0, y: 0, z: 0 },
}

/**
 * AI 演武场的取景。
 *
 * 场地是 48×48 米，比实验室大一倍多，相机也得相应退远：
 * 正对中心、俯角约 38°、视野 50°，整块场地收进画面，围墙读得出来。
 */
export const arenaFraming: SceneFraming = {
  position: { x: 0, y: 27, z: 34 },
  fov: 50,
  target: { x: 0, y: 0, z: 0 },
}
