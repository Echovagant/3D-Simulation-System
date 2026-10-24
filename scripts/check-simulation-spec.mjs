#!/usr/bin/env node
/**
 * 仿真规格自检：规格文档里写下的每个常量，都必须与源码里的真值一致。
 *
 * 用法：node scripts/check-simulation-spec.mjs [文档路径]
 *   文档路径默认是 docs/simulation-spec.md；传参可覆盖（自测用）。
 * 退出码：发现不一致为 1，否则为 0
 *
 * 为什么要有这道闸门：
 * 规格文档是最容易「悄悄说谎」的一类产物——代码里的步长从 1/60 改成 1/120，
 * 文档里的 `1/60` 不会自己跟着变，读文档的人却会以为它仍然成立。
 * 这道闸门把文档里的每个数字取回源码核对，对不上就让构建失败。
 *
 * 约定：
 * - 期望值只来自文档，源码是事实来源；脚本里不写死任何随版本变化的数字。
 * - 双向都查：文档漏写的常量、文档写了却没人核对的常量，都要报错。
 * - 实测基线是第三条链：`docs/simulation-baseline.json` 记运行期数字，
 *   文档的基线表与它对账，它的 config 段再与源码常量对账。
 */
import { readFileSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = fileURLToPath(new URL('..', import.meta.url))
const docPath = process.argv[2]
  ? resolve(process.argv[2])
  : join(repoRoot, 'docs', 'simulation-spec.md')

// ---------- 源文件读取 ----------

const textCache = new Map()

/** 读仓库里的文本文件（相对仓库根）；读不到就抛错，不静默跳过 */
const readText = (relPath) => {
  if (!textCache.has(relPath)) {
    const abs = join(repoRoot, relPath)
    textCache.set(relPath, existsSync(abs) ? readFileSync(abs, 'utf8') : null)
  }
  const content = textCache.get(relPath)
  if (content === null) throw new Error(`源文件不存在：${relPath}`)
  return content
}

/** 读仓库里的 JSON 文件 */
const readJson = (relPath) => JSON.parse(readText(relPath))

/**
 * 取 `marker` 后面那个对象字面量的完整文本（按花括号配对）。
 * 只看字面量本身，避免同名标识在文件别处被误命中。
 */
const objectBlock = (relPath, marker) => {
  const src = readText(relPath)
  const start = src.indexOf(marker)
  if (start < 0) throw new Error(`${relPath} 里找不到 ${marker}`)
  const brace = src.indexOf('{', start)
  if (brace < 0) throw new Error(`${relPath} 里 ${marker} 后面没有对象字面量`)
  let depth = 0
  for (let i = brace; i < src.length; i += 1) {
    if (src[i] === '{') depth += 1
    else if (src[i] === '}') {
      depth -= 1
      if (depth === 0) return src.slice(start, i + 1)
    }
  }
  throw new Error(`${relPath} 里 ${marker} 的对象字面量没有闭合`)
}

/** 在文本里抓第一个捕获组；抓不到就抛错 */
const capture = (text, regex, label) => {
  const m = text.match(regex)
  if (!m) throw new Error(`匹配不到 ${label}`)
  return m[1]
}

/**
 * 用全局正则抓多组匹配，合成一个 token 集合。
 *
 * 与 `capture` 的区别：它返回**所有**匹配，而不是第一个——
 * 像「有几条接入线」这种问题，答案本身就是一组。
 */
const captureList = (text, regex, label) => {
  const out = new Set()
  let m
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
  while ((m = re.exec(text)) !== null) {
    for (let i = 1; i < m.length; i += 1) {
      if (m[i]) out.add(m[i].trim())
    }
    if (m[0].length === 0) re.lastIndex += 1
  }
  if (out.size === 0) throw new Error(`匹配不到 ${label}`)
  return [...out]
}

/**
 * 数「有几条匹配」，而不是把匹配内容摊平。
 *
 * ⚠️ `captureList` 返回的是 token 集合（一条接入线贡献 id/host/kind 三个 token），
 * 用它数条目会数出三倍。条目数要按**匹配次数**算。
 */
const captureMatchCount = (text, regex, label) => {
  let count = 0
  let m
  const re = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : `${regex.flags}g`)
  while ((m = re.exec(text)) !== null) {
    count += 1
    if (m[0].length === 0) re.lastIndex += 1
  }
  if (count === 0) throw new Error(`匹配不到 ${label}`)
  return count
}

/** 按路径读 JSON 里的值 */
const jsonValue = (relPath, path) => {
  const data = readJson(relPath)
  let current = data
  for (const key of path) {
    if (current === null || typeof current !== 'object' || !(key in current)) {
      throw new Error(`${relPath} 里找不到 ${path.join('.')}`)
    }
    current = current[key]
  }
  return current
}

// ---------- 取值用的正则片段 ----------

/** 数字字面量：整数、小数、科学计数法 */
const N = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)(?:[eE][+-]?\\d+)?'
/** 数字字面量，额外允许 `1/60` 这种分数表达式 */
const NUM = `${N}(?:\\s*/\\s*${N})?`

// ---------- 对账契约 ----------
// 每一项写清楚：键名、文档里标的来源文件、值怎么从源码取、值的类型。
// 这里只有「怎么取」，没有「期望是多少」——期望值由文档提供。

const SIM = 'src/config/simulation.ts'
const LLM = 'src/config/llm.ts'
const AI = 'src/composables/useAI.ts'
const PROMPTS = 'src/services/llm/prompts.ts'
const PROVIDERS = 'src/config/llmProviders.ts'
const ACC = 'src/utils/fixedStepAccumulator.ts'
const BASELINE = 'backend/tests/fixtures/browser_baseline.json'
const SIMPY = 'backend/app/services/simulator.py'
const CFG = 'backend/app/config.py'
const RENDER = 'src/render/renderPage.ts'
const PROXY = 'backend/app/services/llm_proxy.py'
const BASELINE_RECORD = 'docs/simulation-baseline.json'

const simBlock = () => objectBlock(SIM, 'export const simulationConfig')
const llmBlock = () => objectBlock(LLM, 'export const llmConfig')
const renderPhysicsBlock = () => objectBlock(RENDER, 'export const RENDER_PHYSICS')
const renderGroundBlock = () => objectBlock(RENDER, 'export const RENDER_GROUND')

// ---------- 清单与记录的解析 ----------

/** 取第一个捕获组；抓不到就返回 undefined */
const optionalCapture = (text, regex) => {
  const m = text.match(regex)
  return m ? m[1] : undefined
}

/**
 * 取数组字面量里的每个对象块（按花括号配对）。
 *
 * 只认字面量本身，避免同名标识在文件别处被误命中。
 */
const arrayBlocks = (relPath, marker) => {
  const src = readText(relPath)
  const start = src.indexOf(marker)
  if (start < 0) throw new Error(`${relPath} 里找不到 ${marker}`)
  const open = start + marker.length - 1
  if (src[open] !== '[') throw new Error(`${relPath} 里 ${marker} 后面不是数组字面量`)
  const blocks = []
  let i = open + 1
  let depth = 1
  while (i < src.length && depth > 0) {
    const ch = src[i]
    if (ch === '[') {
      depth += 1
      i += 1
      continue
    }
    if (ch === ']') {
      depth -= 1
      i += 1
      continue
    }
    if (ch === '{') {
      let objDepth = 1
      const objStart = i
      i += 1
      while (i < src.length && objDepth > 0) {
        if (src[i] === '{') objDepth += 1
        else if (src[i] === '}') objDepth -= 1
        i += 1
      }
      blocks.push(src.slice(objStart, i))
      continue
    }
    i += 1
  }
  return blocks
}

/** 取元组字面量里每个调用的参数块（`Name(...)` 的圆括号内容） */
const callBlocks = (relPath, marker) => {
  const src = readText(relPath)
  const start = src.indexOf(marker)
  if (start < 0) throw new Error(`${relPath} 里找不到 ${marker}`)
  const open = start + marker.length - 1
  if (src[open] !== '(') throw new Error(`${relPath} 里 ${marker} 后面不是调用字面量`)
  const blocks = []
  let i = open + 1
  let depth = 1
  while (i < src.length && depth > 0) {
    const ch = src[i]
    if (ch === '"' || ch === "'") {
      const quote = ch
      i += 1
      while (i < src.length && src[i] !== quote) i += 1
      i += 1
      continue
    }
    if (ch === '(') {
      depth += 1
      i += 1
      continue
    }
    if (ch === ')') {
      depth -= 1
      i += 1
      continue
    }
    const callMatch = /^[A-Za-z_][A-Za-z0-9_]*\(/.exec(src.slice(i, i + 40))
    if (callMatch) {
      const callStart = i + callMatch[0].length - 1
      let callDepth = 1
      let j = callStart + 1
      while (j < src.length && callDepth > 0) {
        if (src[j] === '"' || src[j] === "'") {
          const quote = src[j]
          j += 1
          while (j < src.length && src[j] !== quote) j += 1
          j += 1
          continue
        }
        if (src[j] === '(') callDepth += 1
        else if (src[j] === ')') callDepth -= 1
        j += 1
      }
      blocks.push(src.slice(callStart + 1, j - 1))
      i = j
      continue
    }
    i += 1
  }
  return blocks
}

/** 前端清单里的每个条目 */
const providerEntries = () =>
  arrayBlocks(PROVIDERS, 'export const llmProviders: LlmProvider[] = [').map((block) => ({
    id: capture(block, /id:\s*'([^']+)'/, 'provider.id'),
    baseUrl: capture(block, /baseUrl:\s*'([^']+)'/, 'provider.baseUrl'),
    keyKind: optionalCapture(block, /keyKind:\s*'([^']+)'/),
    keyFamily: optionalCapture(block, /keyFamily:\s*'([^']+)'/),
    keyPrefix: optionalCapture(block, /keyPrefix:\s*'([^']+)'/),
    reasoningEffort: optionalCapture(block, /reasoningEffort:\s*'([^']+)'/),
    models: /models:\s*false/.test(block) ? false : true,
  }))

/** 后端清单里的每个条目（前端清单的镜像） */
const backendProviderEntries = () =>
  callBlocks(PROXY, 'PROVIDERS: tuple[LlmProvider, ...] = (').map((block) => ({
    id: capture(block, /id="([^"]+)"/, 'provider.id'),
    baseUrl: capture(block, /base_url="([^"]+)"/, 'provider.base_url'),
    keyFamily: optionalCapture(block, /key_family="([^"]+)"/),
    keyPrefix: optionalCapture(block, /key_prefix="([^"]+)"/),
    models: /models_supported=False/.test(block) ? false : true,
  }))

/** 一条接入线的五段：id · 端点 · 凭证类型 · 凭证前缀 · 模型列表接口 */
const accessLineTuple = (id) => {
  const entry = providerEntries().find((item) => item.id === id)
  if (!entry) throw new Error(`清单里没有 ${id}`)
  if (!entry.keyKind) throw new Error(`${id} 不是接入线（没有凭证类型）`)
  return [
    entry.id,
    entry.baseUrl,
    entry.keyKind,
    entry.keyPrefix ?? '-',
    entry.models === false ? 'no-models' : 'models',
  ]
}

/** 后端托管通道的故障转移顺序——顺序本身就是契约 */
const fallbackOrder = () =>
  capture(
    readText(CFG),
    /llm_fallback_order:\s*list\[str\]\s*=\s*\[([^\]]*)\]/,
    'llm_fallback_order',
  )
    .split(',')
    .map((item) => item.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)

// ---------- 实测基线（文档基线表 ↔ 基线记录）----------

/**
 * 基线表的列序：与文档里那张表一一对应。
 *
 * 逐轮读数不在参数表里，而在实测基线表里——那一列的值由文档给出，
 * 真值由基线记录给出，两者必须一致。
 */
const BASELINE_RUN_COLUMNS = [
  { label: '调用次数', key: 'CALLS', json: (run) => run.runs },
  { label: '闸门通过', key: 'PASSED', json: (run) => run.passed },
  { label: '正文为空', key: 'EMPTY_BODY', json: (run) => run.emptyBody },
  { label: '推理 token 最小', key: 'REASONING_MIN', json: (run) => run.reasoningTokensMin },
  { label: '推理 token 平均', key: 'REASONING_AVG', json: (run) => run.reasoningTokensAvg },
  { label: '推理 token 峰值', key: 'REASONING_MAX', json: (run) => run.reasoningTokensMax },
  { label: '端到端延迟均值', key: 'LATENCY_AVG_MS', json: (run) => run.latencyAvgMs },
]

/** 占位符：这一轮没有记这一项 */
const BASELINE_PLACEHOLDERS = new Set(['—', '–', '-', 'n/a', 'N/A'])

/** 解析实测基线表：行首是 `run-N`，其余按列序取值 */
const parseBaselineTable = (text) => {
  const rows = []
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length > 0 && cells[0] === '') cells.shift()
    if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    const idMatch = /^`(run-[0-9]+)`$/.exec(cells[0] ?? '')
    if (!idMatch) continue
    rows.push({ id: idMatch[1], cells: cells.slice(1) })
  }
  return rows
}

/** 取实测基线表里某一轮某一列的值 */
const baselineCell = (text, runId, columnIndex, columnLabel) => {
  const row = parseBaselineTable(text).find((item) => item.id === runId)
  if (!row) throw new Error(`实测基线表里没有 ${runId} 这一行`)
  if (row.cells.length !== BASELINE_RUN_COLUMNS.length) {
    throw new Error(
      `实测基线表里 ${runId} 这行有 ${row.cells.length} 列，应有 ${BASELINE_RUN_COLUMNS.length} 列`,
    )
  }
  const value = row.cells[columnIndex]
  if (value === undefined) throw new Error(`实测基线表里 ${runId} 缺少「${columnLabel}」这一列`)
  if (BASELINE_PLACEHOLDERS.has(value)) {
    throw new Error(`实测基线表里 ${runId} 的「${columnLabel}」是占位符，但基线记录里有这一项`)
  }
  return value
}

/** 基线记录（读不到时不抛错，交给对账环节报错） */
const baselineLoad = (() => {
  try {
    return { data: readJson(BASELINE_RECORD), error: null }
  } catch (err) {
    return { data: null, error: err.message }
  }
})()

const CONTRACT = [
  // ---- 前端物理配置 ----
  {
    key: 'SIM_FIXED_TIME_STEP',
    source: SIM,
    kind: 'number',
    read: () =>
      capture(simBlock(), new RegExp(`fixedTimeStep:\\s*(${NUM})`), 'simulationConfig.physics.fixedTimeStep'),
  },
  {
    key: 'SIM_MAX_SUB_STEPS',
    source: SIM,
    kind: 'number',
    read: () =>
      capture(simBlock(), new RegExp(`maxSubSteps:\\s*(${NUM})`), 'simulationConfig.physics.maxSubSteps'),
  },
  {
    key: 'SIM_MAX_FRAME_DELTA',
    source: SIM,
    kind: 'number',
    read: () =>
      capture(simBlock(), new RegExp(`maxFrameDelta:\\s*(${NUM})`), 'simulationConfig.physics.maxFrameDelta'),
  },
  {
    key: 'SIM_DEFAULT_GRAVITY_Y',
    source: SIM,
    kind: 'number',
    read: () =>
      capture(
        simBlock(),
        new RegExp(`defaultGravity:\\s*\\{[^}]*?y:\\s*(${NUM})`),
        'simulationConfig.physics.defaultGravity.y',
      ),
  },
  {
    key: 'SIM_USEPHYSICS_DEFAULT_FRICTION',
    source: SIM,
    kind: 'number',
    read: () =>
      capture(
        simBlock(),
        new RegExp(`defaultFriction:\\s*(${NUM})`),
        'simulationConfig.physics.defaultFriction',
      ),
  },
  {
    key: 'SIM_USEPHYSICS_DEFAULT_RESTITUTION',
    source: SIM,
    kind: 'number',
    read: () =>
      capture(
        simBlock(),
        new RegExp(`defaultRestitution:\\s*(${NUM})`),
        'simulationConfig.physics.defaultRestitution',
      ),
  },

  // ---- 固定步长累加器 ----
  {
    key: 'SIM_STEP_EPSILON',
    source: ACC,
    kind: 'number',
    read: () =>
      capture(readText(ACC), new RegExp(`^const\\s+STEP_EPSILON\\s*=\\s*(${NUM})`, 'm'), 'STEP_EPSILON'),
  },

  // ---- LLM 配置 ----
  {
    key: 'AI_MIN_INTERVAL_MS',
    source: LLM,
    kind: 'number',
    read: () => capture(llmBlock(), new RegExp(`minIntervalMs:\\s*(${NUM})`), 'llmConfig.minIntervalMs'),
  },
  {
    key: 'AI_MAX_CALLS_PER_SESSION',
    source: LLM,
    kind: 'number',
    read: () =>
      capture(llmBlock(), new RegExp(`maxCallsPerSession:\\s*(${NUM})`), 'llmConfig.maxCallsPerSession'),
  },
  {
    key: 'AI_COOLDOWN_MS',
    source: LLM,
    kind: 'number',
    read: () => capture(llmBlock(), new RegExp(`cooldownMs:\\s*(${NUM})`), 'llmConfig.cooldownMs'),
  },
  {
    key: 'AI_TIMEOUT_MS',
    source: LLM,
    kind: 'number',
    read: () => capture(llmBlock(), new RegExp(`timeoutMs:\\s*(${NUM})`), 'llmConfig.timeoutMs'),
  },
  {
    key: 'AI_CONTROLLER_MAX_TOKENS',
    source: LLM,
    kind: 'number',
    read: () =>
      capture(llmBlock(), new RegExp(`controllerMaxTokens:\\s*(${NUM})`), 'llmConfig.controllerMaxTokens'),
  },
  {
    key: 'AI_EXPLAIN_MAX_TOKENS',
    source: LLM,
    kind: 'number',
    read: () =>
      capture(llmBlock(), new RegExp(`explainMaxTokens:\\s*(${NUM})`), 'llmConfig.explainMaxTokens'),
  },
  {
    key: 'AI_MINIMAX_ACCESS_LINES',
    source: PROVIDERS,
    kind: 'list',
    // 四条接入线：两个端点 × 两种凭证。它们互不通用，
    // 每条要单独占一个条目（key 是按 providerId 分槽的）。
    read: () =>
      captureList(
        readText(PROVIDERS),
        /id:\s*'(minimax[^']*)'[\s\S]*?baseUrl:\s*'https:\/\/([^/']+)\/v1'[\s\S]*?keyKind:\s*'(\w+)'/g,
        'minimax 接入线',
      ),
  },
  {
    key: 'AI_MINIMAX_ACCESS_LINE_COUNT',
    source: PROVIDERS,
    kind: 'number',
    read: () =>
      captureMatchCount(
        readText(PROVIDERS),
        /id:\s*'(minimax[^']*)'[\s\S]*?baseUrl:\s*'https:\/\/([^/']+)\/v1'[\s\S]*?keyKind:\s*'(\w+)'/g,
        'minimax 接入线',
      ),
  },
  {
    key: 'AI_ACCESS_LINE_COUNT',
    source: PROVIDERS,
    kind: 'number',
    // 全部接入线（每个厂商的每条线各占一个条目）。
    // 厂商新增端点或新凭证类型时这个数会变——规格对不上就构建失败。
    read: () =>
      captureMatchCount(
        readText(PROVIDERS),
        /id:\s*'[a-z0-9-]+'[\s\S]*?keyKind:\s*'\w+'[\s\S]*?keyFamily:\s*'([a-z]+)'/g,
        '接入线',
      ),
  },
  {
    key: 'AI_ACCESS_LINE_FAMILIES',
    source: PROVIDERS,
    kind: 'list',
    // 厂商清单：每个厂商一条（或多条）接入线。
    read: () =>
      captureList(
        readText(PROVIDERS),
        /id:\s*'[a-z0-9-]+'[\s\S]*?keyKind:\s*'\w+'[\s\S]*?keyFamily:\s*'([a-z]+)'/g,
        '接入线厂商',
      ),
  },
  {
    key: 'AI_ACCESS_LINE_SUBSCRIPTION_COUNT',
    source: PROVIDERS,
    kind: 'number',
    // 订阅制的接入线有几条——它们与按量计费的那一套互不通用。
    read: () =>
      captureMatchCount(
        readText(PROVIDERS),
        /id:\s*'[a-z0-9-]+'[\s\S]*?keyKind:\s*'subscription'[\s\S]*?keyFamily:\s*'([a-z]+)'/g,
        '订阅接入线',
      ),
  },
  {
    key: 'AI_ACCESS_LINE_STANDARD_COUNT',
    source: PROVIDERS,
    kind: 'number',
    // 按量计费的接入线有几条——它与订阅制的那一套互不通用。
    read: () => providerEntries().filter((entry) => entry.keyKind === 'standard').length,
  },
  {
    key: 'AI_ACCESS_LINE_VENDOR_COUNT',
    source: PROVIDERS,
    kind: 'number',
    // 接入线覆盖几个厂商。厂商是分组标签，不是接入线本身。
    read: () =>
      new Set(providerEntries().filter((entry) => entry.keyKind).map((entry) => entry.keyFamily))
        .size,
  },
  {
    key: 'AI_ACCESS_LINE_IDS',
    source: PROVIDERS,
    kind: 'list',
    // 全部接入线的 id。集合比较——只比条数会漏掉「换掉一条又加回一条」。
    read: () =>
      providerEntries()
        .filter((entry) => entry.keyKind)
        .map((entry) => entry.id),
  },
  {
    key: 'AI_ACCESS_LINE_NO_MODELS',
    source: PROVIDERS,
    kind: 'list',
    // 没有模型列表接口的接入线：界面与验证脚本都要跳过它们。
    read: () =>
      providerEntries()
        .filter((entry) => entry.models === false)
        .map((entry) => entry.id),
  },
  {
    key: 'AI_DIRECT_LINE_COUNT',
    source: PROVIDERS,
    kind: 'number',
    // 不带凭证类型标记的条目：它们不在接入线体系里。
    read: () => providerEntries().filter((entry) => !entry.keyKind).length,
  },
  {
    key: 'AI_DIRECT_LINE_IDS',
    source: PROVIDERS,
    kind: 'list',
    read: () =>
      providerEntries()
        .filter((entry) => !entry.keyKind)
        .map((entry) => entry.id),
  },
  {
    key: 'AI_PROVIDER_COUNT',
    source: PROVIDERS,
    kind: 'number',
    // 清单的总条数：接入线 + 不带凭证类型标记的那几个。
    read: () => providerEntries().length,
  },
  {
    key: 'AI_PROVIDER_IDS',
    source: PROVIDERS,
    kind: 'list',
    read: () => providerEntries().map((entry) => entry.id),
  },
  {
    key: 'AI_FALLBACK_ORDER',
    source: CFG,
    kind: 'ordered-list',
    // 后端托管通道的故障转移顺序：顺序本身就是契约，不能只比集合。
    read: () => fallbackOrder().join(', '),
  },

  // ---- 实测基线记录（docs/simulation-baseline.json）----
  {
    key: 'BASE_RECORDED_AT',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'string',
    read: () => String(readJson(BASELINE_RECORD).recordedAt),
  },
  {
    key: 'BASE_PROVIDER',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'string',
    read: () => String(readJson(BASELINE_RECORD).provider),
  },
  {
    key: 'BASE_CONFIG_CONTROLLER_MAX_TOKENS',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'number',
    read: () => String(readJson(BASELINE_RECORD).config.controllerMaxTokens),
  },
  {
    key: 'BASE_CONFIG_EXPLAIN_MAX_TOKENS',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'number',
    read: () => String(readJson(BASELINE_RECORD).config.explainMaxTokens),
  },
  {
    key: 'BASE_CONFIG_REASONING_EFFORT',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'string',
    read: () => String(readJson(BASELINE_RECORD).config.reasoningEffort),
  },
  {
    key: 'BASE_RUN_COUNT',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'number',
    read: () => String(readJson(BASELINE_RECORD).runs.length),
  },
  {
    key: 'BASE_MODELS_AVAILABLE',
    source: BASELINE_RECORD,
    label: '基线记录',
    kind: 'number',
    read: () => String(readJson(BASELINE_RECORD).modelsAvailable),
  },

  // ---- AI 演武场 ----
  {
    key: 'AI_MAX_SPEED',
    source: AI,
    kind: 'number',
    read: () =>
      capture(readText(AI), new RegExp(`^const\\s+LLM_MAX_SPEED\\s*=\\s*(${NUM})`, 'm'), 'LLM_MAX_SPEED'),
  },
  {
    key: 'AI_AVOID_DISTANCE',
    source: AI,
    kind: 'number',
    read: () =>
      capture(readText(AI), new RegExp(`^const\\s+AVOID_DISTANCE\\s*=\\s*(${NUM})`, 'm'), 'AVOID_DISTANCE'),
  },
  {
    key: 'AI_DECISION_INTERVAL_MS',
    source: AI,
    kind: 'number',
    read: () =>
      capture(
        readText(AI),
        new RegExp(`^const\\s+DECISION_INTERVAL_MS\\s*=\\s*(${NUM})`, 'm'),
        'DECISION_INTERVAL_MS',
      ),
  },
  {
    key: 'AI_ACTION_NAMES',
    source: PROMPTS,
    kind: 'list',
    read: () =>
      capture(
        readText(PROMPTS),
        /export\s+type\s+LlmActionName\s*=\s*([^;\n]+)/,
        'LlmActionName',
      ),
  },

  // ---- 浏览器基准（JSON 直接解析，按路径取）----
  {
    key: 'BASE_GRAVITY_Y',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['world', 'gravity', 'y'])),
  },
  {
    key: 'BASE_DT',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['world', 'dt'])),
  },
  {
    key: 'BASE_STEPS',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['world', 'steps'])),
  },
  {
    key: 'BASE_TOLERANCE',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['tolerance', 'positionMeters'])),
  },
  {
    key: 'BASE_SAMPLE_COUNT',
    source: BASELINE,
    kind: 'number',
    read: () => {
      const samples = jsonValue(BASELINE, ['samples'])
      if (!Array.isArray(samples)) throw new Error(`${BASELINE} 的 samples 不是数组`)
      return String(samples.length)
    },
  },
  {
    key: 'BASE_SETTLED_STEP',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['settled', 'step'])),
  },
  {
    key: 'BASE_CUBE_HALF',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['cube', 'halfExtents', 'y'])),
  },
  {
    key: 'BASE_FRICTION',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['cube', 'friction'])),
  },
  {
    key: 'BASE_RESTITUTION',
    source: BASELINE,
    kind: 'number',
    read: () => String(jsonValue(BASELINE, ['cube', 'restitution'])),
  },

  // ---- 后端批量仿真 ----
  {
    key: 'SIM_BACKEND_DT',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(readText(SIMPY), new RegExp(`^DEFAULT_DT\\s*=\\s*(${NUM})`, 'm'), 'DEFAULT_DT'),
  },
  {
    key: 'SIM_BACKEND_GRAVITY_Y',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(readText(SIMPY), new RegExp(`^DEFAULT_GRAVITY_Y\\s*=\\s*(${NUM})`, 'm'), 'DEFAULT_GRAVITY_Y'),
  },
  {
    key: 'SIM_GROUND_HALF_X',
    source: SIMPY,
    kind: 'number',
    read: () => tupleItem(readText(SIMPY), 'GROUND_HALF_EXTENTS', 0),
  },
  {
    key: 'SIM_GROUND_HALF_Y',
    source: SIMPY,
    kind: 'number',
    read: () => tupleItem(readText(SIMPY), 'GROUND_HALF_EXTENTS', 1),
  },
  {
    key: 'SIM_GROUND_HALF_Z',
    source: SIMPY,
    kind: 'number',
    read: () => tupleItem(readText(SIMPY), 'GROUND_HALF_EXTENTS', 2),
  },
  {
    key: 'SIM_GROUND_OFFSET_Y',
    source: SIMPY,
    kind: 'number',
    read: () => tupleItem(readText(SIMPY), 'GROUND_TRANSLATION', 1),
  },
  {
    key: 'SIM_DEFAULT_SIZE',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(readText(SIMPY), new RegExp(`^DEFAULT_SIZE\\s*=\\s*(${NUM})`, 'm'), 'DEFAULT_SIZE'),
  },
  {
    key: 'SIM_DEFAULT_STEPS',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(readText(SIMPY), new RegExp(`^DEFAULT_STEPS\\s*=\\s*(${NUM})`, 'm'), 'DEFAULT_STEPS'),
  },
  {
    key: 'SIM_RESTING_SPEED',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(readText(SIMPY), new RegExp(`^RESTING_SPEED\\s*=\\s*(${NUM})`, 'm'), 'RESTING_SPEED'),
  },
  {
    key: 'SIM_PENETRATION_TOLERANCE',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(
        readText(SIMPY),
        new RegExp(`^PENETRATION_TOLERANCE\\s*=\\s*(${NUM})`, 'm'),
        'PENETRATION_TOLERANCE',
      ),
  },
  {
    key: 'SIM_SAMPLE_INTERVAL',
    source: SIMPY,
    kind: 'number',
    read: () =>
      capture(readText(SIMPY), new RegExp(`^SAMPLE_INTERVAL\\s*=\\s*(${NUM})`, 'm'), 'SAMPLE_INTERVAL'),
  },
  {
    key: 'SIM_SWEEP_PARAMS',
    source: SIMPY,
    kind: 'list',
    read: () => tupleLiteral(readText(SIMPY), 'SWEEP_PARAMS'),
  },
  {
    key: 'SIM_SUPPORTED_TYPES',
    source: SIMPY,
    kind: 'list',
    read: () => tupleLiteral(readText(SIMPY), 'SUPPORTED_TYPES'),
  },

  // ---- 后端配置 ----
  {
    key: 'SIM_MAX_RUNS_PER_JOB',
    source: CFG,
    kind: 'number',
    read: () =>
      capture(
        readText(CFG),
        /^[ \t]*simulation_max_runs_per_job:[ \t]*int[ \t]*=[ \t]*(\d+)/m,
        'simulation_max_runs_per_job',
      ),
  },
  {
    key: 'SIM_MAX_STEPS',
    source: CFG,
    kind: 'number',
    read: () =>
      capture(readText(CFG), /^[ \t]*simulation_max_steps:[ \t]*int[ \t]*=[ \t]*(\d+)/m, 'simulation_max_steps'),
  },
  {
    key: 'SIM_MAX_RUNS_PER_DAY',
    source: CFG,
    kind: 'number',
    read: () =>
      capture(
        readText(CFG),
        /^[ \t]*simulation_max_runs_per_day:[ \t]*int[ \t]*=[ \t]*(\d+)/m,
        'simulation_max_runs_per_day',
      ),
  },
  {
    key: 'RENDER_MAX_FRAMES',
    source: CFG,
    kind: 'number',
    read: () =>
      capture(readText(CFG), /^[ \t]*render_max_frames:[ \t]*int[ \t]*=[ \t]*(\d+)/m, 'render_max_frames'),
  },
  {
    key: 'RENDER_TIMEOUT_SECONDS',
    source: CFG,
    kind: 'number',
    read: () =>
      capture(
        readText(CFG),
        /^[ \t]*render_timeout_seconds:[ \t]*int[ \t]*=[ \t]*(\d+)/m,
        'render_timeout_seconds',
      ),
  },

  // ---- 服务端渲染页 ----
  {
    key: 'RENDER_FIXED_TIME_STEP',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(renderPhysicsBlock(), new RegExp(`fixedTimeStep:\\s*(${NUM})`), 'RENDER_PHYSICS.fixedTimeStep'),
  },
  {
    key: 'RENDER_MIN_SPEED',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(renderPhysicsBlock(), new RegExp(`minSpeed:\\s*(${NUM})`), 'RENDER_PHYSICS.minSpeed'),
  },
  {
    key: 'RENDER_MAX_SPEED',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(renderPhysicsBlock(), new RegExp(`maxSpeed:\\s*(${NUM})`), 'RENDER_PHYSICS.maxSpeed'),
  },
  {
    key: 'RENDER_GROUND_HALF_X',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(
        renderGroundBlock(),
        new RegExp(`halfExtents:\\s*\\{[^}]*?x:\\s*(${NUM})`),
        'RENDER_GROUND.halfExtents.x',
      ),
  },
  {
    key: 'RENDER_GROUND_HALF_Y',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(
        renderGroundBlock(),
        new RegExp(`halfExtents:\\s*\\{[^}]*?x:\\s*${NUM}[^}]*?y:\\s*(${NUM})`),
        'RENDER_GROUND.halfExtents.y',
      ),
  },
  {
    key: 'RENDER_GROUND_HALF_Z',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(
        renderGroundBlock(),
        new RegExp(`halfExtents:\\s*\\{[^}]*?x:\\s*${NUM}[^}]*?y:\\s*${NUM}[^}]*?z:\\s*(${NUM})`),
        'RENDER_GROUND.halfExtents.z',
      ),
  },
  {
    key: 'RENDER_GROUND_BODY_Y',
    source: RENDER,
    kind: 'number',
    read: () =>
      capture(renderGroundBlock(), new RegExp(`bodyY:\\s*(${NUM})`), 'RENDER_GROUND.bodyY'),
  },
  {
    key: 'RENDER_ACTION_TYPES',
    source: RENDER,
    kind: 'list',
    read: () =>
      capture(
        readText(RENDER),
        /^export\s+const\s+RENDER_ACTION_TYPES\s*=\s*(\[[^\]]*\])/m,
        'RENDER_ACTION_TYPES',
      ),
  },
]

// 逐条接入线：条目 id 变了，这里就会多出一条契约——文档必须同步补一行。
const accessLineContracts = providerEntries()
  .filter((entry) => entry.keyKind)
  .map((entry) => ({
    key: `AI_LINE_${entry.id.replace(/-/g, '_').toUpperCase()}`,
    source: PROVIDERS,
    kind: 'tuple',
    read: () => accessLineTuple(entry.id),
  }))
CONTRACT.push(...accessLineContracts)

// 逐轮实测读数：轮次来自基线记录，文档的基线表必须逐项对上。
const baselineRunContracts = (baselineLoad.data?.runs ?? []).flatMap((run) =>
  BASELINE_RUN_COLUMNS.map((column, index) => {
    if (column.json(run) === undefined) return null
    return {
      key: `BASE_${run.id.replace(/-/g, '_').toUpperCase()}_${column.key}`,
      source: BASELINE_RECORD,
      label: '基线记录',
      kind: 'number',
      doc: (text) => baselineCell(text, run.id, index, column.label),
      read: () => String(column.json(run)),
    }
  }).filter(Boolean),
)
CONTRACT.push(...baselineRunContracts)

/** Python 元组字面量的第 index 项（0 起） */
const tupleItem = (text, name, index) => {
  const inner = capture(text, new RegExp(`^${name}\\s*=\\s*\\(([^)]*)\\)`, 'm'), name)
  const items = inner.split(',').map((item) => item.trim()).filter(Boolean)
  if (index >= items.length) throw new Error(`${name} 只有 ${items.length} 项，取不到第 ${index + 1} 项`)
  return items[index]
}

/** Python 元组字面量的原始文本（列表类常量用） */
const tupleLiteral = (text, name) =>
  capture(text, new RegExp(`^${name}\\s*=\\s*(\\([^)]*\\))`, 'm'), name)

// ---------- 值的解析与比较 ----------

/** 把文本转成数字；支持 `1/60`、`1.0 / 60.0`、`1e-9` 这几种写法 */
const toNumber = (raw) => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : NaN
  const text = String(raw).trim()
  if (!text) return NaN
  const fraction = new RegExp(`^(${N})\\s*\\/\\s*(${N})$`).exec(text)
  if (fraction) {
    const numerator = Number(fraction[1])
    const denominator = Number(fraction[2])
    if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return NaN
    return numerator / denominator
  }
  const value = Number(text)
  return Number.isFinite(value) ? value : NaN
}

/** 数值相等：相对误差不超过 1e-9 */
const nearlyEqual = (a, b) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a))

/**
 * 把文本拆成 token 集合。
 * 文档侧写 `cube, sphere`，源码侧写 `("cube", "sphere")` 或 `'move' | 'rotate' | 'wait'`，
 * 两边拆出来的 token 才能直接比。
 */
const splitTokens = (raw) => {
  const text = String(raw).replace(/[()[\]{}'"`]/g, ' ')
  const tokens = text.split(/[\s,|]+/).map((token) => token.trim()).filter(Boolean)
  return [...new Set(tokens)]
}

/** 分段值的分隔符（接入线明细那一列） */
const TUPLE_SEP = '·'

/** 拆「a · b · c」这样的分段值 */
const splitTuple = (raw) =>
  String(raw)
    .split(TUPLE_SEP)
    .map((part) => part.trim())
    .filter(Boolean)

const sameSet = (a, b) => {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((token, index) => token === right[index])
}

/** 顺序也要一样——顺序本身就是契约时不能只比集合 */
const sameOrder = (a, b) => a.length === b.length && a.every((token, index) => token === b[index])

// ---------- 文档解析 ----------

/** 剥掉单元格里的反引号 */
const stripTicks = (cell) => cell.replace(/`/g, '').trim()

/**
 * 解析文档里的常量表。
 * 只认行首是 `|`、且第 1 个单元格是反引号包裹的大写下划线标识的行。
 */
const parseDoc = (text) => {
  const rows = []
  const seen = new Set()
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((cell) => cell.trim())
    if (cells.length > 0 && cells[0] === '') cells.shift()
    if (cells.length > 0 && cells[cells.length - 1] === '') cells.pop()
    const keyMatch = /^`([A-Z][A-Z0-9_]*)`$/.exec(cells[0] ?? '')
    if (!keyMatch) continue
    const key = keyMatch[1]
    if (cells.length < 4) {
      rows.push({ key, value: stripTicks(cells[1] ?? ''), source: stripTicks(cells[3] ?? ''), broken: true })
      continue
    }
    if (seen.has(key)) {
      rows.push({ key, value: stripTicks(cells[1] ?? ''), source: stripTicks(cells[3] ?? ''), duplicate: true })
      continue
    }
    seen.add(key)
    rows.push({ key, value: stripTicks(cells[1]), source: stripTicks(cells[3]) })
  }
  return rows
}

// ---------- 主流程 ----------

const notes = []
const problems = []

let docText = ''
try {
  docText = readFileSync(docPath, 'utf8')
} catch (err) {
  problems.push(`读不到文档：${docPath}（${err.message}）`)
}

const rows = docText ? parseDoc(docText) : []
const rowsByKey = new Map(rows.filter((row) => !row.broken && !row.duplicate).map((row) => [row.key, row]))
const contractByKey = new Map(CONTRACT.map((entry) => [entry.key, entry]))

for (const row of rows) {
  if (row.broken) {
    problems.push(`常量表行格式不对（${row.key}）：至少要有 4 列（常量 / 值 / 单位 / 来源）`)
    continue
  }
  if (row.duplicate) {
    problems.push(`常量表里有重复的键：${row.key}`)
    continue
  }
}

for (const entry of CONTRACT) {
  const row = rowsByKey.get(entry.key)
  let expectedRaw
  if (entry.doc) {
    // 期望值不在参数表里（例如实测基线表），由条目自己去文档里取。
    try {
      expectedRaw = entry.doc(docText)
    } catch (err) {
      problems.push(`读不到文档里的取值：${entry.key}（${err.message}）`)
      continue
    }
  } else {
    if (!row) {
      problems.push(`文档缺少该常量：${entry.key}`)
      continue
    }
    if (row.source !== entry.source) {
      problems.push(
        `文档标的来源与实际读取的文件不一致：${entry.key}（文档写 ${row.source || '空'}，实际读取 ${entry.source}）`,
      )
      continue
    }
    expectedRaw = row.value
  }

  let actual
  try {
    actual = entry.read()
  } catch (err) {
    problems.push(`读不到${entry.label ?? '源码'}里的取值：${entry.key}（${err.message}）`)
    continue
  }

  // 实际值从哪来：多数条目读的是源码，带 label 的条目读的是基线记录。
  // 报错时要说清是哪一边——把记录里的数说成「源码」，会让人跑去翻错文件。
  const actualLabel = entry.label ?? '源码'
  const actualText = typeof actual === 'string' ? actual : String(actual)

  if (entry.kind === 'number') {
    const expectedNumber = toNumber(expectedRaw)
    if (!Number.isFinite(expectedNumber)) {
      problems.push(`文档里的值不是数字：${entry.key} = "${expectedRaw}"`)
      continue
    }
    const actualNumber = toNumber(actualText)
    if (!Number.isFinite(actualNumber)) {
      problems.push(`${actualLabel}里的值不是数字：${entry.key} = "${actualText}"`)
      continue
    }
    if (!nearlyEqual(expectedNumber, actualNumber)) {
      problems.push(
        `文档与${actualLabel}不一致：${entry.key}（文档 ${expectedRaw} → ${expectedNumber}，${actualLabel} ${actualText} → ${actualNumber}）`,
      )
      continue
    }
    notes.push(`${entry.key} = ${actualText} ✓`)
  } else if (entry.kind === 'list') {
    const expectedTokens = splitTokens(expectedRaw)
    const actualTokens = splitTokens(actualText)
    if (!sameSet(expectedTokens, actualTokens)) {
      const missing = expectedTokens.filter((token) => !actualTokens.includes(token))
      const extra = actualTokens.filter((token) => !expectedTokens.includes(token))
      problems.push(
        `文档与${actualLabel}不一致：${entry.key}（文档 ${expectedRaw}；${actualLabel} ${actualText}；文档多出 ${missing.join(', ') || '无'}；${actualLabel}多出 ${extra.join(', ') || '无'}）`,
      )
      continue
    }
    notes.push(`${entry.key} = ${actualTokens.join(', ')} ✓`)
  } else if (entry.kind === 'ordered-list') {
    const expectedTokens = splitTokens(expectedRaw)
    const actualTokens = splitTokens(actualText)
    if (!sameOrder(expectedTokens, actualTokens)) {
      problems.push(
        `文档与${actualLabel}的顺序不一致：${entry.key}（文档 ${expectedRaw}；${actualLabel} ${actualText}）`,
      )
      continue
    }
    notes.push(`${entry.key} = ${actualTokens.join(', ')} ✓`)
  } else if (entry.kind === 'tuple') {
    const expectedParts = splitTuple(expectedRaw)
    const actualParts = (Array.isArray(actual) ? actual : splitTuple(actualText)).map(String)
    if (!sameOrder(expectedParts, actualParts)) {
      const diff = expectedParts
        .map((part, index) =>
          part === actualParts[index] ? null : `第 ${index + 1} 段 ${part} ≠ ${actualParts[index] ?? '（缺）'}`,
        )
        .filter(Boolean)
      problems.push(
        `文档与${actualLabel}不一致：${entry.key}（文档 ${expectedRaw}；${actualLabel} ${actualParts.join(` ${TUPLE_SEP} `)}${diff.length ? `；${diff.join('；')}` : ''}）`,
      )
      continue
    }
    notes.push(`${entry.key} = ${actualParts.join(` ${TUPLE_SEP} `)} ✓`)
  } else {
    if (expectedRaw !== actualText) {
      problems.push(`文档与${actualLabel}不一致：${entry.key}（文档 ${expectedRaw}，${actualLabel} ${actualText}）`)
      continue
    }
    notes.push(`${entry.key} = ${actualText} ✓`)
  }
}

// 反向：文档里出现的每一个标识，都必须有对账规则
for (const row of rows) {
  if (row.broken || row.duplicate) continue
  if (!contractByKey.has(row.key)) {
    problems.push(`文档里的这一行没有对账规则：${row.key}`)
  }
}

// ---------- 跨源对账 ----------

// 前后端的提供商清单必须一致：前端是事实来源，后端是它的镜像
try {
  const frontendIds = providerEntries().map((entry) => entry.id)
  const backendIds = backendProviderEntries().map((entry) => entry.id)
  const missing = frontendIds.filter((id) => !backendIds.includes(id))
  const extra = backendIds.filter((id) => !frontendIds.includes(id))
  if (missing.length || extra.length) {
    problems.push(
      `前后端的提供商清单不一致（前端缺 ${missing.join(', ') || '无'}；后端多 ${extra.join(', ') || '无'}）`,
    )
  } else {
    notes.push(`前后端提供商清单一致（${frontendIds.length} 条） ✓`)
  }
} catch (err) {
  problems.push(`读不到提供商清单：${err.message}`)
}

if (baselineLoad.error) {
  problems.push(`读不到基线记录：${BASELINE_RECORD}（${baselineLoad.error}）`)
} else {
  const record = baselineLoad.data
  const config = record.config ?? {}

  // 基线记录的 config 段必须与源码常量一致——改了源码忘了更新记录，构建要失败
  const configChecks = [
    {
      key: 'controllerMaxTokens',
      label: 'llmConfig.controllerMaxTokens',
      read: () =>
        capture(
          llmBlock(),
          new RegExp(`controllerMaxTokens:\\s*(${NUM})`),
          'llmConfig.controllerMaxTokens',
        ),
    },
    {
      key: 'explainMaxTokens',
      label: 'llmConfig.explainMaxTokens',
      read: () =>
        capture(
          llmBlock(),
          new RegExp(`explainMaxTokens:\\s*(${NUM})`),
          'llmConfig.explainMaxTokens',
        ),
    },
  ]
  for (const check of configChecks) {
    try {
      const recorded = toNumber(config[check.key])
      const actual = toNumber(check.read())
      if (!Number.isFinite(recorded) || !Number.isFinite(actual) || !nearlyEqual(recorded, actual)) {
        problems.push(
          `基线记录与源码不一致：config.${check.key}（记录 ${config[check.key]}，源码 ${check.label} = ${check.read()}）`,
        )
      } else {
        notes.push(`基线记录 config.${check.key} = ${recorded} ✓（与 ${check.label} 一致）`)
      }
    } catch (err) {
      problems.push(`基线记录与源码对不上：config.${check.key}（${err.message}）`)
    }
  }

  // 基线记录里的接入线必须在清单里，且它的思考深度参数与记录一致
  try {
    const providerId = String(record.provider ?? '')
    const entry = providerEntries().find((item) => item.id === providerId)
    if (!entry) {
      problems.push(`基线记录里的接入线 ${providerId} 不在清单里`)
    } else if (!entry.keyKind) {
      problems.push(`基线记录里的 ${providerId} 不是接入线（没有凭证类型）`)
    } else if (entry.reasoningEffort !== config.reasoningEffort) {
      problems.push(
        `基线记录与源码不一致：config.reasoningEffort（记录 ${config.reasoningEffort}，源码 ${providerId} 的 reasoningEffort = ${entry.reasoningEffort}）`,
      )
    } else {
      notes.push(`基线记录 config.reasoningEffort = ${config.reasoningEffort} ✓（与 ${providerId} 一致）`)
    }
  } catch (err) {
    problems.push(`基线记录与源码对不上：provider（${err.message}）`)
  }

  // 文档的实测基线表与基线记录必须逐行对应
  const docRuns = parseBaselineTable(docText)
  const recordRuns = record.runs ?? []
  for (const run of recordRuns) {
    if (!docRuns.some((row) => row.id === run.id)) {
      problems.push(`基线记录里有 ${run.id} 这一轮，文档的实测基线表里没有`)
    }
  }
  for (const row of docRuns) {
    const run = recordRuns.find((item) => item.id === row.id)
    if (!run) {
      problems.push(`文档的实测基线表里有 ${row.id} 这一轮，基线记录里没有`)
      continue
    }
    if (row.cells.length !== BASELINE_RUN_COLUMNS.length) {
      problems.push(
        `实测基线表里 ${row.id} 这行有 ${row.cells.length} 列，应有 ${BASELINE_RUN_COLUMNS.length} 列`,
      )
      continue
    }
    BASELINE_RUN_COLUMNS.forEach((column, index) => {
      const cell = row.cells[index]
      if (!BASELINE_PLACEHOLDERS.has(cell) && column.json(run) === undefined) {
        problems.push(
          `实测基线表里 ${row.id} 的「${column.label}」有值，但基线记录里没有这一项`,
        )
      }
    })
  }
}

// ---------- 输出 ----------

console.log('仿真规格自检\n')
for (const note of notes) console.log('  ✓', note)

if (problems.length) {
  console.log('')
  for (const problem of problems) console.log('  ❌', problem)
  console.log(`\n${problems.length} 处问题`)
  process.exit(1)
}

console.log(`\n✅ ${notes.length} 项对账全部通过`)
process.exit(0)
