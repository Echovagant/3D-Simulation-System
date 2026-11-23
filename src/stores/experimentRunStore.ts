/**
 * 仿真实验室的实验运行记录。
 *
 * 记录存在 localStorage（键 `experiment-runs`），最多保留 30 条：
 * 实验台的定位是「可重复、可比较」——跑完就散、没有存档，用户就没法回看与复现。
 *
 * 外部存储一律当成不可信输入：读坏数据返回空数组并给一句可读的提示，
 * 写失败（隐私模式 / 配额满）只标记错误、不把异常抛给界面。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { SceneDocument } from '@/types'

/** 运行记录的 localStorage 键 */
export const EXPERIMENT_RUNS_KEY = 'experiment-runs'

/** 最多保留的运行记录条数 */
export const MAX_EXPERIMENT_RUNS = 30

/** 这条运行是从哪来的：预设 / 场景编辑器保存的场景 / 编辑器交接的场景 */
export interface ExperimentRunSource {
  kind: 'preset' | 'scene' | 'handoff'
  id: string
  name: string
}

/** 实验级参数（与实验室右栏「环境设置」「仿真速度」一一对应） */
export interface ExperimentRunConfig {
  gravity: number
  friction: number
  restitution: number
  simulationSpeed: number
}

export interface ExperimentRun {
  id: string
  name: string
  createdAt: string
  source: ExperimentRunSource
  config: ExperimentRunConfig
  objectCount: number
  simulationTime: number
  recordedFrames: number
  /** 交接场景的来源记录里存一份场景文档，复现时不再依赖 sessionStorage */
  document?: SceneDocument
}

/** 记录一条运行所需的信息：id 与时间由 store 生成 */
export type ExperimentRunInput = Omit<ExperimentRun, 'id' | 'createdAt'>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const createRunId = (): string => {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const sanitizeSource = (raw: unknown): ExperimentRunSource | null => {
  if (!isRecord(raw)) return null
  const kind = raw.kind
  if (kind !== 'preset' && kind !== 'scene' && kind !== 'handoff') return null
  return {
    kind,
    id: typeof raw.id === 'string' ? raw.id : '',
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 200) : '未命名来源',
  }
}

const sanitizeConfig = (raw: unknown): ExperimentRunConfig => {
  if (!isRecord(raw)) {
    return { gravity: -9.8, friction: 0.1, restitution: 0.5, simulationSpeed: 1 }
  }
  return {
    gravity: finiteOr(raw.gravity, -9.8),
    friction: finiteOr(raw.friction, 0.1),
    restitution: finiteOr(raw.restitution, 0.5),
    simulationSpeed: finiteOr(raw.simulationSpeed, 1),
  }
}

const sanitizeDocument = (raw: unknown): SceneDocument | undefined => {
  if (!isRecord(raw) || !Array.isArray(raw.objects)) return undefined
  return raw as unknown as SceneDocument
}

/** 单条记录收敛；不合法（缺 id / 缺来源）就整条丢弃，不在列表里留半条脏数据 */
const sanitizeRun = (raw: unknown): ExperimentRun | null => {
  if (!isRecord(raw)) return null

  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (!id) return null

  const source = sanitizeSource(raw.source)
  if (!source) return null

  const createdAt =
    typeof raw.createdAt === 'string' && raw.createdAt.trim()
      ? raw.createdAt
      : new Date(0).toISOString()

  const document = sanitizeDocument(raw.document)

  return {
    id,
    name: typeof raw.name === 'string' && raw.name.trim() ? raw.name.slice(0, 200) : source.name,
    createdAt,
    source,
    config: sanitizeConfig(raw.config),
    objectCount: Math.max(0, Math.round(finiteOr(raw.objectCount, 0))),
    simulationTime: Math.max(0, finiteOr(raw.simulationTime, 0)),
    recordedFrames: Math.max(0, Math.round(finiteOr(raw.recordedFrames, 0))),
    ...(document ? { document } : {}),
  }
}

export const useExperimentRunStore = defineStore('experimentRun', () => {
  /** 最近一次读到的运行记录（新→旧） */
  const runs = ref<ExperimentRun[]>([])
  /** 最近一次读写的可读错误；空串表示没有错误 */
  const lastError = ref('')

  /** 从 localStorage 读一份干净的列表；坏数据一律退回空数组 */
  const readFromStorage = (): ExperimentRun[] => {
    lastError.value = ''

    let raw: string | null
    try {
      raw = localStorage.getItem(EXPERIMENT_RUNS_KEY)
    } catch (error) {
      console.warn('[experimentRunStore] 读取运行记录失败', error)
      lastError.value = '运行记录读取失败：浏览器本地存储不可用'
      return []
    }
    if (!raw) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn('[experimentRunStore] 运行记录不是合法 JSON，已忽略', error)
      lastError.value = '运行记录数据已损坏，已忽略（不影响本次实验）'
      return []
    }

    if (!Array.isArray(parsed)) {
      lastError.value = '运行记录格式不正确，已忽略'
      return []
    }

    return parsed
      .map(sanitizeRun)
      .filter((run): run is ExperimentRun => run !== null)
      .slice(0, MAX_EXPERIMENT_RUNS)
  }

  /** 写回 localStorage；失败只记录可读错误，返回 false */
  const persist = (list: ExperimentRun[]): boolean => {
    try {
      localStorage.setItem(EXPERIMENT_RUNS_KEY, JSON.stringify(list))
      lastError.value = ''
      return true
    } catch (error) {
      console.warn('[experimentRunStore] 写入运行记录失败', error)
      lastError.value = '运行记录写入失败：浏览器本地存储不可用或空间不足'
      return false
    }
  }

  /** 列出运行记录（新→旧），并同步到响应式列表 */
  const listRuns = (): ExperimentRun[] => {
    const list = readFromStorage()
    runs.value = list
    return list
  }

  /** 记录一条运行；写失败返回 null（界面据此给提示，不抛异常） */
  const recordRun = (input: ExperimentRunInput): ExperimentRun | null => {
    const source = sanitizeSource(input.source)
    if (!source) {
      lastError.value = '运行记录缺少来源信息，未保存'
      return null
    }

    const document = sanitizeDocument(input.document)
    const run: ExperimentRun = {
      id: createRunId(),
      name:
        typeof input.name === 'string' && input.name.trim()
          ? input.name.trim().slice(0, 200)
          : source.name,
      createdAt: new Date().toISOString(),
      source,
      config: sanitizeConfig(input.config),
      objectCount: Math.max(0, Math.round(finiteOr(input.objectCount, 0))),
      simulationTime: Math.max(0, finiteOr(input.simulationTime, 0)),
      recordedFrames: Math.max(0, Math.round(finiteOr(input.recordedFrames, 0))),
      ...(document ? { document } : {}),
    }

    // 每次从存储重读：多个标签页交替写时不会互相覆盖成旧列表
    const next = [run, ...readFromStorage()].slice(0, MAX_EXPERIMENT_RUNS)
    if (!persist(next)) return null

    runs.value = next
    return run
  }

  /** 删除一条记录；不存在或写失败返回 false */
  const removeRun = (id: string): boolean => {
    const current = readFromStorage()
    const next = current.filter((run) => run.id !== id)
    if (next.length === current.length) {
      runs.value = current
      return false
    }
    if (!persist(next)) {
      runs.value = current
      return false
    }
    runs.value = next
    return true
  }

  /** 清空全部记录；写失败返回 false */
  const clearRuns = (): boolean => {
    if (!persist([])) return false
    runs.value = []
    return true
  }

  return {
    runs,
    lastError,
    listRuns,
    recordRun,
    removeRun,
    clearRuns,
  }
})
