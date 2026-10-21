import { describe, it, expect } from 'vitest'
import { createThumbnail } from './thumbnail'

describe('createThumbnail', () => {
  it('生成 data:image/svg+xml 的 data URI', () => {
    const url = createThumbnail('士兵', 'characters')
    expect(url.startsWith('data:image/svg+xml,')).toBe(true)
  })

  it('取名字的首字作为占位字符', () => {
    expect(decodeURIComponent(createThumbnail('士兵', 'characters'))).toContain('>士<')
    expect(decodeURIComponent(createThumbnail('A&B 测试', 'characters'))).toContain('>A<')
  })

  it('对用户输入做 XML 转义，不让 & 撑坏 SVG', () => {
    // 只有首字会进 SVG，所以用 & 开头的名字来验证转义
    const svg = decodeURIComponent(createThumbnail('&测试', 'characters'))
    expect(svg).toContain('&amp;')
    expect(svg).not.toContain('>&<')
  })

  it('背景透明——分类渐变在 CSS 里，配色只有一个真源', () => {
    const svg = decodeURIComponent(createThumbnail('士兵', 'characters'))
    expect(svg).not.toContain('linearGradient')
    expect(svg).not.toContain('<rect')
  })

  it('未知分类不会抛错', () => {
    expect(() => createThumbnail('未知', 'not-a-category')).not.toThrow()
  })

  it('空名字回退到问号', () => {
    expect(decodeURIComponent(createThumbnail('   ', 'props'))).toContain('>?<')
  })
})
