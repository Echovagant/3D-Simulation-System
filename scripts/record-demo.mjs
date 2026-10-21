#!/usr/bin/env node
/**
 * 录一段真实演示视频（README 顶部用）。
 *
 * 用法：node scripts/record-demo.mjs
 *
 * 做法：无头 Chrome 打开**生产产物**，用 CDP 的 Page.startScreencast
 * 抓真实交互过程（放物体、跑物理、看智能体），再交给 ffmpeg 编码成
 * MP4（<video> 标签用）与 GIF（README 里最通用的形式）。
 *
 * 不是"渲染一张好看的图"——录的是这个项目真的在跑的东西。
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat, writeFile, mkdir, rm } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spawn, execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { CDP, evalJs, sleep } from './lib/cdp.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const DIST = join(repoRoot, 'dist')
const FRAME_DIR = join(repoRoot, 'node_modules', '.cache', 'demo-frames')
const OUT_DIR = join(repoRoot, 'docs', 'assets')
const FFMPEG = 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe'
const W = 1280
const H = 720

if (!existsSync(DIST)) {
  console.error('没有 dist/ —— 先跑 npm run build')
  process.exit(1)
}
if (!existsSync(FFMPEG)) {
  console.error(`找不到 ffmpeg：${FFMPEG}`)
  process.exit(1)
}

function existsSync(p) {
  try {
    stat(p)
    return true
  } catch {
    return false
  }
}

// ---------- 静态服务 ----------
const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary', '.wasm': 'application/wasm',
  '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.woff': 'font/woff', '.ico': 'image/x-icon',
}
const PORT = 5341
const server = createServer(async (req, res) => {
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
await new Promise((r) => server.listen(PORT, '127.0.0.1', r))

// ---------- Chrome ----------
const DEBUG_PORT = 9341
const chrome = spawn('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', [
  '--headless=new',
  `--remote-debugging-port=${DEBUG_PORT}`,
  `--user-data-dir=${join(repoRoot, 'node_modules', '.cache', 'chrome-demo')}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--force-device-scale-factor=1', `--window-size=${W},${H}`,
  'about:blank',
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
await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false }, sessionId)

// ---------- 帧收集 ----------
const frames = []
cdp.on('Page.screencastFrame', async (params, sid) => {
  frames.push({ data: params.data, ts: params.metadata?.timestamp ?? Date.now() / 1000 })
  // 必须 ack，否则帧流会停住
  try {
    await cdp.send('Page.screencastFrameAck', { sessionId: params.sessionId }, sid)
  } catch {}
}, sessionId)

/** 点一个带 title 的按钮 */
const clickByTitle = async (title) => {
  const r = await evalJs(cdp, sessionId, `(() => {
    const el = document.querySelector('[title=${JSON.stringify(title)}]');
    if (!el) return false;
    el.click();
    return true;
  })()`)
  console.log(`   点击「${title}」-> ${r ? 'ok' : '未找到'}`)
  return r
}

/** 点一个文字匹配的按钮（面板里的按钮多数没有 title，只有文字） */
const clickByText = async (text) => {
  const r = await evalJs(cdp, sessionId, `(() => {
    const el = [...document.querySelectorAll('button')]
      .find((b) => (b.innerText || '').includes(${JSON.stringify(text)}));
    if (!el) return false;
    el.click();
    return true;
  })()`)
  console.log(`   点击按钮「${text}」-> ${r ? 'ok' : '未找到'}`)
  return r
}

const goto = async (route, wait) => {
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${PORT}${route}` }, sessionId)
  await sleep(wait)
}

// ---------- 拍摄脚本 ----------
console.log('录制中…')

// 演示只留两个"有动作"的场景：物理仿真与 AI 演武场。
// 其余页面用静态截图展示（scripts/generate-docs-assets.mjs）——
// GIF 循环播放时越短越耐看，30 秒的循环只会让人划走。

// 先把仿真实验室加载好，**再开始录屏**：
// 否则开头几秒是黑屏（3D 场景还没初始化），录进来就是一段黑。
console.log(' 预热 仿真实验室')
await goto('/simulation-lab', 6000)

await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 82, maxWidth: W, maxHeight: H, everyNthFrame: 1 }, sessionId)

console.log(' ① 仿真实验室：跑物理')
await clickByTitle('开始仿真')
await sleep(3500)

console.log(' ② AI 演武场：智能体自主移动')
await goto('/ai-playground', 6000)
// ⚠️ 必须真的启动仿真：演武场的智能体默认是「空闲」状态，
// 不点开始的话录下来的是一片静止的场地，与"自主移动"的说法对不上。
await clickByText('开始')
await sleep(4500)

await cdp.send('Page.stopScreencast', {}, sessionId)
await sleep(300)

console.log(`\n抓到 ${frames.length} 帧`)

// ---------- 落盘 ----------
await rm(FRAME_DIR, { recursive: true, force: true })
await mkdir(FRAME_DIR, { recursive: true })
const timeline = []
for (let i = 0; i < frames.length; i++) {
  const name = `f${String(i).padStart(5, '0')}.jpg`
  await writeFile(join(FRAME_DIR, name), Buffer.from(frames[i].data, 'base64'))
  const dur = i < frames.length - 1 ? frames[i + 1].ts - frames[i].ts : 1 / 15
  timeline.push(`file '${name}'\nduration ${Math.max(0.01, dur).toFixed(4)}`)
}
timeline.push(`file '${'f' + String(frames.length - 1).padStart(5, '0')}.jpg'`)
const concatPath = join(FRAME_DIR, 'list.txt')
await writeFile(concatPath, timeline.join('\n'), 'utf8')

// ---------- 编码 ----------
await mkdir(OUT_DIR, { recursive: true })
const mp4 = join(OUT_DIR, 'demo.mp4')
const gif = join(OUT_DIR, 'demo.gif')

console.log('编码 MP4…')
try {
  execFileSync(FFMPEG, [
    '-y', '-f', 'concat', '-safe', '0', '-i', concatPath,
    '-vf', 'fps=30,scale=1280:-2:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '24', '-movflags', '+faststart',
    mp4,
  ], { stdio: ['ignore', 'inherit', 'inherit'] })
} catch (e) {
  console.error('MP4 编码失败')
  process.exit(1)
}
console.log(`  ${mp4}  ${(await stat(mp4)).size} B`)

console.log('编码 GIF（单命令双通道调色板）…')
const palette = join(FRAME_DIR, 'palette.png')
/** 跑 ffmpeg，失败时把 stderr 当字符串打出来（否则只能看到 Buffer 的数字） */
const runFfmpeg = (args, label) => {
  try {
    execFileSync(FFMPEG, args, { stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (e) {
    const err = (e.stderr ?? '').toString()
    console.error(`\n❌ ${label} 失败：`)
    console.error(
      err
        .split('\n')
        .filter((l) => l.trim() && !/built with|configuration:|lib[a-z]+ version/.test(l))
        .slice(-14)
        .join('\n'),
    )
    process.exit(1)
  }
}
// 一张图里同时做调色板生成与套用：
// split 出两路，一路进 palettegen 生成调色板，另一路连同调色板进 paletteuse。
// （早先写成「两遍 + 读调色板文件」时把 paletteuse 的两个输入接反了，
//   报 "Palette input must contain exactly 256 pixels"。）
runFfmpeg([
  '-y', '-i', mp4,
  '-vf', 'fps=10,scale=640:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle',
  '-loop', '0', gif,
], 'GIF')
console.log(`  ${gif}  ${(await stat(gif)).size} B`)

// ---------- 收尾 ----------
try { await cdp.send('Browser.close') } catch {}
try { chrome.kill() } catch {}
server.close()
await sleep(400)
await rm(FRAME_DIR, { recursive: true, force: true })
process.exit(0)
