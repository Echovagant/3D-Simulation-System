// @vitest-environment jsdom
/**
 * 任务套件与评测留档 store 的回归网。
 *
 * 盯的是：套件 CRUD、20 套上限、坏数据回退、结果 50 条上限、写失败不抛。
 * 这些是「评测台能反复用」的地基——读坏数据不能把弹窗带崩，
 * 用户手写的套件也不能在超限时被悄悄挤掉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  GYM_EVAL_RESULTS_KEY,
  GYM_TASK_SUITES_KEY,
  MAX_GYM_EVAL_RUNS,
  MAX_GYM_TASK_SUITES,
  useGymEvaluationStore,
  type GymEvalRunResult,
  type GymTaskSuite,
} from './gymEvaluationStore'

const scene = (name = '演示场景'): Record<string, unknown> => ({
  name,
  objects: [{ uuid: 'agent-1', type: 'cube' }],
})

const makeTask = (overrides: Partial<GymTaskSuite['tasks'][number]> = {}) => ({
  id: 'task-1',
  name: '任务 1',
  scene: scene(),
  target: { x: 3, z: 0 },
  maxSteps: 300,
  ...overrides,
})

const makeResult = (overrides: Partial<GymEvalRunResult> = {}): GymEvalRunResult => ({
  taskId: 'task-1',
  taskName: '任务 1',
  policyId: 'constant',
  success: true,
  steps: 10,
  totalReward: 1.5,
  wallClockMs: 120,
  error: null,
  ...overrides,
})

const makeRunInput = (name = '留档套件') => ({
  suite: { id: 'suite-x', name, tasks: [makeTask()] },
  policies: ['constant' as const],
  results: [makeResult()],
  wallClockMs: 200,
})

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('任务套件 —— CRUD', () => {
  it('新建套件后持久化，并能重新读回', () => {
    const store = useGymEvaluationStore()
    const suite = store.createSuite({
      name: '回归套件',
      tasks: [{ name: '任务 1', scene: scene(), target: { x: 3, z: 0 }, maxSteps: 200 }],
    })

    expect(suite).not.toBeNull()
    expect(suite?.id).toBeTruthy()
    expect(store.currentSuiteId).toBe(suite?.id)

    const stored = JSON.parse(localStorage.getItem(GYM_TASK_SUITES_KEY) as string)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      name: '回归套件',
      tasks: [{ name: '任务 1', target: { x: 3, z: 0 }, maxSteps: 200 }],
    })
    expect(stored[0].tasks[0].id).toBeTruthy()

    // 新 Pinia 实例重新读：列表、当前套件都一致
    setActivePinia(createPinia())
    const fresh = useGymEvaluationStore()
    const list = fresh.listSuites()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(suite?.id)
    expect(fresh.currentSuiteId).toBe(suite?.id)
  })

  it('更新套件名称与任务列表', () => {
    const store = useGymEvaluationStore()
    const suite = store.createSuite({ name: '旧名字' })

    const ok = store.updateSuite(suite?.id as string, {
      name: '新名字',
      tasks: [makeTask({ name: '改过的任务' })],
    })

    expect(ok).toBe(true)
    expect(store.currentSuite?.name).toBe('新名字')
    expect(store.currentSuite?.tasks).toHaveLength(1)
    expect(store.currentSuite?.tasks[0].name).toBe('改过的任务')
  })

  it('任务增删改：新增、替换、删除都落到存储', () => {
    const store = useGymEvaluationStore()
    const suite = store.createSuite({ name: '任务 CRUD' })
    const suiteId = suite?.id as string

    const added = store.addTask(suiteId, {
      name: '新任务',
      scene: scene('新场景'),
      target: { x: 5, z: 0 },
      maxSteps: 100,
    })
    expect(added).not.toBeNull()
    expect(store.currentSuite?.tasks).toHaveLength(1)

    const edited = { ...(added as NonNullable<typeof added>), name: '改名任务', target: { x: 8, z: 1 } }
    expect(store.updateTask(suiteId, edited)).toBe(true)
    expect(store.currentSuite?.tasks[0].name).toBe('改名任务')

    expect(store.removeTask(suiteId, added?.id as string)).toBe(true)
    expect(store.currentSuite?.tasks).toHaveLength(0)
  })

  it('删除当前套件后，当前选中落到剩余第一套', () => {
    const store = useGymEvaluationStore()
    const first = store.createSuite({ name: '第一套' })
    const second = store.createSuite({ name: '第二套' })
    expect(store.currentSuiteId).toBe(second?.id)

    expect(store.deleteSuite(second?.id as string)).toBe(true)
    expect(store.currentSuiteId).toBe(first?.id)
    expect(store.listSuites()).toHaveLength(1)
  })

  it('选中不存在的 id 时清空选择', () => {
    const store = useGymEvaluationStore()
    store.createSuite({ name: '唯一一套' })
    store.selectSuite('not-exist')
    expect(store.currentSuiteId).toBe('')
  })
})

describe('任务套件 —— 导入导出', () => {
  it('导出的 JSON 能原样再导入，id 冲突时生成新 id', () => {
    const store = useGymEvaluationStore()
    const suite = store.createSuite({
      name: '可导出套件',
      tasks: [makeTask()],
    })

    const text = store.exportSuite(suite?.id as string)
    expect(text).toBeTruthy()
    const parsed = JSON.parse(text as string) as { name: string; tasks: unknown[] }
    expect(parsed.name).toBe('可导出套件')
    expect(parsed.tasks).toHaveLength(1)

    const imported = store.importSuiteJson(text as string)
    expect(imported).not.toBeNull()
    expect(imported?.id).not.toBe(suite?.id)
    expect(store.listSuites()).toHaveLength(2)
  })

  it('导入缺 tasks 的对象时失败并给出可读提示', () => {
    const store = useGymEvaluationStore()
    expect(store.importSuite({ name: '没有任务' })).toBeNull()
    expect(store.lastError).toContain('导入失败')
  })

  it('导入非法 JSON 时失败并给出可读提示', () => {
    const store = useGymEvaluationStore()
    expect(store.importSuiteJson('{ 不是 JSON')).toBeNull()
    expect(store.lastError).toContain('不是合法 JSON')
  })
})

describe('任务套件 —— 容量上限', () => {
  it(`最多保留 ${MAX_GYM_TASK_SUITES} 套，超限拒绝新增且不丢已有套件`, () => {
    const store = useGymEvaluationStore()
    for (let index = 1; index <= MAX_GYM_TASK_SUITES; index++) {
      expect(store.createSuite({ name: `套件 ${index}` })).not.toBeNull()
    }

    const overflow = store.createSuite({ name: '第二十一套' })
    expect(overflow).toBeNull()
    expect(store.lastError).toContain(`${MAX_GYM_TASK_SUITES}`)
    expect(store.listSuites()).toHaveLength(MAX_GYM_TASK_SUITES)

    const stored = JSON.parse(localStorage.getItem(GYM_TASK_SUITES_KEY) as string)
    expect(stored).toHaveLength(MAX_GYM_TASK_SUITES)
  })
})

describe('任务套件 —— 坏数据回退', () => {
  it('坏 JSON 返回空数组并给出可读提示', () => {
    localStorage.setItem(GYM_TASK_SUITES_KEY, '{ 这不是 JSON')

    const store = useGymEvaluationStore()
    expect(store.listSuites()).toEqual([])
    expect(store.lastError).toContain('已损坏')
  })

  it('顶层不是数组时返回空数组', () => {
    localStorage.setItem(GYM_TASK_SUITES_KEY, JSON.stringify({ suites: [] }))

    const store = useGymEvaluationStore()
    expect(store.listSuites()).toEqual([])
    expect(store.lastError).toContain('格式不正确')
  })

  it('缺场景的任务被丢弃，合法任务保留', () => {
    localStorage.setItem(
      GYM_TASK_SUITES_KEY,
      JSON.stringify([
        {
          id: 'suite-ok',
          name: '可用套件',
          tasks: [
            { id: 'tool-1', name: '坏任务', target: { x: 1, z: 1 }, maxSteps: 10 },
            { id: 'tool-2', name: '好任务', scene: { objects: [] }, maxSteps: 20 },
          ],
        },
      ]),
    )

    const store = useGymEvaluationStore()
    const [suite] = store.listSuites()
    expect(suite.id).toBe('suite-ok')
    expect(suite.tasks).toHaveLength(1)
    expect(suite.tasks[0].name).toBe('好任务')
    expect(suite.tasks[0].maxSteps).toBe(20)
  })

  it('字段类型不对时按默认值兜底', () => {
    localStorage.setItem(
      GYM_TASK_SUITES_KEY,
      JSON.stringify([
        {
          id: 'suite-1',
          name: 42,
          tasks: [
            {
              id: 'task-1',
              name: null,
              scene: { objects: [] },
              target: { x: '远', z: null },
              maxSteps: '很多',
            },
          ],
        },
      ]),
    )

    const store = useGymEvaluationStore()
    const [suite] = store.listSuites()
    expect(suite.name).toBe('未命名套件')
    expect(suite.tasks[0].name).toBe('未命名任务')
    expect(suite.tasks[0].target).toEqual({ x: 0, z: 0 })
    expect(suite.tasks[0].maxSteps).toBe(300)
  })

  it('localStorage 读取抛错时返回空数组', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })

    const store = useGymEvaluationStore()
    expect(store.listSuites()).toEqual([])
    expect(store.lastError).toContain('读取失败')
  })
})

describe('评测留档 —— 上限与坏数据', () => {
  it(`最多保留 ${MAX_GYM_EVAL_RUNS} 次运行，超出后丢弃最旧的`, () => {
    const store = useGymEvaluationStore()
    for (let index = 1; index <= MAX_GYM_EVAL_RUNS + 3; index++) {
      store.recordRun(makeRunInput(`第 ${index} 次`))
    }

    const list = store.listRuns()
    expect(list).toHaveLength(MAX_GYM_EVAL_RUNS)
    expect(list[0].suiteName).toBe(`第 ${MAX_GYM_EVAL_RUNS + 3} 次`)
    expect(list[MAX_GYM_EVAL_RUNS - 1].suiteName).toBe('第 4 次')
  })

  it('结果里的非法策略被丢弃，汇总按合法结果重算', () => {
    localStorage.setItem(
      GYM_EVAL_RESULTS_KEY,
      JSON.stringify([
        {
          id: 'run-1',
          suiteId: 'suite-1',
          suiteName: '套件',
          createdAt: '2026-01-01T00:00:00.000Z',
          policies: ['constant', 'llm'],
          results: [
            makeResult({ policyId: 'constant', success: true }),
            { ...makeResult(), policyId: 'llm' },
          ],
          summary: { totalRuns: 99 },
          wallClockMs: 100,
        },
      ]),
    )

    const store = useGymEvaluationStore()
    const [run] = store.listRuns()
    expect(run.results).toHaveLength(1)
    expect(run.policies).toEqual(['constant'])
    expect(run.summary.totalRuns).toBe(1)
    expect(run.summary.successRate).toBe(1)
  })

  it('坏 JSON 与顶层非数组都退回空数组', () => {
    localStorage.setItem(GYM_EVAL_RESULTS_KEY, '{ bad')
    let store = useGymEvaluationStore()
    expect(store.listRuns()).toEqual([])
    expect(store.lastError).toContain('已损坏')

    setActivePinia(createPinia())
    localStorage.setItem(GYM_EVAL_RESULTS_KEY, JSON.stringify({ runs: [] }))
    store = useGymEvaluationStore()
    expect(store.listRuns()).toEqual([])
    expect(store.lastError).toContain('格式不正确')
  })

  it('重开弹窗时用最近一次留档恢复 lastResults', () => {
    const store = useGymEvaluationStore()
    store.recordRun(makeRunInput('最近一次'))

    setActivePinia(createPinia())
    const fresh = useGymEvaluationStore()
    fresh.listRuns()

    expect(fresh.lastResults).toHaveLength(1)
    expect(fresh.lastSummary?.totalRuns).toBe(1)
  })
})

describe('写失败不抛给界面', () => {
  it('localStorage 写满时新建套件返回 null 并给出可读提示', () => {
    const store = useGymEvaluationStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(store.createSuite({ name: '写不进去' })).toBeNull()
    expect(store.suites).toEqual([])
    expect(store.lastError).toContain('写入失败')
  })

  it('finishRun 保留 finalDistance（界面策略对比要用）', () => {
    const store = useGymEvaluationStore()
    store.finishRun({
      ...makeRunInput('带距离'),
      results: [makeResult({ finalDistance: 0.42 })],
    })

    expect(store.lastResults[0].finalDistance).toBe(0.42)
    // 留档里也要在：重开页面后策略对比仍能读到距离
    const stored = JSON.parse(localStorage.getItem(GYM_EVAL_RESULTS_KEY) as string)
    expect(stored[0].results[0].finalDistance).toBe(0.42)
  })

  it('写失败时记录运行返回 null，但 lastResults 已经更新', () => {
    const store = useGymEvaluationStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    const run = store.finishRun(makeRunInput('写不进去'))
    expect(run).toBeNull()
    expect(store.lastResults).toHaveLength(1)
    expect(store.lastSummary?.totalRuns).toBe(1)
    expect(store.lastError).toContain('写入失败')
  })
})
