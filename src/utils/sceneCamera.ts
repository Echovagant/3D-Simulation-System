/**
 * 场景镜头的运行时校验。
 *
 * 镜头来自场景文档（可能由外部导入、后端返回或 LLM 生成），
 * 因此和物体一样属于不可信输入：NaN、缺失字段、离谱的 fov
 * 必须在进入相机之前就被收敛掉，否则整个投影矩阵会失效（画面全黑）。
 */
import type { SceneCamera } from '@/types'
import { SCENE_PRESENTATION } from '@/config/scenePresentation'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const readPoint = (
  raw: unknown,
): { x: number; y: number; z: number } | null => {
  if (!isRecord(raw)) return null
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.z)) {
    return null
  }
  // 场景尺度上限 200 米：超出这个范围的机位一定是坏数据
  const clamp = (value: number) => Math.min(200, Math.max(-200, value))
  return { x: clamp(raw.x), y: clamp(raw.y), z: clamp(raw.z) }
}

/**
 * 把任意输入收敛成合法镜头；读不出来返回 null（调用方保持当前机位）。
 */
export const normalizeSceneCamera = (raw: unknown): SceneCamera | null => {
  if (!isRecord(raw)) return null
  const position = readPoint(raw.position)
  const target = readPoint(raw.target)
  if (!position || !target) return null

  const fov = isFiniteNumber(raw.fov)
    ? Math.min(90, Math.max(25, raw.fov))
    : SCENE_PRESENTATION.defaultFov

  return { position, target, fov }
}
