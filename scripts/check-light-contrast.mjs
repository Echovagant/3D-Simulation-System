/**
 * 防回归检查：**深色界面**的配色必须达到 WCAG AA。
 *
 * 背景：全站已统一为深色专业工具风（画布底色见 src/assets/styles/tokens.css
 * 的 --bg-canvas）。当年浅色时代的闸门盯的是「白字落在浅底上隐形」；
 * 现在方向反过来——深底上的纯黑前景、深靛文字同样会隐形。
 *
 * 这道闸门拦四类回退：
 *   1. 禁用色重新出现（浅灰 #f0f0f0）——
 *      不属于项目色系，任何位置都不允许（金色 #ffd700 系曾是禁用色，
 *      黑金缎面主题定稿后已转正为 --accent 族，不再拦）；
 *   2. 前景色与实际背景的对比度掉到 WCAG AA 以下（正文 4.5:1、大字 3:1）——
 *      半透明底色先与背景合成后再算；组件里写 var(--token) 会先展开成实色；
 *   3. **面板工具层跑出白名单域**：ai-* 类只允许出现在 AI 演武场域，
 *      sim-* 类只允许出现在仿真实验室域——工具层串门会像装了两个 App；
 *   4. 各目标底色上的前景色逐条对账（底色取自目标配置，不再全局硬编码）。
 *
 * 覆盖范围：总览页、首页（深色画布底）；仿真实验室两个面板与浅色面板
 * 工具层（阶段 4 深色化之前暂按白面板底对账）。
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
/** WCAG 2.1 相对亮度：0.03928 以下是线性段，其余走 gamma 展开 */
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
/** 只认 #hex 与 rgba()/rgb() 两种写法；项目里出现其他颜色函数（如 hsl）时这里返回 null，调用方按「无法核对」处理 */
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

/* ---------- 令牌解析：组件里允许写 var(--token)，这里展开成实色再对账 ---------- */
const tokensSource = read('src', 'assets', 'styles', 'tokens.css')
const tokenMap = new Map()
for (const m of tokensSource.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)) {
  tokenMap.set(m[1], m[2].trim())
}
/** 递归展开 var() 引用（令牌允许互相引用，如 --bg-canvas: var(--ink-950)） */
const resolveVar = (value, depth = 0) => {
  if (depth > 8) return value
  return value.replace(/var\((--[\a-z0-9-]+)(?:,\s*([^)]+))?\)/gi, (whole, name, fallback) => {
    if (tokenMap.has(name)) return resolveVar(tokenMap.get(name), depth + 1)
    return fallback !== undefined ? fallback : whole
  })
}
/** 解析一个声明值：先展开令牌，再 parseColor；rgba() 整体展开后仍能命中 */
const resolveColor = (value) => {
  const expanded = resolveVar(value).trim()
  // var 展开后可能是 "rgba(124, 106, 242, 0.16)" 也可能落在 calc() 里——calc 不支持，返回 null
  return parseColor(expanded)
}
/** 同上，但只接受不透明色并返回 #hex（页面/面板底色用） */
const resolveColorHex = (value) => {
  const c = resolveColor(value)
  return c && c.a === 1 ? rgbToHex(c.rgb) : null
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
// 不属于项目色系的颜色：任何位置都不允许再出现
// （金色 #ffd700 系曾是禁用色，黑金缎面主题定稿后已转正为 --accent 族，移出清单）
const BANNED_EVERYWHERE = [
  { label: '浅灰前景 #f0f0f0（浅色时代遗留）', re: /#f0f0f0\b/i },
]
// 深底页面禁纯黑前景（必然隐形）；白底面板禁纯白前景。按目标底色选用。
const BANNED_ON_DARK = [
  { label: '纯黑前景 #000（深色底上不可见）', re: /#000(?:000)?\b|\brgba?\(\s*0\s*,\s*0\s*,\s*0\s*,\s*1\s*\)/i },
]
const BANNED_ON_LIGHT = [
  { label: '纯白前景 #fff / #ffffff（浅色背景上不可见）', re: /#fff(?:fff)?\b|\brgba?\(\s*255\s*,\s*255\s*,\s*255\s*,\s*1\s*\)/i },
]

/** 页面底色从令牌层读，保证「令牌改了 → 检查跟着变」 */
const pageBg = resolveColorHex(tokenMap.get('--bg-canvas') ?? '')
if (!pageBg) {
  console.error('FAIL 无法从 tokens.css 解析出 --bg-canvas（画布底色）')
  process.exit(1)
}
/** 深色面板底：实验室面板与面板工具层的统一对账底 */
const PANEL_SURFACE = resolveColorHex(tokenMap.get('--bg-panel') ?? '')
if (!PANEL_SURFACE) {
  console.error('FAIL 无法从 tokens.css 解析出 --bg-panel（面板底色）')
  process.exit(1)
}

const failures = []
const rows = []

/* ---------- 逐个目标检查 ---------- */
const checkTarget = ({ name, style, bg, specialBg = {}, bannedForeground = BANNED_ON_DARK }) => {
  const rules = parseRules(style)

  const cleanStyle = style.replace(/\/\*[\s\S]*?\*\//g, '')
  for (const { label, re } of BANNED_EVERYWHERE) {
    if (re.test(cleanStyle)) failures.push(`${name}的样式里仍出现${label}`)
  }

  for (const [selector, decls] of rules) {
    const fgDecl = decls.color
    if (!fgDecl) continue

    // 底色：元素自己的 background-color（半透明则与页面底色合成），否则页面底色
    let elementBg = bg
    let hasOwnBg = false
    if (decls['background-color']) {
      const parsedBg = resolveColor(decls['background-color'])
      if (parsedBg) {
        elementBg = parsedBg.a < 1 ? composite(parsedBg, bg) : rgbToHex(parsedBg.rgb)
        hasOwnBg = true
      }
    }
    if (specialBg[selector]) {
      elementBg = specialBg[selector]
      hasOwnBg = true
    }

    const parsedFg = resolveColor(fgDecl)
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

    // 「禁用前景色」只针对压在目标底上且没有自带底色的字：
    // 主色按钮上的白字是对的，由对比度检查负责。
    if (!hasOwnBg) {
      for (const { label, re } of bannedForeground) {
        if (re.test(fgDecl)) {
          failures.push(`${name} ${selector} 的文字色仍是${label}（当前 ${fgDecl}）`)
        }
      }
    }
  }
}

/* 1. 总览页（深色画布底） */
checkTarget({
  name: '总览页',
  style: styleOf(read('src', 'views', 'Overview.vue')),
  bg: pageBg,
})

/* 2. 首页（同一片深色画布） */
checkTarget({
  name: '首页',
  style: styleOf(read('src', 'views', 'Welcome.vue')),
  bg: pageBg,
})

/* 3. 仿真实验室的两个面板：深色面板底 */
for (const file of ['SimulationBatchPanel.vue', 'RenderPanel.vue']) {
  const source = read('src', 'components', 'simulations', file)
  const name = file.replace('.vue', '')
  checkTarget({ name, style: styleOf(source), bg: PANEL_SURFACE })
}

/* 4. 面板工具层本身：每个前景色都要在其面板底上达到 AA */
{
  const kitSource = read('src', 'assets', 'styles', 'simulation-panel-kit.css')
  const kitRules = parseRules(kitSource)
  const accentBg = resolveColorHex(kitRules.get('.sim-bg-accent')?.background ?? '')
  if (!accentBg) {
    console.error('FAIL 面板工具层里找不到 .sim-bg-accent 的底色')
    process.exit(1)
  }
  checkTarget({
    name: '面板工具层',
    style: kitSource,
    bg: PANEL_SURFACE,
    // 主色底上的白字：底色不是面板深灰，得单独算
    specialBg: { '.sim-t-on-accent': accentBg },
  })
}

/* 5. 工具层白名单：ai-* 类只能出现在 AI 演武场域，sim-* 类只能出现在仿真实验室域。
      工具层串门 = 同一个应用里出现第二套观感，直接拦在类名上。 */
const extractKitClasses = (css) => {
  const set = new Set()
  for (const m of css.matchAll(/\.((?:ai|sim)-[a-z0-9-]+)/g)) set.add(m[1])
  return [...set]
}
const AI_KIT_CLASSES = extractKitClasses(read('src', 'assets', 'styles', 'ai-panel-kit.css'))
const SIM_KIT_CLASSES = extractKitClasses(read('src', 'assets', 'styles', 'simulation-panel-kit.css'))
const KIT_DOMAINS = [
  { name: 'AI 工具层（ai-*）', classes: AI_KIT_CLASSES, allowed: ['src/views/AIPlayground.vue', 'src/components/three/ai/'] },
  { name: '实验室工具层（sim-*）', classes: SIM_KIT_CLASSES, allowed: ['src/views/SimulationLab.vue', 'src/components/simulations/'] },
]
{
  const { readdirSync } = await import('node:fs')
  const walkVue = (dir) => {
    const out = []
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name)
      if (e.isDirectory()) out.push(...walkVue(p))
      else if (e.name.endsWith('.vue')) out.push(p)
    }
    return out
  }
  for (const file of walkVue(join(repoRoot, 'src'))) {
    const rel = file.slice(repoRoot.length).replace(/\\/g, '/')
    const source = readFileSync(file, 'utf8')
    const used = new Set()
    for (const m of source.matchAll(/class="([^"]*)"/g)) {
      for (const token of m[1].split(/\s+/)) if (token) used.add(token)
    }
    for (const kit of KIT_DOMAINS) {
      if (kit.allowed.some((prefix) => rel.startsWith(prefix))) continue
      for (const cls of kit.classes) {
        if (used.has(cls)) {
          failures.push(`${rel} 用了${kit.name}类 ${cls}（只允许出现在它自己的域里）`)
        }
      }
    }
  }
}

/* ---------- 输出 ---------- */
console.log(`深色界面配色检查（页面底色取自 tokens.css 的 --bg-canvas = ${pageBg}）\n`)
for (const r of rows) {
  const flag = r.ratio >= r.need ? 'OK  ' : 'FAIL'
  console.log(
    `  ${flag} ${(r.name + ' ' + r.selector).padEnd(30)} ${r.fg} on ${r.bg}  ${r.ratio.toFixed(2)}:1  ` +
      `（${r.size}px ${r.isLarge ? '大字 ≥3.0' : '正文 ≥4.5'}）`,
  )
}

if (failures.length > 0) {
  console.error('\nFAIL 配色与深色背景不匹配：')
  for (const f of failures) console.error(`  - ${f}`)
  console.error(
    '提示：深色界面正文用 var(--text-1)、次级用 var(--text-2)、弱化用 var(--text-3)，' +
      '强调用 var(--accent)；组件里不要写硬编码 hex，更不要把别的工具层类搬进来。',
  )
  process.exit(1)
}

console.log('\nOK 深色界面配色达标（禁用色未出现，全部前景达到 WCAG AA，工具层未串门）')
