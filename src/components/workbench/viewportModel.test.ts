import { describe, expect, it } from 'vitest'
import { buildViewportModel } from './viewportModel'
import type { GymObservation } from '@/services/api/gymWorkbench'

/**
 * 3D 视口数据模型：场景提供几何/尺寸，观测提供位置/目标/完成状态。
 * 纯函数测试——不创建 WebGL。
 */

const scene = {
  objects: [
    {
      uuid: 'a',
      type: 'sphere',
      position: { x: -1, y: 1, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
    },
    {
      uuid: 'b',
      type: 'cube',
      position: { x: 1, y: 1, z: 0 },
      scale: { x: 2, y: 2, z: 2 },
    },
    {
      uuid: 'c',
      type: 'cylinder',
      position: { x: 0, y: 1, z: 2 },
      scale: { x: 1, y: 3, z: 1 },
    },
    {
      uuid: 'staticsign',
      type: 'some-future-type',
      position: { x: 0, y: 0, z: -3 },
      scale: { x: 1, y: 1, z: 1 },
    },
  ],
}

const observation: GymObservation = {
  agent: { uuid: 'a', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  agents: [
    {
      uuid: 'a',
      position: { x: 0, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      target: { x: 3, z: 0 },
      distance: 3,
      done: false,
    },
    {
      uuid: 'b',
      position: { x: 2, y: 1, z: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      target: { x: -1, z: 0 },
      distance: 3,
      done: true,
    },
  ],
  objects: [
    { uuid: 'a', position: { x: 0, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
    { uuid: 'b', position: { x: 2, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
  ],
  target: { x: 3, z: 0 },
  step: 1,
  maxSteps: 300,
  distance: 3,
}

describe('buildViewportModel', () => {
  it('场景给几何类型与尺寸，观测位置覆盖初始位置', () => {
    const model = buildViewportModel(scene, observation)

    expect(model.objects.map((item) => item.uuid)).toEqual(['a', 'b'])
    const a = model.objects[0]
    expect(a.kind).toBe('sphere')
    expect(a.position).toEqual({ x: 0, y: 1, z: 0 })
    expect(a.isAgent).toBe(true)
    expect(a.done).toBe(false)

    const b = model.objects[1]
    expect(b.kind).toBe('cube')
    expect(b.scale).toEqual({ x: 2, y: 2, z: 2 })
    expect(b.done).toBe(true)
  })

  it('多智能体：每个受控物体各有一个目标环，完成状态跟着走', () => {
    const model = buildViewportModel(scene, observation)

    expect(model.targets).toEqual([
      { uuid: 'a', x: 3, z: 0, done: false },
      { uuid: 'b', x: -1, z: 0, done: true },
    ])
  })

  it('没有观测时退回场景初始布局（静态预览）', () => {
    const model = buildViewportModel(scene, null)

    expect(model.objects).toHaveLength(4)
    expect(model.objects[0].position).toEqual({ x: -1, y: 1, z: 0 })
    expect(model.objects.every((item) => !item.isAgent)).toBe(true)
    expect(model.targets).toEqual([])
  })

  it('未知类型按立方体画，观测里多出来的物体也有兜底尺寸', () => {
    const model = buildViewportModel(scene, {
      ...observation,
      agents: undefined,
      objects: [
        { uuid: 'staticsign', position: { x: 0, y: 0, z: -2 }, velocity: { x: 0, y: 0, z: 0 } },
        { uuid: 'not-in-scene', position: { x: 5, y: 1, z: 0 }, velocity: { x: 0, y: 0, z: 0 } },
      ],
    })

    expect(model.objects.map((item) => item.kind)).toEqual(['cube', 'cube'])
    expect(model.objects[1].scale).toEqual({ x: 1, y: 1, z: 1 })
  })

  it('单智能体：目标环取 observation.target', () => {
    const model = buildViewportModel(scene, {
      ...observation,
      agents: undefined,
      target: { x: 7, z: -2 },
    })

    expect(model.targets).toEqual([{ uuid: 'target', x: 7, z: -2, done: false }])
  })
})
