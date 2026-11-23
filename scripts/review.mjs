#!/usr/bin/env node
/**
 * 评审状态机：Approved 绑定一个提交，HEAD 前进后提醒重审。
 *
 * 用法：
 *   node scripts/review.mjs approve [--commit <hash>] [--note "说明"]
 *   node scripts/review.mjs status
 *   node scripts/review.mjs check [--strict]
 *
 * 状态文件：`.superpowers/sdd/review.json`（gitignored 的流程产物，不入库）。
 *
 * 口径：
 * - 没有 review.json → 跳过（未走评审流程的检出不该被拦）
 * - approvedCommit === HEAD → 当前
 * - HEAD 前进 → 警告；`--strict` / `REVIEW_STRICT=1` 时才退出 1
 * - 历史被改写（approved 不是 HEAD 祖先）→ 提示无法比较，按需要重审
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const reviewPath = join(repoRoot, '.superpowers', 'sdd', 'review.json')
const COMMIT_RE = /^[0-9a-f]{7,40}$/

/** 纯判定：评审记录与 HEAD 的关系 */
export const evaluateReview = (review, head) => {
  if (!review) return { status: 'missing' }
  if (review.approvedCommit === head) return { status: 'current' }
  return { status: 'stale' }
}

/** schema 校验；返回错误列表（空 = 合法） */
export const validateReview = (review) => {
  const errors = []
  if (!review || typeof review !== 'object') return ['review 不是对象']
  if (review.version !== 1) errors.push('version 必须是 1')
  if (typeof review.approvedCommit !== 'string' || !COMMIT_RE.test(review.approvedCommit)) {
    errors.push('approvedCommit 不是合法提交号')
  }
  if (typeof review.approvedAt !== 'string' || Number.isNaN(Date.parse(review.approvedAt))) {
    errors.push('approvedAt 缺失或不是可解析时间')
  }
  if (typeof review.branch !== 'string' || !review.branch) errors.push('branch 缺失')
  return errors
}

const git = (args) =>
  execFileSync('git', args, {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

const currentHead = () => git(['rev-parse', 'HEAD'])

const loadReview = () => {
  if (!existsSync(reviewPath)) return null
  try {
    return JSON.parse(readFileSync(reviewPath, 'utf8'))
  } catch (error) {
    console.error(`✗ review.json 解析失败：${error.message}`)
    process.exit(1)
  }
}

const parseArgs = (argv) => {
  const args = { strict: process.env.REVIEW_STRICT === '1' }
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--strict') args.strict = true
    else if (argv[i] === '--commit') args.commit = argv[i + 1]
    else if (argv[i] === '--note') args.note = argv[i + 1]
  }
  return args
}

const short = (hash) => hash.slice(0, 7)

const cmdApprove = (args) => {
  const requested = args.commit ?? 'HEAD'
  let full
  try {
    full = git(['rev-parse', '--verify', requested])
  } catch {
    console.error(`✗ 提交不存在：${requested}`)
    process.exit(1)
  }
  const review = {
    version: 1,
    approvedCommit: full,
    approvedAt: new Date().toISOString(),
    branch: git(['rev-parse', '--abbrev-ref', 'HEAD']),
    ...(args.note ? { note: args.note } : {}),
  }
  mkdirSync(dirname(reviewPath), { recursive: true })
  writeFileSync(reviewPath, `${JSON.stringify(review, null, 2)}\n`, 'utf8')
  console.log(`✓ 已记录评审：${short(full)}（${review.branch}）`)
}

/** 输出状态并返回退出码（0 / 1） */
const report = (strict) => {
  const review = loadReview()
  const head = currentHead()
  const verdict = evaluateReview(review, head)

  if (verdict.status === 'missing') {
    console.log('skip: 没有 review.json（未走评审流程的检出）')
    return 0
  }
  const errors = validateReview(review)
  if (errors.length > 0) {
    console.error('✗ review.json schema 校验失败：')
    for (const error of errors) console.error(`  - ${error}`)
    return 1
  }
  if (verdict.status === 'current') {
    console.log(`✓ Approved 与 HEAD 一致（${short(head)}）`)
    return 0
  }

  let ahead = null
  try {
    ahead = Number(git(['rev-list', '--count', `${review.approvedCommit}..HEAD`]))
  } catch {
    ahead = null
  }
  if (ahead === null) {
    console.log(`⚠ 评审提交 ${short(review.approvedCommit)} 与当前分支无法比较（历史可能被改写），建议重审`)
    return strict ? 1 : 0
  }
  if (ahead === 0) {
    console.log(`✓ Approved 已覆盖 HEAD（${short(head)}）`)
    return 0
  }
  console.log(`⚠ Approved 之后 HEAD 前进了 ${ahead} 笔，请重审：`)
  try {
    for (const line of git(['log', '--oneline', '--max-count=8', `${review.approvedCommit}..HEAD`]).split(
      /\r?\n/,
    )) {
      if (line) console.log(`  ${line}`)
    }
  } catch {
    /* 列表失败不影响结论 */
  }
  return strict ? 1 : 0
}

const [, , cmd, ...rest] = process.argv
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href
if (isMain) {
  const args = parseArgs(rest)
  if (cmd === 'approve') cmdApprove(args)
  else if (cmd === 'status') process.exit(report(false))
  else if (cmd === 'check') process.exit(report(args.strict))
  else {
    console.error('用法：node scripts/review.mjs <approve|status|check> [--strict] [--commit <hash>] [--note 文本]')
    process.exit(2)
  }
}
