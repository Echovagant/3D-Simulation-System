/**
 * 防回归检查：总览页（src/views/Overview.vue）的配色必须适配**浅色**背景。
 *
 * 背景：全屏背景已从深蓝 Babylon 全息换成 Canvas 2D 浅色靛紫网络
 * （画布底色见 TechGridUniverse.vue 的 CANVAS_BG，浅色靛紫 #f7f8fc）。
 * 总览页原本是按深色背景写的——白字、金字，落在浅色背景上对比度只有 1.06，
 * 等于隐形；这是 plan 020 换背景后暴露出来的唯一受害者。
 *
 * 这道闸栏拦两类回退：
 *   1. 又把“为深色背景设计”的浅色/金色前景塞回总览页（纯白、#f0f0f0、
 *      #ffd700、纯黑）；
 *   2. 前景色与实际背景的对比度掉到 WCAG AA 以下（正文 4.5:1、大字 3:1）——
 *      包括半透明底色先与背景合成后再算。
 *
 * 改背景色时**必须同步改总览页配色**，否则这里会直接失败。
 *
 * 零依赖，Node ESM。退出码：0 = 通过；1 = 发现问题。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const overviewPath = join(repoRoot, 'src', 'views', 'Overview.vue')
const backgroundPath = join(repoRoot, 'src', 'components', 'common', 'Background', 'TechGridUniverse.vue')

/* ---------- 颜色工具（WCAG 2.1） ---------- */
const hexToRgb = (hex) => {
  let c = hex.replace('#', '').trim()
  if (c.length === 3) c = c.split('').map((ch) => ch + ch).join('')
  return [0, 2, 4].map((i) => parseInt(c.slice(i, i + 2), 16))
}
const rgbToHex = (rgb) => '#' + rgb.map((n) => Math.round(n).toString(16).padStart(2, '0')).join('')
const luminance = (hex) => {
  const v = hexToRgb(hex)
    .map((n) => n / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]
}
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m)
  return (hi + 0.05) / (lo + 0.05)
}
const parseColor = (value) => {
  const hex = value.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
  if (hex) return { rgb: hexToRgb(value), a: 1 }
  const rgb = value.match(/^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i)
  if (rgb) return { rgb: [+rgb[1], +rgb[2], +rgb[3]], a: rgb[4] === undefined ? 1 : +rgb[4] }
  return null
}
/** 把半透明前景/底色与不透明背景合成成实色 */
const composite = (fg, bgHex) => {
  const bg = hexToRgb(bgHex)
  return rgbToHex(fg.rgb.map((c, i) => fg.a * c + (1 - fg.a) * bg[i]))
}

/* ---------- 读取真实文件 ---------- */
const overview = readFileSync(overviewPath, 'utf8')
const styleStart = overview.indexOf('<style')
const styleEnd = overview.lastIndexOf('</style>')
if (styleStart === -1 || styleEnd === -1) {
  console.error('FAIL 在 src/views/Overview.vue 里找不到 <style> 段')
  process.exit(1)
}
const style = overview.slice(styleStart, styleEnd)

// 背景底色从背景组件里读，保证“背景改了 → 检查跟着变”
const backgroundSource = readFileSync(backgroundPath, 'utf8')
const pageBg = backgroundSource.match(/CANVAS_BG\s*=\s*['"](#[0-9a-f]{3,6})['"]/i)?.[1]
if (!pageBg) {
  console.error('FAIL 无法从 TechGridUniverse.vue 解析出 CANVAS_BG（画布底色）')
  process.exit(1)
}

/* ---------- 解析顶层 CSS 规则（跳过 @media，块内有颜色则报错） ---------- */
const stripAtBlocks = (text) => {
  const out = []
  let i = 0
  while (i < text.length) {
    const at = text.indexOf('@media', i)
    if (at === -1) {
      out.push(text.slice(i))
      break
    }
    out.push(text.slice(i, at))
    let depth = 0
    let j = text.indexOf('{', at)
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') {
        depth--
        if (depth === 0) break
      }
    }
    const block = text.slice(at, j + 1)
    if (/(^|[\s;{])(color|background|background-color|border|border-color|box-shadow|text-shadow|opacity)\s*:/i.test(block)) {
      console.error('FAIL @media 块内出现颜色声明，本检查只覆盖基础字号，请把颜色提到基础规则里：')
      console.error(block)
      process.exit(1)
    }
    i = j + 1
  }
  return out.join('')
}

const rules = new Map()
for (const m of stripAtBlocks(style).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const selector = m[1]
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .pop()
  if (!selector) continue
  const decls = {}
  for (const decl of m[2].replace(/\/\*[\s\S]*?\*\//g, '').split(';')) {
    const i = decl.indexOf(':')
    if (i > 0) decls[decl.slice(0, i).trim()] = decl.slice(i + 1).trim()
  }
  rules.set(selector, decls)
}

const failures = []

/* ---------- 检查 1：禁用色 ---------- */
// 为深色背景设计的颜色：任何位置都不允许再出现
const BANNED_EVERYWHERE = [
  { label: '浅灰前景 #f0f0f0（深色背景遗留）', re: /#f0f0f0\b/i },
  { label: '金色 #ffd700 / rgb(255,215,0)（不属于项目色系）', re: /#ffd700\b|\brgba?\(\s*255\s*,\s*215\s*,\s*0/i },
]
// 纯白/纯黑：允许作为半透明底色（例如 rgba(255,255,255,0.75) 的卡片），
// 但不允许出现在前景位——浅色背景上的白字必然不可见。
const BANNED_FOREGROUND = [
  { label: '纯白前景 #fff / #ffffff（浅色背景上不可见）', re: /#fff(?:fff)?\b|\brgba?\(\s*255\s*,\s*255\s*,\s*255/i },
  { label: '纯黑前景 #000（项目正文用 #333）', re: /#000(?:000)?\b|\brgba?\(\s*0\s*,\s*0\s*,\s*0/i },
]

const cleanStyle = style.replace(/\/\*[\s\S]*?\*\//g, '')
for (const { label, re } of BANNED_EVERYWHERE) {
  if (re.test(cleanStyle)) failures.push(`总览页样式里仍出现${label}`)
}
for (const [selector, decls] of rules) {
  const fg = decls.color
  if (!fg) continue
  for (const { label, re } of BANNED_FOREGROUND) {
    if (re.test(fg)) failures.push(`${selector} 的文字色仍是${label}（当前 ${fg}）`)
  }
}

/* ---------- 检查 2：对比度（半透明底色先与背景合成） ---------- */
// .title 压在 Header.vue 里全局 `.title` 规则画的灰→白渐变条上，
// 最差的一端是灰色 #808080，按那一端算。
const TITLE_BAR_WORST = '#808080'

const rows = []
for (const [selector, decls] of rules) {  const fgDecl = decls.color
  if (!fgDecl) continue

  // 底色：元素自己的 background-color（半透明则与页面底色合成），否则页面底色
  let bg = pageBg
  if (decls['background-color']) {
    const parsedBg = parseColor(decls['background-color'])
    if (parsedBg) bg = parsedBg.a < 1 ? composite(parsedBg, pageBg) : rgbToHex(parsedBg.rgb)
  }
  if (selector === '.title') bg = TITLE_BAR_WORST

  const parsedFg = parseColor(fgDecl)
  if (!parsedFg) {
    failures.push(`${selector} 的文字色无法解析：${fgDecl}`)
    continue
  }
  const fg = parsedFg.a < 1 ? composite(parsedFg, bg) : rgbToHex(parsedFg.rgb)

  const size = Number.parseFloat(decls['font-size'] || '16')
  const weight = Number.parseInt(decls['font-weight'] || '400', 10)
  const isLarge = size >= 24 || (size >= 18.66 && weight >= 700)
  const need = isLarge ? 3.0 : 4.5
  const ratio = contrast(fg, bg)

  rows.push({ selector, fg, bg, size, isLarge, need, ratio })
  if (ratio < need) {
    failures.push(
      `${selector} 文字色 ${fg} 在 ${bg} 上只有 ${ratio.toFixed(2)}:1，` +
        `未达到 ${isLarge ? '大字' : '正文'} ${need}:1（${size}px${isLarge ? ' 大字' : ''}）`,
    )
  }
}

/* ---------- 输出 ---------- */
console.log(`总览页配色检查（背景底色取自 TechGridUniverse.vue 的 CANVAS_BG = ${pageBg}）\n`)
for (const r of rows) {
  const flag = r.ratio >= r.need ? 'OK  ' : 'FAIL'
  console.log(
    `  ${flag} ${r.selector.padEnd(26)} ${r.fg} on ${r.bg}  ${r.ratio.toFixed(2)}:1  ` +
      `（${r.size}px ${r.isLarge ? '大字 ≥3.0' : '正文 ≥4.5'}）`,
  )
}

if (failures.length > 0) {
  console.error('\nFAIL 总览页配色与浅色背景不匹配：')
  for (const f of failures) console.error(`  - ${f}`)
  console.error('提示：背景已是浅色 #f7f8fc，正文用 #333、次级用 #666、强调用靛紫 #6E5AF0，不要再用白字/金字')
  process.exit(1)
}

console.log('\nOK 总览页配色与浅色背景匹配（禁用色未出现，全部前景达到 WCAG AA）')
