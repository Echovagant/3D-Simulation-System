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

const simBlock = () => objectBlock(SIM, 'export const simulationConfig')
const llmBlock = () => objectBlock(LLM, 'export const llmConfig')
const renderPhysicsBlock = () => objectBlock(RENDER, 'export const RENDER_PHYSICS')
const renderGroundBlock = () => objectBlock(RENDER, 'export const RENDER_GROUND')

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

const sameSet = (a, b) => {
  if (a.length !== b.length) return false
  const left = [...a].sort()
  const right = [...b].sort()
  return left.every((token, index) => token === right[index])
}

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

  let actual
  try {
    actual = entry.read()
  } catch (err) {
    problems.push(`读不到源码里的取值：${entry.key}（${err.message}）`)
    continue
  }
  const actualText = typeof actual === 'string' ? actual : String(actual)

  if (entry.kind === 'number') {
    const expectedNumber = toNumber(row.value)
    if (!Number.isFinite(expectedNumber)) {
      problems.push(`文档里的值不是数字：${entry.key} = "${row.value}"`)
      continue
    }
    const actualNumber = toNumber(actualText)
    if (!Number.isFinite(actualNumber)) {
      problems.push(`源码里的值不是数字：${entry.key} = "${actualText}"`)
      continue
    }
    if (!nearlyEqual(expectedNumber, actualNumber)) {
      problems.push(
        `文档与源码不一致：${entry.key}（文档 ${row.value} → ${expectedNumber}，源码 ${actualText} → ${actualNumber}）`,
      )
      continue
    }
    notes.push(`${entry.key} = ${actualText} ✓`)
  } else if (entry.kind === 'list') {
    const expectedTokens = splitTokens(row.value)
    const actualTokens = splitTokens(actualText)
    if (!sameSet(expectedTokens, actualTokens)) {
      const missing = expectedTokens.filter((token) => !actualTokens.includes(token))
      const extra = actualTokens.filter((token) => !expectedTokens.includes(token))
      problems.push(
        `文档与源码不一致：${entry.key}（文档 ${row.value}；源码 ${actualText}；文档多出 ${missing.join(', ') || '无'}；源码多出 ${extra.join(', ') || '无'}）`,
      )
      continue
    }
    notes.push(`${entry.key} = ${actualTokens.join(', ')} ✓`)
  } else {
    if (row.value !== actualText) {
      problems.push(`文档与源码不一致：${entry.key}（文档 ${row.value}，源码 ${actualText}）`)
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

// ---------- 输出 ----------

console.log('仿真规格自检\n')
for (const note of notes) console.log('  ✓', note)

if (problems.length) {
  console.log('')
  for (const problem of problems) console.log('  ❌', problem)
  console.log(`\n${problems.length} 处问题`)
  process.exit(1)
}

console.log(`\n✅ ${notes.length} 个常量全部与源码一致`)
process.exit(0)
