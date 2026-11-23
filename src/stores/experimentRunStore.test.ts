// @vitest-environment jsdom
/**
 * 实验运行记录 store 的回归网。
 *
 * 盯的是「记录能不能留下、坏数据会不会把页面带崩、上限与增删是否守约」：
 * 运行记录是实验室从「演示页」变成「实验台」的地基，读坏数据必须安静退回空列表，
 * 写失败（隐私模式 / 配额满）也不能把异常抛给界面。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import {
  EXPERIMENT_RUNS_KEY,
  MAX_EXPERIMENT_RUNS,
  useExperimentRunStore,
  type ExperimentRunInput,
} from './experimentRunStore'
import type { SceneDocument } from '@/types'

/** 一条最小可用的运行记录输入 */
const makeInput = (overrides: Partial<ExperimentRunInput> = {}): ExperimentRunInput => ({
  name: '牛顿摆 · 第 1 次',
  source: { kind: 'preset', id: 'newtons-cradle', name: '牛顿摆' },
  config: { gravity: -9.8, friction: 0.1, restitution: 0.5, simulationSpeed: 1 },
  objectCount: 6,
  simulationTime: 12.5,
  recordedFrames: 125,
  ...overrides,
})

/** 一份最小场景文档（交接记录用） */
const buildDocument = (id: string): SceneDocument => ({
  id,
  name: '斜面上的球',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  objects: [
    {
      uuid: 'obj-1',
      type: 'sphere',
      name: '小球',
      position: { x: 0, y: 2, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      visible: true,
    },
  ],
})

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('实验运行记录 —— 写入与读取', () => {
  it('记录一条运行后能从 localStorage 读回完整字段', () => {
    const store = useExperimentRunStore()
    const document = buildDocument('doc-1')

    const run = store.recordRun(
      makeInput({
        source: { kind: 'handoff', id: 'doc-1', name: '斜面上的球' },
        document,
      }),
    )

    expect(run).not.toBeNull()
    expect(run?.id).toBeTruthy()
    expect(typeof run?.createdAt).toBe('string')

    const stored = JSON.parse(localStorage.getItem(EXPERIMENT_RUNS_KEY) as string)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      name: '牛顿摆 · 第 1 次',
      source: { kind: 'handoff', id: 'doc-1', name: '斜面上的球' },
      config: { gravity: -9.8, friction: 0.1, restitution: 0.5, simulationSpeed: 1 },
      objectCount: 6,
      simulationTime: 12.5,
      recordedFrames: 125,
    })
    expect(stored[0].document.id).toBe('doc-1')

    // 新实例重新读：列表与写入时一致
    setActivePinia(createPinia())
    const fresh = useExperimentRunStore()
    const list = fresh.listRuns()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe(run?.id)
    expect(list[0].document?.objects).toHaveLength(1)
  })

  it('新记录排在最前（新→旧）', () => {
    const store = useExperimentRunStore()
    store.recordRun(makeInput({ name: '第一次' }))
    store.recordRun(makeInput({ name: '第二次' }))

    const list = store.listRuns()
    expect(list.map((run) => run.name)).toEqual(['第二次', '第一次'])
  })

  it('没有记录时返回空数组，不报错', () => {
    const store = useExperimentRunStore()
    expect(store.listRuns()).toEqual([])
    expect(store.runs).toEqual([])
    expect(store.lastError).toBe('')
  })
})

describe('实验运行记录 —— 坏数据回退', () => {
  it('存的是坏 JSON 时返回空数组，并给出可读提示', () => {
    localStorage.setItem(EXPERIMENT_RUNS_KEY, '{ 这不是 JSON')

    const store = useExperimentRunStore()
    expect(store.listRuns()).toEqual([])
    expect(store.runs).toEqual([])
    expect(store.lastError).toContain('已损坏')
  })

  it('顶层不是数组时返回空数组', () => {
    localStorage.setItem(EXPERIMENT_RUNS_KEY, JSON.stringify({ runs: [] }))

    const store = useExperimentRunStore()
    expect(store.listRuns()).toEqual([])
    expect(store.lastError).toContain('格式不正确')
  })

  it('单条记录缺 id 或缺来源时被丢弃，合法记录保留', () => {
    localStorage.setItem(
      EXPERIMENT_RUNS_KEY,
      JSON.stringify([
        {
          id: 'run-ok',
          name: '好记录',
          createdAt: '2026-01-01T00:00:00.000Z',
          source: { kind: 'preset', id: 'p1', name: '预设一' },
          config: { gravity: -9.8, friction: 0.1, restitution: 0.5, simulationSpeed: 1 },
          objectCount: 2,
          simulationTime: 1,
          recordedFrames: 10,
        },
        { name: '缺 id', source: { kind: 'preset', id: 'p2', name: '预设二' } },
        { id: 'run-bad-source', source: { kind: 'unknown', id: 'x', name: '未知' } },
      ]),
    )

    const store = useExperimentRunStore()
    const list = store.listRuns()
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('run-ok')
  })

  it('字段类型不对时按默认值兜底，而不是整条崩掉', () => {
    localStorage.setItem(
      EXPERIMENT_RUNS_KEY,
      JSON.stringify([
        {
          id: 'run-1',
          name: 42,
          createdAt: null,
          source: { kind: 'scene', id: 's1', name: '场景一' },
          config: { gravity: 'x', friction: null, restitution: NaN, simulationSpeed: '' },
          objectCount: '很多',
          simulationTime: -5,
          recordedFrames: 3.7,
        },
      ]),
    )

    const store = useExperimentRunStore()
    const [run] = store.listRuns()
    expect(run.name).toBe('场景一')
    expect(run.config).toEqual({
      gravity: -9.8,
      friction: 0.1,
      restitution: 0.5,
      simulationSpeed: 1,
    })
    expect(run.objectCount).toBe(0)
    expect(run.simulationTime).toBe(0)
    expect(run.recordedFrames).toBe(4)
  })

  it('localStorage 读取直接抛错时返回空数组', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied')
    })

    const store = useExperimentRunStore()
    expect(store.listRuns()).toEqual([])
    expect(store.lastError).toContain('读取失败')
  })
})

describe('实验运行记录 —— 容量上限', () => {
  it(`最多保留 ${MAX_EXPERIMENT_RUNS} 条，超出后丢弃最旧的`, () => {
    const store = useExperimentRunStore()
    for (let i = 1; i <= MAX_EXPERIMENT_RUNS + 5; i++) {
      store.recordRun(makeInput({ name: `第 ${i} 次` }))
    }

    const list = store.listRuns()
    expect(list).toHaveLength(MAX_EXPERIMENT_RUNS)
    expect(list[0].name).toBe(`第 ${MAX_EXPERIMENT_RUNS + 5} 次`)
    expect(list[MAX_EXPERIMENT_RUNS - 1].name).toBe('第 6 次')

    const stored = JSON.parse(localStorage.getItem(EXPERIMENT_RUNS_KEY) as string)
    expect(stored).toHaveLength(MAX_EXPERIMENT_RUNS)
  })
})

describe('实验运行记录 —— 删除与清空', () => {
  it('按 id 删除一条，其余记录保持顺序', () => {
    const store = useExperimentRunStore()
    const first = store.recordRun(makeInput({ name: '第一条' }))
    const second = store.recordRun(makeInput({ name: '第二条' }))

    expect(store.removeRun(first?.id as string)).toBe(true)

    const list = store.listRuns()
    expect(list.map((run) => run.name)).toEqual(['第二条'])
    expect(list[0].id).toBe(second?.id)
  })

  it('删除不存在的 id 返回 false，列表不变', () => {
    const store = useExperimentRunStore()
    store.recordRun(makeInput({ name: '唯一一条' }))

    expect(store.removeRun('not-exist')).toBe(false)
    expect(store.listRuns()).toHaveLength(1)
  })

  it('清空后 storage 里是空数组', () => {
    const store = useExperimentRunStore()
    store.recordRun(makeInput())
    store.recordRun(makeInput())

    expect(store.clearRuns()).toBe(true)
    expect(store.listRuns()).toEqual([])
    expect(JSON.parse(localStorage.getItem(EXPERIMENT_RUNS_KEY) as string)).toEqual([])
  })
})

describe('实验运行记录 —— 写失败不抛给界面', () => {
  it('localStorage 写满时 recordRun 返回 null 并给出可读提示', () => {
    const store = useExperimentRunStore()
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(store.recordRun(makeInput())).toBeNull()
    expect(store.runs).toEqual([])
    expect(store.lastError).toContain('写入失败')
  })

  it('写失败时删除与清空返回 false，已有记录不被破坏', () => {
    const store = useExperimentRunStore()
    const run = store.recordRun(makeInput({ name: '保留我' }))

    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError')
    })

    expect(store.removeRun(run?.id as string)).toBe(false)
    expect(store.clearRuns()).toBe(false)
    expect(store.lastError).toContain('写入失败')

    vi.restoreAllMocks()
    const list = store.listRuns()
    expect(list.map((item) => item.name)).toEqual(['保留我'])
  })
})
