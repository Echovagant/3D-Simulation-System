#!/usr/bin/env node
/**
 * 闸门：后端契约相关文件变了，docs/api-contract.md 必须同步变。
 *
 * 为什么还需要这一道：`check-api-contract` 比的是**内容**是否一致，
 * 只有当生成物真的过期时才会红；而 PR 里「改了路由/schema 但契约文档
 * 一个字没动」在内容校验前就应该给出更直白的提示。这道闸门看的是
 * **变更集合**：后端契约相关文件出现在 diff 里、契约文档却不在 → 直接红。
 *
 * 变更集合的来源（按优先级）：
 * 1. 工作区 + 暂存区（本地开发时最及时）
 * 2. `CONTRACT_BASE_REF` 环境变量（CI 显式指定的基线）
 * 3. `origin/HEAD` / `origin/main` / `origin/master` 与 HEAD 的三点 diff
 *
 * 退出码：0 不需要重生成或已同步；1 需要重生成但没做。
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** Windows 的 \ 统一成正斜杠，去掉 ./ 前缀 */
export const normalizePath = (value) => value.replace(/\\/g, '/').replace(/^\.\//, '')

/** 会影响 API 契约的源文件（路由、schema、应用装配） */
const CONTRACT_SOURCES = [
  /^backend\/app\/routers\/.+\.py$/,
  /^backend\/app\/schemas\.py$/,
  /^backend\/app\/main\.py$/,
]

export const isContractRelevant = (file) =>
  CONTRACT_SOURCES.some((pattern) => pattern.test(normalizePath(file)))

/**
 * 纯判定：返回 { required, backendChanged, docChanged }。
 * required = 有契约相关变更，但契约文档不在变更集合里。
 */
export const needsContractRegen = (changedFiles) => {
  const files = changedFiles.map(normalizePath)
  const backendChanged = files.filter(isContractRelevant)
  const docChanged = files.includes('docs/api-contract.md')
  return {
    required: backendChanged.length > 0 && !docChanged,
    backendChanged,
    docChanged,
  }
}

const git = (args) =>
  execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()

const gitList = (args) => {
  const text = git(args)
  return text ? text.split(/\r?\n/).filter(Boolean) : []
}

const resolveBaseRef = () => {
  if (process.env.CONTRACT_BASE_REF) return process.env.CONTRACT_BASE_REF
  try {
    const head = git(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'])
    if (head) return head.replace(/^refs\/remotes\//, '')
  } catch {
    /* 没有 origin/HEAD 时继续找常见主分支 */
  }
  for (const ref of ['origin/main', 'origin/master']) {
    try {
      git(['rev-parse', '--verify', '--quiet', ref])
      return ref
    } catch {
      /* 试下一个 */
    }
  }
  return null
}

/** 收集变更文件，并说明来源（给报错提示用） */
const collectChangedFiles = () => {
  const dirty = new Set([
    ...gitList(['diff', '--name-only']),
    ...gitList(['diff', '--name-only', '--cached']),
  ])
  if (dirty.size > 0) return { files: [...dirty], source: '工作区/暂存区' }

  const base = resolveBaseRef()
  if (!base) return { files: [], source: '无基线（跳过变更检查）' }
  try {
    return { files: gitList(['diff', '--name-only', `${base}...HEAD`]), source: `${base}...HEAD` }
  } catch {
    return { files: [], source: `基线不可用（${base}）` }
  }
}

const main = () => {
  const { files, source } = collectChangedFiles()
  const verdict = needsContractRegen(files)
  if (!verdict.required) {
    if (verdict.backendChanged.length > 0) {
      console.log(`OK 契约重生成检查：后端契约相关变更 ${verdict.backendChanged.length} 个，契约文档已同步`)
    } else {
      console.log(`OK 契约重生成检查：无后端契约相关变更（来源：${source}）`)
    }
    return
  }
  console.error('FAIL 后端契约相关文件变了，但 docs/api-contract.md 没跟着变')
  for (const file of verdict.backendChanged) console.error(`  - ${file}`)
  console.error('  修复：npm run gen:api-contract（然后一起提交）')
  process.exit(1)
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) main()
