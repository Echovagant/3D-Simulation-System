#!/usr/bin/env node
/**
 * 闸门：API 契约文档必须与代码一致。
 *
 * 做法：按当前代码重新渲染一份，与仓库里的 `docs/api-contract.md` 逐字节比对。
 * 不一致 = 有人改了后端但忘了重新生成文档。
 *
 * 比的是**工作区里的那份**：本地改了后端还没重新生成，这里就红；
 * CI 里工作区就是检出出来的提交，所以红的就是「提交进去的契约文档过期了」。
 *
 * 退出码：0 一致；1 不一致。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import { countEndpoints, renderContract } from './lib/render-contract.mjs'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const backendDir = join(repoRoot, 'backend')
const docPath = join(repoRoot, 'docs', 'api-contract.md')

try {
  execFileSync('uv', ['--version'], { stdio: 'ignore' })
} catch {
  console.error('FAIL 找不到 uv —— 契约校验跑不起来')
  console.error('安装：https://docs.astral.sh/uv/getting-started/installation/')
  console.error('装好后进 backend 目录跑一次：uv sync')
  process.exit(1)
}

const tmp = mkdtempSync(join(tmpdir(), 'api-contract-'))
const specPath = join(tmp, 'openapi.json')

try {
  execFileSync('uv', ['run', 'python', '-m', 'app.cli', 'export-openapi', specPath], {
    cwd: backendDir,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  const spec = JSON.parse(readFileSync(specPath, 'utf8'))
  const fresh = renderContract(spec)

  if (!existsSync(docPath)) {
    console.error('FAIL 契约文档不存在')
    console.error('  修复：npm run gen:api-contract')
    process.exit(1)
  }

  const committed = readFileSync(docPath, 'utf8')
  if (committed !== fresh) {
    console.error('FAIL 契约文档与代码不一致')
    console.error('  改了后端接口但没重新生成 docs/api-contract.md')
    console.error('  修复：npm run gen:api-contract')
    process.exit(1)
  }

  const endpointCount = countEndpoints(spec)
  console.log(`OK 契约文档与代码一致（${endpointCount} 个端点 · ${relative(repoRoot, docPath)}）`)
} catch (error) {
  console.error(`FAIL 契约校验失败：${error.message}`)
  const text = (error.stdout ?? '') + (error.stderr ?? '')
  if (text.trim()) console.error(text.slice(0, 2000))
  process.exit(1)
}
