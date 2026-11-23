/**
 * Agent 评测台 · 任务套件与批量评测结果。
 *
 * 套件是「可重复、可比较」的地基：一组任务（场景 JSON + 目标 + 步数上限 + 参数），
 * 批量跑完把每次运行的结果留档。存储分两个键：
 * - `gym-task-suites`：最多 20 套（用户手写的资产，超限时拒绝新增，不偷偷丢旧的）
 * - `gym-eval-results`：最多 50 次运行（跑出来的记录，超出后丢弃最旧的）
 *
 * 外部存储一律当成不可信输入：坏数据回退空列表并给一句可读提示，
 * 写失败（隐私模式 / 配额满）只标记错误，不把异常抛给界面。
 *
 * 运行状态（running / progress / lastResults）只留在内存里；
 * 应用重开后会从最近一次留档的运行结果恢复展示。
 */
import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { summarizeGymEvalResults } from '@/services/gym/evaluate'

/** 任务套件的 localStorage 键 */
export const GYM_TASK_SUITES_KEY = 'gym-task-suites'

/** 评测运行记录的 localStorage 键 */
export const GYM_EVAL_RESULTS_KEY = 'gym-eval-results'

/** 最多保留的任务套件数（用户资产，超限拒绝新增） */
export const MAX_GYM_TASK_SUITES = 20

/** 最多保留的评测运行次数 */
export const MAX_GYM_EVAL_RUNS = 50

/** 基线策略：恒定推力 / 比例控制（都是只用观测的规则，不调 LLM） */
export type GymEvalPolicyId = 'constant' | 'proportional'

/** 一个评测任务：场景文档 + 目标点 + 回合上限 + 可选物理参数 */
export interface GymTask {
  id: string
  name: string
  /** 完整前端场景文档（与批量仿真同一口径） */
  scene: Record<string, unknown>
  target: { x: number; z: number }
  maxSteps: number
  params?: Record<string, unknown>
}

/** 新建任务时的输入：id 由 store 生成 */
export type GymTaskInput = Omit<GymTask, 'id'> & { id?: string }

/** 一套任务 */
export interface GymTaskSuite {
  id: string
  name: string
  tasks: GymTask[]
}

/** 单次「任务 × 策略」的运行结果 */
export interface GymEvalRunResult {
  taskId: string
  taskName: string
  policyId: GymEvalPolicyId
  success: boolean
  steps: number
  totalReward: number
  wallClockMs: number
  /** 终局时的水平距离（米）；运行失败没有有效观测时为 null */
  finalDistance?: number | null
  /** 非空表示这次运行失败（后端不可达 / 422 / 清理失败等） */
  error: string | null
}

/** 按策略汇总 */
export interface GymEvalPolicySummary {
  policyId: GymEvalPolicyId
  runs: number
  successes: number
  /** 0~1；分母是该策略的全部运行（含失败） */
  successRate: number
  /** 平均步数只统计无错误的运行 */
  avgSteps: number
  /** 平均 reward 只统计无错误的运行 */
  avgReward: number
  /** 平均耗时只统计无错误的运行（毫秒） */
  avgLatencyMs: number
}

/** 一次批量评测的汇总 */
export interface GymEvalSummary {
  totalRuns: number
  successes: number
  /** 0~1；分母是全部运行（含失败） */
  successRate: number
  avgSteps: number
  avgReward: number
  avgLatencyMs: number
  byPolicy: GymEvalPolicySummary[]
}

/** 一次完整批量评测的留档 */
export interface GymEvalRun {
  id: string
  suiteId: string
  suiteName: string
  createdAt: string
  policies: GymEvalPolicyId[]
  results: GymEvalRunResult[]
  summary: GymEvalSummary
  wallClockMs: number
}

/** 运行进度（由 runner 回调写入） */
export interface GymEvalProgress {
  completed: number
  total: number
  currentTaskName: string
  currentPolicyId: GymEvalPolicyId | null
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const finiteOr = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, Math.round(value)))
}

const sanitizeName = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : fallback

const createGymId = (prefix: string): string => {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') {
    return `${prefix}-${cryptoApi.randomUUID()}`
  }
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const isPolicyId = (value: unknown): value is GymEvalPolicyId =>
  value === 'constant' || value === 'proportional'

const sanitizeTask = (raw: unknown): GymTask | null => {
  if (!isRecord(raw)) return null
  const scene = isRecord(raw.scene) ? raw.scene : null
  // 没有场景的任务跑不起来：整条丢弃，不在列表里留半条脏数据
  if (!scene) return null

  const targetRaw = isRecord(raw.target) ? raw.target : {}
  const params = isRecord(raw.params) ? raw.params : undefined
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createGymId('task')

  return {
    id,
    name: sanitizeName(raw.name, '未命名任务'),
    scene,
    target: {
      x: finiteOr(targetRaw.x, 0),
      z: finiteOr(targetRaw.z, 0),
    },
    maxSteps: clampInt(raw.maxSteps, 1, 10000, 300),
    ...(params ? { params } : {}),
  }
}

/** 任务列表收敛：坏任务丢弃，重复 id 重新生成（导入的文件可能带冲突 id） */
const sanitizeTaskList = (rawTasks: unknown[]): GymTask[] => {
  const seen = new Set<string>()
  const tasks: GymTask[] = []
  for (const raw of rawTasks) {
    const task = sanitizeTask(raw)
    if (!task) continue
    if (seen.has(task.id)) task.id = createGymId('task')
    seen.add(task.id)
    tasks.push(task)
  }
  return tasks
}

const sanitizeSuite = (raw: unknown): GymTaskSuite | null => {
  if (!isRecord(raw) || !Array.isArray(raw.tasks)) return null
  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createGymId('suite'),
    name: sanitizeName(raw.name, '未命名套件'),
    tasks: sanitizeTaskList(raw.tasks),
  }
}

const sanitizeResult = (raw: unknown): GymEvalRunResult | null => {
  if (!isRecord(raw) || !isPolicyId(raw.policyId)) return null
  const finalDistance =
    typeof raw.finalDistance === 'number' && Number.isFinite(raw.finalDistance)
      ? Math.max(0, raw.finalDistance)
      : null
  return {
    taskId: typeof raw.taskId === 'string' ? raw.taskId : '',
    taskName: sanitizeName(raw.taskName, '未命名任务'),
    policyId: raw.policyId,
    success: raw.success === true,
    steps: clampInt(raw.steps, 0, 1_000_000, 0),
    totalReward: finiteOr(raw.totalReward, 0),
    wallClockMs: Math.max(0, finiteOr(raw.wallClockMs, 0)),
    finalDistance,
    error: typeof raw.error === 'string' && raw.error ? raw.error : null,
  }
}

const sanitizeRun = (raw: unknown): GymEvalRun | null => {
  if (!isRecord(raw) || !Array.isArray(raw.results)) return null

  const results = raw.results
    .map(sanitizeResult)
    .filter((result): result is GymEvalRunResult => result !== null)
  const policies = Array.isArray(raw.policies)
    ? [...new Set(raw.policies.filter(isPolicyId))]
    : [...new Set(results.map((result) => result.policyId))]

  return {
    id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : createGymId('run'),
    suiteId: typeof raw.suiteId === 'string' ? raw.suiteId : '',
    suiteName: sanitizeName(raw.suiteName, '未命名套件'),
    createdAt:
      typeof raw.createdAt === 'string' && raw.createdAt.trim()
        ? raw.createdAt
        : new Date(0).toISOString(),
    policies,
    results,
    // 汇总按结果重算，不信任存储里可能已经过期的 summary
    summary: summarizeGymEvalResults(results, policies),
    wallClockMs: Math.max(0, finiteOr(raw.wallClockMs, 0)),
  }
}

export const useGymEvaluationStore = defineStore('gymEvaluation', () => {
  /** 任务套件（新→旧） */
  const suites = ref<GymTaskSuite[]>([])
  /** 当前选中的套件 id（空串 = 未选中） */
  const currentSuiteId = ref('')
  /** 批量评测运行留档（新→旧） */
  const runs = ref<GymEvalRun[]>([])
  /** 套件/结果存储或 CRUD 的可读错误 */
  const lastError = ref('')

  /** 批量评测进行中 */
  const running = ref(false)
  /** 当前进度 */
  const progress = ref<GymEvalProgress>({
    completed: 0,
    total: 0,
    currentTaskName: '',
    currentPolicyId: null,
  })
  /** 最近一次批量评测的明细 */
  const lastResults = ref<GymEvalRunResult[]>([])
  /** 最近一次批量评测的汇总 */
  const lastSummary = ref<GymEvalSummary | null>(null)
  /** 批量评测本身的失败原因（runner 抛出时） */
  const lastRunError = ref('')

  const currentSuite = computed<GymTaskSuite | null>(
    () => suites.value.find((suite) => suite.id === currentSuiteId.value) ?? null,
  )

  // ---- 存储读写 ----

  /** 从 localStorage 读套件；坏数据一律退回空数组 */
  const readSuites = (): GymTaskSuite[] => {
    lastError.value = ''

    let raw: string | null
    try {
      raw = localStorage.getItem(GYM_TASK_SUITES_KEY)
    } catch (error) {
      console.warn('[gymEvaluationStore] 读取任务套件失败', error)
      lastError.value = '任务套件读取失败：浏览器本地存储不可用'
      return []
    }
    if (!raw) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn('[gymEvaluationStore] 任务套件不是合法 JSON，已忽略', error)
      lastError.value = '任务套件数据已损坏，已忽略'
      return []
    }

    if (!Array.isArray(parsed)) {
      lastError.value = '任务套件格式不正确，已忽略'
      return []
    }

    return parsed
      .map(sanitizeSuite)
      .filter((suite): suite is GymTaskSuite => suite !== null)
      .slice(0, MAX_GYM_TASK_SUITES)
  }

  /** 写回套件；失败只记录可读错误，返回 false */
  const persistSuites = (list: GymTaskSuite[]): boolean => {
    try {
      localStorage.setItem(GYM_TASK_SUITES_KEY, JSON.stringify(list))
      lastError.value = ''
      return true
    } catch (error) {
      console.warn('[gymEvaluationStore] 写入任务套件失败', error)
      lastError.value = '任务套件写入失败：浏览器本地存储不可用或空间不足'
      return false
    }
  }

  /** 从 localStorage 读运行留档；坏数据一律退回空数组 */
  const readRuns = (): GymEvalRun[] => {
    lastError.value = ''

    let raw: string | null
    try {
      raw = localStorage.getItem(GYM_EVAL_RESULTS_KEY)
    } catch (error) {
      console.warn('[gymEvaluationStore] 读取评测结果失败', error)
      lastError.value = '评测结果读取失败：浏览器本地存储不可用'
      return []
    }
    if (!raw) return []

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch (error) {
      console.warn('[gymEvaluationStore] 评测结果不是合法 JSON，已忽略', error)
      lastError.value = '评测结果数据已损坏，已忽略'
      return []
    }

    if (!Array.isArray(parsed)) {
      lastError.value = '评测结果格式不正确，已忽略'
      return []
    }

    return parsed
      .map(sanitizeRun)
      .filter((run): run is GymEvalRun => run !== null)
      .slice(0, MAX_GYM_EVAL_RUNS)
  }

  /** 写回运行留档；失败只记录可读错误，返回 false */
  const persistRuns = (list: GymEvalRun[]): boolean => {
    try {
      localStorage.setItem(GYM_EVAL_RESULTS_KEY, JSON.stringify(list))
      lastError.value = ''
      return true
    } catch (error) {
      console.warn('[gymEvaluationStore] 写入评测结果失败', error)
      lastError.value = '评测结果写入失败：浏览器本地存储不可用或空间不足'
      return false
    }
  }

  // ---- 套件 CRUD ----

  /** 读套件并同步到响应式状态；当前 id 失效时自动落到第一套 */
  const listSuites = (): GymTaskSuite[] => {
    const list = readSuites()
    suites.value = list
    if (!list.some((suite) => suite.id === currentSuiteId.value)) {
      currentSuiteId.value = list[0]?.id ?? ''
    }
    return list
  }

  /** 选中一套；id 不存在时清空选择 */
  const selectSuite = (id: string): void => {
    const list = listSuites()
    currentSuiteId.value = list.some((suite) => suite.id === id) ? id : ''
  }

  /**
   * 新建套件。超过 20 套时拒绝（不丢用户已有资产），返回 null。
   * 成功后自动选中新套件。
   */
  const createSuite = (input: { name?: string; tasks?: GymTaskInput[] } = {}): GymTaskSuite | null => {
    const current = readSuites()
    if (current.length >= MAX_GYM_TASK_SUITES) {
      lastError.value = `最多保留 ${MAX_GYM_TASK_SUITES} 套任务套件，请先删除不用的套件`
      return null
    }

    const suite: GymTaskSuite = {
      id: createGymId('suite'),
      name: sanitizeName(input.name, '未命名套件'),
      tasks: sanitizeTaskList(input.tasks ?? []),
    }
    const next = [suite, ...current]
    if (!persistSuites(next)) return null

    suites.value = next
    currentSuiteId.value = suite.id
    return suite
  }

  /** 更新套件名称或任务列表；套件不存在返回 false */
  const updateSuite = (
    id: string,
    patch: { name?: string; tasks?: GymTaskInput[] },
  ): boolean => {
    const current = readSuites()
    const index = current.findIndex((suite) => suite.id === id)
    if (index < 0) {
      lastError.value = '任务套件不存在，可能已被删除'
      return false
    }

    const suite = current[index]
    const nextSuite: GymTaskSuite = {
      ...suite,
      ...(patch.name !== undefined ? { name: sanitizeName(patch.name, suite.name) } : {}),
      ...(patch.tasks !== undefined ? { tasks: sanitizeTaskList(patch.tasks) } : {}),
    }
    const next = [...current]
    next[index] = nextSuite
    if (!persistSuites(next)) return false

    suites.value = next
    return true
  }

  /** 删除一套；成功后的当前套件落到剩余第一套 */
  const deleteSuite = (id: string): boolean => {
    const current = readSuites()
    const next = current.filter((suite) => suite.id !== id)
    if (next.length === current.length) {
      suites.value = current
      return false
    }
    if (!persistSuites(next)) {
      suites.value = current
      return false
    }

    suites.value = next
    if (currentSuiteId.value === id) currentSuiteId.value = next[0]?.id ?? ''
    return true
  }

  /** 往套件里追加一个任务；场景缺失时返回 null */
  const addTask = (suiteId: string, input: GymTaskInput): GymTask | null => {
    const list = readSuites()
    const suite = list.find((item) => item.id === suiteId)
    if (!suite) {
      lastError.value = '任务套件不存在，可能已被删除'
      return null
    }

    const task = sanitizeTask({ ...input, id: input.id ?? createGymId('task') })
    if (!task) {
      lastError.value = '新增任务需要有效的场景文档'
      return null
    }
    if (suite.tasks.some((item) => item.id === task.id)) task.id = createGymId('task')

    if (!updateSuite(suiteId, { tasks: [...suite.tasks, task] })) return null
    return task
  }

  /** 用整条任务替换同 id 的任务；不存在或场景缺失返回 false */
  const updateTask = (suiteId: string, task: GymTask): boolean => {
    const list = readSuites()
    const suite = list.find((item) => item.id === suiteId)
    if (!suite) {
      lastError.value = '任务套件不存在，可能已被删除'
      return false
    }

    const cleaned = sanitizeTask(task)
    if (!cleaned) {
      lastError.value = '任务缺少有效的场景文档'
      return false
    }
    if (!suite.tasks.some((item) => item.id === cleaned.id)) {
      lastError.value = '任务不存在，可能已被删除'
      return false
    }

    return updateSuite(suiteId, {
      tasks: suite.tasks.map((item) => (item.id === cleaned.id ? cleaned : item)),
    })
  }

  /** 删除一个任务 */
  const removeTask = (suiteId: string, taskId: string): boolean => {
    const list = readSuites()
    const suite = list.find((item) => item.id === suiteId)
    if (!suite) {
      lastError.value = '任务套件不存在，可能已被删除'
      return false
    }

    const tasks = suite.tasks.filter((task) => task.id !== taskId)
    if (tasks.length === suite.tasks.length) return false
    return updateSuite(suiteId, { tasks })
  }

  // ---- 导入 / 导出 ----

  /**
   * 导入一套任务套件（已解析的 JSON 对象）。
   * 只接受 `{ name, tasks: [...] }` 形状；id 冲突时重新生成，不覆盖已有套件。
   */
  const importSuite = (raw: unknown): GymTaskSuite | null => {
    const suite = sanitizeSuite(raw)
    if (!suite) {
      lastError.value = '导入失败：需要包含 name 与 tasks 数组的套件对象'
      return null
    }

    const current = readSuites()
    if (current.length >= MAX_GYM_TASK_SUITES) {
      lastError.value = `最多保留 ${MAX_GYM_TASK_SUITES} 套任务套件，请先删除不用的套件`
      return null
    }

    const id = current.some((item) => item.id === suite.id) ? createGymId('suite') : suite.id
    const nextSuite: GymTaskSuite = { ...suite, id }
    const next = [nextSuite, ...current]
    if (!persistSuites(next)) return null

    suites.value = next
    currentSuiteId.value = id
    return nextSuite
  }

  /** 从 JSON 文本导入套件；语法错误给可读提示，不抛异常 */
  const importSuiteJson = (text: string): GymTaskSuite | null => {
    let parsed: unknown
    try {
      parsed = JSON.parse(text)
    } catch {
      lastError.value = '导入失败：不是合法 JSON'
      return null
    }
    return importSuite(parsed)
  }

  /** 导出一套套件为 JSON 文本；没有套件时返回 null */
  const exportSuite = (id: string): string | null => {
    const list = readSuites()
    suites.value = list
    const suite = list.find((item) => item.id === id)
    if (!suite) {
      lastError.value = '没有可导出的任务套件'
      return null
    }
    // 不导出内部 id：导入到另一台机器时不会与本地已有套件撞车
    return JSON.stringify({ name: suite.name, tasks: suite.tasks }, null, 2)
  }

  // ---- 运行留档 ----

  /** 读运行留档（新→旧）；内存里还没有结果时用最近一次留档恢复展示 */
  const listRuns = (): GymEvalRun[] => {
    const list = readRuns()
    runs.value = list
    if (lastResults.value.length === 0 && list.length > 0) {
      lastResults.value = list[0].results
      lastSummary.value = list[0].summary
    }
    return list
  }

  /** 记录一次完整运行；写失败返回 null（结果仍在 lastResults 里可见） */
  const recordRun = (input: {
    suite: GymTaskSuite
    policies: GymEvalPolicyId[]
    results: GymEvalRunResult[]
    wallClockMs: number
  }): GymEvalRun | null => {
    const results = input.results
      .map(sanitizeResult)
      .filter((result): result is GymEvalRunResult => result !== null)
    const policies = [...new Set(input.policies.filter(isPolicyId))]

    const run: GymEvalRun = {
      id: createGymId('run'),
      suiteId: input.suite.id,
      suiteName: sanitizeName(input.suite.name, '未命名套件'),
      createdAt: new Date().toISOString(),
      policies,
      results,
      summary: summarizeGymEvalResults(results, policies),
      wallClockMs: Math.max(0, finiteOr(input.wallClockMs, 0)),
    }

    const current = readRuns()
    const next = [run, ...current].slice(0, MAX_GYM_EVAL_RUNS)
    if (!persistRuns(next)) return null

    runs.value = next
    return run
  }

  /** 删除一条运行留档 */
  const removeRun = (id: string): boolean => {
    const current = readRuns()
    const next = current.filter((run) => run.id !== id)
    if (next.length === current.length) {
      runs.value = current
      return false
    }
    if (!persistRuns(next)) {
      runs.value = current
      return false
    }
    runs.value = next
    return true
  }

  /** 清空全部运行留档 */
  const clearRuns = (): boolean => {
    if (!persistRuns([])) return false
    runs.value = []
    return true
  }

  // ---- 运行状态 ----

  /** 开始一次批量评测：清掉上一次结果，进度归零 */
  const beginRun = (total: number): void => {
    running.value = true
    lastRunError.value = ''
    lastResults.value = []
    lastSummary.value = null
    progress.value = {
      completed: 0,
      total: Math.max(0, Math.round(total)),
      currentTaskName: '',
      currentPolicyId: null,
    }
  }

  /** runner 回调写入进度 */
  const updateProgress = (next: GymEvalProgress): void => {
    progress.value = { ...next }
  }

  /** 批量评测正常结束：落库并更新最近结果 */
  const finishRun = (input: {
    suite: GymTaskSuite
    policies: GymEvalPolicyId[]
    results: GymEvalRunResult[]
    wallClockMs: number
  }): GymEvalRun | null => {
    running.value = false
    const results = input.results
      .map(sanitizeResult)
      .filter((result): result is GymEvalRunResult => result !== null)
    lastResults.value = results
    lastSummary.value = summarizeGymEvalResults(results, input.policies)
    progress.value = {
      completed: results.length,
      total: results.length,
      currentTaskName: '',
      currentPolicyId: null,
    }
    return recordRun({ ...input, results })
  }

  /** 批量评测异常中止 */
  const failRun = (message: string): void => {
    running.value = false
    lastRunError.value = message
    progress.value = { ...progress.value, currentTaskName: '', currentPolicyId: null }
  }

  return {
    // 状态
    suites,
    currentSuiteId,
    currentSuite,
    runs,
    lastError,
    running,
    progress,
    lastResults,
    lastSummary,
    lastRunError,
    // 套件 CRUD
    listSuites,
    selectSuite,
    createSuite,
    updateSuite,
    deleteSuite,
    addTask,
    updateTask,
    removeTask,
    // 导入导出
    importSuite,
    importSuiteJson,
    exportSuite,
    // 运行留档
    listRuns,
    recordRun,
    removeRun,
    clearRuns,
    // 运行状态
    beginRun,
    updateProgress,
    finishRun,
    failRun,
  }
})
