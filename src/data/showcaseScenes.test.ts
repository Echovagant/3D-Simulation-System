import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import { SHOWCASE_SCENES } from './showcaseScenes'
import { normalizeSceneDocument } from '@/utils/sceneDocument'
import { SCENE_WORLD_SIZES } from '@/config/sceneEditor'
import type { SceneDocument, SceneDocumentObject } from '@/types'

/**
 * 地面/底板类物体：又宽又薄，本来就该铺出画面。
 * 取景检查不把它们算进裁切判断——把整块 36×28 的底板塞进画面，
 * 相机得退到 60 米外，主体反而变成一小块（作品感恰恰来自「底板延伸出画」）。
 */
const isGroundPlate = (object: SceneDocumentObject): boolean =>
  Math.abs(object.scale.y) <= 0.5 &&
  (Math.abs(object.scale.x) >= 8 || Math.abs(object.scale.z) >= 8)

/** 把一个物体（含旋转）摊成世界坐标的 8 个角点 */
const objectCorners = (object: SceneDocumentObject): THREE.Vector3[] => {
  const half = new THREE.Vector3(
    Math.abs(object.scale.x) / 2,
    Math.abs(object.scale.y) / 2,
    Math.abs(object.scale.z) / 2,
  )
  const rotation = new THREE.Matrix4().makeRotationFromEuler(
    new THREE.Euler(object.rotation.x, object.rotation.y, object.rotation.z),
  )
  const position = new THREE.Vector3(object.position.x, object.position.y, object.position.z)
  const corners: THREE.Vector3[] = []
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const corner = new THREE.Vector3(half.x * x, half.y * y, half.z * z)
        corner.applyMatrix4(rotation).add(position)
        corners.push(corner)
      }
    }
  }
  return corners
}

/**
 * 算镜头在给定宽高比下的取景占比。
 *
 * 返回 { maxX, maxY }：所有物体角点在 NDC 上的最大绝对值（1 = 刚好贴边）。
 * 大于 1 说明有物体被裁掉，小于 0.5 说明主体太小。
 */
const measureFraming = (
  document: SceneDocument,
  aspect: number,
): { maxX: number; maxY: number } => {
  const spec = document.camera
  if (!spec) throw new Error('场景缺少镜头')

  const position = new THREE.Vector3(spec.position.x, spec.position.y, spec.position.z)
  const target = new THREE.Vector3(spec.target.x, spec.target.y, spec.target.z)
  const forward = target.clone().sub(position).normalize()
  const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize()
  const up = new THREE.Vector3().crossVectors(right, forward).normalize()
  const tanV = Math.tan(((spec.fov ?? 50) * Math.PI) / 360)
  const tanH = tanV * aspect

  let maxX = 0
  let maxY = 0
  for (const object of document.objects) {
    if (isGroundPlate(object)) continue
    for (const corner of objectCorners(object)) {
      const offset = corner.clone().sub(position)
      const depth = offset.dot(forward)
      expect(depth, `${object.name} 在相机背后`).toBeGreaterThan(0)
      maxX = Math.max(maxX, Math.abs(offset.dot(right)) / depth / tanH)
      maxY = Math.max(maxY, Math.abs(offset.dot(up)) / depth / tanV)
    }
  }
  return { maxX, maxY }
}

describe('精选场景数据', () => {
  it('至少覆盖教学、具身智能、企业办公、创意可视化四类用户', () => {
    const audiences = new Set(SHOWCASE_SCENES.map((scene) => scene.audience))
    expect(SHOWCASE_SCENES.length).toBeGreaterThanOrEqual(4)
    expect(audiences).toEqual(
      new Set(['教学', '具身智能', '企业办公', '创意可视化']),
    )
  })

  it('每个场景都能通过导入校验（不会出现「能显示但导不回去」）', () => {
    for (const scene of SHOWCASE_SCENES) {
      const parsed = normalizeSceneDocument(scene.document)
      expect(parsed.ok, `${scene.name} 校验失败`).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.document.objects.length).toBe(scene.document.objects.length)
      expect(SCENE_WORLD_SIZES).toContain(parsed.document.worldSize)
    }
  })

  it('场景 id 与物体 uuid 全局唯一，名字统一带「精选 · 」前缀', () => {
    const ids = new Set<string>()
    const uuids = new Set<string>()
    for (const scene of SHOWCASE_SCENES) {
      expect(scene.name.startsWith('精选 · ')).toBe(true)
      expect(ids.has(scene.id)).toBe(false)
      ids.add(scene.id)
      for (const object of scene.document.objects) {
        expect(uuids.has(object.uuid), `重复 uuid: ${object.uuid}`).toBe(false)
        uuids.add(object.uuid)
      }
    }
  })

  it('颜色都是合法的十六进制值', () => {
    for (const scene of SHOWCASE_SCENES) {
      for (const object of scene.document.objects) {
        expect(object.color).toBeTypeOf('number')
        expect(object.color!).toBeGreaterThanOrEqual(0)
        expect(object.color!).toBeLessThanOrEqual(0xffffff)
      }
    }
  })

  it('每个场景都带可用的初始镜头，且校验后不丢镜头', () => {
    for (const scene of SHOWCASE_SCENES) {
      expect(scene.document.camera, `${scene.name} 缺少镜头`).toBeTruthy()
      const parsed = normalizeSceneDocument(scene.document)
      expect(parsed.ok, `${scene.name} 校验失败`).toBe(true)
      if (!parsed.ok) continue
      expect(parsed.document.camera).toEqual(scene.document.camera)
    }
  })

  it('每个场景都有静态结构 + 至少一个动态演示件', () => {
    for (const scene of SHOWCASE_SCENES) {
      const types = scene.document.objects.map((object) => object.physics?.type)
      expect(types).toContain('static')
      expect(types).toContain('dynamic')
    }
  })

  it('镜头在 16:9 与 4:3 视口里都装得下全部物体，且主体不缩成一小块', () => {
    for (const scene of SHOWCASE_SCENES) {
      for (const aspect of [16 / 9, 4 / 3]) {
        const { maxX, maxY } = measureFraming(scene.document, aspect)
        const label = `${scene.name} @ ${aspect.toFixed(2)}`
        // 1.02 给边框留 2% 余量：贴边不算裁切
        expect(maxX, `${label} 水平裁切（${maxX.toFixed(2)}）`).toBeLessThanOrEqual(1.02)
        expect(maxY, `${label} 垂直裁切（${maxY.toFixed(2)}）`).toBeLessThanOrEqual(1.02)
        // 主体至少占画面一半：太低就是「场景缩在中间一小块」
        expect(Math.max(maxX, maxY), `${label} 主体过小`).toBeGreaterThanOrEqual(0.5)
      }
    }
  })
})
