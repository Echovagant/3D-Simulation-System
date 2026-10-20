/**
 * 防回归检查：src/ 下不允许存在「未被 git 跟踪」的 .js 文件。
 *
 * 背景：`npm run type-check` 实际执行的是 `vue-tsc --build`。在根 tsconfig.json
 * 缺少 "noEmit": true 时，它会把编译后的 .js 直接写回 src/ 源码旁边，而 Vite 的
 * 默认 resolve.extensions 顺序把 .js 排在 .ts 前面，导致无扩展名导入解析到编译
 * 产物而不是源文件。
 *
 * 判定口径：**磁盘上存在、且不在 `git ls-files --cached` 跟踪列表里**的 .js 文件
 * 即视为发射产物。注意这里刻意不使用 `--exclude-standard`：新增的 .gitignore 规则
 * 会把这类产物 ignore 掉，用 exclude-standard 会让本检查形同虚设。
 *
 * 零依赖，Node ESM。退出码：0 = 干净；1 = 发现产物。
 */
import { execFileSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const srcDir = path.join(repoRoot, 'src')

/** 递归收集 src/ 下所有 .js 文件的相对（posix 风格）路径 */
function collectJsFiles(dir, base = '') {
  const found = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = base ? `${base}/${entry.name}` : entry.name
    const abs = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      found.push(...collectJsFiles(abs, rel))
    } else if (entry.isFile() && entry.name.endsWith('.js')) {
      found.push(rel)
    }
  }
  return found
}

/** git 已跟踪的 src/ 下文件集合 */
function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z', '--cached', '--', 'src'], {
    cwd: repoRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  return new Set(out.split('\0').filter(Boolean))
}

let jsFiles
try {
  jsFiles = collectJsFiles(srcDir)
} catch (err) {
  console.error(`ERROR: 无法扫描 ${srcDir}：${err.message}`)
  process.exit(1)
}

const tracked = trackedFiles()
const artifacts = jsFiles.filter((rel) => !tracked.has(`src/${rel}`))

if (artifacts.length > 0) {
  console.error(`FAIL: src/ 下发现 ${artifacts.length} 个未被 git 跟踪的 .js 编译产物：`)
  for (const rel of artifacts.sort()) {
    console.error(`  src/${rel}`)
  }
  console.error('提示：根 tsconfig.json 需要 "noEmit": true；清理方式：删除上面列出的文件')
  process.exit(1)
}

console.log(`OK: no untracked .js artifacts in src/（已扫描 ${jsFiles.length} 个 .js 文件，全部已被 git 跟踪）`)
