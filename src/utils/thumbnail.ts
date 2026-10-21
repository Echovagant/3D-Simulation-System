/**
 * 生成模型缩略图的占位图（内联 SVG 的 data URI）。
 *
 * 这里**只画占位字符**，不画背景：
 * 分类渐变由 `.model-preview--<category>` 这条 CSS 规则提供，
 * 这样占位条目和真实渲染图共用同一层背景，配色只有一个真源。
 * 真实模型的缩略图是**渲染出来的 PNG**（见 scripts/render-model-thumbnails.mjs），
 * 透明背景，直接叠在这层渐变上。
 */

/** XML 转义：模型名是用户输入（上传流程），不能直接拼进 SVG */
const escapeXml = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/**
 * 生成模型缩略图的占位图（内联 SVG 的 data URI）
 *
 * 替代 picsum.photos 的随机图：不引入任何二进制资源，天然离线可用。
 * 背景透明——分类配色在 CSS 里，见 ModelLibrary.vue 的 .model-preview--*。
 */
export const createThumbnail = (name: string, _category: string): string => {
  const initial = escapeXml((name || '?').trim().charAt(0) || '?')
  const svg = [
    '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">',
    '<text x="200" y="150" font-family="system-ui, sans-serif" font-size="96" font-weight="700"',
    ' fill="rgb(255, 255, 255)" fill-opacity="0.92" text-anchor="middle" dominant-baseline="central">',
    initial,
    '</text></svg>',
  ].join('')
  return `data:image/svg+xml,${encodeURIComponent(svg)}`
}
