import { describe, expect, it } from 'vitest'
import { SHOWCASE_SCENES } from './showcaseScenes'
import { normalizeSceneDocument } from '@/utils/sceneDocument'
import { SCENE_WORLD_SIZES } from '@/config/sceneEditor'

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
})
