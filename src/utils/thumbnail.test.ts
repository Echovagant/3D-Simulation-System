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

  it('未知分类回退到道具配色，不会抛错', () => {
    const svg = decodeURIComponent(createThumbnail('未知', 'not-a-category'))
    expect(svg).toContain('linearGradient')
  })

  it('空名字回退到问号', () => {
    expect(decodeURIComponent(createThumbnail('   ', 'props'))).toContain('>?<')
  })
})
