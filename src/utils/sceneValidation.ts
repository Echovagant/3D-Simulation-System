/**
 * 场景静态校验（保存前 / 手动检查用）。
 *
 * 校验**不阻止保存**：它只回答「这个场景摆得对不对」，把问题和物体绑定，
 * 界面点一条就能选中对应物体。规则的取舍都以「不误报正常贴地物体」为准——
 * 一个把落地方块标成错误的检查器，用户第二次就不会再点它。
 *
 * 尺寸近似：这里只有场景文档（没有 three 对象），包围盒按基本体的基准尺寸
 * 与缩放估算；模型按导入时的归一化尺度（maxDim = 2，半长 1）估算。
 */
import * as THREE from 'three'
import type { SceneDocument, SceneDocumentObject } from '@/types'
import { normalizeWorldSize } from '@/config/sceneEditor'

export type SceneValidationLevel = 'error' | 'warning'

export type SceneValidationCode =
  | 'out-of-bounds'
  | 'invalid-scale'
  | 'below-ground'
  | 'floating-static'
  | 'static-overlap'

export interface SceneValidationIssue {
  level: SceneValidationLevel
  code: SceneValidationCode
  /** 可直接展示给用户的中文说明 */
  message: string
  uuid: string
  name: string
}

export type SceneValidationInput = {
  objects: SceneDocumentObject[]
  worldSize?: number
}

type Vec3 = { x: number; y: number; z: number }
type Aabb = { min: Vec3; max: Vec3 }

/** 浮点误差容忍：贴地物体的底面正好是 0，不该被「差 1e-9」判成深穿 */
const EPSILON = 1e-6
/** 底部低于这条线视为深穿地面（米） */
const GROUND_PENETRATION_LIMIT = -0.1
/** 静态物体底部高于这条线视为悬空（米） */
const FLOATING_LIMIT = 0.05
/** 最薄方向小于这个尺寸视为薄片，不参与重叠提示（米） */
const THIN_PLATE_LIMIT = 0.2
/** 重叠体积超过较小 AABB 的这个比例才提示 */
const OVERLAP_RATIO = 0.6

/** 地面 / 底板 / 台面：它们天然与其他静态结构共面，不该报重叠 */
const GROUND_NAME_PATTERN = /(地面|地板|底板|地基|底座|ground|floor|platform|plate)/i

/** 本地包围盒半长（缩放为 1 时的基准尺寸），与建体时的几何基准保持一致 */
const localHalfExtents = (obj: SceneDocumentObject): Vec3 => {
  const sx = Math.abs(obj.scale.x)
  const sy = Math.abs(obj.scale.y)
  const sz = Math.abs(obj.scale.z)

  if (obj.type === 'sphere') {
    const radius = 0.5 * Math.max(sx, sy, sz)
    return { x: radius, y: radius, z: radius }
  }
  if (obj.type === 'cube' || obj.type === 'ramp') {
    // BoxGeometry(1,1,1) 与楔形顶点都在 ±0.5 内
    return { x: 0.5 * sx, y: 0.5 * sy, z: 0.5 * sz }
  }
  // 模型导入时统一归一到 maxDim = 2 → 半长 1
  return { x: sx, y: sy, z: sz }
}

/** 旋转后的世界包围盒（用旋转矩阵的绝对值把局部半长投到世界三轴） */
const computeAabb = (obj: SceneDocumentObject): Aabb => {
  const half = localHalfExtents(obj)
  const matrix = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(obj.rotation.x, obj.rotation.y, obj.rotation.z, 'XYZ'),
  )
  const e = matrix.elements
  const ex = Math.abs(e[0]) * half.x + Math.abs(e[4]) * half.y + Math.abs(e[8]) * half.z
  const ey = Math.abs(e[1]) * half.x + Math.abs(e[5]) * half.y + Math.abs(e[9]) * half.z
  const ez = Math.abs(e[2]) * half.x + Math.abs(e[6]) * half.y + Math.abs(e[10]) * half.z

  return {
    min: { x: obj.position.x - ex, y: obj.position.y - ey, z: obj.position.z - ez },
    max: { x: obj.position.x + ex, y: obj.position.y + ey, z: obj.position.z + ez },
  }
}

const sizeOf = (aabb: Aabb): Vec3 => ({
  x: aabb.max.x - aabb.min.x,
  y: aabb.max.y - aabb.min.y,
  z: aabb.max.z - aabb.min.z,
})

const volumeOf = (aabb: Aabb): number => {
  const size = sizeOf(aabb)
  return Math.max(0, size.x) * Math.max(0, size.y) * Math.max(0, size.z)
}

const containsAabb = (outer: Aabb, inner: Aabb): boolean =>
  inner.min.x >= outer.min.x - EPSILON &&
  inner.max.x <= outer.max.x + EPSILON &&
  inner.min.y >= outer.min.y - EPSILON &&
  inner.max.y <= outer.max.y + EPSILON &&
  inner.min.z >= outer.min.z - EPSILON &&
  inner.max.z <= outer.max.z + EPSILON

const isStatic = (obj: SceneDocumentObject): boolean => obj.physics?.type === 'static'

/** 地面 / 底板：名字明确，或「静态 + 又薄又大的贴地平板」 */
const isGroundLike = (obj: SceneDocumentObject, aabb: Aabb, worldSize: number): boolean => {
  if (GROUND_NAME_PATTERN.test(obj.name)) return true
  if (!isStatic(obj)) return false

  const size = sizeOf(aabb)
  const area = size.x * size.z
  return (
    size.y <= 0.4 &&
    aabb.min.y <= 0.1 &&
    area >= worldSize * worldSize * 0.15
  )
}

const intersectionVolume = (a: Aabb, b: Aabb): number => {
  const x = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x)
  const y = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y)
  const z = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z)
  if (x <= 0 || y <= 0 || z <= 0) return 0
  return x * y * z
}

const displayName = (obj: SceneDocumentObject): string => obj.name || obj.type

const formatNumber = (value: number): string => value.toFixed(2)

/**
 * 校验一个场景（也接受 `{ objects, worldSize }`）。
 *
 * 返回顺序固定：先按物体顺序给出错误与提示，再给出成对的重叠提示。
 */
export const validateScene = (
  input: SceneValidationInput | SceneDocument | null | undefined,
): SceneValidationIssue[] => {
  const objects = Array.isArray(input?.objects) ? input.objects : []
  const worldSize = normalizeWorldSize(input?.worldSize)
  const halfSize = worldSize / 2
  const issues: SceneValidationIssue[] = []

  const entries = objects.map((obj) => ({
    obj,
    aabb: computeAabb(obj),
    name: displayName(obj),
  }))

  for (const { obj, aabb, name } of entries) {
    const uuid = obj.uuid

    if (obj.scale.x <= 0 || obj.scale.y <= 0 || obj.scale.z <= 0) {
      issues.push({
        level: 'error',
        code: 'invalid-scale',
        message: `缩放必须大于 0（当前 ${formatNumber(obj.scale.x)} / ${formatNumber(
          obj.scale.y,
        )} / ${formatNumber(obj.scale.z)}）`,
        uuid,
        name,
      })
      // 缩放非法时包围盒没有意义，后续边界与穿地检查跳过
      continue
    }

    const outOfBounds: string[] = []
    if (aabb.min.x < -halfSize - EPSILON) outOfBounds.push(`X 最小 ${formatNumber(aabb.min.x)}`)
    if (aabb.max.x > halfSize + EPSILON) outOfBounds.push(`X 最大 ${formatNumber(aabb.max.x)}`)
    if (aabb.min.z < -halfSize - EPSILON) outOfBounds.push(`Z 最小 ${formatNumber(aabb.min.z)}`)
    if (aabb.max.z > halfSize + EPSILON) outOfBounds.push(`Z 最大 ${formatNumber(aabb.max.z)}`)

    if (outOfBounds.length > 0) {
      issues.push({
        level: 'error',
        code: 'out-of-bounds',
        message: `超出场地边界（${outOfBounds.join('、')} 米，场地范围 ±${halfSize} 米）`,
        uuid,
        name,
      })
    }

    if (aabb.min.y < GROUND_PENETRATION_LIMIT) {
      issues.push({
        level: 'error',
        code: 'below-ground',
        message: `底部低于地面 ${formatNumber(Math.abs(aabb.min.y))} 米（深穿地面）`,
        uuid,
        name,
      })
    } else if (
      isStatic(obj) &&
      aabb.min.y > FLOATING_LIMIT &&
      !isGroundLike(obj, aabb, worldSize)
    ) {
      issues.push({
        level: 'warning',
        code: 'floating-static',
        message: `静态物体底部悬空 ${formatNumber(aabb.min.y)} 米，没有支撑`,
        uuid,
        name,
      })
    }
  }

  // 静态 ↔ 静态的重叠：薄片、嵌套件、地面/底板都跳过，只提示真正「撞在一起」的结构
  for (let i = 0; i < entries.length; i += 1) {
    for (let j = i + 1; j < entries.length; j += 1) {
      const first = entries[i]
      const second = entries[j]
      if (!isStatic(first.obj) || !isStatic(second.obj)) continue
      if (isGroundLike(first.obj, first.aabb, worldSize)) continue
      if (isGroundLike(second.obj, second.aabb, worldSize)) continue

      const firstSize = sizeOf(first.aabb)
      const secondSize = sizeOf(second.aabb)
      const firstThin = Math.min(firstSize.x, firstSize.y, firstSize.z) < THIN_PLATE_LIMIT
      const secondThin = Math.min(secondSize.x, secondSize.y, secondSize.z) < THIN_PLATE_LIMIT
      if (firstThin || secondThin) continue

      // 完全被包含的嵌套件（装饰、嵌入结构）不算重叠
      if (containsAabb(first.aabb, second.aabb) || containsAabb(second.aabb, first.aabb)) {
        continue
      }

      const overlap = intersectionVolume(first.aabb, second.aabb)
      if (overlap <= 0) continue

      const smallerVolume = Math.min(volumeOf(first.aabb), volumeOf(second.aabb))
      if (smallerVolume <= 0) continue
      if (overlap <= smallerVolume * OVERLAP_RATIO) continue

      issues.push({
        level: 'warning',
        code: 'static-overlap',
        message: `与「${second.name}」的包围盒重叠，重叠体积占较小者的 ${Math.round(
          (overlap / smallerVolume) * 100,
        )}%`,
        uuid: first.obj.uuid,
        name: first.name,
      })
    }
  }

  return issues
}
