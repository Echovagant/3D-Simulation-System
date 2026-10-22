#!/usr/bin/env node
/**
 * 生成 API 契约文档。
 *
 * ⚠️ `docs/api-contract.md` 是**生成物**，不要手改——
 * 手改的内容会在下一次 CI 校验时被覆盖掉。
 *
 * 用法：node scripts/gen-api-contract.mjs
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { countEndpoints, renderContract } from './lib/render-contract.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const backendDir = join(repoRoot, 'backend')
const outPath = join(repoRoot, 'docs', 'api-contract.md')
// 临时文件放系统临时目录，不往仓库里丢东西
const tmpSpec = join(tmpdir(), 'api-contract-openapi.json')

try {
  execFileSync('uv', ['run', 'python', '-m', 'app.cli', 'export-openapi', tmpSpec], {
    cwd: backendDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const spec = JSON.parse(readFileSync(tmpSpec, 'utf8'))
  const endpointCount = countEndpoints(spec)

  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, renderContract(spec), 'utf8')
  console.log(`OK 契约文档已生成：${relative(repoRoot, outPath)}（${endpointCount} 个端点）`)
} catch (error) {
  const text = (error.stdout ?? '') + (error.stderr ?? '')
  console.error(`FAIL 生成契约文档失败：${error.message}`)
  if (text.trim()) console.error(text.slice(0, 2000))
  if (!existsSync(tmpSpec)) {
    console.error('提示：契约生成需要 uv 与后端依赖（cd backend && uv sync）')
  }
  process.exit(1)
}
