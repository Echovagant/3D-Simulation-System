import { describe, expect, it } from 'vitest'
import { normalizeSceneDocument, parseSceneDocumentJson } from './sceneDocument'
import { DEFAULT_SCENE_WORLD_SIZE } from '@/config/sceneEditor'

const validDocument = {
  id: 'demo-1',
  name: '演示场景',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  version: 1,
  worldSize: 60,
  objects: [
    {
      uuid: 'cube-1',
      type: 'cube',
      name: '立方体',
      position: { x: 1, y: 2, z: 3 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
      color: 0x4f9dff,
      physics: { type: 'static', shape: 'box', mass: 1 },
    },
  ],
}

describe('场景文档导入校验', () => {
  it('合法的导出文档能原样通过校验（JSON 往返）', () => {
    const parsed = parseSceneDocumentJson(JSON.stringify(validDocument))
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.id).toBe('demo-1')
    expect(parsed.document.name).toBe('演示场景')
    expect(parsed.document.worldSize).toBe(60)
    expect(parsed.document.objects).toHaveLength(1)
    expect(parsed.document.objects[0]).toMatchObject({
      uuid: 'cube-1',
      type: 'cube',
      color: 0x4f9dff,
      physics: { type: 'static', shape: 'box', mass: 1 },
    })
  })

  it('缺省字段按合理值补齐：rotation=0、scale=1、visible=true、worldSize=默认', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'sphere',
          position: { x: 0, y: 1, z: 0 },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    const object = parsed.document.objects[0]
    expect(object.rotation).toEqual({ x: 0, y: 0, z: 0 })
    expect(object.scale).toEqual({ x: 1, y: 1, z: 1 })
    expect(object.visible).toBe(true)
    expect(object.uuid).toBeTruthy()
    expect(parsed.document.worldSize).toBe(DEFAULT_SCENE_WORLD_SIZE)
  })

  it('不认识的物体类型直接拒绝，并指出是第几个', () => {
    const parsed = normalizeSceneDocument({
      objects: [{ type: 'cone', position: { x: 0, y: 1, z: 0 } }],
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('第 1 个物体')
    expect(parsed.error).toContain('cone')
  })

  it('模型缺 modelId 时拒绝导入', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'model',
          name: '机甲',
          position: { x: 0, y: 1, z: 0 },
        },
      ],
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('modelId')
  })

  it('坐标不是有限数字时拒绝导入', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'cube',
          position: { x: Number.NaN, y: 1, z: 0 },
        },
      ],
    })
    expect(parsed.ok).toBe(false)
  })

  it('不是 JSON 时给出可读错误而不是抛异常', () => {
    const parsed = parseSceneDocumentJson('{ 这不是 JSON')
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('JSON')
  })

  it('非法镜头被丢弃，物体照常通过（镜头是可选增强，不该拖垮导入）', () => {
    const parsed = normalizeSceneDocument({
      camera: { position: { x: '左', y: 1, z: 0 }, target: { x: 0, y: 0, z: 0 } },
      objects: [{ type: 'cube', position: { x: 0, y: 1, z: 0 } }],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.document.camera).toBeUndefined()
  })

  it('合法镜头原样通过，fov 缺省补 50', () => {
    const parsed = normalizeSceneDocument({
      camera: { position: { x: 10, y: 8, z: 12 }, target: { x: 0, y: 2, z: 0 } },
      objects: [],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.document.camera).toEqual({
      position: { x: 10, y: 8, z: 12 },
      target: { x: 0, y: 2, z: 0 },
      fov: 50,
    })
  })

  it('物理参数 friction / restitution 随文档往返保留', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'cube',
          position: { x: 0, y: 0.5, z: 0 },
          physics: {
            type: 'dynamic',
            shape: 'box',
            mass: 2,
            friction: 0.35,
            restitution: 0.75,
          },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.objects[0].physics).toEqual({
      type: 'dynamic',
      shape: 'box',
      mass: 2,
      friction: 0.35,
      restitution: 0.75,
    })
  })

  it('旧文档缺少 friction / restitution 时补默认 0.5 / 0.2', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'sphere',
          position: { x: 0, y: 1, z: 0 },
          physics: { type: 'static', shape: 'sphere', mass: 1 },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.objects[0].physics).toMatchObject({
      mass: 1,
      friction: 0.5,
      restitution: 0.2,
    })
  })

  it('越界的 friction / restitution 被夹到 0~1，非数字回落默认值', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'cube',
          position: { x: 0, y: 0.5, z: 0 },
          physics: {
            type: 'dynamic',
            shape: 'box',
            mass: 1,
            friction: 5,
            restitution: -2,
          },
        },
        {
          type: 'cube',
          position: { x: 2, y: 0.5, z: 0 },
          physics: {
            type: 'dynamic',
            shape: 'box',
            mass: 1,
            friction: '很滑',
            restitution: Number.NaN,
          },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.objects[0].physics).toMatchObject({
      friction: 1,
      restitution: 0,
    })
    expect(parsed.document.objects[1].physics).toMatchObject({
      friction: 0.5,
      restitution: 0.2,
    })
  })

  it('材质参数 metalness / roughness 随文档往返保留', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'cube',
          position: { x: 0, y: 0.5, z: 0 },
          color: 0xb8bcc2,
          material: { metalness: 0.85, roughness: 0.35 },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.objects[0].material).toEqual({
      metalness: 0.85,
      roughness: 0.35,
    })
  })

  it('旧文档没有 material 字段时保持缺省（沿用编辑器默认材质）', () => {
    const parsed = normalizeSceneDocument({
      objects: [{ type: 'sphere', position: { x: 0, y: 1, z: 0 } }],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.objects[0].material).toBeUndefined()
  })

  it('越界的 material 被夹到 0~1，非数字回退默认 0.08 / 0.58', () => {
    const parsed = normalizeSceneDocument({
      objects: [
        {
          type: 'cube',
          position: { x: 0, y: 0.5, z: 0 },
          material: { metalness: 5, roughness: -2 },
        },
        {
          type: 'cube',
          position: { x: 2, y: 0.5, z: 0 },
          material: { metalness: '很亮', roughness: Number.NaN },
        },
      ],
    })
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return

    expect(parsed.document.objects[0].material).toEqual({ metalness: 1, roughness: 0 })
    expect(parsed.document.objects[1].material).toEqual({ metalness: 0.08, roughness: 0.58 })
  })

  it('物体数量超过上限时拒绝，避免一份文件把页面拖死', () => {
    const parsed = normalizeSceneDocument({
      objects: Array.from({ length: 501 }, () => ({
        type: 'cube',
        position: { x: 0, y: 1, z: 0 },
      })),
    })
    expect(parsed.ok).toBe(false)
    if (parsed.ok) return
    expect(parsed.error).toContain('上限')
  })
})
