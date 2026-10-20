/** 分类 → 渐变配色。用 rgb() 而不是 #，避免在 data URI 里出现 '#' */
const CATEGORY_GRADIENTS: Record<string, [string, string]> = {
  characters: ['rgb(56, 189, 248)', 'rgb(99, 102, 241)'],
  environments: ['rgb(16, 185, 129)', 'rgb(13, 148, 136)'],
  props: ['rgb(251, 146, 60)', 'rgb(236, 72, 153)'],
}

/** XML 转义：模型名是用户输入（上传流程），不能直接拼进 SVG */
const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 生成模型缩略图占位图（内联 SVG 的 data URI）
 * 替代 picsum.photos 的随机图：不引入任何二进制资源，天然离线可用
 */
export const createThumbnail = (name: string, category: string): string => {
  const [from, to] = CATEGORY_GRADIENTS[category] ?? CATEGORY_GRADIENTS.props
  const initial = escapeXml((name || '?').trim().charAt(0) || '?')
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">',
    '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">',
    `<stop offset="0%" stop-color="${from}"/><stop offset="100%" stop-color="${to}"/>`,
    '</linearGradient></defs>',
    '<rect width="400" height="300" fill="url(#g)"/>',
    '<text x="200" y="150" font-family="system-ui, sans-serif" font-size="96" font-weight="700"',
    ' fill="rgb(255, 255, 255)" fill-opacity="0.92" text-anchor="middle" dominant-baseline="central">',
    initial,
    '</text></svg>',
  ].join('')
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
