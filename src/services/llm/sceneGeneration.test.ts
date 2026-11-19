import { describe, expect, it } from 'vitest'
import { buildSceneGenerationMessages, parseGeneratedScene } from './sceneGeneration'

describe('buildSceneGenerationMessages —— prompt 构造', () => {
  it('system 里带类型白名单与 y 范围规则，user 里带用户描述', () => {
    const messages = buildSceneGenerationMessages('一个滑板场，有斜坡')
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('system')
    expect(messages[0].content).toContain('cube')
    expect(messages[0].content).toContain('ramp')
    expect(messages[0].content).toContain('0.3~4')
    expect(messages[0].content).toContain('不要 markdown')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toBe('一个滑板场，有斜坡')
  })
})

describe('parseGeneratedScene —— 模型输出收敛', () => {
  it('合法 JSON：全部字段进结果，rotation/scale 可选补默认', () => {
    const result = parseGeneratedScene(
      '{"objects":[{"name":"斜坡","type":"ramp","position":{"x":0,"y":0.5,"z":0}}]}',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0]).toMatchObject({
      name: '斜坡',
      type: 'ramp',
      position: { x: 0, y: 0.5, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    })
    expect(result.skipped).toHaveLength(0)
  })

  it('markdown 围栏包裹的 JSON 也能剥出来', () => {
    const result = parseGeneratedScene(
      '这是你要的场景：\n```json\n{"objects":[{"name":"方块","type":"cube","position":{"x":1,"y":0.5,"z":1}}]}\n```',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects[0].name).toBe('方块')
  })

  it('未知类型被逐条丢弃并说明原因；有效项照常保留', () => {
    const result = parseGeneratedScene(
      '{"objects":[{"name":"圆锥","type":"cone","position":{"x":0,"y":1,"z":0}},{"name":"方块","type":"cube","position":{"x":1,"y":0.5,"z":1}}]}',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].type).toBe('cube')
    expect(result.skipped[0]).toContain('cone')
  })

  it('超过上限截断，并把截断原因写进 skipped', () => {
    const objects = Array.from({ length: 20 }, (_, i) => ({
      name: `块${i}`,
      type: 'cube',
      position: { x: i, y: 0.5, z: 0 },
    }))
    const result = parseGeneratedScene(JSON.stringify({ objects }))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects).toHaveLength(12)
    expect(result.skipped[0]).toContain('上限')
  })

  it('非有限数字的 position 整项丢弃', () => {
    const result = parseGeneratedScene(
      '{"objects":[{"name":"坏块","type":"cube","position":{"x":"左","y":1,"z":0}},{"name":"好块","type":"cube","position":{"x":1,"y":0.5,"z":1}}]}',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects).toHaveLength(1)
    expect(result.objects[0].name).toBe('好块')
  })

  it('scale 越界钳制回 0.2~3，非法回退默认 1', () => {
    const result = parseGeneratedScene(
      '{"objects":[{"name":"巨块","type":"cube","position":{"x":0,"y":0.5,"z":0},"scale":{"x":50,"y":1,"z":"?"}}]}',
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.objects[0].scale).toEqual({ x: 3, y: 1, z: 1 })
  })

  it('全部非法才算失败，错误里带第一条原因', () => {
    const result = parseGeneratedScene('{"objects":[{"name":"圆锥","type":"cone"}]}')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error).toContain('全部物体无效')
  })

  it('没有 JSON / 缺 objects 数组 / JSON 解析失败分别给可读错误', () => {
    expect(parseGeneratedScene('抱歉我做不到').ok).toBe(false)
    expect(parseGeneratedScene('{"foo":1}').ok).toBe(false)
    expect(parseGeneratedScene('{"objects":"不是数组"}').ok).toBe(false)
  })
})
