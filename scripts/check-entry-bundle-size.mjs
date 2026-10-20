#!/usr/bin/env node
/**
 * 防回归检查：构建产物的入口 chunk（dist/assets/index-*.js）不得超过体积上限。
 *
 * 背景：计划 012 把首屏入口从 7 505.71 kB 拆到了 267.86 kB。这个体积没有任何
 * 运行时断言在守——一旦某个依赖被重新打进入口 chunk，回归不会被任何测试发现，
 * 而用户要等到首屏变慢才察觉。所以把体积上限固化成一条可执行的检查。
 *
 * 用法：node scripts/check-entry-bundle-size.mjs
 * 环境变量：MAX_ENTRY_KB 覆盖默认上限 1536（1.5 MB）
 *
 * 退出码：0 = 通过；1 = 入口 chunk 超限，或构建产物不存在/缺少入口 chunk。
 *
 * 注意：产物缺失**不算通过**——那意味着这条检查根本没被真正执行，
 * 静默放行等于没有守卫。因此缺产物时直接判失败。
 *
 * 注意：本脚本只看入口 chunk。分块后的异步 chunk（rapier 等）不计入上限，
 * 因为它们不阻塞首屏渲染。
 */
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const assetsDir = join(repoRoot, 'dist', 'assets')
const assetsRel = relative(repoRoot, assetsDir).split(sep).join('/')

/** 默认上限 1.5 MB（按 1024 字节计），可用 MAX_ENTRY_KB 覆盖 */
const DEFAULT_MAX_KB = 1536
const parsedMaxKb = Number.parseInt(process.env.MAX_ENTRY_KB ?? '', 10)
const maxKb = Number.isFinite(parsedMaxKb) && parsedMaxKb > 0 ? parsedMaxKb : DEFAULT_MAX_KB
const maxBytes = maxKb * 1024

/**
 * 在 dist/assets/ 里找入口 chunk（index-<hash>.js）
 * @returns {Promise<{chunks: {name: string, size: number}[], reason: string}>}
 */
async function collectEntryChunks() {
  let entries
  try {
    entries = await readdir(assetsDir, { withFileTypes: true })
  } catch (err) {
    return { chunks: [], reason: `无法读取 ${assetsRel}（${err.code ?? err.message}）` }
  }

  const chunks = []
  for (const entry of entries) {
    if (!entry.isFile()) continue
    if (!/^index-.*\.js$/.test(entry.name)) continue
    const info = await stat(join(assetsDir, entry.name))
    chunks.push({ name: entry.name, size: info.size })
  }
  // 体积最大的候选按最严格的口径检查
  chunks.sort((a, b) => b.size - a.size)
  return { chunks, reason: `${assetsRel} 下没有 index-*.js 入口 chunk` }
}

const { chunks, reason } = await collectEntryChunks()

if (chunks.length === 0) {
  console.error(`FAIL: ${reason}`)
  console.error('构建产物不存在，请先运行 `npm run build-only`')
  process.exit(1)
}

const entry = chunks[0]
const entryRel = relative(repoRoot, join(assetsDir, entry.name)).split(sep).join('/')
const sizeKb = entry.size / 1024

console.log(`入口 chunk: ${entryRel}`)
console.log(`实际体积: ${entry.size} 字节（${sizeKb.toFixed(2)} KB）`)
console.log(`体积上限: ${maxKb} KB（${maxBytes} 字节）`)
if (chunks.length > 1) {
  console.log(`其余候选: ${chunks.slice(1).map((c) => `${c.name} (${c.size} 字节)`).join('、')}`)
}

if (entry.size > maxBytes) {
  console.error(`FAIL: 入口 chunk ${sizeKb.toFixed(2)} KB 超过上限 ${maxKb} KB`)
  process.exit(1)
}

console.log(`OK: 入口 chunk ${sizeKb.toFixed(2)} KB 未超过上限 ${maxKb} KB`)
process.exit(0)
