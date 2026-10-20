// @vitest-environment jsdom
import { describe, it, expect } from 'vitest'
import { renderMarkdown } from './markdownRenderer'

describe('renderMarkdown', () => {
  it('把 markdown 转成 HTML', async () => {
    const html = await renderMarkdown('# 标题\n\n正文')
    expect(html).toContain('<h1>')
    expect(html).toContain('正文')
  })

  it('剥离 script 标签', async () => {
    const html = await renderMarkdown('<script>alert(1)</script>ok')
    expect(html).not.toContain('script')
  })

  it('空文本产出空字符串', async () => {
    expect(await renderMarkdown('')).toBe('')
  })
})
