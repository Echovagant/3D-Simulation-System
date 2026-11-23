// @vitest-environment jsdom
/**
 * 批量评测弹窗的冒烟网。
 *
 * 盯用户能看见的状态：空套件提示、离线时禁用运行、在线且有套件时按钮可用、
 * 任务编辑区能开关。评测执行细节由 evaluate.test.ts 锁住，这里不跑网络。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia, type Pinia } from 'pinia'
import BatchEvaluationDialog from './BatchEvaluationDialog.vue'
import { useGymEvaluationStore } from '@/stores/gymEvaluationStore'
import { summarizeGymEvalResults } from '@/services/gym/evaluate'
import type { GymEvalRunResult } from '@/stores/gymEvaluationStore'

const jsonResponse = (body: unknown, status = 200): Response =>
  ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    headers: new Headers(),
    json: async () => body,
    text: async () => JSON.stringify(body),
  }) as unknown as Response

const installOnlineFetch = (): ReturnType<typeof vi.fn> => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const path = new URL(String(input), 'http://localhost').pathname
    if (path === '/api/gym/sessions') return jsonResponse([])
    return jsonResponse(
      { error: { code: 'http_error', message: `意外路径 ${path}`, detail: null } },
      500,
    )
  })
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const seedSuite = (pinia: Pinia) => {
  setActivePinia(pinia)
  return useGymEvaluationStore().createSuite({
    name: '冒烟套件',
    tasks: [
      {
        name: '任务 1',
        scene: { objects: [{ uuid: 'agent-1', type: 'cube' }] },
        target: { x: 3, z: 0 },
        maxSteps: 120,
      },
    ],
  })
}

const mountDialog = (pinia: Pinia) =>
  mount(BatchEvaluationDialog, {
    global: { plugins: [pinia] },
  })

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('BatchEvaluationDialog', () => {
  it('没有套件：显示空态，不渲染运行按钮', async () => {
    installOnlineFetch()
    const pinia = createPinia()
    setActivePinia(pinia)

    const wrapper = mountDialog(pinia)
    await flushPromises()

    expect(wrapper.find('[aria-label="批量评测"]').exists()).toBe(true)
    expect(wrapper.find('.bev-run-btn').exists()).toBe(false)
    expect(wrapper.text()).toContain('左侧选一套套件')
    // 没有当前会话场景：新建套件按钮禁用
    expect(wrapper.find('.bev-new-suite-btn').attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('后端在线且有套件：运行按钮可用，运行次数按任务 × 策略算', async () => {
    installOnlineFetch()
    const pinia = createPinia()
    seedSuite(pinia)

    const wrapper = mountDialog(pinia)
    await flushPromises()

    const runButton = wrapper.find('.bev-run-btn')
    expect(runButton.exists()).toBe(true)
    expect(runButton.attributes('disabled')).toBeUndefined()
    // 1 个任务 × 默认勾选 2 个策略
    expect(wrapper.text()).toContain('2 次运行')
    expect(wrapper.text()).toContain('任务 1')

    wrapper.unmount()
  })

  it('后端不在：给出可读提示并禁用运行', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const pinia = createPinia()
    seedSuite(pinia)

    const wrapper = mountDialog(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('后端不在')
    expect(wrapper.find('.bev-run-btn').attributes('disabled')).toBeDefined()

    wrapper.unmount()
  })

  it('任务编辑区可以打开与取消', async () => {
    installOnlineFetch()
    const pinia = createPinia()
    seedSuite(pinia)

    const wrapper = mountDialog(pinia)
    await flushPromises()

    const editButton = wrapper
      .findAll('.bev-task-actions .bev-mini-btn')
      .find((button) => button.text() === '编辑')
    expect(editButton).toBeDefined()
    await editButton!.trigger('click')

    expect(wrapper.find('.bev-task-editor').exists()).toBe(true)

    const cancelButton = wrapper
      .findAll('.bev-task-editor .bev-mini-btn')
      .find((button) => button.text() === '取消')
    expect(cancelButton).toBeDefined()
    await cancelButton!.trigger('click')

    expect(wrapper.find('.bev-task-editor').exists()).toBe(false)

    wrapper.unmount()
  })

  it('有结果：渲染策略对比指标、Δ 与逐任务矩阵', async () => {
    installOnlineFetch()
    const pinia = createPinia()
    seedSuite(pinia)
    const evaluation = useGymEvaluationStore()
    const results: GymEvalRunResult[] = [
      {
        taskId: 'task-1',
        taskName: '任务 1',
        policyId: 'constant',
        success: true,
        steps: 12,
        totalReward: 2,
        wallClockMs: 100,
        finalDistance: 0.3,
        error: null,
      },
      {
        taskId: 'task-1',
        taskName: '任务 1',
        policyId: 'proportional',
        success: true,
        steps: 8,
        totalReward: 3,
        wallClockMs: 90,
        finalDistance: 0.2,
        error: null,
      },
    ]
    evaluation.lastResults = results
    evaluation.lastSummary = summarizeGymEvalResults(results, ['constant', 'proportional'])

    const wrapper = mountDialog(pinia)
    await flushPromises()

    expect(wrapper.text()).toContain('策略对比')
    expect(wrapper.text()).toContain('平均最终距离')
    expect(wrapper.text()).toContain('Δ')
    expect(wrapper.text()).toContain('逐任务对比')
    // 比例控制相对恒定推到基准的 Δ：步数 -4、成功率 ±0%
    expect(wrapper.text()).toContain('-4')
    expect(wrapper.find('.bev-matrix-table').exists()).toBe(true)

    wrapper.unmount()
  })
})
