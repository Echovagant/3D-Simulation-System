import { marked } from 'marked'
import { sanitizeHtml } from '@/utils/formatHelpers'

/**
 * 把 markdown 文本渲染为经过净化的 HTML
 *
 * 顺序是强制的：先 `marked.parse` 生成 HTML，再交给 `sanitizeHtml` 净化，
 * 二者不可颠倒（净化必须在渲染之后）。
 *
 * @param markdown markdown 源文本
 * @returns 净化后的 HTML 字符串
 */
export const renderMarkdown = async (markdown: string): Promise<string> => {
  const html = await marked.parse(markdown)
  return sanitizeHtml(html)
}
