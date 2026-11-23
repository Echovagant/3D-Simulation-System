import { describe, expect, it } from 'vitest'
import {
  createPrimitiveMesh,
  isPrimitiveType,
  WEDGE_INDICES,
  WEDGE_VERTICES,
} from './primitiveFactory'

describe('primitiveFactory —— 斜面（楔形）基础体', () => {
  it('isPrimitiveType 认识 ramp，旧类型不受影响', () => {
    expect(isPrimitiveType('ramp')).toBe(true)
    expect(isPrimitiveType('cube')).toBe(true)
    expect(isPrimitiveType('sphere')).toBe(true)
    expect(isPrimitiveType('cone')).toBe(false)
    expect(isPrimitiveType('')).toBe(false)
  })

  it('createPrimitiveMesh("ramp") 返回共享楔形几何：6 顶点 / 24 索引 / 基准占地 1×1 高 1', () => {
    const mesh = createPrimitiveMesh('ramp', { name: 'Ramp' })
    const geometry = mesh.geometry
    expect(mesh.name).toBe('Ramp')
    expect(geometry.getAttribute('position').count).toBe(6)
    expect(geometry.index?.count).toBe(24)

    geometry.computeBoundingBox()
    const box = geometry.boundingBox!
    expect(box.min.x).toBeCloseTo(-0.5)
    expect(box.max.x).toBeCloseTo(0.5)
    expect(box.min.y).toBeCloseTo(-0.5)
    expect(box.max.y).toBeCloseTo(0.5)
    expect(box.min.z).toBeCloseTo(-0.5)
    expect(box.max.z).toBeCloseTo(0.5)
    // 基准包围盒断言后把共享材质释放掉：mesh.material 类型是联合类型，需收窄
    ;(mesh.material as import('three').MeshStandardMaterial).dispose()
  })

  it('楔形数据自洽：索引都在顶点范围内，每个三角面法线都朝外（不漏底、不空心）', () => {
    expect(WEDGE_VERTICES.length).toBe(18)
    expect(WEDGE_INDICES.length % 3).toBe(0)
    for (const idx of WEDGE_INDICES) {
      expect(idx).toBeGreaterThanOrEqual(0)
      expect(idx).toBeLessThan(6)
    }

    const v = (i: number): [number, number, number] => [
      WEDGE_VERTICES[i * 3],
      WEDGE_VERTICES[i * 3 + 1],
      WEDGE_VERTICES[i * 3 + 2],
    ]

    // 实体的形心：6 个顶点的平均值
    const centroid: [number, number, number] = [0, 0, 0]
    for (let i = 0; i < 6; i += 1) {
      const [x, y, z] = v(i)
      centroid[0] += x / 6
      centroid[1] += y / 6
      centroid[2] += z / 6
    }

    for (let i = 0; i < WEDGE_INDICES.length; i += 3) {
      const [ia, ib, ic] = [WEDGE_INDICES[i], WEDGE_INDICES[i + 1], WEDGE_INDICES[i + 2]]
      const a = v(ia)
      const b = v(ib)
      const c = v(ic)
      const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
      const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
      const normal = [
        ab[1] * ac[2] - ab[2] * ac[1],
        ab[2] * ac[0] - ab[0] * ac[2],
        ab[0] * ac[1] - ab[1] * ac[0],
      ]
      // 面心相对实体形心的方向，应当与法线同向（点积 > 0 才是朝外）
      const faceCenter = [
        (a[0] + b[0] + c[0]) / 3,
        (a[1] + b[1] + c[1]) / 3,
        (a[2] + b[2] + c[2]) / 3,
      ]
      const outward = [
        faceCenter[0] - centroid[0],
        faceCenter[1] - centroid[1],
        faceCenter[2] - centroid[2],
      ]
      const dot = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2]
      expect(dot, `第 ${i / 3 + 1} 个三角面绕序朝内`).toBeGreaterThan(0)
    }
  })

  it('前端封面绕序朝 +z（曾因 3,5,4 反向导致从正面看是空心）', () => {
    const v = (i: number): [number, number, number] => [
      WEDGE_VERTICES[i * 3],
      WEDGE_VERTICES[i * 3 + 1],
      WEDGE_VERTICES[i * 3 + 2],
    ]
    const [a, b, c] = [v(3), v(4), v(5)]
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const normalZ = ab[0] * ac[1] - ab[1] * ac[0]
    expect(normalZ).toBeGreaterThan(0)
  })
})
