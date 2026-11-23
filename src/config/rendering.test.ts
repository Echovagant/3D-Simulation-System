/**
 * 渲染器的 GPU 偏好不能漂。
 *
 * 为什么用「扫源码」而不是「跑起来看」：
 * WebGL 上下文属性在 jsdom 里拿不到（没有 WebGL 上下文），
 * 而真正会漏的地方恰恰是**新加的渲染器**——某天有人新写一个
 * `new THREE.WebGLRenderer({ ... })`，忘了带 GPU 偏好，
 * 双显卡笔记本上就悄悄跑在核显上。扫源码能覆盖到那一个新点。
 *
 * 所以这里扫的是 `src/` 下的源码文件（跳过测试文件），
 * 找出每一处渲染器创建，断言它带了 `powerPreference`。
 *
 * 一条例外：`src/background/` 下的装饰性背景层显式写 `'low-power'`——
 * 背景是 30fps 节流的装饰画布，留在核显跑，独显整块让给主视口。
 * 它仍然必须**显式**写（漏写照样算违规），只是取值不同。
 */
import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { RENDER_POWER_PREFERENCE } from './rendering'

/**
 * 源码根目录。
 *
 * 用 `process.cwd()` 而不是 `import.meta.url`——后者在 Vitest 的 SSR 转换下
 * 不是 file:// URL，`fileURLToPath` 会直接抛错。cwd 与仓库根一致时它就是 src/。
 */
const SRC_DIR = join(process.cwd(), 'src')

/** 递归收集 src/ 下的源码文件；测试文件本身跳过（里面写着匹配用的字面量） */
const walk = (dir: string): string[] => {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts')) out.push(full)
  }
  return out
}

/**
 * 去掉注释，**保留换行**（行号才对得上）。
 *
 * ⚠️ 不去注释就会把「被注释掉的那行」当成真的约束——
 * 实测踩过：`// powerPreference: RENDER_POWER_PREFERENCE,` 这种写法
 * 字符串照样能搜到，于是闸门放行了一个根本没有约束力的渲染器。
 *
 * 字符串字面量要原样抄出去：`'https://example.com'` 里的 `//` 不是注释。
 */
const stripComments = (text: string): string => {
  let out = ''
  let i = 0
  const n = text.length
  while (i < n) {
    const ch = text[i]
    const next = text[i + 1] ?? ''
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      out += ch
      i += 1
      while (i < n) {
        if (text[i] === '\\') {
          out += text[i] + (text[i + 1] ?? '')
          i += 2
          continue
        }
        out += text[i]
        if (text[i] === quote) {
          i += 1
          break
        }
        i += 1
      }
      continue
    }
    if (ch === '/' && next === '/') {
      while (i < n && text[i] !== '\n') i += 1
      continue
    }
    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2)
      const stop = end === -1 ? n : end + 2
      for (let j = i; j < stop; j += 1) if (text[j] === '\n') out += '\n'
      i = stop
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/** 从 open（`(` 或 `{` 的位置）开始配对取出内部文本 */
const matchBlock = (text: string, open: number): string => {
  const openCh = text[open]
  const closeCh = openCh === '(' ? ')' : '}'
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === openCh) depth += 1
    else if (ch === closeCh) {
      depth -= 1
      if (depth === 0) return text.slice(open + 1, i)
    }
  }
  return ''
}

interface RendererSite {
  /** 相对 src/ 的路径，正斜杠分隔 */
  file: string
  line: number
  /** 渲染器的实参文本（已去注释） */
  args: string
}

const RENDERER_CALL = /new\s+(?:THREE\.)?WebGLRenderer\s*\(/g

/** 找出 src/ 下每一处渲染器创建 */
const findRendererSites = (): RendererSite[] => {
  const sites: RendererSite[] = []
  for (const file of walk(SRC_DIR)) {
    const text = stripComments(readFileSync(file, 'utf8'))
    RENDERER_CALL.lastIndex = 0
    let match = RENDERER_CALL.exec(text)
    while (match !== null) {
      const openParen = text.indexOf('(', match.index)
      const args = matchBlock(text, openParen)
      const brace = args.indexOf('{')
      sites.push({
        file: relative(SRC_DIR, file).split(sep).join('/'),
        line: text.slice(0, match.index).split('\n').length,
        args: brace >= 0 ? matchBlock(args, brace) : args,
      })
      match = RENDERER_CALL.exec(text)
    }
  }
  return sites
}

/** 参数里必须真的写了这个属性（不是注释里的、也不是别的名字） */
const hasPowerPreference = (args: string): boolean =>
  /powerPreference\s*:\s*RENDER_POWER_PREFERENCE/.test(args)

/** 背景层（src/background/）：必须显式写低功耗字面量，省得漏写后悄悄漂到默认值 */
const isBackgroundSite = (file: string): boolean => file.startsWith('background/')

const hasLowPowerPreference = (args: string): boolean =>
  /powerPreference\s*:\s*'low-power'/.test(args)

describe('渲染器的 GPU 偏好', () => {
  it('常量取 high-performance', () => {
    expect(RENDER_POWER_PREFERENCE).toBe('high-performance')
  })

  it('src/ 下每一处渲染器创建都显式请求了 GPU 偏好（主视口高性能 / 背景层低功耗）', () => {
    const offenders = findRendererSites()
      .filter((site) =>
        isBackgroundSite(site.file)
          ? !hasLowPowerPreference(site.args)
          : !hasPowerPreference(site.args),
      )
      .map((site) => `${site.file}:${site.line}`)

    expect(offenders).toEqual([])
  })

  it('扫描确实找到了已知的创建点（防止扫描器失效导致空过）', () => {
    const files = findRendererSites().map((site) => site.file)

    expect(files.length).toBeGreaterThanOrEqual(4)
    expect(files).toEqual(
      expect.arrayContaining([
        'composables/useThree.ts',
        'composables/useSceneEditor.ts',
        'render/main.ts',
        'views/SimulationLab.vue',
        'components/workbench/WorkbenchViewport.vue',
        'background/geometry-background.ts',
      ]),
    )
  })
})
