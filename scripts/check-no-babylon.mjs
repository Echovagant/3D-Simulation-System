/**
 * 防回归检查：项目里不允许再出现 Babylon 的任何痕迹。
 *
 * 背景：原全屏背景是 Babylon 引擎画的深蓝全息赛博朋克，单独构成一个
 * 7.13 MB 的懒加载分块，**每条路由首屏都要下载**。现在背景换成了零依赖的
 * Canvas 2D 浅色靛紫网络，引擎已经没有存在理由。
 *
 * 没有这道闸栏的话，一次 `npm i @babylonjs/core` 就能把 7 MB 的首屏开销
 * 悄悄加回来，而且没人会注意到。
 *
 * 扫描范围：src/ 下的源码文件 + package.json。关键词大小写不敏感。
 *
 * 零依赖，Node ESM。退出码：0 = 干净；1 = 发现残留。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(repoRoot, 'src')
const pkgPath = join(repoRoot, 'package.json')

const KEYWORD = 'babylon'

/** 递归收集 src/ 下的源码文件 */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|vue|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

/** 返回命中关键词的行号（1 起） */
function hitLines(text) {
  const lines = []
  text.split(/\r?\n/).forEach((line, index) => {
    if (line.toLowerCase().includes(KEYWORD)) lines.push(index + 1)
  })
  return lines
}

const failures = []

let files
try {
  files = walk(srcDir)
} catch (err) {
  console.error(`ERROR: 无法扫描 ${srcDir}：${err.message}`)
  process.exit(1)
}

for (const file of files) {
  const lines = hitLines(readFileSync(file, 'utf8'))
  if (lines.length > 0) {
    failures.push(`src 仍提到 ${KEYWORD}：${relative(repoRoot, file)}（行 ${lines.join(', ')}）`)
  }
}

const pkgText = readFileSync(pkgPath, 'utf8')

// 依赖清单必须逐字干净：任何 babylon 依赖都不允许再出现
const pkg = JSON.parse(pkgText)
const declared = {
  ...pkg.dependencies,
  ...pkg.devDependencies,
  ...pkg.optionalDependencies,
  ...pkg.peerDependencies,
}
for (const name of Object.keys(declared)) {
  if (name.toLowerCase().includes(KEYWORD)) {
    failures.push(`package.json 仍声明了依赖 ${name}`)
  }
}

// 其余位置也不允许提到 babylon。
// 例外只有护栏自己的接线（npm 脚本名 + 脚本文件路径）——把它们摘掉再扫。
const pkgLines = hitLines(
  pkgText.replace(/verify:no-babylon|check-no-babylon\.mjs/g, ''),
)
if (pkgLines.length > 0) {
  failures.push(`package.json 仍提到 ${KEYWORD}（行 ${pkgLines.join(', ')}）`)
}

if (failures.length > 0) {
  console.error('FAIL 发现 Babylon 残留：')
  for (const f of failures) console.error(`  ${f}`)
  console.error('提示：背景已改为零依赖的 Canvas 2D 实现，不要再引入 @babylonjs/core')
  process.exit(1)
}

console.log(`OK 未发现 ${KEYWORD} 残留（已扫描 ${files.length} 个 src 源文件与 package.json）`)
