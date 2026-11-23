import { describe, expect, it } from 'vitest'
import type { SceneDocument, SceneDocumentObject } from '@/types'
import { validateScene } from './sceneValidation'

/**
 * 场景静态校验：错误（越界 / 零缩放 / 深穿地面）必须抓准，
 * 提示（悬空 / 静态重叠）要有明确文案且不误报正常贴地物体。
 */

const makeObject = (
  overrides: Partial<SceneDocumentObject> & { uuid: string },
): SceneDocumentObject => ({
  type: 'cube',
  name: overrides.uuid,
  position: { x: 0, y: 0.5, z: 0 },
  rotation: { x: 0, y: 0, z: 0 },
  scale: { x: 1, y: 1, z: 1 },
  visible: true,
  physics: { type: 'dynamic', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
  ...overrides,
})

const makeDocument = (
  objects: SceneDocumentObject[],
  worldSize = 40,
): SceneDocument => ({
  id: 'scene-check',
  name: '校验场景',
  createdAt: '2026-11-23T10:00:00.000Z',
  updatedAt: '2026-11-23T10:00:00.000Z',
  version: 1,
  worldSize,
  objects,
})

const codesOf = (issues: ReturnType<typeof validateScene>) => issues.map((issue) => issue.code)

describe('场景校验 · 错误', () => {
  it('正常贴地物体不报错（动态与静态都不误报）', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({ uuid: 'dynamic', position: { x: -2, y: 0.5, z: 0 } }),
        makeObject({
          uuid: 'static',
          position: { x: 2, y: 0.5, z: 0 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    expect(issues).toEqual([])
  })

  it('包围盒超出场地边界时报错，并说明哪个轴越界', () => {
    const issues = validateScene(
      makeDocument([makeObject({ uuid: 'edge', position: { x: 20, y: 0.5, z: 0 } })]),
    )

    expect(codesOf(issues)).toContain('out-of-bounds')
    const issue = issues.find((item) => item.code === 'out-of-bounds')
    expect(issue?.level).toBe('error')
    expect(issue?.uuid).toBe('edge')
    expect(issue?.message).toContain('X 最大')
    expect(issue?.message).toContain('场地范围')
  })

  it('球体按缩放后的半径判断越界', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'ball',
          type: 'sphere',
          position: { x: 19.5, y: 0.5, z: 0 },
          scale: { x: 2, y: 2, z: 2 },
        }),
      ]),
    )

    expect(codesOf(issues)).toContain('out-of-bounds')
  })

  it('缩放为 0 或负数时报错', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({ uuid: 'flat', scale: { x: 0, y: 1, z: 1 } }),
        makeObject({ uuid: 'flipped', scale: { x: 1, y: -1, z: 1 } }),
      ]),
    )

    const scaleIssues = issues.filter((issue) => issue.code === 'invalid-scale')
    expect(scaleIssues).toHaveLength(2)
    expect(scaleIssues.map((issue) => issue.uuid)).toEqual(['flat', 'flipped'])
    expect(scaleIssues[0].level).toBe('error')
    expect(scaleIssues[0].message).toContain('缩放必须大于 0')
  })

  it('底部明显低于地面时报深穿，轻微贴地不报', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({ uuid: 'sunk', position: { x: 0, y: -1, z: 0 } }),
        makeObject({ uuid: 'touching', position: { x: 3, y: 0.5, z: 0 } }),
      ]),
    )

    expect(codesOf(issues)).toContain('below-ground')
    expect(issues.find((issue) => issue.code === 'below-ground')?.uuid).toBe('sunk')
    expect(issues.find((issue) => issue.code === 'below-ground')?.message).toContain('深穿地面')
    expect(issues.some((issue) => issue.uuid === 'touching')).toBe(false)
  })
})

describe('场景校验 · 提示', () => {
  it('静态物体悬空时给出提示（不阻止保存）', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'floating',
          name: '悬空平台',
          position: { x: 0, y: 5, z: 0 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    const issue = issues.find((item) => item.code === 'floating-static')
    expect(issue?.level).toBe('warning')
    expect(issue?.uuid).toBe('floating')
    expect(issue?.name).toBe('悬空平台')
    expect(issue?.message).toContain('底部悬空')
  })

  it('两个静态物体大面积重叠时给出提示', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'a',
          name: '基座 A',
          position: { x: 0, y: 0.5, z: 0 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
        makeObject({
          uuid: 'b',
          name: '基座 B',
          position: { x: 0.3, y: 0.5, z: 0 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    const issue = issues.find((item) => item.code === 'static-overlap')
    expect(issue?.level).toBe('warning')
    expect(issue?.uuid).toBe('a')
    expect(issue?.message).toContain('基座 B')
    expect(issue?.message).toContain('%')
  })

  it('动态物体互相重叠不提示（会自然散开）', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({ uuid: 'a', position: { x: 0, y: 5, z: 0 } }),
        makeObject({ uuid: 'b', position: { x: 0.1, y: 5, z: 0 } }),
      ]),
    )

    expect(issues).toEqual([])
  })

  it('薄片（最薄方向 < 0.2 米）重叠不提示', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'plate-a',
          position: { x: 0, y: 0.05, z: 0 },
          scale: { x: 2, y: 0.1, z: 2 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
        makeObject({
          uuid: 'plate-b',
          position: { x: 0.3, y: 0.05, z: 0 },
          scale: { x: 2, y: 0.1, z: 2 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    expect(codesOf(issues)).not.toContain('static-overlap')
  })

  it('被完全包含的嵌套件不提示重叠', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'shell',
          name: '外壳',
          position: { x: 0, y: 2, z: 0 },
          scale: { x: 4, y: 4, z: 4 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
        makeObject({
          uuid: 'core',
          name: '内芯',
          position: { x: 0, y: 0.5, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    expect(codesOf(issues)).not.toContain('static-overlap')
  })

  it('名字是地面/底板的静态构件不报重叠', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'ground-a',
          name: '地面 A',
          position: { x: 0, y: 0.5, z: 0 },
          scale: { x: 6, y: 0.4, z: 6 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
        makeObject({
          uuid: 'ground-b',
          name: '地面 B',
          position: { x: 1, y: 0.5, z: 0 },
          scale: { x: 6, y: 0.4, z: 6 },
          physics: { type: 'static', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    expect(codesOf(issues)).not.toContain('static-overlap')
  })

  it('旋转后的包围盒按世界轴估算（斜放的长条不会漏判越界）', () => {
    const issues = validateScene(
      makeDocument([
        makeObject({
          uuid: 'rotated',
          position: { x: 19, y: 1, z: 0 },
          rotation: { x: 0, y: Math.PI / 4, z: 0 },
          scale: { x: 6, y: 1, z: 0.5 },
          physics: { type: 'dynamic', shape: 'box', mass: 1, friction: 0.5, restitution: 0.2 },
        }),
      ]),
    )

    expect(codesOf(issues)).toContain('out-of-bounds')
  })
})
