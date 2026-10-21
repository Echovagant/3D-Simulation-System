#!/usr/bin/env node
/**
 * 生成品牌资产：站点 logo 与浏览器 favicon。
 *
 * 用法：node scripts/generate-brand-assets.mjs
 *
 * 为什么自己生成：
 * - 原来的 favicon 用的是 **Vue.js 官方 logo**（#41b883 / #35495e）——
 *   那是 Vue Software 的注册商标，不该拿来当本项目的标识；
 * - 原来的 logo 是 **AI 生成的图像**（原文件带国标 GB 45438-2025 的 AIGC 隐式标识），
 *   而任何一次重新编码（缩放、转格式）都会**丢掉那个标识块**——
 *   丢了之后再传播，隐式标识义务就没了；
 * - 自制资产没有这些问题：版权归属清晰、无需标识、可以任意再分发。
 *
 * 标记的设计：二十面体（20 个面）平直着色 + 棱线 + 一个琥珀色高亮节点。
 * 取二十面体是因为它在 32px 下仍然读得出"立体结构"，
 * 正好是这个项目要表达的东西。
 */
import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const PORT = 5299
const DEBUG_PORT = 9299

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.wasm': 'application/wasm',
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

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8">
<script type="importmap">
{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}
</script>
</head><body><script type="module">
import * as THREE from 'three'

const INDIGO = '#6E5AF0'
const INDIGO_DEEP = '#4B37C9'
const EDGE = '#C7C0FF'
const AMBER = '#FFA117'

window.renderMark = async (size) => {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(1)
  renderer.setSize(size, size)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.0
  renderer.outputColorSpace = THREE.SRGBColorSpace
  document.body.appendChild(renderer.domElement)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100)

  const group = new THREE.Group()

  // 主体：二十面体，平直着色（去索引 + 重算法线，棱面清晰）
  let geo = new THREE.IcosahedronGeometry(1, 0).toNonIndexed()
  geo.computeVertexNormals()
  const shell = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
    color: new THREE.Color(INDIGO),
    roughness: 0.32,
    metalness: 0.25,
  }))
  group.add(shell)

  // 棱线：把每个三角形的边画出来，低多边形结构感
  const edges = new THREE.LineSegments(
    new THREE.EdgesGeometry(geo),
    new THREE.LineBasicMaterial({ color: new THREE.Color(EDGE), transparent: true, opacity: 0.7 }),
  )
  group.add(edges)

  // 琥珀高亮节点：坐在**实测的最高顶点**上——几何体的最高点不等于半径，
  // 写死坐标会悬空。代表"被选中的实体"。
  const pos = geo.attributes.position
  let topY = -Infinity
  for (let i = 0; i < pos.count; i++) topY = Math.max(topY, pos.getY(i))
  const node = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.19, 0),
    new THREE.MeshStandardMaterial({
      color: new THREE.Color(AMBER),
      emissive: new THREE.Color(AMBER),
      emissiveIntensity: 1.4,
      roughness: 0.3,
      metalness: 0.1,
    }),
  )
  node.position.set(0, topY + 0.04, 0)
  group.add(node)

  scene.add(group)

  // 三点光
  const key = new THREE.DirectionalLight(0xffffff, 2.6)
  key.position.set(2.2, 2.8, 2.4)
  scene.add(key)
  const fill = new THREE.DirectionalLight(0xdfe6ff, 1.0)
  fill.position.set(-2.4, 0.6, 1.8)
  scene.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 1.4)
  rim.position.set(-0.8, 1.2, -2.6)
  scene.add(rim)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xc8cde0, 1.0))

  // 相机：3/4 视角，微俯视
  const dist = 3.95
  camera.position.set(dist * 0.52, dist * 0.40, dist * 0.76)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  renderer.render(scene, camera)
  return renderer.domElement.toDataURL('image/png')
}
window.__ready = true
</script></body></html>`

const htmlPath = join(repoRoot, 'node_modules', '.cache', 'brand-generator.html')
await mkdir(join(repoRoot, 'node_modules', '.cache'), { recursive: true })
await writeFile(htmlPath, pageHtml, 'utf8')

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
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/node_modules/.cache/brand-generator.html` }, sessionId)
await new Promise((r) => setTimeout(r, 2500))

/** 渲染指定尺寸并取回 PNG */
const renderAt = async (size) => {
  const res = await send('Runtime.evaluate', {
    expression: `window.renderMark(${size})`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)
  if (res.exceptionDetails || !res.result?.value) {
    throw new Error(res.exceptionDetails?.exception?.description ?? '渲染失败')
  }
  return Buffer.from(res.result.value.split(',')[1], 'base64')
}

// 1) 站点 logo 512x512
const logoPng = await renderAt(512)
await writeFile(join(repoRoot, 'src', 'assets', 'images', 'logo.png'), logoPng)
console.log(`✓ src/assets/images/logo.png  ${logoPng.length} B  512x512`)

// 2) favicon：32x32 PNG 塞进 ICO（现代浏览器均支持 PNG 负载的 ICO）
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

try { await send('Browser.close') } catch {}
try { chrome.kill() } catch {}
server.close()
await new Promise((r) => setTimeout(r, 400))
process.exit(0)
