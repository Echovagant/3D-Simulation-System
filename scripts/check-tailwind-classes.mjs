#!/usr/bin/env node
/**
 * 防回归闸门：统计并守住「无效 Tailwind 类名」（死类名）的数量上限。
 *
 * 背景（已核实的事实，不再重复论证）：
 *   - package.json 里没有任何 tailwind* 依赖；没有 postcss.config.*；没有 tailwind.config.*
 *   - 样式全部是手写 CSS（src/assets/styles 下的 .css 与各组件的 <style> 块）
 *   - 但 20 个 .vue 文件里有 8 个在模板里写着 Tailwind 工具类，它们全是**死类名**：
 *     写了不生效（没有 Tailwind 就没有这些 utility）。
 *
 * 为什么值得守：
 *   危害不是"样式没生效"这么简单。模板里写着 `lg:col-span-6` / `flex-1` /
 *   `h-[calc(100%-46px)]` 的人会以为布局长这样，实际上完全不是。计划 019 的执行者
 *   就踩了这个坑——`h-[calc(100%-46px)]` 里少空格的 calc 是无效 CSS，视口高度退化成
 *   auto，画布被内容顶到 1338×1849px，形成"画布尺寸 ↔ 布局高度"的反馈循环。
 *   没有这道闸门，下一个人只会看到"模板里有 class"，不会意识到它不生效。
 *
 * 本闸门**不**代表"这些类名应该被保留"，而是"暂时没人清理，但别再增加"。
 * 本脚本不做任何清理，也不引入 Tailwind——引入 Tailwind 是一次全面的重新设计，
 * 超出本任务的范围。
 *
 * 判定口径：
 *   1. 只扫描 .vue 的 <template> 块（从第一个 <template> 到第一个 <script/<style>，
 *      这样嵌套的 <template v-if> 也不会截断扫描范围），取 class="..." 的全部 token，
 *      以及 :class / v-bind:class 里**静态字符串字面量**的部分。
 *      动态拼接（如 `nav-item ${x ? 'a' : ''}`）一律跳过——无法静态判定。
 *   2. 先收集"项目自有类名"：src 下所有 .css 与各 .vue 的 <style> 块里真实定义过的
 *      选择器类名。**这些类名一律不算死类名**（项目自己实现了它们，是有效的）。
 *      这一步很关键：`.left-panel` / `.right-panel` 长得像 `left-*` / `right-*`，
 *      `.animate-fade-in-up` 长得像 `animate-*`，`.delay-100` 长得像 `delay-*`，
 *      `.content-wrapper` 长得像 `content-*`，但它们都是项目自己写的有效样式。
 *   3. 剩下的 token 按"工具类形态"规则判定（精确名单 + 前缀名单），而不是靠一长串
 *      枚举具体类名，因此新增的 Tailwind 写法也能被自动识别。
 *
 * 基线怎么读：
 *   MAX_DEAD_TAILWIND_CLASSES = 死类名**出现次数**的上限（当前值 757）。
 *   收紧它 = 有人在真的清理（删掉 N 个死类名就把常量改小 N，不用改逻辑）。
 *   放宽它 = 有人在新增，本闸门失效。
 *   环境变量 MAX_DEAD_TAILWIND_CLASSES 可覆盖默认值，方便 CI 里临时放宽/收紧。
 *
 *   注：任务里给的参考值 169 用的是另一个口径（"含有死类名的 class 属性"个数，
 *   且只数静态 class 属性、不数 :class 绑定）。本脚本用的是"死类名出现次数"，
 *   因为只有它能保证"新增任何一个死类名"都必然让计数 +1；属性个数口径下，
 *   往一个已经脏的属性里再加一个死类名是**看不见的**，债会继续扩散。
 *   脚本会同时打印属性口径的统计，便于对照。
 *
 * 用法：node scripts/check-tailwind-classes.mjs
 * 退出码：0 = 未超基线；1 = 超过基线，或扫描本身出错（目录不存在等）。
 *
 * 零依赖，Node ESM。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(repoRoot, 'src')

/**
 * 死类名出现次数上限（= 当前仓库里无效 Tailwind 类名的总出现次数）。
 * 收紧它意味着有人在真的清理；放宽它意味着有人在新增。
 * 可用环境变量 MAX_DEAD_TAILWIND_CLASSES 覆盖。
 */
const MAX_DEAD_TAILWIND_CLASSES = 757
const parsedMax = Number.parseInt(process.env.MAX_DEAD_TAILWIND_CLASSES ?? '', 10)
const maxDead =
  Number.isFinite(parsedMax) && parsedMax >= 0 ? parsedMax : MAX_DEAD_TAILWIND_CLASSES

/**
 * Tailwind 工具类精确名单（不含前缀形态的 utility）。
 * 只收"裸 utility"：修饰符变体（hover:、lg:、dark: …）由分隔符拆分后逐段判定。
 */
const TAILWIND_EXACT = new Set([
  // display / layout
  'block',
  'inline',
  'inline-block',
  'inline-flex',
  'inline-grid',
  'flex',
  'grid',
  'hidden',
  'contents',
  'table',
  'flow-root',
  'list-item',
  'isolate',
  // position
  'static',
  'fixed',
  'absolute',
  'relative',
  'sticky',
  // visibility
  'visible',
  'invisible',
  'collapse',
  // typography
  'italic',
  'not-italic',
  'underline',
  'overline',
  'line-through',
  'no-underline',
  'uppercase',
  'lowercase',
  'capitalize',
  'normal-case',
  'truncate',
  'antialiased',
  // accessibility
  'sr-only',
  'not-sr-only',
  // borders / effects
  'border',
  'rounded',
  'shadow',
  'ring',
  'outline',
  'transition',
  'transform',
  'resize',
  'appearance-none',
  // flex / grow
  'flex-1',
  'flex-auto',
  'flex-initial',
  'flex-none',
  'grow',
  'shrink',
  // 标记类：本身不是 utility，但只服务于 Tailwind 的 peer-/group- 变体
  'peer',
  'group',
])

/**
 * Tailwind 工具类前缀名单（`prefix-` 形态，含任意值后缀如 `w-1/2`、`h-[calc(...)]`）。
 * 保持"形态"而不是"具体值"，这样新写法不用改这里也能被识别。
 */
const TAILWIND_PREFIXES = [
  // 布局 / 对齐
  'items-',
  'justify-',
  'self-',
  'place-',
  'content-',
  'flex-', // flex-1 / flex-col / flex-wrap
  'grid-', // grid-cols-2 …
  'gap-',
  'space-x-',
  'space-y-',
  'divide-',
  // 间距
  'p-',
  'px-',
  'py-',
  'pt-',
  'pr-',
  'pb-',
  'pl-',
  'm-',
  'mx-',
  'my-',
  'mt-',
  'mr-',
  'mb-',
  'ml-',
  // 尺寸
  'w-',
  'h-',
  'size-',
  'min-w-',
  'min-h-',
  'max-w-',
  'max-h-',
  'basis-',
  // 定位
  'inset-',
  'top-',
  'right-',
  'bottom-',
  'left-',
  'z-',
  // 排版
  'text-', // 字号 / 颜色 / 文本对齐
  'font-',
  'leading-',
  'tracking-',
  'whitespace-',
  'break-',
  'align-',
  'list-',
  'indent-',
  'placeholder-',
  'decoration-',
  'accent-',
  'prose', // @tailwindcss/typography（本项目未安装，同样是死类名）
  // 背景 / 边框
  'bg-',
  'border', // border / border-2 / border-gray-700 / border-t-transparent
  'rounded', // rounded / rounded-lg / rounded-b-lg
  'outline-',
  'ring',
  // 效果
  'shadow',
  'opacity-',
  'aspect-',
  'overflow-',
  'mix-blend-',
  'blur-',
  'backdrop-', // backdrop-blur-* / backdrop-brightness-* …
  // 交互
  'cursor-',
  'select-',
  'pointer-events-',
  'resize',
  'appearance-',
  // 动画 / 过渡
  'transition',
  'duration-',
  'ease-',
  'delay-',
  'animate-',
  // 变换
  'scale-',
  'rotate-',
  'translate-',
  'skew-',
  'origin-',
  // 网格列 / 行（col-span-* / col-start-* / row-span-* …）
  'col-',
  'row-',
  // 排序
  'order-',
  // 渐变（from-* / via-* / to-*）
  'from-',
  'via-',
  'to-',
  // SVG
  'fill-',
  'stroke-',
  // 光标
  'caret-',
  // 其他
  'object-',
  'columns-',
  'will-change-',
  'sr-',
]

/** 判定某个"基类名"（去掉修饰符后缀）是不是 Tailwind 工具类 */
function isTailwindUtility(base) {
  if (!base) return false
  if (TAILWIND_EXACT.has(base)) return true
  return TAILWIND_PREFIXES.some((prefix) => base.startsWith(prefix))
}

/**
 * 判定一个完整 token 是不是 Tailwind 类名。
 * 先按 ':' 拆出修饰符段（hover: / lg: / peer-checked:after: …），
 * 只要**任意一段**命中工具类形态就算命中。
 */
function looksLikeTailwind(token) {
  return token.split(':').some((segment) => isTailwindUtility(segment))
}

/** 递归收集目录下的文件 */
function walk(dir, accept) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full, accept))
    else if (accept(entry.name)) out.push(full)
  }
  return out
}

/**
 * CSS 标识符的"名字字符"：字母、数字、下划线、连字符，以及 U+00A0 以上的非 ASCII 字符。
 * 用 \u 转义写法而不是直接贴不可见字符——否则源码里会出现"看不见的差异"。
 */
const CSS_NAME_CHAR = /[-_a-zA-Z0-9 -￿]/

/** CSS 转义序列：`\` + 1~6 位十六进制（可再跟一个空白）或 `\` + 任意单个字符 */
function decodeCssEscape(css, start) {
  // start 指向反斜杠
  let i = start + 1
  let hex = ''
  while (i < css.length && hex.length < 6 && /[0-9a-fA-F]/.test(css[i])) {
    hex += css[i]
    i++
  }
  if (hex.length > 0) {
    if (i < css.length && /\s/.test(css[i])) i++ // 转义后的空白是终止符的一部分
    const code = Number.parseInt(hex, 16)
    if (!Number.isFinite(code) || code === 0 || code > 0x10ffff) {
      return { text: '�', next: i }
    }
    return { text: String.fromCodePoint(code), next: i }
  }
  if (i >= css.length) return { text: '', next: i }
  // `\` + 换行是 CSS 的续行符：不产生字符，标识符继续
  if (css[i] === '\n') return { text: '', next: i + 1, continuation: true }
  return { text: css[i], next: i + 1 }
}

/**
 * 从一段 CSS 选择器文本里收集"定义过的类名"（能识别 CSS 转义）。
 * 只看选择器部分（每个 '{' 之前的那段），避免把声明里的值误当成类名。
 *
 * 转义要特别小心，规则是按 CSS 规范来的：
 *   - `.lg\:col-span-6` 里的 `\:` 是"被转义的冒号"，冒号是类名的一部分，
 *     所以真实类名是 `lg:col-span-6`——**反转义后**的名字才是它。
 *   - `.lg\\:col-span-6` 里的 `\\` 是"被转义的反斜杠"，它本身是类名的一个字符，
 *     而后面那个**没被转义**的 `:` 已经结束了类名（后面是伪类 `:col-span-6`）。
 *     所以真实类名是 `lg\`，模板里写的 `lg:col-span-6` 并不是这条规则的目标。
 *   - 同理不能简单地按 `\.([\w-]+)` 取名字：那样会把 `flex` 误登记成项目自有类名，
 *     导致全仓库的 `flex` 都被当成"有效的"，闸门就瞎了。
 */
function extractClassNames(selector) {
  const out = []
  let i = 0
  while (i < selector.length) {
    if (selector[i] !== '.') {
      i++
      continue
    }
    let j = i + 1
    let name = ''
    while (j < selector.length) {
      const ch = selector[j]
      if (ch === '\\') {
        const escape = decodeCssEscape(selector, j)
        if (escape.continuation) {
          // 续行符：不产生字符，标识符继续往下读
          j = escape.next
          continue
        }
        if (!escape.text) break
        // 转义出来的字符是类名的一部分，名字继续往下读
        name += escape.text
        j = escape.next
        continue
      }
      if (CSS_NAME_CHAR.test(ch)) {
        name += ch
        j++
        continue
      }
      break
    }
    // `.5rem` 这种小数不是类名
    if (name && !/^\d/.test(name)) out.push(name)
    i = Math.max(j, i + 1)
  }
  return out
}

/** 收集一段 CSS 文本里定义过的类名 */
function collectDefinedClasses(css, into) {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '')
  const parts = stripped.split('{')
  // 最后一段是最后一个块的内容，没有对应选择器，跳过
  for (const part of parts.slice(0, -1)) {
    for (const name of extractClassNames(part)) into.add(name)
  }
}

/**
 * 取出 .vue 的 <template> 块（返回 [start, end) 字符区间）。
 * 从第一个 <template> 起，到第一个 <script / <style> 止。
 * 这样嵌套的 <template v-if="…"> 不会截断扫描范围。
 */
function templateRange(text) {
  const start = text.search(/<template[\s>]/)
  if (start === -1) return null
  const rest = text.slice(start)
  const stop = rest.search(/<script[\s>]|<style[\s>]/)
  const end = stop === -1 ? text.length : start + stop
  return [start, end]
}

/** 匹配 class / :class / v-bind:class 属性（含跨行值） */
const ATTR_RE = /(?::class|v-bind:class|(?<![\w:.-])class)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/** 匹配属性值里的字符串字面量（单引号 / 双引号 / 模板字符串） */
const LITERAL_RE = /`([^`]*)`|'([^']*)'|"([^"]*)"/g

/** 比较运算符：出现在字面量左侧时说明它是比较对象而不是类名 */
const COMPARISON_LEFT = /(?:===|!==|==|!=)\s*$/
/** 比较运算符：出现在字面量右侧时同样说明它是比较对象 */
const COMPARISON_RIGHT = /^\s*(?:===|!==|==|!=)/

/**
 * 从 :class 的表达式里取出**静态字符串字面量**。
 * - 模板字符串含 ${} → 动态拼接，跳过
 * - 紧跟在比较运算符左右的字面量 → 是比较对象（如 'running'），不是类名，跳过
 * - 其余（对象键、数组元素、三元分支）→ 是类名，保留
 */
function staticLiterals(expr) {
  const out = []
  LITERAL_RE.lastIndex = 0
  let m
  while ((m = LITERAL_RE.exec(expr))) {
    const raw = m[0]
    const value = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3]
    if (raw.startsWith('`') && value.includes('${')) continue // 动态拼接，静态不可判定
    const before = expr.slice(0, m.index)
    const after = expr.slice(m.index + raw.length)
    if (COMPARISON_LEFT.test(before)) continue
    if (COMPARISON_RIGHT.test(after)) continue
    out.push(value)
  }
  return out
}

let vueFiles
try {
  vueFiles = walk(srcDir, (name) => name.endsWith('.vue'))
} catch (err) {
  console.error(`ERROR: 无法扫描 ${srcDir}：${err.message}`)
  process.exit(1)
}

if (vueFiles.length === 0) {
  console.error(`ERROR: ${srcDir} 下没有找到任何 .vue 文件，扫描环境异常`)
  process.exit(1)
}

// ---- 1. 收集项目自有类名（这些是有效的，不算死类名） ----
const projectClasses = new Set()
let cssFiles = []
try {
  cssFiles = walk(srcDir, (name) => name.endsWith('.css'))
} catch (err) {
  console.error(`ERROR: 无法扫描 ${srcDir} 下的 CSS：${err.message}`)
  process.exit(1)
}
for (const file of cssFiles) {
  collectDefinedClasses(readFileSync(file, 'utf8'), projectClasses)
}
for (const file of vueFiles) {
  const text = readFileSync(file, 'utf8')
  const styleRe = /<style[^>]*>([\s\S]*?)<\/style>/g
  let m
  while ((m = styleRe.exec(text))) {
    collectDefinedClasses(m[1], projectClasses)
  }
}

// ---- 2. 逐文件扫描，统计死类名 ----
const perFile = []
const uniqueDead = new Set()
let total = 0
let totalAttrs = 0
let attrsWithDead = 0
let scannedFiles = 0

for (const file of vueFiles) {
  const text = readFileSync(file, 'utf8')
  const range = templateRange(text)
  if (!range) continue
  scannedFiles++

  const body = text.slice(range[0], range[1])
  const lineOffset = text.slice(0, range[0]).split('\n').length - 1

  // 逐个 class 属性统计（含 ≥1 个死类名的属性个数）
  const deadHits = []
  let attrs = 0
  let attrWithDead = 0
  ATTR_RE.lastIndex = 0
  let m
  while ((m = ATTR_RE.exec(body))) {
    attrs++
    const isBound = m[0].includes(':class') || m[0].includes('v-bind:class')
    const value = m[1] !== undefined ? m[1] : m[2]
    const line = body.slice(0, m.index).split('\n').length + lineOffset
    const tokens = isBound
      ? staticLiterals(value).flatMap((literal) => literal.split(/\s+/).filter(Boolean))
      : value.split(/\s+/).filter(Boolean)
    const dead = tokens.filter((token) => !projectClasses.has(token) && looksLikeTailwind(token))
    if (dead.length > 0) attrWithDead++
    for (const token of dead) deadHits.push({ token, line, bound: isBound })
  }

  totalAttrs += attrs
  attrsWithDead += attrWithDead
  if (deadHits.length === 0) continue

  const rel = relative(repoRoot, file).split(sep).join('/')
  perFile.push({ file: rel, hits: deadHits })
  total += deadHits.length
  for (const hit of deadHits) uniqueDead.add(hit.token)
}

perFile.sort((a, b) => b.hits.length - a.hits.length || a.file.localeCompare(b.file))

// ---- 3. 报告 ----
console.log('检查项：无效 Tailwind 类名（死类名）——本项目未接入 Tailwind，这些类名不生效')
console.log(`基线上限: ${maxDead}（可用环境变量 MAX_DEAD_TAILWIND_CLASSES 覆盖）`)
console.log(`已扫描 .vue: ${scannedFiles} 个；项目自有类名: ${projectClasses.size} 个（已排除，不计入）`)
console.log('')
console.log('逐文件命中数（死类名出现次数）：')
if (perFile.length === 0) {
  console.log('  （无）')
} else {
  for (const entry of perFile) {
    console.log(`  ${String(entry.hits.length).padStart(4)}  ${entry.file}`)
  }
}
console.log('')
console.log(`总计: ${total} / ${maxDead}（去重后 ${uniqueDead.size} 个不同类名）`)
console.log(
  `属性口径对照: ${totalAttrs} 个 class 属性里 ${attrsWithDead} 个含死类名` +
    '（注意：属性口径下往已脏的属性里加类名不会被发现，所以基线用的是出现次数）',
)

if (total > maxDead) {
  console.error(`FAIL: 死类名出现次数 ${total} 超过基线 ${maxDead}（超出 ${total - maxDead}）`)
  console.error('下面按文件列出命中的类名、首次出现的行号与次数，直接去删/改即可收紧基线：')
  for (const entry of perFile) {
    const byToken = new Map()
    for (const hit of entry.hits) {
      if (!byToken.has(hit.token)) byToken.set(hit.token, { line: hit.line, count: 0 })
      byToken.get(hit.token).count++
    }
    console.error(`  ${entry.file}`)
    for (const [token, info] of byToken) {
      console.error(`    L${String(info.line).padStart(4)}  ${token}  (${info.count} 处)`)
    }
  }
  console.error('提示：本项目没有 Tailwind，这些类名写了也不生效；删掉或改成手写 CSS 的类名。')
  process.exit(1)
}

console.log(`OK: 死类名出现次数 ${total} 未超过基线 ${maxDead}`)
process.exit(0)
