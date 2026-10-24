#!/usr/bin/env node
/**
 * 生成文档资产：README 封面 + 7 张页面截图。
 *
 * 用法：
 *   npm run build            # 先构建出 dist/
 *   npm run gen:docs         # 再生成封面与截图
 *
 * 全部用无头 Chrome 对**生产产物**拍摄/渲染，不手绘、不截开发服务器。
 * 数字（入口体积、用例数、闸门数、依赖数）都从真实产物与 package.json 里读，
 * 不写死——写死就会在代码变了之后悄悄说谎。
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join, extname } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CDP, evalJs, sleep } from './lib/cdp.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(repoRoot, 'dist')
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'

if (!existsSync(DIST)) {
  console.error('没有 dist/ —— 先跑 npm run build')
  process.exit(1)
}

function existsSync(p) {
  try {
    // ⚠️ 必须是**同步**的 stat：`node:fs/promises` 的 stat 返回 Promise，
    // 不会同步抛异常，catch 不到——这个函数就会永远返回 true，
    // 「dist/ 在不在」的检查就成了摆设。
    statSync(p)
    return true
  } catch {
    return false
  }
}

// ---------- 真实数字 ----------
const pkg = JSON.parse(await readFile(join(repoRoot, 'package.json'), 'utf8'))
const assetNames = await readdir(join(DIST, 'assets'))
const entryName = assetNames.find((f) => /^index-.*\.js$/.test(f))
if (!entryName) {
  console.error('dist/assets 下找不到入口 chunk —— 先跑 npm run build')
  process.exit(1)
}
const entryKB = (await stat(join(DIST, 'assets', entryName))).size / 1024
const deps = Object.keys(pkg.dependencies).length
// 闸门数量：数**构建链里真正调用**的 verify:* 闸门。
// ⚠️ 不能数全部 verify:* 脚本——`npm run build` 之外的（后端闸门、契约校验、
// 离线降级）不在构建链里，数进去封面会和 README 正文的「11 道构建闸门」对不上。
// 口径与 scripts/check-readme.mjs 保持一致。
const gateCount = new Set(
  [...pkg.scripts.build.matchAll(/npm run (verify:[a-z0-9-]+)/g)].map((m) => m[1]),
).size

let testCases = '?'
{
  // vitest 的 json reporter 把报告**写进文件**，stdout 只有一行提示——
  // 去 stdout 里找数字是找不到的，得读文件。
  const reportPath = join(repoRoot, 'node_modules', '.cache', 'docs-assets-vitest.json')
  await mkdir(join(repoRoot, 'node_modules', '.cache'), { recursive: true })
  try {
    execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', `--outputFile=${reportPath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300000,
    })
  } catch {
    // 测试失败也要把报告读出来——数字本身仍然可用
  }
  try {
    const report = JSON.parse(await readFile(reportPath, 'utf8'))
    testCases = String(report.numTotalTests)
  } catch {
    // 读不到就保持 '?'，下面的检查会终止
  }
}
if (testCases === '?') {
  console.error('跑测试拿用例数失败，封面上的该指标不可信，终止')
  process.exit(1)
}

console.log(`入口 ${entryKB.toFixed(2)} KB · 用例 ${testCases} · 闸门 ${gateCount} · 依赖 ${deps}`)

// ---------- 静态服务（dist/ 与仓库里的 logo.svg）----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.woff': 'font/woff', '.ico': 'image/x-icon',
}
const PORT = 5311
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    const buf = await readFile(join(repoRoot, p))
    res.writeHead(200, { 'Content-Type': MIME[extname(p)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404)
    res.end('nf')
  }
})
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

// ---------- 启动无头 Chrome ----------
const DEBUG_PORT = 9311
const chrome = spawn(CHROME, [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${join(repoRoot, 'node_modules', '.cache', 'chrome-docs-assets')}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', '--window-size=1280,640', 'about:blank',
], { stdio: ['ignore', 'pipe', 'pipe'] })

let ws = null
for (let i = 0; i < 40; i++) {
  await sleep(500)
  try {
    const j = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).json()
    if (j.webSocketDebuggerUrl) { ws = j.webSocketDebuggerUrl; break }
  } catch {}
}
if (!ws) {
  console.error('Chrome 未就绪')
  try { chrome.kill() } catch {}
  server.close()
  process.exit(1)
}

const cdp = await CDP.connect(ws)
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
await cdp.send('Page.enable', {}, sessionId)
await cdp.send('Runtime.enable', {}, sessionId)

const close = async () => {
  try { await cdp.send('Browser.close') } catch {}
  try { chrome.kill() } catch {}
  server.close()
  await sleep(400)
}

// ============================================================
// 1) README 封面
// ============================================================
const logoSvg = await readFile(join(repoRoot, 'src', 'assets', 'images', 'logo.svg'), 'utf8')
// 内联 SVG：去掉 XML 声明（SVG 里不允许），注释留着无妨（不在 data URI 里）
const logoInline = logoSvg.replace(/<\?xml[^>]*\?>/g, '').trim()

const W = 1280
const H = 640

// 确定性伪随机（固定种子 → 每次生成的封面一致）
let seed = 20260101
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)

const nodes = []
for (let i = 0; i < 58; i++) {
  nodes.push({ x: rnd() * W, y: rnd() * H, r: 1.2 + rnd() * 2.4, a: 0.18 + rnd() * 0.32 })
}
const lines = []
for (let i = 0; i < nodes.length; i++) {
  for (let j = i + 1; j < nodes.length; j++) {
    const dx = nodes[i].x - nodes[j].x
    const dy = nodes[i].y - nodes[j].y
    const d = Math.hypot(dx, dy)
    if (d < 190) {
      lines.push(
        `<line x1="${nodes[i].x.toFixed(1)}" y1="${nodes[i].y.toFixed(1)}" x2="${nodes[j].x.toFixed(1)}" y2="${nodes[j].y.toFixed(1)}" stroke="#6E5AF0" stroke-width="1" opacity="${(0.09 * (1 - d / 190)).toFixed(3)}"/>`,
      )
    }
  }
}
const dots = nodes
  .map((n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="#6E5AF0" opacity="${n.a.toFixed(2)}"/>`)
  .join('')
const amberDots = nodes
  .filter(() => rnd() > 0.86)
  .slice(0, 6)
  .map((n) => `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${(n.r + 1.6).toFixed(1)}" fill="#96560A" opacity="0.5"/>`)
  .join('')

const metricCards = [
  { value: `${entryKB.toFixed(2)} KB`, label: '入口 chunk' },
  { value: String(testCases), label: '测试用例' },
  { value: String(gateCount), label: '构建闸门' },
  { value: String(deps), label: '运行时依赖' },
]
  .map(
    (m) => `<div class="metric">
      <div class="metric-value">${m.value}</div>
      <div class="metric-label">${m.label}</div>
    </div>`,
  )
  .join('')

const coverHtml = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { margin:0; padding:0; box-sizing:border-box; }
  html,body { width:${W}px; height:${H}px; overflow:hidden; }
  body {
    background: #F7F8FC;
    font-family: 'Microsoft YaHei','PingFang SC','Segoe UI',Arial,sans-serif;
    display:flex; flex-direction:column; align-items:center; justify-content:center;
    position:relative;
  }
  .net { position:absolute; inset:0; }
  .glow {
    position:absolute; left:50%; top:44%; width:900px; height:420px;
    transform: translate(-50%,-50%);
    background: radial-gradient(ellipse at center, rgba(110,90,240,0.10), rgba(110,90,240,0) 70%);
  }
  .inner { position:relative; text-align:center; z-index:2; }
  /* 块级 div 在居中容器里会靠左 —— 必须 margin: auto */
  .logo { width:92px; height:92px; margin:0 auto 18px; }
  .logo svg { width:100%; height:100%; display:block; }
  h1 { font-size:58px; line-height:1.1; color:#333333; font-weight:800; letter-spacing:.02em; }
  .en { font-size:15px; color:#8A8A99; letter-spacing:.34em; margin-top:9px; text-transform:uppercase; }
  .rule { width:76px; height:3px; border-radius:2px; background:#6E5AF0; margin:18px auto 0; opacity:.85; }
  .sub { margin-top:16px; font-size:21px; color:#666666; letter-spacing:.01em; }
  .metrics { display:flex; gap:14px; justify-content:center; margin-top:30px; }
  .metric {
    min-width:132px; padding:13px 20px 11px; border-radius:12px; background:#FFFFFF;
    border:1px solid #E4E9F5; box-shadow:0 2px 8px rgba(110,90,240,0.05);
  }
  .metric-value { font-size:25px; font-weight:800; color:#6E5AF0; line-height:1.15; letter-spacing:-0.01em; }
  .metric-label { font-size:12px; color:#8A8A99; margin-top:3px; letter-spacing:.04em; }
</style></head>
<body>
  <svg class="net" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${lines.join('')}${dots}${amberDots}</svg>
  <div class="glow"></div>
  <div class="inner">
    <div class="logo">${logoInline}</div>
    <h1>3D 仿真系统</h1>
    <div class="en">3D Simulation System</div>
    <div class="rule"></div>
    <div class="sub">Web3D 场景编辑 · 刚体物理仿真 · 规则式智能体</div>
    <div class="metrics">${metricCards}</div>
  </div>
</body></html>`

await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false }, sessionId)
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` }, sessionId)
// 把封面 HTML 塞进去
await cdp.send('Runtime.evaluate', {
  expression: `document.open(); document.write(${JSON.stringify(coverHtml)}); document.close();`,
  awaitPromise: true,
}, sessionId)
await sleep(900)
const coverShot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId)
await mkdir(join(repoRoot, 'docs', 'assets'), { recursive: true })
await writeFile(join(repoRoot, 'docs', 'assets', 'cover.png'), Buffer.from(coverShot.data, 'base64'))
console.log('✓ docs/assets/cover.png')

// ============================================================
// 2) 页面截图（对生产产物实拍）
// ============================================================

/**
 * 预置一个**有内容**的场景到 localStorage。
 *
 * ⚠️ 场景编辑器默认是空的（"未选择任何对象"）——空场景当对外截图很难看，
 * 而且看不出这个页面能做什么。截图前先把一份场景写进去，
 * 再用 `?sceneId=<id>` 打开它。
 *
 * 存储格式与 `src/stores/sceneEditorStore.ts` 一致：
 * 文档在 `scene-<id>`，索引在 `scene-index`（**两个都要写**，
 * 只写文档不写索引 = 场景列不出来）。
 *
 * ⚠️ 场景文档里**没有颜色字段**：基本体的颜色是建体时 `Math.random()` 定的。
 * 所以颜色由下面的 `applyColors` 步骤在加载后统一改——
 * 否则每次生成的截图颜色都不一样，README 的图会「自己会动」。
 */
const DEMO_SCENE_ID = 'readme-demo'
const DEMO_SCENE = {
  id: DEMO_SCENE_ID,
  name: '物体堆叠与碰撞',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  gravity: { x: 0, y: -9.81, z: 0 },
  objects: [
    {
      uuid: 'demo-cube-1', type: 'cube', name: '立方体 A',
      position: { x: -2.2, y: 1.2, z: 0.4 }, rotation: { x: 0, y: 0.6, z: 0 },
      scale: { x: 1.4, y: 1.4, z: 1.4 }, visible: true,
      physics: { type: 'dynamic', shape: 'box', mass: 1 },
    },
    {
      uuid: 'demo-cube-2', type: 'cube', name: '立方体 B',
      position: { x: 0.1, y: 2.6, z: -0.6 }, rotation: { x: 0.3, y: 0.2, z: 0.1 },
      scale: { x: 1.1, y: 1.1, z: 1.1 }, visible: true,
      physics: { type: 'dynamic', shape: 'box', mass: 1 },
    },
    {
      uuid: 'demo-sphere-1', type: 'sphere', name: '球体 A',
      position: { x: 2.4, y: 1.4, z: 1.2 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1.5, y: 1.5, z: 1.5 }, visible: true,
      physics: { type: 'dynamic', shape: 'sphere', mass: 1 },
    },
    {
      uuid: 'demo-sphere-2', type: 'sphere', name: '球体 B',
      position: { x: -0.6, y: 3.4, z: 1.8 }, rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 0.9, y: 0.9, z: 0.9 }, visible: true,
      physics: { type: 'dynamic', shape: 'sphere', mass: 1 },
    },
    {
      uuid: 'demo-cube-3', type: 'cube', name: '斜放的立方体',
      position: { x: 3.2, y: 0.8, z: -2.2 }, rotation: { x: 0.4, y: 0.9, z: 0.2 },
      scale: { x: 1.3, y: 1.3, z: 1.3 }, visible: true,
      physics: { type: 'dynamic', shape: 'box', mass: 1 },
    },
  ],
}

/** 物体配色（场景编辑器建体时随机上色，截图要稳定就得这里定死） */
const DEMO_COLORS = {
  '立方体 A': 0x6e5af0,
  '立方体 B': 0x3b82f6,
  '球体 A': 0xf97316,
  '球体 B': 0x10b981,
  '斜放的立方体': 0xec4899,
}

const SHOTS = [
  ['/', 'home', 3200],
  ['/overview', 'overview', 3600],
  ['/scene-editor?sceneId=readme-demo', 'scene-editor', 6000],
  ['/simulation-lab?preset=newtons-cradle', 'simulation-lab', 4500],
  ['/model-library', 'model-library', 4500],
  ['/ai-playground', 'ai-playground', 6000],
  ['/docs', 'docs', 3600],
]

// 静态服务要先能吐 dist/ 里的文件
const distServer = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
    let file = join(DIST, p)
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(DIST, 'index.html')
    }
    const buf = await readFile(file)
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    res.end(buf)
  } catch {
    res.writeHead(404)
    res.end('nf')
  }
})
const DIST_PORT = 5312
await new Promise((r) => distServer.listen(DIST_PORT, '127.0.0.1', r))

await mkdir(join(repoRoot, 'docs', 'screenshots'), { recursive: true })

// 预置演示场景：必须在**首次导航到站点**之前写入 localStorage，
// 否则同源策略下页面还没拿到 origin，写不进去。
await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DIST_PORT}/` }, sessionId)
await sleep(1200)
await evalJs(
  cdp,
  sessionId,
  `(() => {
    localStorage.setItem('scene-${DEMO_SCENE_ID}', ${JSON.stringify(JSON.stringify(DEMO_SCENE))});
    const index = [{
      id: '${DEMO_SCENE_ID}',
      name: ${JSON.stringify(DEMO_SCENE.name)},
      createdAt: '${DEMO_SCENE.createdAt}',
      objectCount: ${DEMO_SCENE.objects.length},
    }];
    localStorage.setItem('scene-index', JSON.stringify(index));
    return true;
  })()`,
)
console.log(`✓ 预置演示场景 scene-${DEMO_SCENE_ID}（${DEMO_SCENE.objects.length} 个物体）`)

for (const [route, name, wait] of SHOTS) {
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 2, mobile: false }, sessionId)
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${DIST_PORT}${route}` }, sessionId)
  await sleep(wait)
  await evalJs(cdp, sessionId, `document.fonts ? document.fonts.ready.then(()=>1) : 1`)
  await sleep(400)

  // 场景编辑器：把随机色改成定死的配色。
  // ⚠️ 基本体的颜色是建体时 `Math.random()` 定的，场景文档里不存颜色——
  // 不改的话每次生成的截图颜色都不一样，README 的图会「自己会动」。
  if (name === 'scene-editor') {
    const painted = await evalJs(
      cdp,
      sessionId,
      `(() => {
        const colors = ${JSON.stringify(DEMO_COLORS)};
        const app = document.getElementById('app');
        const pinia = app && app.__vue_app__ ? app.__vue_app__.config.globalProperties.$pinia : null;
        const st = pinia ? pinia.state.value.useSceneEditorStore : null;
        if (!st) return { painted: 0 };
        let painted = 0;
        for (const obj of st.objects || []) {
          const hex = colors[obj.name];
          const mesh = obj.threeObject;
          if (hex && mesh && mesh.material && typeof mesh.material.color?.setHex === 'function') {
            mesh.material.color.setHex(hex);
            mesh.material.needsUpdate = true;
            painted += 1;
          }
        }
        return { painted };
      })()`,
    )
    await sleep(600)
    console.log(`  配色：${painted.painted} 个物体`)
  }

  const info = await evalJs(cdp, sessionId, `(() => {
    const app = document.getElementById('app')
    const pinia = app && app.__vue_app__ ? app.__vue_app__.config.globalProperties.$pinia : null
    const st = pinia ? pinia.state.value.useSceneEditorStore : null
    return {
      mounted: !!(app && app.children.length),
      text: (document.body.innerText||'').trim().length,
      objects: st ? (st.objects || []).length : 0,
    }
  })()`)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }, sessionId)
  const buf = Buffer.from(shot.data, 'base64')
  await writeFile(join(repoRoot, 'docs', 'screenshots', `${name}.png`), buf)
  console.log(
    `✓ docs/screenshots/${name}.png  ${String(buf.length).padStart(8)} B  mounted=${info.mounted} objects=${info.objects}`,
  )
  if (!info.mounted) {
    console.error(`  ⚠️ ${route} 页面没挂载，截图可能是空白`)
    process.exitCode = 1
  }
}

distServer.close()
await close()
process.exit(process.exitCode ?? 0)
