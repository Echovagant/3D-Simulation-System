/**
 * 批量仿真 · 表单解析与结果汇总（纯函数，便于单测）。
 *
 * 组件只负责绑定输入、发起请求；把「字符串怎么变成数字列表」、
 * 「多行扫描怎么组装成 sweeps」、「结果怎么按 seed 汇总」放在这里，
 * 这样这些规则不用挂载组件就能验证。
 */
import type {
  SimulationJobRequest,
  SimulationParams,
  SimulationRun,
  SimulationSweep,
  SimulationSweepParam,
} from '@/services/api/simulations'
import type { SceneDocument } from '@/types'

/** 一行扫描输入：维度可以还没选（none），取值是用户原样输入的字符串 */
export interface SweepRowInput {
  param: SimulationSweepParam | 'none'
  values: string | number[]
}

/** 取值里允许出现的分隔符：中英文逗号、分号、空白 */
const VALUE_SEPARATOR = /[\s,，;；]+/

/** 解析单个数字；空串或非法值返回 undefined */
const parseNumber = (raw: string): number | undefined => {
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** 把 `0.1, 0.5 0.9` 这类输入解析成数字列表，忽略空段与非法项 */
export const parseSweepValues = (raw: string): number[] =>
  raw
    .split(VALUE_SEPARATOR)
    .map(parseNumber)
    .filter((value): value is number => value !== undefined)

/** 组装多行扫描的结果 */
export interface BuildSweepsResult {
  sweeps: SimulationSweep[]
  error?: string
}

/**
 * 从多行扫描输入组装 `sweeps`。
 *
 * - 维度为 `none` 的行直接忽略；
 * - 选了维度却没给合法取值 → 报错（静默丢掉会让用户以为扫了）；
 * - 同一维度出现两次 → 报错（笛卡尔积里会出现自相矛盾的组合）。
 */
export const buildSweeps = (rows: SweepRowInput[]): BuildSweepsResult => {
  const sweeps: SimulationSweep[] = []
  const seen = new Set<SimulationSweepParam>()
  for (const row of rows) {
    if (row.param === 'none') continue
    const values = Array.isArray(row.values) ? row.values : parseSweepValues(row.values)
    if (values.length === 0) {
      return { sweeps: [], error: `扫描维度「${row.param}」的取值不能为空。` }
    }
    if (seen.has(row.param)) {
      return { sweeps: [], error: `扫描维度「${row.param}」重复了，请合并成一行。` }
    }
    seen.add(row.param)
    sweeps.push({ param: row.param, values })
  }
  return { sweeps }
}

/** 种子解析结果：空输入返回空对象（= 不传，后端按 [0] 处理） */
export interface ParsedSeeds {
  seeds?: number[]
  error?: string
}

/** 解析种子输入：整数、逗号或空格分隔；空串 = 不传 */
export const parseSeeds = (raw: string): ParsedSeeds => {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  const seeds: number[] = []
  for (const part of trimmed.split(VALUE_SEPARATOR)) {
    if (!part) continue
    const value = Number(part)
    if (!Number.isInteger(value)) {
      return { error: '随机种子必须是整数（用逗号或空格分隔）。' }
    }
    seeds.push(value)
  }
  return seeds.length > 0 ? { seeds } : {}
}

/** 随机扰动解析结果 */
export interface ParsedRandomization {
  value?: number
  error?: string
}

/** 解析随机扰动：空串 = 不传（后端按 0 处理）；必须是非负数字 */
export const parseRandomization = (raw: string | number): ParsedRandomization => {
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { error: '随机扰动必须是数字。' }
    if (raw < 0) return { error: '随机扰动不能为负数。' }
    return { value: raw }
  }
  const trimmed = raw.trim()
  if (!trimmed) return {}
  const value = Number(trimmed)
  if (!Number.isFinite(value)) return { error: '随机扰动必须是数字。' }
  if (value < 0) return { error: '随机扰动不能为负数。' }
  return { value }
}

/** 组装请求体的输入 */
export interface SimulationBatchPayloadInput {
  label?: string
  scene: SceneDocument
  params?: SimulationParams
  sweeps?: SimulationSweep[]
  seeds?: number[]
  randomization?: number
}

/**
 * 组装提交载荷。
 *
 * 统一走 `sweeps`，不再发旧版 `sweep`；空数组 / 空串一律省略字段，
 * 让后端用自己的缺省值（seeds=[0]、randomization=0）。
 */
export const buildSimulationBatchPayload = (
  input: SimulationBatchPayloadInput,
): SimulationJobRequest => {
  const payload: SimulationJobRequest = { scene: input.scene }
  const label = input.label?.trim()
  if (label) payload.label = label
  if (input.params) payload.params = input.params
  if (input.sweeps && input.sweeps.length > 0) payload.sweeps = input.sweeps
  if (input.seeds && input.seeds.length > 0) payload.seeds = input.seeds
  if (input.randomization !== undefined) payload.randomization = input.randomization
  return payload
}

/** 按 seed 汇总的一行 */
export interface SeedSummaryRow {
  seed: number
  runs: number
  settledRuns: number
  /** 组内每轮 maxPenetration 的均值 */
  maxPenetrationAvg: number
  /** 组内每轮 maxPenetration 的最大值 */
  maxPenetrationMax: number
  /** 组内每轮 totalFallDistance 的均值 */
  avgFallDistance: number
}

const average = (values: number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, value) => sum + value, 0) / values.length

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

/**
 * 按 seed 汇总结果。
 *
 * 后端约定每轮 `params` 里都带 `seed`；旧结果没有该字段时按 0 归组，
 * 与后端「缺省 seeds=[0]」的口径一致。
 */
export const summarizeBySeed = (runs: SimulationRun[]): SeedSummaryRow[] => {
  const groups = new Map<number, SimulationRun[]>()
  for (const run of runs) {
    const rawSeed = run.params?.seed
    const seed = isFiniteNumber(rawSeed) ? rawSeed : 0
    const group = groups.get(seed)
    if (group) group.push(run)
    else groups.set(seed, [run])
  }

  return Array.from(groups.entries())
    .sort(([a], [b]) => a - b)
    .map(([seed, group]) => {
      const penetrations = group.map((run) => run.metrics.maxPenetration).filter(isFiniteNumber)
      const distances = group.map((run) => run.metrics.totalFallDistance).filter(isFiniteNumber)
      const settledRuns = group.filter((run) => isFiniteNumber(run.metrics.settledAtFrame)).length
      return {
        seed,
        runs: group.length,
        settledRuns,
        maxPenetrationAvg: average(penetrations),
        maxPenetrationMax: penetrations.length > 0 ? Math.max(...penetrations) : 0,
        avgFallDistance: average(distances),
      }
    })
}
