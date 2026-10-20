import { describe, it, expect } from 'vitest'
import { sanitizeHtml } from './formatHelpers'

describe('sanitizeHtml', () => {
  it('移除 script 标签', () => {
    expect(sanitizeHtml('<script>alert(1)</script><p>ok</p>')).not.toContain('script')
  })

  it('移除 onerror 属性', () => {
    expect(sanitizeHtml('<img src=x onerror=alert(1)>')).not.toContain('onerror')
  })

  it('保留普通 markdown 生成的标签', () => {
    const html = sanitizeHtml('<pre><code>const a = 1</code></pre>')
    expect(html).toContain('<pre>')
    expect(html).toContain('<code>')
  })

  it('保留标题标签（jsdom 下 DOMPurify 才不会剥掉首个元素的标签）', () => {
    const html = sanitizeHtml('<h1>h1</h1><h2>h2</h2><p>p</p>')
    expect(html).toContain('<h1>h1</h1>')
    expect(html).toContain('<h2>h2</h2>')
  })

  it('剥离 javascript: 伪协议', () => {
    expect(sanitizeHtml('<a href="javascript:alert(1)">x</a>')).not.toContain('javascript:')
  })

  it('保留 class/id/style 与 data-* 属性（DOMPurify 默认就允许，不需要 ADD_ATTR）', () => {
    const html = sanitizeHtml(
      '<div class="a" id="b" style="color:red" data-language="js">x</div>'
    )
    expect(html).toContain('class="a"')
    expect(html).toContain('id="b"')
    expect(html).toContain('style="color:red"')
    expect(html).toContain('data-language="js"')
  })

  it('保留相对链接与 http 链接，剥离未知协议（URI 走白名单而非黑名单）', () => {
    expect(sanitizeHtml('<a href="/docs/guide">x</a>')).toContain('href="/docs/guide"')
    expect(sanitizeHtml('<a href="https://example.com">x</a>')).toContain(
      'href="https://example.com"'
    )
    expect(sanitizeHtml('<a href="blob:http://x/y">x</a>')).not.toContain('blob:')
  })
})
