#!/usr/bin/env node
/**
 * 真厂商连通性验证：用真 key 跑一遍控制器的真实提示词，统计「有多少次真的拿到了可用动作」。
 *
 * 用法：
 *   node scripts/verify-llm-live.mjs --key-file <路径> [--provider minimax-cn-subscription] [--runs 10]
 *   node scripts/verify-llm-live.mjs --key-env MINIMAX_API_KEY [--runs 10]
 *
 * 退出码：全部通过为 0，否则为 1。
 *
 * 为什么要有这道脚本：
 * 整个 AI 演武场的 LLM 逻辑都由替身模型测试，**没有一条用例跑过真实厂商**。
 * 真实厂商返回的格式只要对不上，整套逻辑会「看起来完全正常」——仿真照跑、
 * 智能体照动，只是每一次决策都悄悄回落到了规则式控制器。
 * 这个脚本用真 key 把这件事变成可测的：
 * 跑 N 次，统计正文为空率、闸门通过率、推理 token 分布。
 *
 * ⚠️ 密钥只从**命令行给的仓库外文件**或环境变量读，
 * 绝不打印、绝不写进产物、绝不进仓库。
 *
 * ⚠️ 它**不在 build 链里**——它要真 key、要花钱、还要网络，
 * 不该挡住没配 key 的贡献者。跑法见 README 或直接 `--help`。
 */
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// ---------- 参数 ----------

const parseArgs = (argv) => {
  const args = { runs: 10, provider: 'minimax-cn-subscription', model: '', timeoutMs: 60000 }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = () => {
      const value = argv[i + 1]
      i += 1
      return value
    }
    if (arg === '--key-file') args.keyFile = next()
    else if (arg === '--key-env') args.keyEnv = next()
    else if (arg === '--provider') args.provider = next()
    else if (arg === '--model') args.model = next()
    else if (arg === '--runs') args.runs = Number(next())
    else if (arg === '--timeout-ms') args.timeoutMs = Number(next())
    else if (arg === '--help' || arg === '-h') args.help = true
  }
  return args
}

const args = parseArgs(process.argv.slice(2))

if (args.help) {
  console.log(`用法：
  node scripts/verify-llm-live.mjs --key-file <仓库外的密钥文件> [选项]
  node scripts/verify-llm-live.mjs --key-env <环境变量名> [选项]

选项：
  --provider <id>     接入线 id（默认 minimax-cn-subscription）
  --model <id>        模型 id（默认取该接入线的默认模型）
  --runs <n>          跑几次（默认 10）
  --timeout-ms <n>    单次超时（默认 60000）

可用接入线：
  minimax                     api.minimax.io                 按量计费
  minimax-subscription        api.minimax.io                 订阅
  minimax-cn                  api.minimaxi.com               按量计费
  minimax-cn-subscription     api.minimaxi.com               订阅
  deepseek                    api.deepseek.com               按量计费
  zhipu                       open.bigmodel.cn               按量计费
  zhipu-coding                open.bigmodel.cn               订阅
  qwen                        dashscope.aliyuncs.com         按量计费
  qwen-coding                 coding.dashscope.aliyuncs.com   订阅（无模型列表接口）
  ark                         ark.cn-beijing.volces.com      按量计费
  ark-coding                  ark.cn-beijing.volces.com      订阅

密钥来源二选一：--key-file（文件里是裸 key，一行）与 --key-env（环境变量名）。`)
  process.exit(0)
}

// ---------- 读密钥 ----------

const readKey = () => {
  if (args.keyEnv) {
    const value = process.env[args.keyEnv]
    if (!value) throw new Error(`环境变量 ${args.keyEnv} 是空的`)
    return value.trim()
  }
  if (args.keyFile) {
    const path = resolve(args.keyFile)
    if (!existsSync(path)) throw new Error(`密钥文件不存在：${path}`)
    return readFileSync(path, 'utf8').trim()
  }
  throw new Error('必须给 --key-file 或 --key-env 其中一个')
}

let apiKey = ''
try {
  apiKey = readKey()
} catch (error) {
  console.error(`❌ 读密钥失败：${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}

if (!apiKey) {
  console.error('❌ 密钥是空的')
  process.exit(1)
}

// ---------- 提供商配置（与 src/config/llmProviders.ts 同源） ----------
//
// ⚠️ 这里**不从源码清单读**——那个文件是 TypeScript，含类型标注，
// 正则解析它比重写一份更脆。两处各自维护，靠 `verify:spec` 闸门
// 与规格文档对账（规格里记着接入线条数与每条线的端点）。
//
// `models: false` 表示这家**没有模型列表接口**——拉模型那一步会直接跳过，
// 而不是拿一个必然失败的请求去报错。

const PROVIDERS = {
  minimax: { baseUrl: 'https://api.minimax.io/v1', reasoningEffort: 'low', model: 'MiniMax-M3.1-Flash' },
  'minimax-subscription': {
    baseUrl: 'https://api.minimax.io/v1',
    reasoningEffort: 'low',
    model: 'MiniMax-M3.1-Flash',
  },
  'minimax-cn': { baseUrl: 'https://api.minimaxi.com/v1', reasoningEffort: 'low', model: 'MiniMax-M3.1-Flash' },
  'minimax-cn-subscription': {
    baseUrl: 'https://api.minimaxi.com/v1',
    reasoningEffort: 'low',
    model: 'MiniMax-M3.1-Flash',
  },
  deepseek: { baseUrl: 'https://api.deepseek.com', reasoningEffort: 'high', model: 'deepseek-flash' },
  zhipu: { baseUrl: 'https://open.bigmodel.cn/api/paas/v4', reasoningEffort: null, model: 'glm-5.3' },
  'zhipu-coding': {
    baseUrl: 'https://open.bigmodel.cn/api/coding/paas/v4',
    reasoningEffort: null,
    model: 'glm-5.2',
  },
  qwen: {
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    reasoningEffort: 'low',
    model: 'qwen3.8-max',
  },
  'qwen-coding': {
    baseUrl: 'https://coding.dashscope.aliyuncs.com/v1',
    reasoningEffort: 'low',
    model: 'qwen3.8-max',
    // 百炼 Coding Plan 不开放模型列表接口
    models: false,
  },
  ark: { baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', reasoningEffort: null, model: 'doubao-seed-2.1-pro' },
  'ark-coding': {
    baseUrl: 'https://ark.cn-beijing.volces.com/api/coding/v3',
    reasoningEffort: null,
    model: 'Doubao-Seed-Code',
  },
}

const provider = PROVIDERS[args.provider]
if (!provider) {
  console.error(`❌ 不认识的 provider：${args.provider}`)
  console.error(`   可用：${Object.keys(PROVIDERS).join(', ')}`)
  process.exit(1)
}

// 模型没指定就用这条接入线的默认模型——各家的默认模型不一样
if (!args.model) args.model = provider.model

// ---------- 控制器提示词（与 src/services/llm/prompts.ts 保持一致） ----------

const SYSTEM_PROMPT = `你是一个 3D 仿真场地里的无人车控制器。你只能通过动作影响它，不能直接给坐标。

场地是 48×48 米，障碍物是静止的方块，四周有墙。坐标里 x 是东西向、z 是南北向。

你只能使用下面三种动作之一，并且必须原样使用这些字段名：
- {"action":"move","direction":[dx,dz],"speed":5} —— 朝 direction 指定的方向行驶，speed 单位是米/秒
- {"action":"rotate","angle":0.5} —— 绕竖直轴转向，angle 单位是弧度，正数向右
- {"action":"wait"} —— 原地不动

要求：
1. 只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块。
2. direction 必须是长度为 2 的数字数组 [dx, dz]，表示单位方向（不需要你自己归一化，但方向不能是 [0,0]）。
3. speed 取值 0.5 到 8，angle 取值 -3.14 到 3.14。
4. 最近障碍物距离小于 3.5 米时优先 rotate 躲开；否则朝目标方向 move。
5. 已经在撞障碍物时，优先 rotate 脱离，不要继续往障碍物里 move。`

/** 几种典型场景：障碍距离不同 → 模型的推理长度不同 */
const SCENARIOS = [
  {
    name: '空旷场地',
    payload: {
      name: 'car-1', type: 'car', position: [1, 0, 2], velocity: [0, 0, 0],
      goal: [0, 0, 0], goal_direction: [-1, 0], nearest_obstacle_distance: 5,
      obstacles_in_range: 0, awareness_range: 10, max_speed: 8, collided: false,
    },
  },
  {
    name: '贴近障碍',
    payload: {
      name: 'car-1', type: 'car', position: [1, 0, 2], velocity: [3, 0, -1],
      goal: [0, 0, 0], goal_direction: [-1, 0], nearest_obstacle_distance: 1.2,
      obstacles_in_range: 4, awareness_range: 10, max_speed: 8, collided: true,
    },
  },
  {
    name: '远距离目标',
    payload: {
      name: 'car-1', type: 'car', position: [12, 0, -8], velocity: [0.5, 0, 0.2],
      goal: [-20, 0, 15], goal_direction: [-0.8, 0.6], nearest_obstacle_distance: 3.4,
      obstacles_in_range: 2, awareness_range: 8, max_speed: 8, collided: false,
    },
  },
]

// ---------- 闸门（与 src/services/llm/prompts.ts 的 parseLlmAction 同规则） ----------

const clamp = (value, min, max) => Math.min(Math.max(value, min), max)

/** 剥掉 Markdown 代码块，抠出第一个完整的 JSON 对象 */
const extractJsonObject = (raw) => {
  if (!raw) return null
  const text = raw.replace(/```(?:json)?/gi, ' ')
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const toFiniteNumber = (value) => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/** 与 parseLlmAction 同规则：校验不过就返回 null（调用方必须回落规则式） */
const parseLlmAction = (raw, maxSpeed = 8) => {
  const json = extractJsonObject(raw)
  if (!json) return null
  let parsed
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const record = parsed
  const action = record.action
  if (action !== 'move' && action !== 'rotate' && action !== 'wait') return null
  if (action === 'wait') return { action: 'wait' }
  if (action === 'rotate') {
    const angle = toFiniteNumber(record.angle)
    if (angle === null) return null
    return { action: 'rotate', angle: clamp(angle, -Math.PI, Math.PI) }
  }
  const direction = record.direction
  if (!Array.isArray(direction) || direction.length < 2) return null
  const dx = toFiniteNumber(direction[0])
  const dz = toFiniteNumber(direction[1])
  if (dx === null || dz === null) return null
  const length = Math.hypot(dx, dz)
  if (length < 1e-6) return null
  const speed = toFiniteNumber(record.speed)
  return {
    action: 'move',
    direction: [dx / length, dz / length],
    speed: speed === null ? maxSpeed : clamp(speed, 0.5, maxSpeed),
  }
}

// ---------- 发请求 ----------

const callOnce = async (scenario) => {
  const body = {
    model: args.model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify(scenario.payload) },
    ],
    max_completion_tokens: 512,
  }
  if (provider.reasoningEffort) body.reasoning_effort = provider.reasoningEffort

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs)
  const started = Date.now()
  try {
    const response = await fetch(`${provider.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const latencyMs = Date.now() - started
    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      return { ok: false, error: `HTTP ${response.status}：${raw.slice(0, 160)}`, latencyMs }
    }
    const payload = await response.json()
    const content = typeof payload?.choices?.[0]?.message?.content === 'string'
      ? payload.choices[0].message.content.trim()
      : ''
    const finishReason = payload?.choices?.[0]?.finish_reason
    const reasoningTokens = payload?.usage?.completion_tokens_details?.reasoning_tokens
    return { ok: true, content, finishReason, reasoningTokens, latencyMs }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, error: controller.signal.aborted ? '请求超时' : message, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 拉模型列表 ----------

/**
 * 拉一把 key 实际能用的模型。
 *
 * 界面上的「拉取可用模型」按钮走的是同一条路径——
 * 这个脚本跑通了，界面上那个按钮就是通的。
 *
 * @returns `supported: false` 表示这家没有模型列表接口，跳过即可，不算失败。
 */
const fetchModelList = async () => {
  if (provider.models === false) {
    return { ok: false, supported: false, models: [], error: '这家没有开放模型列表接口' }
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), args.timeoutMs)
  try {
    const response = await fetch(`${provider.baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    })
    if (!response.ok) {
      const raw = await response.text().catch(() => '')
      return {
        ok: false,
        supported: true,
        models: [],
        error: `HTTP ${response.status}：${raw.slice(0, 120)}`,
      }
    }
    const payload = await response.json()
    const list = Array.isArray(payload?.data) ? payload.data : []
    const models = list
      .map((entry) => (typeof entry?.id === 'string' ? entry.id.trim() : ''))
      .filter(Boolean)
    return { ok: models.length > 0, models, error: models.length ? '' : '返回的列表是空的' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return {
      ok: false,
      supported: true,
      models: [],
      error: controller.signal.aborted ? '请求超时' : message,
    }
  } finally {
    clearTimeout(timer)
  }
}

// ---------- 跑 ----------

// 先拉模型列表：界面上的「拉取可用模型」按钮走的是同一条路径
const modelList = await fetchModelList()

const results = []
for (let i = 0; i < args.runs; i += 1) {
  const scenario = SCENARIOS[i % SCENARIOS.length]
  const result = await callOnce(scenario)
  results.push({ scenario: scenario.name, ...result })
  // 串行跑：并发请求会把厂商的限流与推理长度搅在一起，测出来的数字不可信
  if (i < args.runs - 1) await new Promise((r) => setTimeout(r, 400))
}

// ---------- 统计 ----------

const total = results.length
const httpFailed = results.filter((r) => !r.ok)
const empty = results.filter((r) => r.ok && !r.content)
const truncated = results.filter((r) => r.ok && !r.content && r.finishReason === 'length')
const passed = results.filter((r) => r.ok && r.content && parseLlmAction(r.content) !== null)
const rejected = results.filter((r) => r.ok && r.content && parseLlmAction(r.content) === null)
const reasoning = results.map((r) => r.reasoningTokens).filter((n) => typeof n === 'number')
const latencies = results.map((r) => r.latencyMs).filter((n) => typeof n === 'number')

const sum = (list) => list.reduce((a, b) => a + b, 0)
const avg = (list) => (list.length ? (sum(list) / list.length).toFixed(0) : '-')

console.log('\n真厂商连通性验证')
console.log(`  提供商：${args.provider}（${provider.baseUrl}）`)
console.log(`  模型：${args.model}`)
console.log(`  次数：${total}\n`)

console.log('模型列表（界面「拉取可用模型」走的是同一条路径）：')
if (modelList.supported === false) {
  console.log(`  — ${modelList.error}（跳过，不算失败）`)
} else if (modelList.ok) {
  console.log(`  ✓ 拉到 ${modelList.models.length} 个模型`)
  for (const id of modelList.models) {
    console.log(`      ${id}${id === args.model ? '   ← 当前用的' : ''}`)
  }
} else {
  console.log(`  ❌ 拉取失败：${modelList.error}`)
}
console.log('')

for (const [index, r] of results.entries()) {
  const state = !r.ok
    ? `❌ ${r.error}`
    : !r.content
      ? `⚠️ 正文为空（finish_reason=${r.finishReason ?? '-'}）`
      : parseLlmAction(r.content) === null
        ? '⚠️ 闸门拒收（解析不过）'
        : `✓ ${r.content.slice(0, 60)}`
  console.log(`  #${index + 1} [${r.scenario}] ${state}（${r.latencyMs}ms）`)
}

console.log('')
console.log(`  HTTP 失败      ${httpFailed.length}/${total}`)
console.log(`  正文为空      ${empty.length}/${total}${truncated.length ? `（其中被长度上限截断 ${truncated.length} 次）` : ''}`)
console.log(`  闸门拒收      ${rejected.length}/${total}`)
console.log(`  闸门通过      ${passed.length}/${total}`)
console.log(`  推理 token    ${reasoning.length ? `min=${Math.min(...reasoning)} max=${Math.max(...reasoning)} avg=${avg(reasoning)}` : '-'}`)
console.log(`  延迟          avg=${avg(latencies)}ms`)

// ---------- 判定 ----------

const problems = []
if (httpFailed.length > 0) problems.push(`${httpFailed.length} 次请求失败（先看错误信息：key、端点、额度）`)
if (empty.length > 0) {
  problems.push(
    `${empty.length} 次正文为空${truncated.length ? `（${truncated.length} 次被输出上限截断——调大 controllerMaxTokens 能救）` : ''}`,
  )
}
if (rejected.length > 0) problems.push(`${rejected.length} 次返回了内容但过不了闸门（提示词或厂商返回格式对不上）`)
if (passed.length === 0 && total > 0) problems.push('没有一次拿到可用动作——LLM 控制器完全不可用')
if (!modelList.ok) {
  // 「这家没有模型列表接口」不算失败——那是接口本身没有，不是 key 或配置错了
  if (modelList.supported !== false) {
    problems.push(
      `拉不到模型列表：${modelList.error}（界面上的「拉取可用模型」按钮会同样失败）`,
    )
  }
} else if (!modelList.models.includes(args.model)) {
  problems.push(
    `当前模型 ${args.model} 不在这把 key 的模型列表里（列表共 ${modelList.models.length} 个）——换模型或换 Key`,
  )
}

if (problems.length) {
  console.error('\n❌ 未通过：')
  for (const p of problems) console.error(`  - ${p}`)
  process.exit(1)
}

console.log(`\n✅ ${passed.length}/${total} 次拿到了可用动作；正文为空 0 次，闸门拒收 0 次`)
process.exit(0)
