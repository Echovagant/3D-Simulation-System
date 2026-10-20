// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import TechGridUniverse, {
  CANVAS_BG,
  HIGHLIGHT_RATIO,
  MAX_NODES,
  MIN_NODES,
  nodeCountFor,
  seedNodes,
} from './TechGridUniverse.vue'

// jsdom 未实现 ResizeObserver，这里给出最小桩
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as never
}

type FakeContext = {
  fillStyle: string
  strokeStyle: string
  lineWidth: number
  globalAlpha: number
  /** 每次 fillRect 时记录当时的 fillStyle，用来验证底色 */
  fillRects: { style: string; args: number[] }[]
  strokes: number
  arcs: number
  setTransform: (...args: number[]) => void
  clearRect: () => void
  fillRect: (x: number, y: number, w: number, h: number) => void
  beginPath: () => void
  moveTo: (x: number, y: number) => void
  lineTo: (x: number, y: number) => void
  stroke: () => void
  fill: () => void
  arc: (x: number, y: number, r: number, s: number, e: number) => void
}

/** 假的 2D 上下文：jsdom 没有 canvas 实现，桩掉它顺便记录调用 */
const createFakeContext = (): FakeContext => {
  const ctx: FakeContext = {
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    globalAlpha: 1,
    fillRects: [],
    strokes: 0,
    arcs: 0,
    setTransform: () => {},
    clearRect: () => {},
    fillRect: (x, y, w, h) => {
      ctx.fillRects.push({ style: ctx.fillStyle, args: [x, y, w, h] })
    },
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {
      ctx.strokes += 1
    },
    fill: () => {},
    arc: () => {
      ctx.arcs += 1
    },
  }
  return ctx
}

/**
 * SFC 源文件：scoped 样式在 jsdom 里不会被注入，只能从源码断言。
 * 用 Vite 的 ?raw 导入拿到原文（与 src/utils/docSections.ts 同一套写法）。
 */
const sourceFiles = import.meta.glob(
  '/src/components/common/Background/TechGridUniverse.vue',
  {
    query: '?raw',
    import: 'default',
    eager: true,
  },
) as Record<string, string>

const source = Object.values(sourceFiles)[0] ?? ''

/** 把 SFC 里的 <style scoped> 片段取出来 */
const styleBlock = (() => {
  const match = source.match(/<style scoped>([\s\S]*?)<\/style>/)
  return match ? match[1] : ''
})()

const mountedApps: App[] = []
let fakeCtx: FakeContext | null = null

/** 让 canvas.getContext('2d') 返回假上下文 */
const stubCanvasContext = (ctx: FakeContext) => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    (() => ctx) as never,
  )
}

/** 挂载背景组件，等 onMounted 跑完 */
const mountBackground = async () => {
  const host = document.createElement('div')
  document.body.appendChild(host)

  const app = createApp(TechGridUniverse)
  mountedApps.push(app)
  app.mount(host)

  await nextTick()
  await nextTick()
  return host
}

/**
 * 让 matchMedia 对 prefers-reduced-motion 返回指定结果。
 * 这个 jsdom 版本没有实现 matchMedia，所以直接定义属性而不是 spyOn。
 */
const originalMatchMedia = window.matchMedia
const stubReducedMotion = (matches: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) =>
      ({
        matches: query.includes('prefers-reduced-motion') ? matches : false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }) as unknown as MediaQueryList,
  })
}

const hexToRgbString = (hex: string) => {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return `rgb(${r}, ${g}, ${b})`
}

afterEach(() => {
  while (mountedApps.length) {
    mountedApps.pop()?.unmount()
  }
  document.body.innerHTML = ''
  document.head.innerHTML = ''
  fakeCtx = null
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: originalMatchMedia,
  })
  vi.restoreAllMocks()
})

describe('TechGridUniverse（浅色靛紫科技网络背景）', () => {
  it('挂载后渲染出画布与面板轮廓，且不产生控制台错误', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fakeCtx = createFakeContext()
    stubCanvasContext(fakeCtx)

    const host = await mountBackground()

    expect(host.querySelector('canvas.tech-grid-canvas')).toBeTruthy()
    expect(host.querySelector('.tech-grid-host')?.getAttribute('aria-hidden')).toBe('true')
    const panelCount = host.querySelectorAll('.tech-grid-panel').length
    expect(panelCount).toBeGreaterThanOrEqual(3)
    expect(panelCount).toBeLessThanOrEqual(5)
    expect(errorSpy).not.toHaveBeenCalled()
  })

  it('画布底色是浅色 #f7f8fc（rgb(247, 248, 252)）', async () => {
    fakeCtx = createFakeContext()
    stubCanvasContext(fakeCtx)

    await mountBackground()

    expect(hexToRgbString(CANVAS_BG)).toBe('rgb(247, 248, 252)')
    // 画布每帧都用底色铺满
    expect(fakeCtx!.fillRects.length).toBeGreaterThan(0)
    expect(fakeCtx!.fillRects.every((r) => r.style === CANVAS_BG)).toBe(true)
    // 样式表里宿主与画布也都声明了同一个底色
    expect(styleBlock).toMatch(/\.tech-grid-host\s*\{[^}]*background-color:\s*#f7f8fc/)
    expect(styleBlock).toMatch(/\.tech-grid-canvas\s*\{[^}]*background-color:\s*#f7f8fc/)
  })

  it('背景不拦截指针事件（pointer-events: none）', async () => {
    // jsdom 不注入 SFC 的 scoped 样式，getComputedStyle 拿不到规则，
    // 因此这里直接对样式表源码断言——它就是浏览器里生效的那份声明。
    expect(styleBlock).toMatch(/\.tech-grid-host\s*\{[^}]*pointer-events:\s*none/)

    fakeCtx = createFakeContext()
    stubCanvasContext(fakeCtx)
    const host = await mountBackground()

    // 背景是纯装饰层：宿主与画布都不该有自己的交互区域
    const hostEl = host.querySelector('.tech-grid-host') as HTMLElement
    expect(hostEl.getAttribute('aria-hidden')).toBe('true')
  })

  it('节点数随视口面积变化并被钳制在 36–84', () => {
    expect(nodeCountFor(1600, 900)).toBe(Math.round((1600 * 900) / 26000))
    expect(nodeCountFor(100, 100)).toBe(MIN_NODES)
    expect(nodeCountFor(10000, 10000)).toBe(MAX_NODES)
  })

  it('琥珀色高亮点占比严格小于 8%', () => {
    const nodes = seedNodes(1600, 900)
    const highlights = nodes.filter((n) => n.highlight).length

    expect(nodes.length).toBe(nodeCountFor(1600, 900))
    expect(highlights).toBeGreaterThan(0)
    expect(highlights).toBeLessThanOrEqual(nodes.length * HIGHLIGHT_RATIO)
    expect(highlights / nodes.length).toBeLessThan(HIGHLIGHT_RATIO)
  })

  it('节点落在视口内，速度与半径在规格范围内', () => {
    const nodes = seedNodes(1600, 900)

    for (const node of nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0)
      expect(node.x).toBeLessThanOrEqual(1600)
      expect(node.y).toBeGreaterThanOrEqual(0)
      expect(node.y).toBeLessThanOrEqual(900)
      expect(Math.abs(node.vx)).toBeLessThanOrEqual(0.06)
      expect(Math.abs(node.vy)).toBeLessThanOrEqual(0.06)
      expect(node.r).toBeGreaterThanOrEqual(1.2)
      expect(node.r).toBeLessThanOrEqual(2.6)
    }
  })

  it('默认会启动渲染循环', async () => {
    fakeCtx = createFakeContext()
    stubCanvasContext(fakeCtx)
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')

    await mountBackground()

    expect(rafSpy).toHaveBeenCalled()
  })

  it('prefers-reduced-motion: reduce 时不启动渲染循环，只画一帧', async () => {
    stubReducedMotion(true)
    fakeCtx = createFakeContext()
    stubCanvasContext(fakeCtx)
    const rafSpy = vi.spyOn(globalThis, 'requestAnimationFrame')

    await mountBackground()

    expect(rafSpy).not.toHaveBeenCalled()
    // 仍然画了静止的一帧
    expect(fakeCtx!.fillRects.length).toBe(1)
  })
})
