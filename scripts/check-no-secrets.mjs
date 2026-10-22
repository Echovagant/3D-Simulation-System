#!/usr/bin/env node
/**
 * 防回归检查：仓库里不允许出现任何看起来像"真密钥"的字符串。
 *
 * 背景：这个项目接了 LLM，API key 必须由使用者自己填、且**绝不进仓库**。
 * 一次误提交（粘进源码、贴进 README、留在调试日志里）就等于把 key 公开了，
 * 而 GitHub 上已推送的历史要改起来非常麻烦。所以要有这道闸门守着。
 *
 * 扫描范围：仓库内除 node_modules / dist / .git 之外的全部文本文件。
 * Python 后端（backend/）的源码同样在扫描范围内。
 * 豁免方式：某一行写上 `secret-scan: allow` 即可跳过（测试夹具用它）。
 *
 * 退出码：0 = 干净；1 = 发现疑似密钥。
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))

/** 不扫的目录 */
const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  '.git',
  '.idea',
  'coverage',
  '.vite',
  // Python 后端：虚拟环境与工具缓存里全是第三方源码，扫它们只会产出假阳性
  '.venv',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  'backend_data',
])
/** 不扫的文件（锁文件里有大量 base64 摘要，误报率太高） */
const SKIP_FILES = new Set(['package-lock.json', 'uv.lock'])

/**
 * `.env` 系列不扫。
 *
 * 它们被 gitignore 排除，本来就不在仓库里，而里面装的就是真 key——
 * 扫它只可能报出「真阳性」，把本地 `npm run build` 弄红，却不可能发现新的问题。
 * 仓库里的 Python 源码照常扫：那里粘错一个 key 才是真正要拦的事故。
 */
const isEnvFile = (name) => name === '.env' || name.startsWith('.env.')
/** 二进制/大文件不扫 */
const MAX_SIZE = 2 * 1024 * 1024

/** 逐行豁免标记 */
const ALLOW_MARKER = 'secret-scan: allow'

/**
 * 疑似密钥的特征。
 *
 * - `sk-...`：OpenAI 风格的前缀
 * - `eyJ...`：JWT 风格（MiniMax 的 key 就是这一类）
 * - `AIza...`：Google / Gemini 风格
 * - `MINIMAX_API_KEY=...` / `api_key: "..."`：赋值形式
 */
const PATTERNS = [
  { name: 'sk- 前缀', regex: /sk-[A-Za-z0-9_-]{16,}/g },
  { name: 'JWT 风格', regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  { name: 'AIza 前缀', regex: /AIza[0-9A-Za-z_-]{30,}/g },
  {
    name: 'API key 赋值',
    regex: /(?:MINIMAX_API_KEY|api[_-]?key|apiKey)\s*[:=]\s*["']?[A-Za-z0-9._-]{16,}/gi,
  },
]

/** 递归收集待扫描文件 */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...walk(join(dir, entry.name)))
      continue
    }
    if (SKIP_FILES.has(entry.name)) continue
    if (isEnvFile(entry.name)) continue
    const full = join(dir, entry.name)
    try {
      if (statSync(full).size > MAX_SIZE) continue
    } catch {
      continue
    }
    out.push(full)
  }
  return out
}

const problems = []
let walked = 0
let scanned = 0

for (const file of walk(repoRoot)) {
  // 闸门脚本自己会列出这些特征串，扫自己必然命中
  if (file === fileURLToPath(import.meta.url)) continue
  walked += 1

  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    continue
  }
  if (
    !text.includes('sk-') &&
    !text.includes('eyJ') &&
    !text.includes('AIza') &&
    !/api[_-]?key/i.test(text)
  ) {
    continue
  }
  scanned += 1

  const lines = text.split(/\r?\n/)
  lines.forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return
    for (const { name, regex } of PATTERNS) {
      regex.lastIndex = 0
      const match = regex.exec(line)
      if (!match) continue
      // 只回显前 6 个字符——闸门的输出也会进 CI 日志，不能把整把 key 抄进去
      const snippet = `${match[0].slice(0, 6)}…（长度 ${match[0].length}）`
      problems.push(
        `${relative(repoRoot, file)}:${index + 1} 疑似密钥（${name}）：${snippet}`,
      )
    }
  })
}

if (problems.length > 0) {
  for (const p of problems) console.error(`FAIL ${p}`)
  console.error(`\n${problems.length} 处疑似密钥。真实 key 请留在本机，不要提交。`)
  process.exit(1)
}

console.log(`OK 仓库内没有疑似密钥（遍历 ${walked} 个文件，其中 ${scanned} 个含疑似特征并逐行检查）`)
