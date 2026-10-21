#!/usr/bin/env node
/**
 * 从真实模型文件渲染缩略图。
 *
 * 用法：node scripts/render-model-thumbnails.mjs
 *
 * 为什么要有这个脚本：
 * 模型库卡片此前显示的是"渐变底 + 名字首字"的占位图，和模型内容没有任何关系。
 * 对**确实有文件**的条目，缩略图应该是这个文件本身的渲染结果——
 * 否则卡片上的图和点进去加载到的东西对不上。
 *
 * 做法：无头 Chrome 打开一个本页，起 three.js + GLTFLoader 加载 GLB，
 * 按包围盒自动取景、布置三点光，截一张**透明背景**的 PNG。
 * 透明背景是为了让卡片容器上的分类渐变透出来（分类配色不丢）。
 *
 * 产物：public/assets/models/thumbnails/<模型名>.png
 */
import { createServer } from 'node:http'
import { readFile, readdir, stat, mkdir, writeFile } from 'node:fs/promises'
import { join, extname, basename, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const MODEL_DIR = join(repoRoot, 'public', 'assets', 'models', 'characters')
const OUT_DIR = join(repoRoot, 'public', 'assets', 'models', 'thumbnails')
const W = 512
const H = 384
const PORT = 5281
const DEBUG_PORT = 9281

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
  '.css': 'text/css',
}

// ---- 静态服务：把仓库根目录挂出去，让页面能 import node_modules 里的 three ----
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

// ---- 待渲染的模型文件 ----
let files = []
try {
  files = (await readdir(MODEL_DIR)).filter((f) => f.toLowerCase().endsWith('.glb'))
} catch {
  console.error(`模型目录不存在: ${MODEL_DIR}`)
  process.exit(1)
}
if (files.length === 0) {
  console.error(`${MODEL_DIR} 下没有 .glb 文件`)
  process.exit(1)
}
await mkdir(OUT_DIR, { recursive: true })

const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8">
<style>html,body{margin:0;padding:0;background:transparent;overflow:hidden}canvas{display:block}</style>
<script type="importmap">
{"imports":{
  "three":"/node_modules/three/build/three.module.js",
  "three/addons/":"/node_modules/three/examples/jsm/"
}}
</script>
</head><body><script type="module">
import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'

const W = ${W}, H = ${H}

// 只建一次渲染器/场景/相机，逐个模型换内容——
// 每次都新建 canvas 会让旧 canvas 留在 DOM 里，截图截到的是上一张。
let renderer = null
let scene = null
let camera = null
let lights = null
let currentRoot = null

const ensureStage = () => {
  if (renderer) return
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(2)
  renderer.setSize(W, H)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.outputColorSpace = THREE.SRGBColorSpace
  document.body.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  camera = new THREE.PerspectiveCamera(35, W / H, 0.01, 100000)
  lights = new THREE.Group()
  scene.add(lights)
}

window.renderModel = async (url) => {
  ensureStage()

  if (currentRoot) {
    scene.remove(currentRoot)
    currentRoot = null
  }
  // 灯位每次按模型尺寸重设
  lights.clear()

  const loader = new GLTFLoader()
  const gltf = await loader.loadAsync(url)
  const root = gltf.scene
  root.updateMatrixWorld(true)

  // 自动取景：按包围盒把模型摆正、居中、按大小定距离
  //
  // 注意：Box3.setFromObject 用的是**绑定姿态**的几何包围盒，
  // 对带骨骼的蒙皮模型会算得偏大（狐狸就大了好几倍）。
  // SkinnedMesh.computeBoundingBox() 才考虑当前骨骼变换，这里逐个处理。
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  const localBox = new THREE.Box3()
  root.traverse((o) => {
    if (!o.geometry) return
    if (o.isSkinnedMesh) {
      o.computeBoundingBox()
      localBox.copy(o.boundingBox)
    } else {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox()
      localBox.copy(o.geometry.boundingBox)
    }
    if (localBox.isEmpty()) return
    box.union(localBox.clone().applyMatrix4(o.matrixWorld))
  })
  if (box.isEmpty()) throw new Error('模型没有可见几何体')
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z)
  root.position.sub(center)
  scene.add(root)
  currentRoot = root

  // 三点光：主光 + 补光 + 轮廓光
  const key = new THREE.DirectionalLight(0xffffff, 2.4)
  key.position.set(maxDim, maxDim * 1.2, maxDim * 1.1)
  lights.add(key)
  const fill = new THREE.DirectionalLight(0xdfe6ff, 0.9)
  fill.position.set(-maxDim, maxDim * 0.4, maxDim * 0.8)
  lights.add(fill)
  const rim = new THREE.DirectionalLight(0xffffff, 1.2)
  rim.position.set(-maxDim * 0.4, maxDim * 0.6, -maxDim * 1.2)
  lights.add(rim)
  lights.add(new THREE.HemisphereLight(0xffffff, 0xd8dcea, 1.1))

  // 相机：3/4 视角，微微俯视
  // 距离按**竖直与水平两个视锥**分别算，取较大者——只看其中一个会切边或留白
  const fovV = (camera.fov * Math.PI) / 180
  const fovH = 2 * Math.atan(Math.tan(fovV / 2) * (W / H))
  const margin = 1.28
  const distV = (size.y / 2) / Math.tan(fovV / 2)
  const distH = (size.x / 2) / Math.tan(fovH / 2)
  const dist = Math.max(distV, distH, maxDim) * margin
  camera.position.set(dist * 0.60, dist * 0.40, dist * 0.70)
  camera.far = Math.max(2000, dist * 20)
  camera.lookAt(0, 0, 0)
  camera.updateProjectionMatrix()

  renderer.render(scene, camera)

  // 回报实际几何统计，交给调用方写进数据层
  let meshes = 0, tris = 0
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return
    meshes++
    const g = o.geometry
    const count = g.index ? g.index.count : (g.attributes?.position?.count ?? 0)
    tris += Math.round(count / 3)
  })
  return { meshes, triangles: tris, size: [size.x, size.y, size.z] }
}
window.__ready = true
</script></body></html>`

const htmlPath = join(repoRoot, 'node_modules', '.cache', 'model-thumbnails.html')
await mkdir(join(repoRoot, 'node_modules', '.cache'), { recursive: true })
await writeFile(htmlPath, pageHtml, 'utf8')

// ---- 启动无头 Chrome ----
const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(repoRoot, 'node_modules', '.cache', 'chrome-thumbnails')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    `--window-size=${W},${H}`,
    'about:blank',
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

// CDP 客户端：用 Node 22+ 内置的 WebSocket，不引外部包
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
const events = []

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
  } else if (msg.method) {
    events.push(msg)
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
await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 2, mobile: false }, sessionId)
// 截图默认把页面合成到**白底**上，PNG 就不是真透明，
// 卡片上的分类渐变会被盖住。这里把默认背景改成全透明。
await send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } }, sessionId)

await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/node_modules/.cache/model-thumbnails.html` }, sessionId)
await new Promise((r) => setTimeout(r, 2500))

const results = []
for (const file of files) {
  const url = `/public/assets/models/characters/${file}`
  const name = basename(file, extname(file))

  const evaluated = await send('Runtime.evaluate', {
    expression: `window.renderModel(${JSON.stringify(url)})`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)

  if (evaluated.exceptionDetails) {
    console.error(`❌ ${name}: ${evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text}`)
    results.push({ name, ok: false })
    continue
  }

  const stats = evaluated.result?.value
  const shot = await send('Page.captureScreenshot', {
    format: 'png',
    // 视口已经是 deviceScaleFactor 2，clip 不再叠 scale——
    // 否则会变成 4x 超采样，文件体积白涨四倍
    clip: { x: 0, y: 0, width: W, height: H, scale: 1 },
  }, sessionId)
  const buf = Buffer.from(shot.data, 'base64')
  const outFile = join(OUT_DIR, `${name}.png`)
  await writeFile(outFile, buf)

  results.push({ name, ok: true, bytes: buf.length, ...stats })
  console.log(
    `✓ ${name.padEnd(18)} ${String(buf.length).padStart(7)} B  ` +
      `网格 ${stats.meshes} · 三角形 ${stats.triangles.toLocaleString()} · ` +
      `尺寸 ${stats.size.map((v) => v.toFixed(2)).join('×')}`,
  )
}

console.log(`\n产物目录: ${OUT_DIR}`)
try { await send('Browser.close') } catch {}
try { chrome.kill() } catch {}
server.close()
await new Promise((r) => setTimeout(r, 400))

const failed = results.filter((r) => !r.ok)
process.exit(failed.length > 0 ? 1 : 0)
