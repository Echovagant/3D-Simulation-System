#!/usr/bin/env node
/**
 * 离线降级闸门：**拔掉后端**，前端必须照常工作。
 *
 * 这个仓库的核心承诺是「后端是可选增强」——后端缺席时，
 * 场景还在浏览器本地、实时仿真还在跑、界面只多一句说明。
 * 承诺不会自己成立：只要有人改坏了一处降级路径，
 * 后端一挂整页就白屏，而这件事没有任何既有闸门能发现。
 *
 * 做法：用无头 Chrome 打开**生产产物**，把 `/api/*` 全部按
 * 503 `backend_unavailable` 应答（与开发期代理在后端缺席时的行为一致），
 * 然后逐个走完 7 个页面，逐页断言：
 *
 * - 页面渲染出来了（页面根节点在）
 * - **0 条 console error、0 个未捕获异常**
 * - 依赖后端的面板给出了降级说明，而不是崩掉或装死
 *
 * 用法：node scripts/check-offline.mjs
 * 环境变量：CHROME_PATH 指定浏览器；PORT 指定静态服务器端口（默认自动挑空闲端口）
 * 退出码：0 = 全部通过；1 = 有问题（并打印具体是哪一页、哪一条）
 *
 * ⚠️ 缺 dist/ 或缺 Chrome 都**判失败**：那意味着这条检查根本没跑起来，
 * 静默放行等于没有守卫（与 `check-entry-bundle-size.mjs` 同一个态度）。
 */
import { createServer } from 'node:http'
import { createServer as createSocketServer } from 'node:net'
import { readFile, stat } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CDP, evalJs, sleep } from './lib/cdp.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(repoRoot, 'dist')

/** 7 个页面与各自的根节点标记 */
const ROUTES = [
  { path: '/', selector: '.welcome-container', name: '首页' },
  { path: '/overview', selector: '.overview-container', name: '总览' },
  { path: '/scene-editor', selector: '.scene-editor', name: '场景编辑器' },
  { path: '/simulation-lab', selector: '.simulation-lab', name: '仿真实验室' },
  { path: '/model-library', selector: '.model-library-container', name: '模型资源库' },
  { path: '/ai-playground', selector: '.ai-playground-container', name: 'AI 演武场' },
  { path: '/docs', selector: '.docs-page', name: '系统文档' },
]

/**
 * 依赖后端的面板：后端不在时必须给出降级说明。
 * 断言的是「有说明」，不是「说明长什么样」——文案可以改，行为不能改。
 */
const BACKEND_PANELS = [
  { selector: '.sim-batch-panel .sim-backend-missing', name: '批量仿真面板' },
  { selector: '.sim-render-panel .sim-backend-missing', name: '服务端渲染面板' },
]

/** 浏览器候选路径：CI 与本地各取所需 */
const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean)

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.woff': 'font/woff',
  '.ico': 'image/x-icon',
}

const existsSync = (p) => {
  try {
    stat(p)
    return true
  } catch {
    return false
  }
}

/** 找一个没人占用的本地端口 */
const findFreePort = () =>
  new Promise((resolvePort, reject) => {
    const probe = createSocketServer()
    probe.once('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      const port = typeof address === 'object' && address ? address.port : 0
      probe.close(() => resolvePort(port))
    })
  })

/** 服务生产产物；未知的路径回落到 index.html（SPA 路由要靠这个） */
const startStaticServer = async (port) => {
  const server = createServer(async (req, res) => {
    try {
      const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname)
      let file = join(DIST, pathname)
      try {
        if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
      } catch {
        file = join(DIST, 'index.html')
      }
      const body = await readFile(file)
      res.writeHead(200, {
        'Content-Type': MIME[extname(file).toLowerCase()] ?? 'application/octet-stream',
        'Content-Length': body.length,
      })
      res.end(body)
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
      res.end('not found')
    }
  })
  await new Promise((r) => server.listen(port, '127.0.0.1', r))
  return server
}

/**
 * 在 GitHub Actions 里把失败原因变成 **annotation**。
 *
 * 步骤日志要登录才看得到，但 annotation 是公开可读的——
 * 失败原因因此不会只藏在日志里。
 *
 * ⚠️ `::error::` 会**把步骤判成失败**（哪怕退出码是 0），
 * 所以它只能在真的失败时用；说明性的输出必须走 `::notice::`。
 */
const isCI = Boolean(process.env.CI)
const annotate = (message) => {
  if (!isCI) return
  const text = String(message).replace(/\r?\n/g, '%0A').slice(0, 4000)
  console.log(`::error title=离线降级闸门::${text}`)
}

/** 说明性输出：只出现在日志与 summary 里，不影响步骤结论 */
const notice = (message) => {
  if (!isCI) return
  const text = String(message).replace(/\r?\n/g, '%0A').slice(0, 4000)
  console.log(`::notice title=离线降级闸门::${text}`)
}

const fail = (message) => {
  annotate(`致命错误：${message}`)
  console.error(`FAIL ${message}`)
  process.exit(1)
}

// ---------- 前置检查 ----------

if (!existsSync(DIST)) {
  fail('没有 dist/ —— 先跑 `npm run build`（这条闸门要验的是生产产物）')
}

const chromePath = CHROME_CANDIDATES.find((p) => existsSync(p))
if (!chromePath) {
  fail(
    '找不到 Chrome —— 这条闸门要真的开一次浏览器。\n' +
      '装 Chrome，或用环境变量指定：CHROME_PATH=<chrome 可执行文件路径>',
  )
}

/**
 * CI 里要关掉沙箱。
 *
 * 容器里 Chrome 的 setuid 沙箱经常起不来（"No usable sandbox!"），
 * 浏览器根本不会启动，调试端口也就永远连不上。
 * 只在 CI 环境加——本地跑保留沙箱。
 */
const CHROME_CI_ARGS = process.env.CI
  ? [
      '--no-sandbox',
      '--disable-dev-shm-usage',
      // 没有 GPU 时强制走 ANGLE 的 SwiftShader 软件渲染路径——
      // 只给「允许用软件 WebGL」还不够，ANGLE 也要明确指过去。
      '--use-angle=swiftshader',
    ]
  : []

/**
 * `--enable-unsafe-swiftshader`：**软件 WebGL 兜底**。
 *
 * 三个 3D 页面要真的渲染出画面，需要 WebGL 上下文。
 * 没有 GPU 的机器（CI 容器、无显卡的虚拟机）上，Chrome 只能靠 SwiftShader 软件渲染，
 * 而新版 Chrome 默认把它禁掉——不显式打开，WebGL 上下文创建会失败，
 * 页面上就会出现 "Error creating WebGL context"。有显卡的机器上这个开关没有副作用。
 */
const CHROME_WEBGL_ARGS = ['--enable-unsafe-swiftshader']

const port = Number(process.env.PORT) || (await findFreePort())
const debugPort = await findFreePort()
const server = await startStaticServer(port)

console.log(`静态服务器：http://127.0.0.1:${port}（生产产物）`)
console.log(`浏览器：${chromePath}${CHROME_CI_ARGS.length ? '（CI 模式：--no-sandbox）' : ''}`)

const chrome = spawn(
  chromePath,
  [
    '--headless=new',
    `--remote-debugging-port=${debugPort}`,
    `--user-data-dir=${join(repoRoot, 'node_modules', '.cache', 'chrome-offline')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=1280,900',
    ...CHROME_WEBGL_ARGS,
    ...CHROME_CI_ARGS,
    'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)
// Chrome 的 stderr 要收着：起不来的时候，这是唯一能看出原因的地方
let chromeStderr = ''
chrome.stderr?.on('data', (chunk) => {
  chromeStderr += chunk.toString()
})
chrome.stdout?.resume()

/** 等 Chrome 的调试端口起来 */
let wsUrl = null
for (let i = 0; i < 60; i++) {
  await sleep(500)
  try {
    const info = await (await fetch(`http://127.0.0.1:${debugPort}/json/version`)).json()
    if (info.webSocketDebuggerUrl) {
      wsUrl = info.webSocketDebuggerUrl
      break
    }
  } catch {
    // 还没起来，继续等
  }
}
if (!wsUrl) {
  try {
    chrome.kill()
  } catch {
    // 已经退出
  }
  server.close()
  console.error('Chrome 的输出（排查用）：')
  console.error(chromeStderr.trim() || '（没有输出）')
  annotate(`Chrome 起不来。stderr：${chromeStderr.trim().slice(-800) || '（没有输出）'}`)
  fail('Chrome 没有就绪（调试端口没起来）')
}

const cdp = await CDP.connect(wsUrl)
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
await cdp.send('Page.enable', {}, sessionId)
await cdp.send('Runtime.enable', {}, sessionId)
await cdp.send('Log.enable', {}, sessionId)

// ---------- 把 /api/* 全部按 503 应答（= 后端下线） ----------

/** 后端缺席时前端拿到的就是这个信封（与开发期代理的行为一致） */
const BACKEND_DOWN_BODY = JSON.stringify({
  error: { code: 'backend_unavailable', message: '后端不可达', detail: null },
})

await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*/api/*' }] }, sessionId)
cdp.on(
  'Fetch.requestPaused',
  async (params, sid) => {
    try {
      await cdp.send(
        'Fetch.fulfillRequest',
        {
          requestId: params.requestId,
          responseCode: 503,
          responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
          body: Buffer.from(BACKEND_DOWN_BODY).toString('base64'),
        },
        sid,
      )
    } catch {
      // 请求可能已经取消
    }
  },
  sessionId,
)

// ---------- 收集页面问题 ----------

/** 当前页面看到的问题 */
let issues = []
/** 网络层自己报的失败：/api 的 503 是**故意的**，不算问题 */
const isExpectedApiFailure = (entry) => {
  const url = entry?.url ?? ''
  const text = entry?.text ?? ''
  return url.includes('/api/') || /Failed to load resource.*503/.test(text)
}

cdp.on(
  'Runtime.consoleAPICalled',
  (params) => {
    if (params?.type !== 'error') return
    const text = (params.args ?? [])
      .map((a) => a.value ?? a.description ?? '')
      .join(' ')
    issues.push({ kind: 'console.error', text })
  },
  sessionId,
)
cdp.on(
  'Runtime.exceptionThrown',
  (params) => {
    const details = params?.exceptionDetails
    issues.push({
      kind: '未捕获异常',
      text: details?.exception?.description ?? details?.text ?? 'unknown exception',
    })
  },
  sessionId,
)
cdp.on(
  'Log.entryAdded',
  (params) => {
    if (params?.entry?.level !== 'error') return
    if (isExpectedApiFailure(params.entry)) return
    issues.push({ kind: '浏览器日志', text: params.entry.text ?? '' })
  },
  sessionId,
)

// ---------- 逐页走一遍 ----------

const report = []

/**
 * 报一下实际用的 OpenGL 渲染器。
 *
 * 这条信息在排查时很值钱：它能一眼看出这次跑的是**真 GPU** 还是
 * **SwiftShader 软件渲染**——两者在别的机器上的表现并不一样。
 */
const glRenderer = await evalJs(
  cdp,
  sessionId,
  `(() => {
    try {
      const c = document.createElement('canvas')
      const gl = c.getContext('webgl2') || c.getContext('webgl')
      if (!gl) return '没有 WebGL 上下文'
      const ext = gl.getExtension('WEBGL_debug_renderer_info')
      return ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : String(gl.getParameter(gl.RENDERER))
    } catch (e) {
      return '读不到：' + String(e)
    }
  })()`,
).catch((e) => '读取失败：' + String(e))
console.log(`WebGL 渲染器：${glRenderer}`)
notice(`本次使用的 WebGL 渲染器：${glRenderer}`)

for (const route of ROUTES) {
  issues = []
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}${route.path}` }, sessionId)

  // 等页面根节点出现（最多 30 秒——CI 机器慢，3D 页面要初始化 WASM）
  let mounted = false
  for (let i = 0; i < 60; i++) {
    await sleep(500)
    const ok = await evalJs(
      cdp,
      sessionId,
      `!!document.querySelector(${JSON.stringify(route.selector)})`,
    ).catch(() => false)
    if (ok) {
      mounted = true
      break
    }
  }
  // 页面出来了还要等 3D 场景与 WASM 初始化——错误常在这之后才冒出来
  await sleep(3000)

  const pageIssues = issues.slice()
  report.push({ route: route.path, name: route.name, mounted, issues: pageIssues })

  console.log(
    `  ${mounted ? '✓' : '✗'} ${route.name.padEnd(6, '　')} ${route.path.padEnd(18)} ` +
      (pageIssues.length ? `${pageIssues.length} 个问题` : '0 console error / 0 未捕获异常'),
  )
  for (const issue of pageIssues) {
    console.log(`      · [${issue.kind}] ${issue.text.slice(0, 300)}`)
    annotate(`${route.name}（${route.path}）${issue.kind}：${issue.text.slice(0, 800)}`)
  }
  if (!mounted) annotate(`${route.name}（${route.path}）页面没渲染出来`)
}

// ---------- 降级面板必须给出说明 ----------

await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/simulation-lab` }, sessionId)
for (let i = 0; i < 40; i++) {
  await sleep(500)
  const ok = await evalJs(cdp, sessionId, `!!document.querySelector('.sim-batch-panel')`).catch(
    () => false,
  )
  if (ok) break
}
await sleep(3000)

console.log('')
console.log('后端缺席时的降级说明：')
const panelProblems = []
for (const panel of BACKEND_PANELS) {
  const found = await evalJs(
    cdp,
    sessionId,
    `!!document.querySelector(${JSON.stringify(panel.selector)})`,
  ).catch(() => false)
  console.log(`  ${found ? '✓' : '✗'} ${panel.name}：${found ? '给出了说明' : '没有说明（会让人以为一切正常）'}`)
  if (!found) {
    panelProblems.push(panel.name)
    annotate(`${panel.name} 在后端缺席时没有给出降级说明（选择器 ${panel.selector} 没命中）`)
  }
}

// ---------- 收尾 ----------

try {
  await cdp.send('Browser.close')
} catch {
  // 浏览器可能已经关了
}
try {
  chrome.kill()
} catch {
  // 同上
}
server.close()

// ---------- 判定 ----------

const brokenPages = report.filter((r) => !r.mounted || r.issues.length > 0)
const problems = []
for (const page of brokenPages) {
  if (!page.mounted) problems.push(`${page.name}（${page.path}）页面没渲染出来`)
  for (const issue of page.issues) problems.push(`${page.name}（${page.path}）${issue.kind}：${issue.text}`)
}
for (const name of panelProblems) problems.push(`${name} 在后端缺席时没有给出降级说明`)

console.log('')
if (problems.length) {
  console.error(`FAIL 离线降级有问题（${problems.length} 处）：`)
  for (const p of problems) {
    console.error(`  · ${p.slice(0, 400)}`)
    annotate(p.slice(0, 1000))
  }
  process.exit(1)
}

console.log(
  `✅ 拔掉后端：${report.length} 个页面全部渲染正常，0 console error、0 未捕获异常；` +
    '依赖后端的面板都给出了降级说明。',
)
process.exit(0)
