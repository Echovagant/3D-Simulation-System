#!/usr/bin/env node
/**
 * README 自检：README 里写的每个数字、每张图、每个锚点都必须是真的。
 *
 * 用法：node scripts/check-readme.mjs
 * 退出码：发现不一致为 1，否则为 0
 *
 * 为什么要有这道闸门：
 * README 是这个仓库对外的第一印象，但它离代码最远——改了代码忘了改 README，
 * 文档就会开始说谎（而且没人会发现）。这个脚本把 README 里出现的关键数字
 * 拿回来跟真实产物对账，对不上就让构建失败。
 *
 * 需要 dist/ 存在（入口体积与产物体积从产物里量）。
 * 没有 dist/ 时会跳过依赖产物的两项，并明确说明——不是静默放过。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const readme = readFileSync(join(repoRoot, 'README.md'), 'utf8')
const problems = []
const notes = []
const skipped = []

// ---------- 1. 图片路径 ----------
const imgRefs = [
  ...[...readme.matchAll(/<img[^>]+src="([^"]+)"/g)].map((m) => m[1]),
  ...[...readme.matchAll(/!\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => m[2]),
]
const allImages = [...new Set(imgRefs)]
for (const ref of allImages) {
  if (/^https?:/.test(ref)) continue
  if (!existsSync(join(repoRoot, ref))) {
    problems.push(`图片不存在: ${ref}`)
  }
}

// ---------- 2. 页内锚点 ----------
const headings = [...readme.matchAll(/^#{1,6}\s+(.+)$/gm)].map((m) =>
  m[1].trim().replace(/[`*_]/g, '').toLowerCase().replace(/[\s/]+/g, '-'),
)
const anchors = [...readme.matchAll(/href="#([^"]+)"/g)].map((m) => m[1].toLowerCase())
for (const a of anchors) {
  if (!headings.includes(a)) problems.push(`锚点无对应标题: #${a}`)
}

// ---------- 3. 徽标格式 ----------
const badgeUrls = [
  ...[...readme.matchAll(/<img[^>]+src="(https:\/\/img\.shields\.io\/[^"]+)"/g)].map((m) => m[1]),
  ...[...readme.matchAll(/!\[[^\]]*\]\((https:\/\/img\.shields\.io\/[^)]+)\)/g)].map((m) => m[1]),
]
for (const url of badgeUrls) {
  if (!/^https:\/\/img\.shields\.io\/badge\/[^/]+-[^/]+-[0-9A-Fa-f]{6}(\?.*)?$/.test(url)) {
    problems.push(`徽标格式可疑: ${url}`)
  }
}

// ---------- 4. 数字对账 ----------
const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))

/** 递归列目录下的文件 */
const walk = (dir, filter) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p, filter))
    else if (filter(entry.name)) out.push(p)
  }
  return out
}

/** README 里写的数字是否与实际一致（group 指定取正则的第几个捕获组） */
const expect = (label, actual, pattern, { group = 1, hint = '' } = {}) => {
  const m = readme.match(pattern)
  if (!m) {
    problems.push(`README 里找不到「${label}」的数值${hint ? `（${hint}）` : ''}`)
    return
  }
  if (m[group] !== String(actual)) {
    problems.push(`「${label}」README 写 ${m[group]}，实际 ${actual}`)
  } else {
    notes.push(`${label} = ${actual} ✓`)
  }
}

/** 体积类允许小幅漂移（构建产物每次重建差几 KB 是常态），超出容差才算说谎 */
const expectWithin = (label, actual, pattern, tolerance, { group = 1 } = {}) => {
  const m = readme.match(pattern)
  if (!m) {
    problems.push(`README 里找不到「${label}」的数值`)
    return
  }
  const stated = Number(m[group])
  if (!Number.isFinite(stated)) {
    problems.push(`「${label}」README 写的 "${m[group]}" 不是数字`)
    return
  }
  const drift = Math.abs(stated - actual) / actual
  if (drift > tolerance) {
    problems.push(
      `「${label}」README 写 ${m[group]}，实际 ${actual}（偏差 ${(drift * 100).toFixed(1)}% 超过 ${(tolerance * 100).toFixed(0)}% 容差）`,
    )
  } else {
    notes.push(`${label} = ${actual} ✓（README 写 ${m[group]}，偏差 ${(drift * 100).toFixed(2)}%）`)
  }
}

// 运行时依赖
expect('运行时依赖数', Object.keys(pkg.dependencies).length, /运行时依赖 \| (\d+) 个/)

// 构建闸门数：数 build 链里**真正调用**的 verify:* 闸门。
// 不能数全部 verify:* 脚本——后端闸门（verify:backend）是 Python 侧的另一套，
// 不在 build 链里，算进来「11 道构建闸门」就不诚实了。
const buildChainGates = [
  ...new Set([...pkg.scripts.build.matchAll(/npm run (verify:[a-z0-9-]+)/g)].map((m) => m[1])),
].filter((s) => s !== 'verify:all')
const gateCount = buildChainGates.length
expect('构建闸门数（指标表）', gateCount, /<b>(\d+)<\/b><br><sub>构建闸门/)
expect('构建闸门数（正文）', gateCount, /用 \*\*(\d+) 道构建闸门\*\*/)

// 后端闸门数：清单是唯一真相源，README 的数字必须与它一致
const backendGateCount = JSON.parse(
  readFileSync(join(repoRoot, 'scripts', 'backend-gates.json'), 'utf8'),
).gates.length
expect('后端闸门数', backendGateCount, /<b>(\d+)<\/b><br><sub>后端闸门/)

// Rapier 版本（运行时依赖官方包；compat 只是测试环境的别名目标）
expect(
  'Rapier 版本',
  pkg.dependencies['@dimforge/rapier3d'].replace('^', ''),
  /Rapier3D（WASM） \| ([\d.]+)/,
)

// 死类名基线：直接读闸门脚本里的常量
const tailwindSource = readFileSync(join(repoRoot, 'scripts', 'check-tailwind-classes.mjs'), 'utf8')
const tailwindBaseline = tailwindSource.match(/MAX_DEAD_TAILWIND_CLASSES = (\d+)/)?.[1]
if (!tailwindBaseline) {
  problems.push('读不出 Tailwind 死类名基线（check-tailwind-classes.mjs 的常量没找到）')
} else {
  expect('死类名基线', tailwindBaseline, /死 Tailwind 类名不得超过 (\d+) 处/)
}

// 测试文件数：数文件系统
const testFiles = walk(join(repoRoot, 'src'), (n) => n.endsWith('.test.ts')).length
expect('测试文件数', testFiles, /(\d+) 个测试文件 \/ (\d+) 个用例/)

// 测试用例数：跑一次 vitest 的 json reporter 拿准数
let testCases = null
try {
  const reportPath = join(tmpdir(), 'readme-check-vitest.json')
  execFileSync(process.execPath, ['node_modules/vitest/vitest.mjs', 'run', '--reporter=json', `--outputFile=${reportPath}`], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 300000,
  })
  const report = JSON.parse(readFileSync(reportPath, 'utf8'))
  testCases = report.numTotalTests
} catch (err) {
  problems.push(`跑测试拿用例数失败: ${(err.stdout ?? '') + (err.stderr ?? '')}`.slice(0, 200))
}
if (testCases !== null) {
  expect('测试用例数', testCases, /(\d+) 个测试文件 \/ (\d+) 个用例/, { group: 2 })
  // 同一个数字在 README 里出现了两次（顶部指标表 + 闸门表），两处都要盯
  // 指标表那行是：<b>223</b><br><sub>测试用例 · 28 个文件</sub>
  expect('测试用例数（指标表）', testCases, />(\d+)<\/b><br><sub>测试用例 · (\d+) 个文件</, { group: 1 })
  expect('测试文件数（指标表）', testFiles, />(\d+)<\/b><br><sub>测试用例 · (\d+) 个文件</, { group: 2 })
}

// 可加载模型数：数 modelLibrary.ts 里 modelUrl 不是 '#' 的条目
const librarySource = readFileSync(join(repoRoot, 'src', 'data', 'modelLibrary.ts'), 'utf8')
const loadableModels = [...librarySource.matchAll(/modelUrl:\s*'([^']+)'/g)]
  .filter((m) => m[1] !== '#').length
expect('可加载模型数', loadableModels, /可加载模型 \| (\d+) 个/)

// 文档篇数
const docCount = walk(join(repoRoot, 'src', 'docs'), (n) => n.endsWith('.md')).length
expect('文档篇数', docCount, /(\d+) 篇正文/)

// 依赖 dist/ 的两项：入口体积与产物体积
const distDir = join(repoRoot, 'dist')
if (!existsSync(distDir)) {
  skipped.push('入口 chunk 体积、产物体积（没有 dist/，先跑 npm run build）')
} else {
  const assetsDir = join(distDir, 'assets')
  const entry = readdirSync(assetsDir).find((f) => /^index-.*\.js$/.test(f))
  if (!entry) {
    problems.push('dist/assets 下找不到入口 chunk')
  } else {
    const bytes = statSync(join(assetsDir, entry)).size
    expectWithin('入口 chunk（KB）', (bytes / 1024).toFixed(2), /\b(\d+\.\d+) KB\b/, 0.03)
  }
  const distBytes = walk(distDir, () => true).reduce((sum, p) => sum + statSync(p).size, 0)
  expectWithin('产物体积（MB）', (distBytes / 1024 / 1024).toFixed(2), /产物体积 \| ([\d.]+) MB/, 0.03)
}

// ---------- 输出 ----------
console.log('README 自检\n')
for (const n of notes) console.log('  ✓', n)
if (skipped.length) {
  console.log('')
  for (const s of skipped) console.log('  ⚠️  跳过：', s)
}
if (problems.length) {
  console.log('')
  for (const p of problems) console.log('  ❌', p)
  console.log(`\n${problems.length} 处问题`)
  process.exit(1)
}
console.log(
  `\n✅ 图片 ${allImages.length} 个全部存在，锚点 ${anchors.length} 个全部有效，徽标 ${badgeUrls.length} 个格式合法，数字与产物一致`,
)
process.exit(0)
