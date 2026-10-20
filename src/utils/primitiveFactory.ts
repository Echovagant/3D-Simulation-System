import * as THREE from 'three'

/**
 * 基本体工厂（计划 018）。
 *
 * 「基本体」= 立方体 / 球体这类可以直接用几何体重建的物体。
 * 它们是场景文档里**唯一**能被完整还原的普通物体（模型另算），
 * 所以「加载场景」必须能重建它们，否则就是半成品闭环。
 *
 * 几何体是**共享**的：每次新建都 `new THREE.BoxGeometry(...)` 会白占一份显存，
 * 缩放走 `mesh.scale`（不动顶点），因此共用同一份几何体是标准做法。
 * 材质**不能**共享：选中高亮靠 `material.emissive`，共享材质会让所有物体一起变亮。
 */
export type PrimitiveType = 'cube' | 'sphere'

const sharedGeometries: Record<PrimitiveType, THREE.BufferGeometry> = {
  cube: new THREE.BoxGeometry(1, 1, 1),
  sphere: new THREE.SphereGeometry(0.5, 32, 32),
}

/** 取共享几何体（碰撞体的基准尺寸也按它换算：立方体半长 0.5、球体半径 0.5） */
export const getPrimitiveGeometry = (type: PrimitiveType): THREE.BufferGeometry =>
  sharedGeometries[type]

/**
 * 创建一个基本体 mesh（**不含刚体**）。
 *
 * 刚体归 useSceneEditor 所有：它是物理世界的唯一所有者，
 * 这里只负责「几何 + 材质 + 变换」。
 */
export const createPrimitiveMesh = (
  type: PrimitiveType,
  options: { color?: number; name?: string } = {},
): THREE.Mesh => {
  const material = new THREE.MeshStandardMaterial({
    color: options.color ?? 0x3498db,
    metalness: 0.3,
    roughness: 0.4,
  })

  const mesh = new THREE.Mesh(getPrimitiveGeometry(type), material)
  mesh.name = options.name ?? type
  mesh.castShadow = true
  return mesh
}

/** 判断一个类型是不是「可重建的基本体」 */
export const isPrimitiveType = (type: string): type is PrimitiveType =>
  type === 'cube' || type === 'sphere'
