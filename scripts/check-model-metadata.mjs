#!/usr/bin/env node
/**
 * 模型元数据回归检查：内置模型的文件属性必须与磁盘上的 GLB 一致。
 *
 * 用法：node scripts/check-model-metadata.mjs
 * 退出码：发现不一致为 1，否则为 0
 *
 * 为什么要有这道闸门：
 * 模型库展示给用户的「文件大小 / 多边形数量 / 材质数量 / 是否包含动画」，
 * 如果和文件里的实际内容对不上，界面就是在展示假数据。
 * 这道脚本在构建时重新解析一遍 public/ 下的 GLB，逐项比对——
 * 改了文件忘了改这里，或者反过来，都会让构建失败。
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const libraryPath = join(repoRoot, 'src', 'data', 'modelLibrary.ts')
const publicRoot = join(repoRoot, 'public')

/** 读取 GLB 的 JSON chunk，提取实际的文件属性 */
const readGlb = (absPath) => {
  const buf = readFileSync(absPath)
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) {
    throw new Error('不是合法的 GLB 文件（magic 不匹配）')
  }
  let offset = 12
  while (offset + 8 <= buf.length) {
    const chunkLength = buf.readUInt32LE(offset)
    const chunkType = buf.toString('ascii', offset + 4, offset + 8)
    if (chunkType === 'JSON') {
      const json = JSON.parse(buf.toString('utf8', offset + 8, offset + 8 + chunkLength))
      let vertices = 0
      let indices = 0
      const materials = new Set()
      for (const mesh of json.meshes ?? []) {
        for (const primitive of mesh.primitives ?? []) {
          const position = json.accessors?.[primitive.attributes?.POSITION]
          if (position) vertices += position.count
          const index = json.accessors?.[primitive.indices]
          if (index) indices += index.count
          if (primitive.material !== undefined) materials.add(primitive.material)
        }
      }
      return {
        bytes: buf.length,
        triangles: Math.round((indices || vertices) / 3),
        materials: materials.size,
        animations: (json.animations ?? []).length,
      }
    }
    offset += 8 + chunkLength
  }
  throw new Error('GLB 里找不到 JSON chunk')
}

/**
 * 从 modelLibrary.ts 里切出模型条目。
 *
 * 条目是 2 空格缩进的 `{ id: 'xxx', ... }` 对象，字段 4 空格缩进，
 * 因此用「行首 4 空格 + id:」和「行首 2 空格 + }」作为边界最稳。
 */
const parseEntries = (source) => {
  const entries = []
  const blockRe = /\{\n    id: '([^']+)',([\s\S]*?)\n  \}/g
  let match
  while ((match = blockRe.exec(source)) !== null) {
    const [, id, body] = match
    const field = (key) => {
      const found = body.match(new RegExp(`${key}:\\s*'([^']*)'`))
      return found ? found[1] : undefined
    }
    const numField = (key) => {
      const found = body.match(new RegExp(`${key}:\\s*([0-9_]+)`))
      return found ? Number(found[1].replace(/_/g, '')) : undefined
    }
    const boolField = (key) => {
      const found = body.match(new RegExp(`${key}:\\s*(true|false)`))
      return found ? found[1] === 'true' : undefined
    }
    entries.push({
      id,
      name: field('name'),
      modelUrl: field('modelUrl'),
      format: field('format'),
      size: numField('size'),
      polyCount: numField('polyCount'),
      materialCount: numField('materialCount'),
      hasAnimation: boolField('hasAnimation'),
    })
  }
  return entries
}

const source = readFileSync(libraryPath, 'utf8')
const entries = parseEntries(source)

if (entries.length === 0) {
  console.error('❌ 没有从 modelLibrary.ts 里解析出任何模型条目——解析逻辑可能失效了')
  process.exit(1)
}

const problems = []
const rows = []

for (const entry of entries) {
  const isPlaceholder = entry.modelUrl === '#'

  if (isPlaceholder) {
    // 占位条目没有文件，不该报告任何文件属性
    if (entry.size !== 0) problems.push(`${entry.id} ${entry.name}：占位条目的 size 必须是 0，实际 ${entry.size}`)
    if (entry.polyCount !== 0) problems.push(`${entry.id} ${entry.name}：占位条目的 polyCount 必须是 0，实际 ${entry.polyCount}`)
    if (entry.materialCount !== 0) problems.push(`${entry.id} ${entry.name}：占位条目的 materialCount 必须是 0，实际 ${entry.materialCount}`)
    if (entry.hasAnimation !== false) problems.push(`${entry.id} ${entry.name}：占位条目的 hasAnimation 必须是 false`)
    if (entry.format !== '') problems.push(`${entry.id} ${entry.name}：占位条目的 format 应为空字符串，实际 "${entry.format}"`)
    rows.push({ name: entry.name, kind: '占位', detail: '不报告文件属性' })
    continue
  }

  const absPath = join(publicRoot, entry.modelUrl.replace(/^\//, ''))
  if (!existsSync(absPath)) {
    problems.push(`${entry.id} ${entry.name}：modelUrl 指向的文件不存在 -> ${entry.modelUrl}`)
    rows.push({ name: entry.name, kind: '缺文件', detail: entry.modelUrl })
    continue
  }

  const real = readGlb(absPath)
  const declaredSize = entry.size
  const declaredTris = entry.polyCount
  const declaredMats = entry.materialCount
  const declaredAnim = entry.hasAnimation

  if (declaredSize !== real.bytes) {
    problems.push(`${entry.id} ${entry.name}：文件大小声明 ${declaredSize}，实际 ${real.bytes}`)
  }
  if (declaredTris !== real.triangles) {
    problems.push(`${entry.id} ${entry.name}：多边形数声明 ${declaredTris}，实际 ${real.triangles}`)
  }
  if (declaredMats !== real.materials) {
    problems.push(`${entry.id} ${entry.name}：材质数声明 ${declaredMats}，实际 ${real.materials}`)
  }
  if (declaredAnim !== real.animations > 0) {
    problems.push(`${entry.id} ${entry.name}：hasAnimation 声明 ${declaredAnim}，实际动画数 ${real.animations}`)
  }
  if (entry.format !== 'GLB') {
    problems.push(`${entry.id} ${entry.name}：文件扩展名是 .glb，format 应为 GLB，实际 "${entry.format}"`)
  }

  rows.push({
    name: entry.name,
    kind: '真实文件',
    detail: `${real.bytes} B · ${real.triangles} 面 · ${real.materials} 材质 · ${real.animations} 动画`,
  })
}

console.log('内置模型元数据核对（数据源：public/ 下 GLB 实测）\n')
for (const row of rows) {
  console.log(`  ${row.name.padEnd(10)} ${row.kind.padEnd(8)} ${row.detail}`)
}
console.log(`\n条目总数 ${rows.length}（真实文件 ${rows.filter((r) => r.kind === '真实文件').length}，占位 ${rows.filter((r) => r.kind === '占位').length}）`)

if (problems.length > 0) {
  console.error(`\n❌ 发现 ${problems.length} 处与实际文件不一致：`)
  for (const problem of problems) console.error(`  - ${problem}`)
  process.exit(1)
}

console.log('\n✅ 模型元数据与磁盘上的文件完全一致')
process.exit(0)
