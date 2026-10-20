import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useSimulationStore } from './simulationStore'
import { simulationPresets } from '@/data/simulationPresets'

/**
 * 计划 018：预设目录的接线。
 *
 * 以前 `simulationPresets` 是个永远为空的 ref，`loadPreset` 永远找不到东西。
 */

describe('预设目录', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('store 里的预设目录不再是空数组', () => {
    const store = useSimulationStore()

    expect(store.simulationPresets.length).toBeGreaterThan(0)
    expect(store.simulationPresets.map((preset) => preset.id)).toContain('newtons-cradle')
  })

  it('目录里的预设 id 唯一', () => {
    const ids = simulationPresets.map((preset) => preset.id)

    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每个预设的物体都写全了渲染所需的字段', () => {
    for (const preset of simulationPresets) {
      expect(preset.scene.objects.length).toBeGreaterThan(0)

      for (const object of preset.scene.objects) {
        expect(['box', 'sphere', 'cylinder']).toContain(object.type)
        expect(object.name).toBeTruthy()
        expect(object.position).toBeDefined()
        expect(object.rotation).toBeDefined()
        expect(object.scale).toBeDefined()
        expect(typeof object.physics.mass).toBe('number')
        expect(typeof object.physics.friction).toBe('number')
        expect(typeof object.physics.restitution).toBe('number')
      }
    }
  })
})

describe('loadPreset', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('按 id 找到预设并返回它', () => {
    const store = useSimulationStore()

    const preset = store.loadPreset('free-fall')

    expect(preset).not.toBeNull()
    expect(preset?.id).toBe('free-fall')
    expect(store.currentScene?.name).toBe(preset?.scene.name)
  })

  it('统计里的物体数是真实数量（以前恒为 1）', () => {
    const store = useSimulationStore()

    store.loadPreset('free-fall')
    expect(store.simulationStats.objects).toBe(2)

    store.loadPreset('newtons-cradle')
    expect(store.simulationStats.objects).toBe(6)

    store.loadPreset('ramp-and-balls')
    expect(store.simulationStats.objects).toBe(5)
  })

  it('未知 id 返回 null，并且不改动当前场景', () => {
    const store = useSimulationStore()
    store.loadPreset('free-fall')

    const preset = store.loadPreset('不存在的预设')

    expect(preset).toBeNull()
    expect(store.currentScene?.name).toBe('自由落体')
  })
})
