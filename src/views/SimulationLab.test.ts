// @vitest-environment jsdom
/**
 * 仿真实验室页面的回归网。
 *
 * 盯的是**用户能看见的行为**：实验配置的存取、从场景编辑器加载场景的失败路径、
 * 数据导出的 JSON 形状、预设切换与仿真控制。
 *
 * ⚠️ jsdom 里没有 WebGL 上下文，渲染器被替身掉；渲染循环的帧由用例手动推进，
 * 帧时间走可控时钟——否则 FPS 与采样间隔都会变成随机数，断言没法锁住。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import { nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { useModelStore } from '@/stores/modelStore'
import SimulationLab from './SimulationLab.vue'

const telemetryMock = vi.hoisted(() => ({ reportError: vi.fn() }))

// 遥测只往队列里塞东西，测试里换成可断言的桩：既不碰网络，也能确认错误被上报了
vi.mock('@/services/api/telemetry', () => ({
  reportError: telemetryMock.reportError,
}))

// 路由只需要 params / query：深链接走的是 props，这里不涉及真实路由表。
// 交接场景的用例要能改 query，所以用一份可复位的可变对象。
const routeMock = vi.hoisted(() => ({
  params: {} as Record<string, string>,
  query: {} as Record<string, string>,
  path: '/simulation-lab',
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeMock,
}))

vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>()

  class FakeWebGLRenderer {
    domElement: HTMLCanvasElement = document.createElement('canvas')
    setSize() {}
    setPixelRatio() {}
    render() {}
    dispose() {}
  }

  return {
    ...actual,
    WebGLRenderer: FakeWebGLRenderer as unknown as typeof actual.WebGLRenderer,
  }
})

/** 实验配置在 localStorage 里的键名 */
const CONFIG_KEY = 'experimentConfig'

/** 单帧时长：60fps */
const FRAME_MS = 1000 / 60

const createObjectURLMock = vi.fn<(blob: Blob | MediaSource) => string>(() => 'blob:mock-url')
const revokeObjectURLMock = vi.fn<(url: string) => void>(() => {})

const urlStub = URL as unknown as {
  createObjectURL: (blob: Blob | MediaSource) => string
  revokeObjectURL: (url: string) => void
}

let wrappers: VueWrapper[] = []
/** 待执行的渲染帧——由用例决定何时推进 */
let frameCallbacks = new Map<number, FrameRequestCallback>()
let nextFrameId = 1
/** 可控时钟：渲染循环用 performance.now() 算帧间隔与 FPS */
let clockMs = 1000
let warnSpy: ReturnType<typeof vi.spyOn>

/** 让挂起的事件循环跑一会儿（物理初始化是异步的） */
const settle = () => new Promise((resolve) => setTimeout(resolve, 30))

/** 轮询等待条件成立；组件里的物理初始化走的是异步链，断言必须等它落定 */
const waitUntil = async (predicate: () => boolean, timeoutMs = 10000) => {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('等待条件超时')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

/** 手动推进 n 帧 */
const advanceFrames = async (count: number) => {
  for (let i = 0; i < count; i++) {
    const pending = [...frameCallbacks.values()]
    frameCallbacks.clear()
    clockMs += FRAME_MS
    pending.forEach((cb) => cb(clockMs))
    await nextTick()
  }
}

const viewportInfo = (wrapper: VueWrapper): string => {
  const info = wrapper.find('.viewport-info')
  return info.exists() ? info.text() : ''
}

/** 视口左上角的物体数量 */
const readObjectCount = (wrapper: VueWrapper): number => {
  const match = /物体数量:\s*(\d+)/.exec(viewportInfo(wrapper))
  return match ? Number(match[1]) : -1
}

/** 状态面板里某一项的取值（按标签匹配，例如「仿真时间」） */
const readStatusValue = (wrapper: VueWrapper, label: string): string => {
  const item = wrapper.findAll('.status-item').find((entry) => entry.text().includes(label))
  const value = item?.find('.value')
  return value?.exists() ? value.text() : ''
}

/** 数值输入框（重力 / 摩擦力 / 弹性系数 / 采样间隔） */
const numberInputs = (wrapper: VueWrapper) =>
  wrapper.findAll('.parameter-item input[type="number"]')

/** 改一个数值输入框：先触发 input 让 v-model 生效，再触发 change 跑面板回调 */
const setNumberInput = async (wrapper: VueWrapper, index: number, value: string) => {
  const input = numberInputs(wrapper)[index]
  if (!input) throw new Error(`找不到第 ${index} 个数值输入框`)
  ;(input.element as HTMLInputElement).value = value
  await input.trigger('input')
  await input.trigger('change')
  await nextTick()
}

/** 勾选/取消「记录仿真数据」 */
const setRecordData = async (wrapper: VueWrapper, checked: boolean) => {
  const checkbox = wrapper.find('input[type="checkbox"]')
  ;(checkbox.element as HTMLInputElement).checked = checked
  await checkbox.trigger('change')
  await nextTick()
}

/** 调整仿真速度滑块 */
const setSimulationSpeed = async (wrapper: VueWrapper, value: string) => {
  const slider = wrapper.find('.speed-control input')
  ;(slider.element as HTMLInputElement).value = value
  await slider.trigger('input')
  await slider.trigger('change')
  await nextTick()
}

/** 挂载仿真实验室并等到演示场景就绪 */
const mountLab = async (): Promise<VueWrapper> => {
  setActivePinia(createPinia())
  const wrapper = mount(SimulationLab)
  wrappers.push(wrapper)
  await waitUntil(() => readObjectCount(wrapper) === 2)
  // onMounted 里还有一次物理世界重建，等它跑完再动手
  await settle()
  return wrapper
}

const unmountLab = (wrapper: VueWrapper) => {
  const index = wrappers.indexOf(wrapper)
  if (index >= 0) wrappers.splice(index, 1)
  wrapper.unmount()
}

/** 捕获导出时点击的下载链接（jsdom 不会真的下载） */
const captureDownloads = async (action: () => Promise<void>): Promise<HTMLAnchorElement[]> => {
  const anchors: HTMLAnchorElement[] = []
  const proto = HTMLAnchorElement.prototype
  const hadOwn = Object.prototype.hasOwnProperty.call(proto, 'click')
  const original = proto.click
  proto.click = function (this: HTMLElement) {
    anchors.push(this as HTMLAnchorElement)
  }
  try {
    await action()
  } finally {
    if (hadOwn) {
      proto.click = original
    } else {
      delete (proto as unknown as Record<string, unknown>).click
    }
  }
  return anchors
}

/** 往 localStorage 里写一个「场景编辑器保存过的场景」 */
const seedSavedScene = (id: string, name: string, objects: unknown[]) => {
  localStorage.setItem(
    'scene-index',
    JSON.stringify([
      { id, name, createdAt: '2024-01-01T00:00:00.000Z', objectCount: objects.length },
    ]),
  )
  localStorage.setItem(
    `scene-${id}`,
    JSON.stringify({
      id,
      name,
      createdAt: '2024-01-01T00:00:00.000Z',
      updatedAt: '2024-01-01T00:00:00.000Z',
      version: 1,
      objects,
    }),
  )
}

/** 往 sessionStorage 里写一份场景编辑器的交接场景（「送到实验室」的产物） */
const seedHandoff = (document: unknown) => {
  sessionStorage.setItem(
    'lab-handoff-scene',
    JSON.stringify({ document, source: 'scene-editor', at: Date.now() }),
  )
}

/** 挂载并等到指定物体数量的场景就绪（交接场景会替换掉演示场景） */
const mountLabExpecting = async (expected: number): Promise<VueWrapper> => {
  setActivePinia(createPinia())
  const wrapper = mount(SimulationLab)
  wrappers.push(wrapper)
  await waitUntil(() => readObjectCount(wrapper) === expected)
  await settle()
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  sessionStorage.clear()
  routeMock.params = {}
  routeMock.query = {}
  routeMock.path = '/simulation-lab'
  wrappers = []
  frameCallbacks = new Map()
  nextFrameId = 1
  clockMs = 1000
  telemetryMock.reportError.mockClear()
  createObjectURLMock.mockClear()
  revokeObjectURLMock.mockClear()
  urlStub.createObjectURL = createObjectURLMock
  urlStub.revokeObjectURL = revokeObjectURLMock

  // 渲染循环不自己跑：由用例决定何时推进帧，物理推进才可复现
  vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
    const id = nextFrameId++
    frameCallbacks.set(id, cb)
    return id
  })
  vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id: number) => {
    frameCallbacks.delete(id)
  })
  vi.spyOn(performance, 'now').mockImplementation(() => clockMs)
  warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  while (wrappers.length) {
    wrappers.pop()?.unmount()
  }
  delete (URL as unknown as Record<string, unknown>).createObjectURL
  delete (URL as unknown as Record<string, unknown>).revokeObjectURL
  vi.restoreAllMocks()
})

describe('仿真实验室 —— 实验配置的存取', () => {
  it('保存实验配置会把当前参数完整写进 localStorage', async () => {
    const wrapper = await mountLab()

    await setNumberInput(wrapper, 0, '-3.5')
    await setNumberInput(wrapper, 1, '0.42')
    await setNumberInput(wrapper, 2, '0.8')
    await setSimulationSpeed(wrapper, '2.5')
    await setRecordData(wrapper, true)
    await setNumberInput(wrapper, 3, '0.25')

    await wrapper.find('button[title="保存实验配置"]').trigger('click')
    await nextTick()

    const raw = localStorage.getItem(CONFIG_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw as string)).toEqual({
      gravity: -3.5,
      friction: 0.42,
      restitution: 0.8,
      simulationSpeed: 2.5,
      recordData: true,
      samplingInterval: 0.25,
    })
    expect(wrapper.find('.message-toast').text()).toBe('实验配置已保存')
  })

  it('重新进入页面时回填上次保存的实验配置', async () => {
    const first = await mountLab()
    await setNumberInput(first, 0, '-3.5')
    await setSimulationSpeed(first, '2.5')
    await setRecordData(first, true)
    await first.find('button[title="保存实验配置"]').trigger('click')
    await nextTick()
    unmountLab(first)

    const second = await mountLab()

    expect((numberInputs(second)[0].element as HTMLInputElement).value).toBe('-3.5')
    expect((second.find('.speed-control input').element as HTMLInputElement).value).toBe('2.5')
    expect((second.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(true)
  })

  it('实验配置是坏 JSON 时保持默认值，不让页面崩', async () => {
    localStorage.setItem(CONFIG_KEY, '{ 这不是 JSON')

    const wrapper = await mountLab()

    // 页面照常起来：演示场景在、参数是默认值
    expect(readObjectCount(wrapper)).toBe(2)
    expect((numberInputs(wrapper)[0].element as HTMLInputElement).value).toBe('-9.8')
    expect((wrapper.find('.speed-control input').element as HTMLInputElement).value).toBe('1')
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('实验配置解析失败'),
      expect.anything(),
    )
  })

  it('实验配置字段类型不对时按默认值兜底', async () => {
    localStorage.setItem(
      CONFIG_KEY,
      JSON.stringify({
        gravity: '不是数字',
        friction: null,
        simulationSpeed: null,
        recordData: 'yes',
        samplingInterval: null,
      }),
    )

    const wrapper = await mountLab()

    expect((numberInputs(wrapper)[0].element as HTMLInputElement).value).toBe('-9.8')
    expect((numberInputs(wrapper)[1].element as HTMLInputElement).value).toBe('0.1')
    expect((numberInputs(wrapper)[2].element as HTMLInputElement).value).toBe('0.5')
    expect((wrapper.find('.speed-control input').element as HTMLInputElement).value).toBe('1')
    expect((wrapper.find('input[type="checkbox"]').element as HTMLInputElement).checked).toBe(false)
  })
})

describe('仿真实验室 —— 从场景编辑器加载场景', () => {
  it('场景加载失败时给出失败提示，并把错误上报而不是抛出去', async () => {
    seedSavedScene('sc-1', '坏场景', [
      {
        uuid: 'o1',
        type: 'model',
        modelId: 'model-missing',
        name: '坏模型',
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
      },
    ])

    const wrapper = await mountLab()

    const loadModelById = vi
      .spyOn(useModelStore(), 'loadModelById')
      .mockRejectedValue(new Error('模型文件读不出来'))

    const rejections: unknown[] = []
    const onUnhandled = (event: PromiseRejectionEvent) => rejections.push(event.reason)
    window.addEventListener('unhandledrejection', onUnhandled)

    await wrapper.find('button[title="从场景编辑器加载场景"]').trigger('click')
    await waitUntil(() => wrapper.find('.message-toast').exists())
    await settle()

    window.removeEventListener('unhandledrejection', onUnhandled)

    expect(wrapper.find('.message-toast').text()).toBe('加载场景失败')
    expect(loadModelById).toHaveBeenCalledWith('model-missing')
    expect(telemetryMock.reportError).toHaveBeenCalledWith(expect.any(Error), '/simulation-lab')
    expect(rejections).toEqual([])
  })

  it('场景文档字段缺失时提示加载失败，页面不崩', async () => {
    // 缺 scale：老版本存的文档可能没有这个字段
    seedSavedScene('sc-2', '缺字段', [
      {
        uuid: 'o1',
        type: 'cube',
        name: '缺缩放',
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        visible: true,
      },
    ])

    const wrapper = await mountLab()

    await wrapper.find('button[title="从场景编辑器加载场景"]').trigger('click')
    await waitUntil(() => wrapper.find('.message-toast').exists())

    expect(wrapper.find('.message-toast').text()).toBe('加载场景失败')
    expect(telemetryMock.reportError).toHaveBeenCalled()
  })

  it('没有已保存场景时「从编辑器加载」按钮是禁用的', async () => {
    const wrapper = await mountLab()

    const button = wrapper.find('button[title="从场景编辑器加载场景"]')
    expect(button.attributes('disabled')).toBeDefined()
  })
})

describe('仿真实验室 —— 数据导出', () => {
  it('导出的 JSON 是可解析的采样记录，并触发一次下载', async () => {
    const wrapper = await mountLab()

    await setRecordData(wrapper, true)
    await wrapper.find('button[title="开始仿真"]').trigger('click')
    await nextTick()

    // 推进若干帧，让采样间隔（0.1s）到点
    await advanceFrames(10)

    const exportButton = wrapper.find('button.export-btn')
    expect(exportButton.exists()).toBe(true)

    const anchors = await captureDownloads(async () => {
      await exportButton.trigger('click')
      await nextTick()
    })

    expect(anchors).toHaveLength(1)
    expect(anchors[0].download).toMatch(/^simulation-data-\d+\.json$/)
    expect(revokeObjectURLMock).toHaveBeenCalledWith('blob:mock-url')

    const blob = createObjectURLMock.mock.calls[0][0] as Blob
    const parsed = JSON.parse(await blob.text())

    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBeGreaterThan(0)

    const frame = parsed[0]
    expect(typeof frame.time).toBe('number')
    expect(frame.time).toBeGreaterThan(0)
    expect(Array.isArray(frame.objects)).toBe(true)
    // 按 UTF-16 码元排序：球(U+7403) 在 立(U+7ACB) 之前
    expect(frame.objects.map((object: { name: string }) => object.name).sort()).toEqual([
      '演示球体',
      '演示立方体',
    ])
    for (const object of frame.objects) {
      expect(typeof object.position.x).toBe('number')
      expect(typeof object.position.y).toBe('number')
      expect(typeof object.position.z).toBe('number')
    }
  })

  it('没有采样数据时不显示导出按钮', async () => {
    const wrapper = await mountLab()

    expect(wrapper.find('button.export-btn').exists()).toBe(false)
  })
})

describe('仿真实验室 —— 仿真控制', () => {
  it('单步仿真把仿真时间推进一个固定步长', async () => {
    const wrapper = await mountLab()
    expect(readStatusValue(wrapper, '仿真时间')).toBe('0.00s')

    await wrapper.find('button[title="单步仿真"]').trigger('click')
    await nextTick()

    // 固定步长 1/60s
    expect(readStatusValue(wrapper, '仿真时间')).toBe('0.02s')
  })

  it('播放与暂停会切换仿真状态', async () => {
    const wrapper = await mountLab()
    expect(readStatusValue(wrapper, '仿真状态')).toBe('已暂停')

    await wrapper.find('button[title="开始仿真"]').trigger('click')
    await nextTick()
    expect(readStatusValue(wrapper, '仿真状态')).toBe('运行中')

    await wrapper.find('button[title="暂停仿真"]').trigger('click')
    await nextTick()
    expect(readStatusValue(wrapper, '仿真状态')).toBe('已暂停')
  })

  it('调整仿真速度会更新显示并给出提示', async () => {
    const wrapper = await mountLab()

    await setSimulationSpeed(wrapper, '2.5')

    expect(wrapper.find('.speed-control span').text()).toBe('2.5x')
    expect(wrapper.find('.message-toast').text()).toBe('仿真速度已设置为 2.5x')
  })

  it('切换预设会用预设里的物体替换演示场景', async () => {
    const wrapper = await mountLab()
    expect(readObjectCount(wrapper)).toBe(2)

    const presetSelect = wrapper.findAll('.preset-selector select')[0]
    ;(presetSelect.element as HTMLSelectElement).value = 'newtons-cradle'
    await presetSelect.trigger('change')

    await waitUntil(() => readObjectCount(wrapper) === 6)

    expect(readObjectCount(wrapper)).toBe(6)
    expect(wrapper.find('.message-toast').text()).toBe('已加载预设: 牛顿摆')
  })

  it('重置仿真会清零仿真时间并重建演示场景', async () => {
    const wrapper = await mountLab()

    await wrapper.find('button[title="单步仿真"]').trigger('click')
    await nextTick()
    expect(readStatusValue(wrapper, '仿真时间')).toBe('0.02s')

    await wrapper.find('button[title="重置仿真"]').trigger('click')
    await waitUntil(
      () => readStatusValue(wrapper, '仿真时间') === '0.00s' && readObjectCount(wrapper) === 2,
    )

    expect(readStatusValue(wrapper, '仿真时间')).toBe('0.00s')
    expect(readObjectCount(wrapper)).toBe(2)
  })

  it('FPS 在采样窗口攒满前保持 0，攒满后显示平均帧率', async () => {
    const wrapper = await mountLab()
    expect(readStatusValue(wrapper, 'FPS')).toBe('0')

    await advanceFrames(10)
    expect(readStatusValue(wrapper, 'FPS')).toBe('0')

    await advanceFrames(20)
    expect(readStatusValue(wrapper, 'FPS')).toBe('60')
  })
})

describe('仿真实验室 —— 接收场景编辑器的交接场景', () => {
  const handoffDocument = {
    id: 'handoff-1',
    name: '编辑器场景',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    version: 1,
    objects: [
      {
        uuid: 'h1',
        type: 'cube',
        name: '方块',
        position: { x: 0, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        visible: true,
      },
    ],
  }

  it('收到交接场景后加载它、给出场景名与物体数，并删除 sessionStorage key', async () => {
    seedHandoff(handoffDocument)

    const wrapper = await mountLabExpecting(1)

    expect(readObjectCount(wrapper)).toBe(1)
    expect(wrapper.find('.message-toast').text()).toBe(
      '已接收编辑器场景：编辑器场景（1 个物体）',
    )
    expect(sessionStorage.getItem('lab-handoff-scene')).toBeNull()
  })

  it('交接数据不是合法 JSON 时给出提示，key 保留', async () => {
    sessionStorage.setItem('lab-handoff-scene', '{ 坏数据')

    const wrapper = await mountLab()

    await waitUntil(() =>
      wrapper.find('.message-toast').text().includes('编辑器交接场景解析失败'),
    )
    expect(sessionStorage.getItem('lab-handoff-scene')).toBe('{ 坏数据')
  })

  it('交接场景校验失败时给出具体原因，不静默', async () => {
    seedHandoff({
      ...handoffDocument,
      objects: [{ uuid: 'h1', type: 'banana', position: { x: 0, y: 1, z: 0 } }],
    })

    const wrapper = await mountLab()

    await waitUntil(() => wrapper.find('.message-toast').text().includes('校验失败'))
    expect(wrapper.find('.message-toast').text()).toContain('类型不支持')
    expect(sessionStorage.getItem('lab-handoff-scene')).not.toBeNull()
  })

  it('带 ?from=editor 进来但没有交接数据时给出重送指引', async () => {
    routeMock.query = { from: 'editor' }

    const wrapper = await mountLab()

    await waitUntil(() =>
      wrapper.find('.message-toast').text().includes('没有找到编辑器交接的场景'),
    )
    expect(wrapper.find('.message-toast').text()).toContain('送到实验室')
  })
})

describe('仿真实验室 —— 运行记录', () => {
  const historyTab = (wrapper: VueWrapper) =>
    wrapper.findAll('.side-tab').find((tab) => tab.text() === '运行记录')

  it('「运行记录」页签在没有记录时显示空态', async () => {
    const wrapper = await mountLab()

    await historyTab(wrapper)?.trigger('click')
    await nextTick()

    const empty = wrapper.find('.experiment-history .empty-state')
    expect(empty.exists()).toBe(true)
    expect(empty.text()).toContain('还没有运行记录')
  })

  it('记录本次运行会把来源、参数、物体数与帧数写进 localStorage', async () => {
    const wrapper = await mountLab()

    await wrapper.find('button[title="记录本次运行"]').trigger('click')
    await nextTick()

    const stored = JSON.parse(localStorage.getItem('experiment-runs') as string)
    expect(stored).toHaveLength(1)
    expect(stored[0]).toMatchObject({
      name: '演示场景',
      source: { kind: 'scene', id: '', name: '演示场景' },
      config: { gravity: -9.8, friction: 0.1, restitution: 0.5, simulationSpeed: 1 },
      objectCount: 2,
      simulationTime: 0,
      recordedFrames: 0,
    })
    expect(wrapper.find('.message-toast').text()).toBe('已记录本次运行：演示场景')

    await historyTab(wrapper)?.trigger('click')
    await nextTick()
    expect(wrapper.find('.experiment-history .run-item').exists()).toBe(true)
  })

  it('复现预设运行会重新加载预设并回填重力/摩擦/弹性/速度', async () => {
    const wrapper = await mountLab()

    await setNumberInput(wrapper, 0, '-3.5')
    await setNumberInput(wrapper, 1, '0.42')
    await setNumberInput(wrapper, 2, '0.8')
    await setSimulationSpeed(wrapper, '2.5')

    const presetSelect = wrapper.findAll('.preset-selector select')[0]
    ;(presetSelect.element as HTMLSelectElement).value = 'newtons-cradle'
    await presetSelect.trigger('change')
    await waitUntil(() => readObjectCount(wrapper) === 6)

    await wrapper.find('button[title="记录本次运行"]').trigger('click')
    await nextTick()

    await historyTab(wrapper)?.trigger('click')
    await nextTick()
    expect(wrapper.find('.run-name').text()).toBe('牛顿摆')
    expect(wrapper.find('.run-config').text()).toContain('重力 -3.50')

    // 把参数改乱，再复现：配置必须回到记录里的值
    await setNumberInput(wrapper, 0, '0')
    await setNumberInput(wrapper, 1, '0.9')
    await setNumberInput(wrapper, 2, '0.1')
    await setSimulationSpeed(wrapper, '0.5')

    await wrapper.find('.run-replay').trigger('click')
    await waitUntil(() => wrapper.find('.message-toast').text() === '已复现运行：牛顿摆')

    expect(readObjectCount(wrapper)).toBe(6)
    expect((numberInputs(wrapper)[0].element as HTMLInputElement).value).toBe('-3.5')
    expect((numberInputs(wrapper)[1].element as HTMLInputElement).value).toBe('0.42')
    expect((numberInputs(wrapper)[2].element as HTMLInputElement).value).toBe('0.8')
    expect((wrapper.find('.speed-control input').element as HTMLInputElement).value).toBe('2.5')
    expect(readStatusValue(wrapper, '仿真时间')).toBe('0.00s')
  })

  it('删除一条记录后列表与 localStorage 同步清掉', async () => {
    const wrapper = await mountLab()

    await wrapper.find('button[title="记录本次运行"]').trigger('click')
    await nextTick()
    await historyTab(wrapper)?.trigger('click')
    await nextTick()
    expect(wrapper.find('.experiment-history .run-item').exists()).toBe(true)

    await wrapper.find('.run-delete').trigger('click')
    await nextTick()

    expect(wrapper.find('.experiment-history .run-item').exists()).toBe(false)
    expect(JSON.parse(localStorage.getItem('experiment-runs') as string)).toEqual([])
  })
})
