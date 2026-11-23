#!/usr/bin/env node
/**
 * SDD ledger CLI。
 *
 * ledger.json 是 SDD 流程的**机器可读正本**（人读正本仍是各 plan 目录的 progress.md），
 * 放在 `.superpowers/sdd/`（gitignored——流程产物不入公开仓库）。
 *
 * 两条命令：
 * - `status`  打印任务/状态/提交号一览
 * - `check`   闸门：schema 校验 + 提交号对账（done 必须有真实存在的提交）
 *
 * 闸门口径：
 * - ledger 文件不存在 → **静默跳过**（CI / 未跑 SDD 流程的检出都应绿）
 * - schema 违规 / done 无提交 / 提交号在 git 里不存在 → 红（exit 1）
 * - updatedAt 落后于仓库最新提交 → 只警告不拦（计划作用域之外的新提交不算账）
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const LEDGER_PATH = join(process.cwd(), '.superpowers', 'sdd', 'ledger.json')
const STATUSES = new Set(['done', 'in-progress', 'open'])
const HASH_RE = /^[0-9a-f]{7,40}$/

/** schema 校验（纯函数，供测试与 check 共用）。返回 { ok, errors[] } */
export function validateLedger(ledger) {
  const errors = []
  if (!ledger || typeof ledger !== 'object') return { ok: false, errors: ['ledger 不是对象'] }
  if (ledger.version !== 1) errors.push(`version 必须是 1，收到 ${JSON.stringify(ledger.version)}`)
  if (typeof ledger.plan !== 'string' || !ledger.plan) errors.push('plan 缺失或非字符串')
  if (typeof ledger.updatedAt !== 'string' || Number.isNaN(Date.parse(ledger.updatedAt))) {
    errors.push('updatedAt 缺失或不是可解析时间')
  }
  if (!Array.isArray(ledger.tasks)) {
    errors.push('tasks 缺失或不是数组')
    return { ok: false, errors }
  }
  const seen = new Set()
  for (const task of ledger.tasks) {
    if (!task?.id || typeof task.id !== 'string') {
      errors.push(`任务缺 id：${JSON.stringify(task).slice(0, 60)}`)
      continue
    }
    if (seen.has(task.id)) errors.push(`任务 id 重复：${task.id}`)
    seen.add(task.id)
    if (typeof task.title !== 'string' || !task.title) errors.push(`${task.id}: title 缺失`)
    if (!STATUSES.has(task.status)) errors.push(`${task.id}: 非法状态 ${JSON.stringify(task.status)}`)
    if (!Array.isArray(task.commits)) errors.push(`${task.id}: commits 缺失或不是数组`)
    else {
      for (const c of task.commits) {
        if (typeof c !== 'string' || !HASH_RE.test(c)) errors.push(`${task.id}: 非法提交号 ${JSON.stringify(c)}`)
      }
      if (task.status === 'done' && task.commits.length === 0) {
        errors.push(`${task.id}: 状态 done 但没有任何提交号`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

/** git 对账：短哈希必须在仓库历史里真实存在。返回 { ok, errors[] }
 *  ⚠️ 不用 `<hash>^{commit}` 语法——cmd.exe 把 ^ 当转义符吃掉，npm 派发下必炸 */
export function reconcileCommits(tasks, runGit = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim()) {
  const errors = []
  for (const task of tasks) {
    for (const c of task.commits ?? []) {
      try {
        runGit(`git rev-parse --quiet --verify ${c}`)
      } catch {
        errors.push(`${task.id}: 提交 ${c} 在 git 历史中不存在`)
      }
    }
  }
  return { ok: errors.length === 0, errors }
}

function loadLedger() {
  if (!existsSync(LEDGER_PATH)) return null
  try {
    return JSON.parse(readFileSync(LEDGER_PATH, 'utf8'))
  } catch (error) {
    console.error(`ledger.json 解析失败：${error.message}`)
    process.exit(1)
  }
}

function cmdStatus() {
  const ledger = loadLedger()
  if (!ledger) {
    console.log('skip: 没有 ledger.json（未跑 SDD 流程的检出）')
    return
  }
  console.log(`plan: ${ledger.plan}  (updatedAt ${ledger.updatedAt})`)
  for (const t of ledger.tasks) {
    const mark = t.status === 'done' ? '✓' : t.status === 'in-progress' ? '…' : '·'
    console.log(` ${mark} ${t.id.padEnd(4)} ${t.status.padEnd(12)} ${(t.commits ?? []).join(',').padEnd(28)} ${t.title}`)
  }
  for (const d of ledger.decisions ?? []) console.log(` [裁决] ${d.id} (${d.date}): ${d.what}`)
}

function cmdCheck() {
  const ledger = loadLedger()
  if (!ledger) {
    console.log('skip: 没有 ledger.json（未跑 SDD 流程的检出）——verify:sdd 直接放行')
    process.exit(0)
  }
  const schema = validateLedger(ledger)
  if (!schema.ok) {
    console.error('✗ ledger schema 校验失败：')
    for (const e of schema.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const recon = reconcileCommits(ledger.tasks)
  if (!recon.ok) {
    console.error('✗ ledger 提交对账失败：')
    for (const e of recon.errors) console.error(`  - ${e}`)
    process.exit(1)
  }
  const doneCount = ledger.tasks.filter((t) => t.status === 'done').length
  console.log(`✓ ledger schema OK · ${doneCount}/${ledger.tasks.length} done · 提交号全部可解析`)
  // 软警告：ledger 落后于仓库最新提交（只提醒，不拦——计划作用域外的新提交不算账）
  try {
    const lastCommitTime = execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim()
    if (Date.parse(ledger.updatedAt) < Date.parse(lastCommitTime)) {
      console.log(`⚠ ledger updatedAt (${ledger.updatedAt}) 早于仓库最新提交时间——若计划作用域有新增工作，记得更新 ledger`)
    }
  } catch {
    /* git 不可用时不警告 */
  }
  process.exit(0)
}

const [, , cmd] = process.argv
// 只在作为 CLI 直接运行时分发；被测试 import 时（argv[1] 是别的入口）不动进程
import { pathToFileURL } from 'node:url'
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  if (cmd === 'status') cmdStatus()
  else if (cmd === 'check') cmdCheck()
  else {
    console.error('用法：node scripts/sdd.mjs <status|check>')
    process.exit(2)
  }
}
