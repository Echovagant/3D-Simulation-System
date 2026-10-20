import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useModelStore } from './modelStore'

describe('useModelStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('初始模型列表来自 createModelLibrary 的副本', () => {
    const store = useModelStore()

    expect(store.models).toHaveLength(9)
    expect(store.getModelsByCategory('characters')).toHaveLength(3)
  })

  it('两个 store 实例的 models 数组互不影响', () => {
    setActivePinia(createPinia())
    const first = useModelStore()

    setActivePinia(createPinia())
    const second = useModelStore()

    // 第一个 store 追加一条，第二个 store 不应该被污染
    first.models.push({ ...first.models[0], id: 'extra' })

    expect(first.models).toHaveLength(10)
    expect(second.models).toHaveLength(9)
  })

  it('deleteModel 只影响当前 store', () => {
    setActivePinia(createPinia())
    const first = useModelStore()

    setActivePinia(createPinia())
    const second = useModelStore()

    first.deleteModel('char-001')

    expect(first.getModelById('char-001')).toBeUndefined()
    expect(second.getModelById('char-001')).toBeDefined()
  })
})
