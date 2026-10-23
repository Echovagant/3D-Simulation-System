/**
 * 防回归检查：**浅色页面**的配色必须适配浅色背景。
 *
 * 背景：全屏背景已从深蓝 Babylon 全息换成 Canvas 2D 浅色靛紫网络
 * （画布底色见 TechGridUniverse.vue 的 CANVAS_BG，浅色靛紫 #f7f8fc）。
 * 当年有若干页面是按深色背景写的——白字、金字，落在浅色背景上对比度只有 1.05，
 * 等于隐形。总览页是第一个被这道闸门盯住的，首页是第二个。
 *
 * 这道闸门拦四类回退：
 *   1. 又把“为深色背景设计”的浅色/金色前景塞回浅色页面（纯白、#f0f0f0、
 *      #ffd700、纯黑）；
 *   2. 前景色与实际背景的对比度掉到 WCAG AA 以下（正文 4.5:1、大字 3:1）——
 *      包括半透明底色先与背景合成后再算；
 *   3. **深色面板工具层（`ai-*`）被搬进浅色页面**——那套近黑底 + 琥珀强调
 *      是 AI 演武场的 HUD 风格，出现在浅色页面上会像装了两个 App；
 *   4. 浅色面板工具层（`sim-*`）里的颜色不再满足对比度。
 *
 * 覆盖范围：总览页、首页、仿真实验室的两个新面板、浅色面板工具层。
 *
 * 改背景色时**必须同步改这些页面的配色**，否则这里会直接失败。
 *
 * 零依赖，Node ESM。退出码：0 = 通过；1 = 发现问题。
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const read = (...parts) => readFileSync(join(repoRoot, ...parts), 'utf8')

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

/**
 * 字号换算成 px。
 *
 * ⚠️ `parseFloat('3rem')` 得到的是 3，不是 48——直接拿它判「大字还是正文」
 * 会把 48px 的标题当成 3px 正文，门槛就判错了。rem 一律按 16px 折算。
 */
const toPx = (value) => {
  if (!value) return null
  const raw = String(value).trim()
  const n = Number.parseFloat(raw)
  if (!Number.isFinite(n)) return null
  if (/rem$/i.test(raw)) return n * 16
  if (/em$/i.test(raw)) return n * 16
  return n
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

const parseRules = (style) => {
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
  return rules
}

const styleOf = (source) => {
  const start = source.indexOf('<style')
  const end = source.lastIndexOf('</style>')
  if (start === -1 || end === -1) {
    console.error('FAIL 找不到 <style> 段')
    process.exit(1)
  }
  return source.slice(start, end)
}

/* ---------- 禁用色 ---------- */
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

/* ---------- 深色面板工具层：不允许出现在浅色页面 ---------- */
const DARK_KIT_CLASSES = [
  'ai-bg-panel',
  'ai-bg-soft',
  'ai-bg-sunken',
  'ai-bg-raised',
  'ai-bg-chip',
  'ai-bg-chip-light',
  'ai-bg-amber',
  'ai-bg-amber-faint',
  'ai-bg-amber-soft',
  'ai-b-amber',
  'ai-b-gray',
  'ai-t',
  'ai-t-primary',
  'ai-t-strong',
  'ai-t-muted',
  'ai-t-faint',
  'ai-t-amber',
  'ai-t-amber-soft',
  'ai-t-on-amber',
  'ai-t-red',
  'ai-t-blue',
  'ai-form',
]

/** 页面底色从背景组件里读，保证「背景改了 → 检查跟着变」 */
const backgroundSource = read('src', 'components', 'common', 'Background', 'TechGridUniverse.vue')
const pageBg = backgroundSource.match(/CANVAS_BG\s*=\s*['"](#[0-9a-f]{3,6})['"]/i)?.[1]
if (!pageBg) {
  console.error('FAIL 无法从 TechGridUniverse.vue 解析出 CANVAS_BG（画布底色）')
  process.exit(1)
}

/** 面板卡片的底色：白 */
const PANEL_SURFACE = '#ffffff'

const failures = []
const rows = []

/* ---------- 逐个目标检查 ---------- */
const checkTarget = ({ name, style, bg, specialBg = {}, skipForeground = [] }) => {
  const rules = parseRules(style)

  const cleanStyle = style.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const { label, re } of BANNED_EVERYWHERE) {
    if (re.test(cleanStyle)) failures.push(`${name}的样式里仍出现${label}`)
  }

  for (const [selector, decls] of rules) {
    const fgDecl = decls.color
    if (!fgDecl) continue
    if (skipForeground.includes(selector)) continue

    // 底色：元素自己的 background-color（半透明则与页面底色合成），否则页面底色
    let elementBg = bg
    let hasOwnBg = false
    if (decls['background-color']) {
      const parsedBg = parseColor(decls['background-color'])
      if (parsedBg) {
        elementBg = parsedBg.a < 1 ? composite(parsedBg, bg) : rgbToHex(parsedBg.rgb)
        hasOwnBg = true
      }
    }
    if (specialBg[selector]) {
      elementBg = specialBg[selector]
      hasOwnBg = true
    }

    const parsedFg = parseColor(fgDecl)
    if (!parsedFg) {
      failures.push(`${name} ${selector} 的文字色无法解析：${fgDecl}`)
      continue
    }
    const fg = parsedFg.a < 1 ? composite(parsedFg, elementBg) : rgbToHex(parsedFg.rgb)

    const size = toPx(decls['font-size']) ?? 16
    const weight = Number.parseInt(decls['font-weight'] || '400', 10)
    const isLarge = size >= 24 || (size >= 18.66 && weight >= 700)
    const need = isLarge ? 3.0 : 4.5
    const ratio = contrast(fg, elementBg)

    rows.push({ name, selector, fg, bg: elementBg, size, isLarge, need, ratio })
    if (ratio < need) {
      failures.push(
        `${name} ${selector} 文字色 ${fg} 在 ${elementBg} 上只有 ${ratio.toFixed(2)}:1，` +
          `未达到 ${isLarge ? '大字' : '正文'} ${need}:1（${size}px${isLarge ? ' 大字' : ''}）`,
      )
    }

    // 「禁用前景色」只针对**压在浅色页面上**的字：
    // 元素自带底色时（主色按钮上的白字），白字是对的，由对比度检查负责。
    if (!hasOwnBg) {
      for (const { label, re } of BANNED_FOREGROUND) {
        if (re.test(fgDecl)) {
          failures.push(`${name} ${selector} 的文字色仍是${label}（当前 ${fgDecl}）`)
        }
      }
    }
  }
}

/* 1. 总览页（浅色页面底色；.title 压在 Header 的渐变条上，按最差的一端算） */
checkTarget({
  name: '总览页',
  style: styleOf(read('src', 'views', 'Overview.vue')),
  bg: pageBg,
  specialBg: { '.title': '#808080' },
})

/* 2. 首页（同一片浅色背景，之前是白字 + 深阴影撑出来的） */
checkTarget({
  name: '首页',
  style: styleOf(read('src', 'views', 'Welcome.vue')),
  bg: pageBg,
})

/* 3. 仿真实验室的两个新面板：面板底色是白，且不许再引用深色工具层 */
for (const file of ['SimulationBatchPanel.vue', 'RenderPanel.vue']) {
  const source = read('src', 'components', 'simulations', file)
  const name = file.replace('.vue', '')
  checkTarget({ name, style: styleOf(source), bg: PANEL_SURFACE })

  // 深色工具层一旦被引用就会把浅色页面弄成深色块——直接拦在类名上
  const usedClasses = new Set()
  for (const m of source.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token) usedClasses.add(token)
    }
  }
  for (const dark of DARK_KIT_CLASSES) {
    if (usedClasses.has(dark)) {
      failures.push(`${name} 用了深色面板工具层类 ${dark}（浅色页面不许出现）`)
    }
  }
}

/* 4. 仿真实验室页面本身也不许出现深色工具层 */
{
  const source = read('src', 'views', 'SimulationLab.vue')
  const usedClasses = new Set()
  for (const m of source.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/)) {
      if (token) usedClasses.add(token)
    }
  }
  for (const dark of DARK_KIT_CLASSES) {
    if (usedClasses.has(dark)) {
      failures.push(`仿真实验室页面用了深色面板工具层类 ${dark}（浅色页面不许出现）`)
    }
  }
}

/* 5. 浅色面板工具层本身：每个前景色都要在白色面板上达到 AA */
{
  const kitSource = read('src', 'assets', 'styles', 'simulation-panel-kit.css')
  const kitRules = parseRules(kitSource)
  const accentBg = kitRules.get('.sim-bg-accent')?.background
  if (!accentBg) {
    console.error('FAIL 浅色面板工具层里找不到 .sim-bg-accent 的底色')
    process.exit(1)
  }
  checkTarget({
    name: '浅色面板工具层',
    style: kitSource,
    bg: PANEL_SURFACE,
    // 主色底上的白字：底色不是白，得单独算
    specialBg: { '.sim-t-on-accent': accentBg },
  })
}

/* ---------- 输出 ---------- */
console.log(`浅色页面配色检查（页面底色取自 TechGridUniverse.vue 的 CANVAS_BG = ${pageBg}）\n`)
for (const r of rows) {
  const flag = r.ratio >= r.need ? 'OK  ' : 'FAIL'
  console.log(
    `  ${flag} ${(r.name + ' ' + r.selector).padEnd(30)} ${r.fg} on ${r.bg}  ${r.ratio.toFixed(2)}:1  ` +
      `（${r.size}px ${r.isLarge ? '大字 ≥3.0' : '正文 ≥4.5'}）`,
  )
}

if (failures.length > 0) {
  console.error('\nFAIL 浅色页面配色与背景不匹配：')
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    '提示：背景已是浅色 #f7f8fc，正文用 #333、次级用 #666、强调用靛紫 #6E5AF0，' +
      '不要用白字/金字；浅色页面也不许引用 ai-* 那套深色工具层。',
  )
  process.exit(1)
}

console.log('\nOK 浅色页面配色与背景匹配（禁用色未出现，全部前景达到 WCAG AA，浅色页面未引用深色工具层）')
