#!/usr/bin/env node
/**
 * 程序化生成内置模型：用 three.js 基本体拼装，导出 GLB。
 *
 * 用法：node scripts/generate-model-assets.mjs
 *
 * 为什么自己生成：
 * - **零第三方许可风险**——这些模型是我们自己创作的，随仓库走 Apache-2.0 即可，
 *   不像外部素材那样要逐个查协议、逐个署名；
 * - 确定性——同样的配方永远产出同样的文件，闸门能逐字节核对；
 * - 体量与面数可控——低多边形基本体拼装，单个模型几十 KB。
 *
 * 配方在 scripts/model-recipes.mjs（声明式数据，改造型不用碰这个脚本）。
 * 产物落在 public/assets/models/<category>/<file>.glb，
 * 缩略图由 render-model-thumbnails.mjs 从**导出的文件**渲染，保证图与文件一致。
 */
import { createServer } from 'node:http'
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises'
import { join, extname } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { MODEL_RECIPES } from './model-recipes.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const PORT = 5291
const DEBUG_PORT = 9291

const MIME = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.glb': 'model/gltf-binary',
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
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js'

window.buildModel = async (recipe) => {
  const group = new THREE.Group()
  // 材质按颜色缓存——同色的零件共用一个材质，导出的 glTF 材质数才合理
  const materialCache = new Map()
  const getMat = (color, emissive) => {
    const key = color + '|' + (emissive ?? '')
    if (materialCache.has(key)) return materialCache.get(key)
    const mat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color),
      roughness: 0.55,
      metalness: 0.15,
    })
    if (emissive) {
      mat.emissive = new THREE.Color(emissive)
      mat.emissiveIntensity = 1.6
    }
    materialCache.set(key, mat)
    return mat
  }

  for (const part of recipe.parts) {
    const g = part.geo
    let geo
    if (g.w !== undefined) geo = new THREE.BoxGeometry(g.w, g.h, g.d)
    else if (g.tube !== undefined) geo = new THREE.TorusGeometry(g.r, g.tube, 12, 40)
    else if (g.h !== undefined) {
      geo = g.cone
        ? new THREE.ConeGeometry(g.r, g.h, 18)
        : new THREE.CylinderGeometry(g.r, g.r, g.h, 20)
    } else if (g.r !== undefined) geo = new THREE.IcosahedronGeometry(g.r, 0)
    else geo = new THREE.SphereGeometry(0.2, 20, 14)

    // 平面着色要在**导出的几何体**上成立：
    // glTF 没有 flatShading 概念，靠去索引 + 重算法线把面法线固化下来
    geo = geo.toNonIndexed()
    geo.computeVertexNormals()

    const mesh = new THREE.Mesh(geo, getMat(part.color, part.emissive))
    mesh.position.set(part.pos[0], part.pos[1], part.pos[2])
    if (part.rot) mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2])
    if (part.scale) mesh.scale.set(part.scale[0], part.scale[1], part.scale[2])
    group.add(mesh)
  }

  // 归一化：按最长边缩放到目标尺寸，并把中心移到原点
  group.updateMatrixWorld(true)
  const box = new THREE.Box3().setFromObject(group)
  const size = new THREE.Vector3()
  const center = new THREE.Vector3()
  box.getSize(size)
  box.getCenter(center)
  const maxDim = Math.max(size.x, size.y, size.z)
  const factor = recipe.targetSize / maxDim
  group.scale.setScalar(factor)
  group.position.set(-center.x * factor, -center.y * factor, -center.z * factor)

  // 导出
  const exporter = new GLTFExporter()
  const glb = await exporter.parseAsync(group, { binary: true, onlyVisible: false })
  const bytes = new Uint8Array(glb)

  // 统计（给调用方写进数据层）
  let meshes = 0, tris = 0
  const mats = new Set()
  group.traverse((o) => {
    if (!o.isMesh) return
    meshes++
    tris += Math.round(o.geometry.attributes.position.count / 3)
    mats.add(o.material.uuid)
  })

  let binary = ''
  const chunk = 0x8000
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk))
  }
  return {
    glbBase64: btoa(binary),
    bytes: bytes.length,
    meshes,
    triangles: tris,
    materials: mats.size,
    dimensions: [size.x * factor, size.y * factor, size.z * factor],
  }
}
window.__ready = true
</script></body></html>`

const htmlPath = join(repoRoot, 'node_modules', '.cache', 'model-generator.html')
await mkdir(join(repoRoot, 'node_modules', '.cache'), { recursive: true })
await writeFile(htmlPath, pageHtml, 'utf8')

const chrome = spawn(
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  [
    '--headless=new',
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${join(repoRoot, 'node_modules', '.cache', 'chrome-generator')}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    '--window-size=800,600',
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
await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/node_modules/.cache/model-generator.html` }, sessionId)
await new Promise((r) => setTimeout(r, 2500))

const results = []
for (const recipe of MODEL_RECIPES) {
  const evaluated = await send('Runtime.evaluate', {
    expression: `window.buildModel(${JSON.stringify(recipe)})`,
    awaitPromise: true,
    returnByValue: true,
  }, sessionId)

  if (evaluated.exceptionDetails || !evaluated.result?.value) {
    console.error(`❌ ${recipe.name}: ${evaluated.exceptionDetails?.exception?.description ?? '未知错误'}`)
    results.push({ name: recipe.name, ok: false })
    continue
  }

  const out = evaluated.result.value
  const dir = join(repoRoot, 'public', 'assets', 'models', recipe.category)
  await mkdir(dir, { recursive: true })
  const glbPath = join(dir, `${recipe.file}.glb`)
  const buf = Buffer.from(out.glbBase64, 'base64')
  await writeFile(glbPath, buf)

  results.push({
    id: recipe.id,
    name: recipe.name,
    category: recipe.category,
    file: recipe.file,
    ok: true,
    bytes: buf.length,
    meshes: out.meshes,
    triangles: out.triangles,
    materials: out.materials,
    dimensions: out.dimensions.map((v) => Number(v.toFixed(3))),
  })
  console.log(
    `✓ ${recipe.name.padEnd(8)} ${recipe.file.padEnd(24)} ${String(buf.length).padStart(7)} B  ` +
      `网格 ${out.meshes} · 三角形 ${out.triangles.toLocaleString()} · 材质 ${out.materials} · ` +
      `尺寸 ${out.dimensions.map((v) => v.toFixed(2)).join('×')}`,
  )
}

console.log('\n生成完毕。接下来跑 npm run gen:thumbnails 从这些文件渲染缩略图。')

try { await send('Browser.close') } catch {}
try { chrome.kill() } catch {}
server.close()
await new Promise((r) => setTimeout(r, 400))

const failed = results.filter((r) => !r.ok)
process.exit(failed.length > 0 ? 1 : 0)
