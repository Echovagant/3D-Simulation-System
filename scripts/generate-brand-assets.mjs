#!/usr/bin/env node
/**
 * 从矢量母版生成品牌资产：站点 logo（PNG）与 favicon（ICO）。
 *
 * 用法：node scripts/generate-brand-assets.mjs
 *
 * 母版是 src/assets/images/logo.svg——**它才是要改的文件**，
 * 这个脚本只负责把它栅格化成需要的产物。不要手改产物。
 *
 * 为什么用矢量母版而不是直接建模：
 * - 母版是纯 SVG，可以手工调坐标，评审时看代码就够，不用跑渲染；
 * - 矢量在任意尺寸都清晰（页头是 46px，favicon 是 32px，README 里更大）；
 * - 产物与母版一一对应，不会出现"改了母版忘了重新生成"的漂移。
 */
import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const MASTER = join(repoRoot, 'src', 'assets', 'images', 'logo.svg')
const PORT = 5299
const DEBUG_PORT = 9299

const MIME = {
  '.html': 'text/html',
  '.svg': 'image/svg+xml',
  '.js': 'text/javascript',
  '.png': 'image/png',
}

const svg = await readFile(MASTER, 'utf8')
if (!/<svg[\s>]/.test(svg)) {
  console.error(`母版不是合法 SVG: ${MASTER}`)
  process.exit(1)
}

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

// 渲染页：把母版 SVG 内联进页面，透明背景
const pageFor = (size) => `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0;padding:0;background:transparent}
svg{display:block;width:${size}px;height:${size}px}
</style></head><body>${svg}</body></html>`

const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(repoRoot, 'node_modules', '.cache', 'chrome-brand')}`,
    '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
    '--force-device-scale-factor=1', '--window-size=600,600', 'about:blank',
  ],
  { stdio: ['ignore', 'pipe', 'pipe'] },
)

let ws = null
for (let i = 0; i < 40; i++) {
  await new Promise((r) => setTimeout(r, 500))
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

const wsImpl = globalThis.WebSocket
if (!wsImpl) {
  console.error('需要 Node 22+（内置 WebSocket）')
  try { chrome.kill() } catch {}
  server.close()
  process.exit(1)
}

const sock = new wsImpl(ws)
let msgId = 0
const pending = new Map()
await new Promise((resolve, reject) => {
  sock.addEventListener('open', resolve)
  sock.addEventListener('error', reject)
})
sock.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data)
  if (msg.id && pending.has(msg.id)) {
    const { resolve: rs, reject: rj } = pending.get(msg.id)
    pending.delete(msg.id)
    if (msg.error) rj(new Error(msg.error.message))
    else rs(msg.result)
  }
})
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, { resolve, reject })
    sock.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
  })

const { targetId } = await send('Target.createTarget', { url: 'about:blank' })
const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
await send('Page.enable', {}, sessionId)
await send('Runtime.enable', {}, sessionId)
// 截图默认把页面合成到白底上，PNG 就不是真透明——这里设成全透明
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId)

/** 把当前页面渲染成指定尺寸的透明 PNG */
const renderAt = async (size) => {
  await send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false }, sessionId)
  // 用 document.write 换页（Page.setDocumentContent 这个 CDP 方法并不存在）
  await send('Runtime.evaluate', {
    expression: `document.open(); document.write(${JSON.stringify(pageFor(size))}); document.close();`,
    awaitPromise: true,
  }, sessionId)
  await new Promise((r) => setTimeout(r, 350))
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: size, height: size, scale: 1 },
  }, sessionId)
  return Buffer.from(shot.data, 'base64')
}

// 1) 站点 logo：512x512 PNG
const logoPng = await renderAt(512)
await writeFile(join(repoRoot, 'src', 'assets', 'images', 'logo.png'), logoPng)
console.log(`✓ src/assets/images/logo.png  ${logoPng.length} B  512x512`)

// 2) favicon：64x64 PNG 塞进 ICO（现代浏览器均支持 PNG 负载的 ICO）
const favPng = await renderAt(64)
const icoHeader = Buffer.alloc(22)
icoHeader.writeUInt16LE(0, 0) // reserved
icoHeader.writeUInt16LE(1, 2) // type = icon
icoHeader.writeUInt16LE(1, 4) // count
icoHeader.writeUInt8(64, 6) // width
icoHeader.writeUInt8(64, 7) // height
icoHeader.writeUInt8(0, 8) // palette
icoHeader.writeUInt8(0, 9) // reserved
icoHeader.writeUInt16LE(1, 10) // color planes
icoHeader.writeUInt16LE(32, 12) // bits per pixel
icoHeader.writeUInt32LE(favPng.length, 14) // image size
icoHeader.writeUInt32LE(22, 18) // image offset
const ico = Buffer.concat([icoHeader, favPng])
await writeFile(join(repoRoot, 'public', 'favicon.ico'), ico)
console.log(`✓ public/favicon.ico  ${ico.length} B  (64x64 PNG 负载)`)

console.log(`\n母版: ${MASTER}`)
console.log('改设计请改母版 SVG，然后重跑 npm run gen:brand')

try { await send('Browser.close') } catch {}
try { chrome.kill() } catch {}
server.close()
await new Promise((r) => setTimeout(r, 400))
process.exit(0)
