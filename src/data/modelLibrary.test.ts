import { describe, it, expect } from 'vitest'
import { createModelLibrary, getRandomDate } from './modelLibrary'

describe('getRandomDate', () => {
  it('同一个种子得到同一个日期', () => {
    expect(getRandomDate(3)).toBe(getRandomDate(3))
  })

  it('不同种子得到不同日期', () => {
    expect(getRandomDate(3)).not.toBe(getRandomDate(4))
  })

  it('返回合法 ISO 字符串', () => {
    expect(getRandomDate(0)).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})

describe('createModelLibrary', () => {
  it('两次调用得到相同长度', () => {
    expect(createModelLibrary().length).toBe(createModelLibrary().length)
  })

  it('两次调用得到完全相同的 uploadDate（确定性）', () => {
    const first = createModelLibrary().map((m) => m.uploadDate)
    const second = createModelLibrary().map((m) => m.uploadDate)
    expect(first).toEqual(second)
  })

  it('每次调用返回新的数组实例', () => {
    expect(createModelLibrary()).not.toBe(createModelLibrary())
  })

  it('包含 9 个模型且分类齐全', () => {
    const list = createModelLibrary()
    expect(list).toHaveLength(9)
    expect(list.filter((m) => m.category === 'characters')).toHaveLength(3)
    expect(list.filter((m) => m.category === 'environments')).toHaveLength(3)
    expect(list.filter((m) => m.category === 'props')).toHaveLength(3)
  })

  it('每个模型的 uploadDate 是有效 ISO 字符串', () => {
    for (const m of createModelLibrary()) {
      expect(m.uploadDate).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    }
  })

  it('modelUrl 为 # 的条目在清单里可数', () => {
    const list = createModelLibrary()
    expect(list.filter((m) => m.modelUrl === '#').length).toBeGreaterThan(0)
  })

  it('不同种子产生不同的 uploadDate', () => {
    const a = createModelLibrary(0).map((m) => m.uploadDate)
    const b = createModelLibrary(100).map((m) => m.uploadDate)
    expect(a).not.toEqual(b)
  })
})
