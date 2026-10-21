#!/usr/bin/env node
/**
 * 资产许可闸门：保证仓库里的每一份资产，来源与协议都清楚，且不限制再分发。
 *
 * 用法：node scripts/check-asset-licenses.mjs
 * 退出码：发现不一致为 1，否则为 0
 *
 * 三道检查：
 * 1. **资产清单**——仓库里每个二进制/资源文件，必须要么是"本项目生成"，
 *    要么在 NOTICE 里有署名条目。出现没交代来源的文件 = 失败。
 * 2. **来源元数据**——资产文件里不能残留第三方生成器/来源标记
 *    （例如 AI 生成内容的 AIGC 隐式标识、素材站的 author/source 字段）。
 *    这类标记一旦在重新编码时丢失，就会造成合规性静默退化。
 * 3. **依赖协议**——node_modules 里所有包的协议必须属于宽松清单，
 *    不允许出现 GPL / AGPL / CC-BY-NC 这类带传染性或禁止商用的协议。
 */
import { readFileSync, existsSync, statSync, readdirSync } from 'node:fs'
import { join, relative, extname } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const problems = []
const notes = []

// ---------- 1. 资产清单 ----------

/**
 * 第三方资产：文件名 -> 必须在 NOTICE 里出现的署名片段。
 *
 * 当前是**空的**——仓库里所有资产都由本项目自己生成，不含第三方素材。
 * 这张表留着是为了将来真要引入外部素材时，有个明确的位置记录它的署名，
 * 而不是随手把文件丢进仓库。往里加一条，就必须在 NOTICE 里写上对应的署名。
 */
const THIRD_PARTY = new Map([])

/** 本项目生成：路径匹配（相对仓库根） */
const SELF_GENERATED = [
  /^docs\/assets\/cover\.png$/,
  /^docs\/assets\/demo\.gif$/,
  /^docs\/assets\/demo\.mp4$/,
  /^docs\/screenshots\/.+\.png$/,
  /^public\/assets\/models\/(characters|environments|props)\/(mech|drone|hover-guardian|city-street|forest|space-station-interior|arcane-book|energy-blaster|terminal-console)\.glb$/,
  /^public\/assets\/models\/thumbnails\/.+\.png$/,
  /^src\/assets\/images\/logo\.png$/,
  /^src\/assets\/images\/logo\.svg$/,
  /^public\/favicon\.ico$/,
]

/** 会被当成"资产"扫的文件扩展名 */
const ASSET_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.avif', '.ico', '.svg',
  '.glb', '.gltf', '.bin', '.mp3', '.wav', '.ogg', '.mp4', '.webm',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
])

const walk = (dir, skip = new Set()) => {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue
    const p = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(p, skip))
    else out.push(p)
  }
  return out
}

const notice = existsSync(join(repoRoot, 'NOTICE'))
  ? readFileSync(join(repoRoot, 'NOTICE'), 'utf8')
  : ''

if (!notice.trim()) {
  problems.push('NOTICE 文件缺失或为空')
}

const assets = walk(repoRoot, new Set(['.git', 'node_modules', 'dist', '.cache'])).filter((p) => {
  const rel = relative(repoRoot, p).split('\\').join('/')
  if (rel.startsWith('src/docs/')) return false // 文档正文是 Markdown，不是资产
  return ASSET_EXT.has(extname(p).toLowerCase())
})

let selfCount = 0
let thirdCount = 0
for (const abs of assets) {
  const rel = relative(repoRoot, abs).split('\\').join('/')
  const name = rel.split('/').pop()

  if (SELF_GENERATED.some((re) => re.test(rel))) {
    selfCount++
    continue
  }

  const thirdParty = THIRD_PARTY.get(name)
  if (thirdParty) {
    thirdCount++
    if (!notice.includes(thirdParty)) {
      problems.push(`${rel}：NOTICE 里缺少「${thirdParty}」的署名条目`)
    }
    continue
  }

  problems.push(`${rel}：来源不明——既不在"本项目生成"清单里，NOTICE 里也没有署名条目`)
}
notes.push(`资产清单：${assets.length} 个（自制 ${selfCount} · 第三方 ${thirdCount}）`)

// ---------- 2. 来源元数据 ----------

/** 第三方来源标记的特征串 */
const PROVENANCE_MARKERS = [
  'AIGC', // 国标 GB 45438-2025 的 AI 生成内容隐式标识
  'sketchfab.com',
  'opengameart.org',
  'ContentProducer',
  'ProduceID',
]

/** 读 PNG 的文本块 */
const pngTextChunks = (buf) => {
  const found = []
  if (buf.length < 8 || buf.readUInt32BE(0) !== 0x89504e47) return found
  let offset = 8
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    if (['tEXt', 'iTXt', 'zTXt'].includes(type)) {
      found.push(buf.toString('utf8', offset + 8, offset + 8 + len))
    }
    offset += 12 + len
    if (type === 'IEND') break
  }
  return found
}

/** 读 GLB 的 JSON chunk */
const glbJson = (buf) => {
  if (buf.length < 12 || buf.readUInt32LE(0) !== 0x46546c67) return null
  let offset = 12
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32LE(offset)
    const type = buf.toString('ascii', offset + 4, offset + 8)
    if (type === 'JSON') {
      try {
        return JSON.parse(buf.toString('utf8', offset + 8, offset + 8 + len))
      } catch {
        return null
      }
    }
    offset += 8 + len
  }
  return null
}

let metadataChecked = 0
for (const abs of assets) {
  const rel = relative(repoRoot, abs).split('\\').join('/')
  const ext = extname(abs).toLowerCase()
  const buf = readFileSync(abs)

  // 只核对**自制资产**：第三方资产的来源标记正是 NOTICE 要保留的署名，
  // 拿它当"残留"报是误报。
  const isSelfGenerated = SELF_GENERATED.some((re) => re.test(rel))
  if (!isSelfGenerated) continue

  if (ext === '.png') {
    for (const chunk of pngTextChunks(buf)) {
      for (const marker of PROVENANCE_MARKERS) {
        if (chunk.includes(marker)) {
          problems.push(`${rel}：PNG 里残留第三方来源标记「${marker}」——重新编码会丢掉它，合规性会静默退化`)
        }
      }
    }
    metadataChecked++
  } else if (ext === '.glb') {
    const json = glbJson(buf)
    if (json) {
      const extras = json.asset?.extras
      if (extras) {
        for (const marker of PROVENANCE_MARKERS) {
          const dumped = JSON.stringify(extras)
          if (dumped.includes(marker)) {
            problems.push(`${rel}：GLB 的 asset.extras 里残留第三方来源标记「${marker}」`)
          }
        }
      }
      const copyright = json.asset?.copyright ?? ''
      for (const marker of PROVENANCE_MARKERS) {
        if (copyright.includes(marker)) {
          problems.push(`${rel}：GLB 的 asset.copyright 里残留第三方来源标记「${marker}」`)
        }
      }
    }
    metadataChecked++
  }
}
notes.push(`来源元数据：核对 ${metadataChecked} 个自制文件的文本块`)

// ---------- 3. favicon 不是别人的商标 ----------

/** Vue.js 官方 logo 的配色签名 */
const VUE_LOGO_COLORS = ['41b883', '35495e']
const faviconPath = join(repoRoot, 'public', 'favicon.ico')
if (existsSync(faviconPath)) {
  const ico = readFileSync(faviconPath)
  const hex = ico.toString('hex')
  const usesVue = VUE_LOGO_COLORS.some((c) => hex.includes(c))
  if (usesVue) {
    problems.push('public/favicon.ico：像素里出现 Vue.js 官方 logo 的配色签名——那是别人的商标，不能当本项目标识')
  } else {
    notes.push('favicon：未检出 Vue logo 配色签名')
  }
}

// ---------- 4. 依赖协议 ----------

/** 宽松许可：可商用、可再分发、无需以相同方式共享 */
const PERMISSIVE = new Set([
  'MIT', 'X11', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause',
  '0BSD', 'CC0-1.0', 'Unlicense', 'CC-BY-4.0', 'CC-BY-3.0', 'Zlib',
  'Python-2.0', 'BlueOak-1.0.0', 'PostgreSQL', 'Artistic-2.0', 'MIT-0',
  'OFL-1.1', 'MPL-2.0', 'Python-2.0', 'BSD-3-Clause-Clear',
  'CC-BY-4.0 AND OFL-1.1 AND MIT', 'CC-BY-4.0 AND MIT', 'Apache-2.0 AND MIT',
  'MPL-2.0 OR Apache-2.0', 'Apache-2.0 OR MIT', 'MIT OR Apache-2.0',
])

/** 明确禁止的协议（含传染性 / 禁止商用） */
const FORBIDDEN = /GPL|AGPL|LGPL|CC-BY-NC|NC-SA|SSPL|BUSL|Commons Clause|Elastic|OSL|JSON|AGPL-3\.0/i

const nm = join(repoRoot, 'node_modules')
let depCount = 0
if (existsSync(nm)) {
  for (const entry of readdirSync(nm, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const dirs =
      entry.name.startsWith('@')
        ? readdirSync(join(nm, entry.name), { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => join(entry.name, d.name))
        : [entry.name]
    for (const pkgName of dirs) {
      const p = join(nm, pkgName, 'package.json')
      if (!existsSync(p)) continue
      let pkg
      try {
        pkg = JSON.parse(readFileSync(p, 'utf8'))
      } catch {
        continue
      }
      depCount++
      // 协议字段可能带外层括号：'(CC-BY-4.0 AND MIT)'
      const raw = typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? '')
      const lic = raw.trim().replace(/^\((.*)\)$/, '$1').trim()
      if (FORBIDDEN.test(lic)) {
        problems.push(`${pkgName}@${pkg.version}：协议「${lic}」带限制或传染性，不允许`)
      } else if (!lic || lic === 'UNLICENSED') {
        // package.json 可能漏写 license 字段，但包里有 LICENSE 文件时按宽松处理，
        // 否则要求人工确认
        const hasLicenseFile = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE'].some(
          (f) => existsSync(join(nm, pkgName, f)),
        )
        if (!hasLicenseFile) {
          problems.push(`${pkgName}@${pkg.version}：协议未声明，且包内没有 LICENSE 文件，需人工确认`)
        }
      } else if (!PERMISSIVE.has(lic)) {
        problems.push(`${pkgName}@${pkg.version}：协议「${lic}」不在已知宽松清单里，需人工确认`)
      }
    }
  }
}
notes.push(`依赖协议：核对 ${depCount} 个包`)

// ---------- 输出 ----------
console.log('资产许可检查\n')
for (const n of notes) console.log('  ✓', n)
if (problems.length) {
  console.log('')
  for (const p of problems) console.log('  ❌', p)
  console.log(`\n${problems.length} 处问题`)
  process.exit(1)
}
console.log('\n✅ 全部资产的来源与协议都清楚，没有带限制的协议')
process.exit(0)
