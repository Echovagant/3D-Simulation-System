#!/usr/bin/env node
/**
 * 闸门：Python 侧的质量检查。
 *
 * 跑清单里的每一项（ruff 静态检查、ruff 格式检查、mypy 类型检查、pytest）。
 * 任何一项失败都让构建失败。
 *
 * 清单在 `scripts/backend-gates.json`——那是唯一真相源，
 * README 校验也读它，两边不会漂移。
 *
 * 用法：node scripts/check-python-gates.mjs
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const backendDir = join(repoRoot, 'backend')
const { gates } = JSON.parse(readFileSync(join(repoRoot, 'scripts', 'backend-gates.json'), 'utf8'))

// 没装 uv 就把话说明白，别让人对着一句 ENOENT 发呆
try {
  execFileSync('uv', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('FAIL 找不到 uv —— Python 侧闸门跑不起来')
  console.error('安装：https://docs.astral.sh/uv/getting-started/installation/')
  console.error('装好后进 backend 目录跑一次：uv sync')
  process.exit(1)
}

for (const gate of gates) {
  console.log(`\n--- ${gate.name} ---`)
  try {
    const out = execFileSync('uv', gate.args, {
      cwd: backendDir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PYTHONUTF8: '1' },
    })
    if (out.trim()) console.log(out.trim())
  } catch (error) {
    console.error(`FAIL ${gate.name}`)
    const out = error.stdout ?? ''
    const err = error.stderr ?? ''
    // ⚠️ **输出不许截断**：排障时最关键的那几行常常在最后，
    // 截掉前面 4000 字符会让 CI 上看不出到底哪一项、哪一行出的问题。
    // 失败时 stdout 与 stderr 都要打全。
    if (out.trim()) console.error(out.trim())
    if (err.trim()) console.error(err.trim())
    if (!out.trim() && !err.trim()) console.error(String(error.message ?? error))
    process.exit(1)
  }
}

console.log(`\nOK Python 侧闸门全过（${gates.length} 项：${gates.map((g) => g.name).join(' / ')}）`)
