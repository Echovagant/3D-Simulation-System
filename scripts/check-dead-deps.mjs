/**
 * 防回归检查：计划 015 删除的 18 个零引用依赖不允许重新出现在 src/ 或 package.json 里。
 *
 * 背景：这些包在 `src/**` 里 0 次 import（tree-shaking 早就把它们排除出产物），
 * 留着它们只会拖慢安装、撑大 lockfile、给 `npm audit` 添噪音。没有护栏的话，
 * 半年后一次 `npm i echarts` 就会把清理成果全部抹掉。
 *
 * 同时守住幽灵依赖：`@fortawesome/fontawesome-svg-core` 被 `src/main.ts` import，
 * 却只靠 npm 提升侥幸解析到顶层，必须在 package.json 里显式声明。
 *
 * 零依赖，Node ESM。退出码：0 = 未回归；1 = 发现回归。
 */
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const DEAD = [
  '@babylonjs/gui',
  '@babylonjs/loaders',
  '@babylonjs/post-processes',
  '@babylonjs/inspector',
  'vue-threejs',
  'three-orbit-controls',
  'cannon',
  'cannon-es',
  'ammo.js',
  'gsap',
  '@tweenjs/tween.js',
  '@iconify/vue',
  'lodash',
  'lodash-es',
  'echarts',
  '@tsparticles/all',
  'tsparticles-engine',
  'tsparticles-plugin-emitters',
  // 计划 016 删除 ParticlesBackground.vue 之后，这三个也变成了零引用依赖
  '@tsparticles/vue3',
  'tsparticles',
]

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const srcDir = join(repoRoot, 'src')

/** 递归收集 src/ 下的源码文件 */
function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (/\.(ts|tsx|vue|js|jsx|mjs|cjs)$/.test(entry.name)) out.push(full)
  }
  return out
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const failures = []

for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8')
  for (const pkg of DEAD) {
    const re = new RegExp(
      `(from|import|require)\\s*\\(?\\s*['"]${escapeRe(pkg)}['"]`,
    )
    if (re.test(text)) failures.push(`src 重新引用了 ${pkg}：${relative(repoRoot, file)}`)
  }
}

const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
const declared = { ...pkg.dependencies, ...pkg.devDependencies }
for (const name of DEAD) {
  if (name in declared) failures.push(`package.json 重新声明了 ${name}`)
}
if (!('@fortawesome/fontawesome-svg-core' in (pkg.dependencies ?? {}))) {
  failures.push('package.json 缺少 @fortawesome/fontawesome-svg-core 的显式声明')
}

if (failures.length > 0) {
  for (const f of failures) console.error(`FAIL ${f}`)
  process.exit(1)
}

console.log(`OK ${DEAD.length} 个零引用依赖未回归`)
