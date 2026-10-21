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

  it('每个条目都指向真实模型文件，没有占位条目', () => {
    const list = createModelLibrary()
    expect(list.filter((m) => m.modelUrl === '#')).toHaveLength(0)
    expect(list.every((m) => m.modelUrl.startsWith('/assets/models/'))).toBe(true)
  })

  it('每个条目的缩略图都指向渲染图，不是占位图', () => {
    for (const m of createModelLibrary()) {
      expect(m.thumbnailUrl, `${m.name} 的缩略图应指向渲染图`).toMatch(
        /^\/assets\/models\/thumbnails\/.+\.png$/,
      )
    }
  })

  it('真实模型不报告空的格式与零属性', () => {
    // 占位条目才允许零属性；真实模型必须有真实属性
    for (const m of createModelLibrary()) {
      expect(m.format, `${m.name} 缺少格式`).not.toBe('')
      expect(m.size, `${m.name} 缺少文件大小`).toBeGreaterThan(0)
      expect(m.polyCount, `${m.name} 缺少多边形数`).toBeGreaterThan(0)
      expect(m.materialCount, `${m.name} 缺少材质数`).toBeGreaterThan(0)
    }
  })

  it('不同种子产生不同的 uploadDate', () => {
    const a = createModelLibrary(0).map((m) => m.uploadDate)
    const b = createModelLibrary(100).map((m) => m.uploadDate)
    expect(a).not.toEqual(b)
  })
})
