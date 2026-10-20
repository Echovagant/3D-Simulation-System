#!/usr/bin/env node
/**
 * 文档回归检查：防止 `src/docs/` 下再次出现 0 字节的空文档
 *
 * 用法：node scripts/check-docs.mjs
 * 退出码：发现空文档为 1，否则为 0
 *
 * 注意：本脚本只能检查“文档文件是否存在且非空”。
 * 新增文档如果忘了在 `DocsSidebar.vue` 加侧边栏链接、或忘了在
 * `Docs.vue` 的 titles 表里加标题，那篇文档仍然不可达——
 * 那是产品流程问题，需要人工核对，脚本查不出来。
 */
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const docsRoot = join(repoRoot, 'src', 'docs')

/** 递归收集目录下所有 .md 文件 */
const collectMarkdown = async (dir) => {
  const out = []
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch (err) {
    console.error(`无法读取目录 ${dir}: ${err.message}`)
    process.exit(1)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...(await collectMarkdown(full)))
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(full)
    }
  }
  return out
}

const files = (await collectMarkdown(docsRoot)).sort()

if (files.length === 0) {
  console.error(`✗ ${relative(repoRoot, docsRoot)} 下没有找到任何 .md 文档`)
  process.exit(1)
}

const empty = []
let totalBytes = 0
const rows = []

for (const file of files) {
  const info = await stat(file)
  const content = await readFile(file, 'utf8')
  const rel = relative(repoRoot, file).split(sep).join('/')
  totalBytes += info.size
  rows.push({ rel, bytes: info.size, chars: content.length })
  if (info.size === 0 || content.trim() === '') {
    empty.push(rel)
  }
}

console.log(`文档目录: ${relative(repoRoot, docsRoot)}`)
console.log(`文件数: ${rows.length}，总字节数: ${totalBytes}\n`)

for (const row of rows) {
  const flag = row.bytes === 0 ? '  ✗ 空文档' : ''
  console.log(`  ${row.rel.padEnd(42)} ${String(row.bytes).padStart(7)} bytes${flag}`)
}

if (empty.length > 0) {
  console.error(`\n✗ 发现 ${empty.length} 个空文档：`)
  for (const rel of empty) console.error(`  - ${rel}`)
  process.exit(1)
}

console.log(`\n✓ 没有空文档（${rows.length} 个文件，共 ${totalBytes} 字节）`)
process.exit(0)
