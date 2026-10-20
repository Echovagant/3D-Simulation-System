<template>
  <div ref="hostRef" class="tech-grid-host" aria-hidden="true">
    <canvas ref="canvasRef" class="tech-grid-canvas"></canvas>
    <div class="tech-grid-panels" aria-hidden="true">
      <span v-for="p in panels" :key="p.id" class="tech-grid-panel" :style="panelStyle(p)"></span>
    </div>
  </div>
</template>

<script lang="ts">
/**
 * 浅色靛紫科技网络背景 —— 纯 Canvas 2D，零运行时依赖。
 *
 * 配色全部取自项目自己的主题色（src/assets/styles/app-global.css）：
 * 主强调色靛紫 #6E5AF0（导航图标 rgb(110, 90, 240) 同源）、hover 琥珀 #ffa117。
 * 底色用 off-white #f7f8fc 而不是纯白——纯白会让网络线条失去对比，纯黑则与
 * 导航的 #333 正文冲突。
 *
 * 硬约束（改动前先读这段）：
 * - 背景永远不能挡住交互：宿主元素 pointer-events: none。
 * - 网络线条 alpha 不得超过 0.22，否则会盖住正文。
 * - 不用霓虹/外发光：只用低 alpha 实色，不要 shadowBlur / globalCompositeOperation。
 */

/** 靛紫主色 */
export const ACCENT = '#6E5AF0'
/** 靛紫的 RGB 分量，供 rgba() 拼接 */
export const ACCENT_RGB = '110, 90, 240'
/** 琥珀色：只用于少量「数据高亮点」 */
export const HIGHLIGHT = '#ffa117'
/** 琥珀色的 RGB 分量 */
export const HIGHLIGHT_RGB = '255, 161, 23'
/** 画布底色：off-white 微冷 */
export const CANVAS_BG = '#f7f8fc'
/** 连线距离阈值基准值（px），实际阈值按视口对角线缩放 */
export const EDGE_MAX_DIST = 150
/** CSS 网格线 alpha */
export const GRID_ALPHA = 0.035
/** 连线 alpha 区间：随距离从 EDGE_ALPHA_MAX 衰减到 EDGE_ALPHA_MIN */
export const EDGE_ALPHA_MIN = 0.10
export const EDGE_ALPHA_MAX = 0.22
/** 节点 alpha 区间：随呼吸相位变化 */
export const NODE_ALPHA_MIN = 0.28
export const NODE_ALPHA_MAX = 0.55
/** 琥珀点占比上限 */
export const HIGHLIGHT_RATIO = 0.08
/** 鼠标视差的最大偏移（px） */
export const PARALLAX_MAX = 10
/** devicePixelRatio 上限 */
export const MAX_DPR = 2
/** 每个节点占用的面积（px²） */
export const AREA_PER_NODE = 26000
/** 节点数下限 */
export const MIN_NODES = 36
/** 节点数上限 */
export const MAX_NODES = 84

/** 网络节点 */
export interface NetNode {
  x: number
  y: number
  vx: number
  vy: number
  r: number
  phase: number
  highlight: boolean
}

/** 伪随机数发生器（mulberry32）。固定种子 → 布局可复现，resize 不会整片重排。 */
function createRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 节点数量：视口面积 / AREA_PER_NODE，钳制在 [MIN_NODES, MAX_NODES] */
export function nodeCountFor(width: number, height: number): number {
  const raw = Math.round((Math.max(0, width) * Math.max(0, height)) / AREA_PER_NODE)
  return Math.min(MAX_NODES, Math.max(MIN_NODES, raw))
}

/**
 * 生成节点分布（纯函数，无副作用，便于测试断言）。
 *
 * - 位置：抖动网格，铺满视口又不聚堆
 * - 速度：各 ±0.06 px/frame
 * - 半径：1.2–2.6 px
 * - 琥珀高亮：按索引均匀取点，占比严格小于 HIGHLIGHT_RATIO（不用随机概率）
 */
export function seedNodes(width: number, height: number): NetNode[] {
  if (!(width > 0) || !(height > 0)) return []

  const count = nodeCountFor(width, height)
  const random = createRandom(0x5eed)
  const nodes: NetNode[] = []

  // 抖动网格：先按面积比例定列数，再在每格内部随机偏移
  const cols = Math.max(1, Math.round(Math.sqrt((count * width) / height)))
  const rows = Math.max(1, Math.ceil(count / cols))
  const cellW = width / cols
  const cellH = height / rows

  // 琥珀点数量：严格小于比例上限
  let highlightCount = Math.floor(count * HIGHLIGHT_RATIO)
  if (highlightCount > 0 && highlightCount / count >= HIGHLIGHT_RATIO) highlightCount -= 1

  for (let i = 0; i < count; i++) {
    const col = i % cols
    const row = Math.floor(i / cols)
    const jx = 0.15 + random() * 0.7
    const jy = 0.15 + random() * 0.7
    // 均匀取点：每 highlightCount 个节点里挑一个，分布不扎堆
    const highlight =
      highlightCount > 0 &&
      Math.floor(((i + 1) * highlightCount) / count) > Math.floor((i * highlightCount) / count)

    nodes.push({
      x: (col + jx) * cellW,
      y: (row + jy) * cellH,
      vx: (random() * 2 - 1) * 0.06,
      vy: (random() * 2 - 1) * 0.06,
      r: 1.2 + random() * 1.4,
      phase: random() * Math.PI * 2,
      highlight,
    })
  }

  return nodes
}
</script>

<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'

interface Panel {
  id: string
  /** 位置与尺寸均为视口百分比 */
  x: number
  y: number
  w: number
  h: number
  /** 小角度旋转，呼应原版面板的摆放感 */
  rot: number
}

/**
 * 静态「数据面板」轮廓（原版全息面板的 2D 替身）。
 * 贴着四角摆，尽量把中间的内容区留干净。
 */
const panels: Panel[] = [
  { id: 'panel-a', x: 4, y: 9, w: 21, h: 16, rot: -2.4 },
  { id: 'panel-b', x: 73, y: 12, w: 23, h: 18, rot: 1.9 },
  { id: 'panel-c', x: 79, y: 68, w: 19, h: 15, rot: -1.6 },
  { id: 'panel-d', x: 2, y: 72, w: 17, h: 13, rot: 2.8 },
]

const panelStyle = (p: Panel) => ({
  left: `${p.x}%`,
  top: `${p.y}%`,
  width: `${p.w}%`,
  height: `${p.h}%`,
  transform: `rotate(${p.rot}deg)`,
})

const hostRef = ref<HTMLElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let nodes: NetNode[] = []
let frameId: number | null = null
let resizeObserver: ResizeObserver | null = null
let resizeTimer: number | null = null
let motionQuery: MediaQueryList | null = null

/** 画布的 CSS 像素尺寸 */
let cssWidth = 0
let cssHeight = 0
/** 当前 devicePixelRatio（已封顶） */
let dpr = 1
/** 实际的连线距离阈值（按视口对角线缩放后） */
let edgeMaxDist = EDGE_MAX_DIST

/** 视差目标（-1..1）与当前值 */
let targetX = 0
let targetY = 0
let parallaxX = 0
let parallaxY = 0
/** 视差阻尼系数 */
const PARALLAX_LERP = 0.05

/** prefers-reduced-motion: reduce 时只画一帧，不启动 rAF 循环 */
let reducedMotion = false

/** 重建画布尺寸、节点分布与连线阈值 */
const applySize = () => {
  const host = hostRef.value
  const canvas = canvasRef.value
  if (!host || !canvas) return

  cssWidth = host.clientWidth || window.innerWidth
  cssHeight = host.clientHeight || window.innerHeight
  dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR)

  canvas.width = Math.max(1, Math.round(cssWidth * dpr))
  canvas.height = Math.max(1, Math.round(cssHeight * dpr))

  ctx = canvas.getContext('2d')
  nodes = seedNodes(cssWidth, cssHeight)

  // 连线阈值随视口对角线缩放：以 1600×900 为基准，范围钳在 0.7–1.5 倍
  const diagonal = Math.hypot(cssWidth, cssHeight)
  const scale = Math.min(1.5, Math.max(0.7, diagonal / Math.hypot(1600, 900)))
  edgeMaxDist = EDGE_MAX_DIST * scale
}

/** 画一帧 */
const draw = (time: number) => {
  const canvas = canvasRef.value
  if (!canvas || !ctx) return

  const t = time * 0.001
  const w = cssWidth
  const h = cssHeight

  // 视差：阻尼跟随鼠标
  parallaxX += (targetX - parallaxX) * PARALLAX_LERP
  parallaxY += (targetY - parallaxY) * PARALLAX_LERP
  const ox = parallaxX * PARALLAX_MAX
  const oy = parallaxY * PARALLAX_MAX

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.globalAlpha = 1

  // 底色
  ctx.fillStyle = CANVAS_BG
  ctx.fillRect(0, 0, w, h)

  // 节点漂移 + 边界反弹
  for (const node of nodes) {
    node.x += node.vx
    node.y += node.vy
    if (node.x < 0) {
      node.x = 0
      node.vx = Math.abs(node.vx)
    } else if (node.x > w) {
      node.x = w
      node.vx = -Math.abs(node.vx)
    }
    if (node.y < 0) {
      node.y = 0
      node.vy = Math.abs(node.vy)
    } else if (node.y > h) {
      node.y = h
      node.vy = -Math.abs(node.vy)
    }
  }

  // 连线：比较距离平方，避免开方
  const maxDistSq = edgeMaxDist * edgeMaxDist
  ctx.lineWidth = 1
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]
      const dx = a.x - b.x
      const dy = a.y - b.y
      const distSq = dx * dx + dy * dy
      if (distSq > maxDistSq) continue
      const dist = Math.sqrt(distSq)
      const alpha = EDGE_ALPHA_MAX + (EDGE_ALPHA_MIN - EDGE_ALPHA_MAX) * (dist / edgeMaxDist)
      ctx.strokeStyle = `rgba(${ACCENT_RGB}, ${alpha.toFixed(3)})`
      ctx.beginPath()
      ctx.moveTo(a.x + ox, a.y + oy)
      ctx.lineTo(b.x + ox, b.y + oy)
      ctx.stroke()
    }
  }

  // 节点：靛紫为主，少量琥珀作「数据高亮点」
  for (const node of nodes) {
    const breath = Math.sin(t * 0.6 + node.phase)
    const k = (breath + 1) / 2
    const radius = node.r * (1 + 0.12 * breath)
    const alpha = NODE_ALPHA_MIN + (NODE_ALPHA_MAX - NODE_ALPHA_MIN) * k
    ctx.fillStyle = node.highlight
      ? `rgba(${HIGHLIGHT_RGB}, ${alpha.toFixed(3)})`
      : `rgba(${ACCENT_RGB}, ${alpha.toFixed(3)})`
    ctx.beginPath()
    ctx.arc(node.x + ox, node.y + oy, radius, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** 渲染循环 */
const frame = (time: number) => {
  draw(time)
  frameId = requestAnimationFrame(frame)
}

const startLoop = () => {
  if (frameId !== null) return
  frameId = requestAnimationFrame(frame)
}

const stopLoop = () => {
  if (frameId === null) return
  cancelAnimationFrame(frameId)
  frameId = null
}

/** 页面不可见时暂停 */
const handleVisibilityChange = () => {
  if (document.hidden) {
    stopLoop()
  } else if (!reducedMotion) {
    startLoop()
  }
}

/** 用户中途切换了「减少动效」偏好 */
const handleMotionChange = (event: MediaQueryListEvent) => {
  reducedMotion = event.matches
  if (reducedMotion) {
    stopLoop()
    draw(performance.now())
  } else {
    startLoop()
  }
}

/** 鼠标视差 */
const handlePointerMove = (event: PointerEvent) => {
  const w = window.innerWidth || 1
  const h = window.innerHeight || 1
  targetX = (event.clientX / w) * 2 - 1
  targetY = (event.clientY / h) * 2 - 1
}

/** 尺寸变化：150ms 防抖后重建 */
const handleResize = () => {
  if (resizeTimer !== null) window.clearTimeout(resizeTimer)
  resizeTimer = window.setTimeout(() => {
    resizeTimer = null
    applySize()
    draw(performance.now())
  }, 150)
}

onMounted(() => {
  if (typeof window.matchMedia === 'function') {
    motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotion = motionQuery.matches
  }

  applySize()
  draw(performance.now())

  if (!reducedMotion) startLoop()

  window.addEventListener('pointermove', handlePointerMove, { passive: true })
  document.addEventListener('visibilitychange', handleVisibilityChange)
  if (motionQuery && typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', handleMotionChange)
  }
  if (typeof ResizeObserver !== 'undefined' && hostRef.value) {
    resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(hostRef.value)
  }
})

onUnmounted(() => {
  stopLoop()

  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  }
  if (resizeTimer !== null) {
    window.clearTimeout(resizeTimer)
    resizeTimer = null
  }

  window.removeEventListener('pointermove', handlePointerMove)
  document.removeEventListener('visibilitychange', handleVisibilityChange)
  if (motionQuery) {
    if (typeof motionQuery.removeEventListener === 'function') {
      motionQuery.removeEventListener('change', handleMotionChange)
    }
    motionQuery = null
  }

  ctx = null
  nodes = []
})
</script>

<style scoped>
/*
 * 宿主：整屏固定，永不拦截交互。
 * z-index: 0 —— 页面内容 .app-container 是 position: relative; z-index: 1（在
 * app-global.css 里），所以内容永远压在背景之上。
 */
.tech-grid-host {
  position: fixed;
  inset: 0;
  z-index: 0;
  pointer-events: none;
  overflow: hidden;
  background-color: #f7f8fc;
}

.tech-grid-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
  background-color: #f7f8fc;
}

/*
 * 面板层同时承担两件事：静态「数据面板」轮廓 + 极淡方格底纹。
 * 方格必须放在这一层（canvas 之上）：canvas 位图本身是不透明的，画在宿主
 * 背景上的方格会被它盖住。
 */
.tech-grid-panels {
  position: absolute;
  inset: 0;
  background-image:
    repeating-linear-gradient(
      0deg,
      rgba(110, 90, 240, 0.035) 0 1px,
      transparent 1px 48px
    ),
    repeating-linear-gradient(
      90deg,
      rgba(110, 90, 240, 0.035) 0 1px,
      transparent 1px 48px
    );
}

.tech-grid-panel {
  position: absolute;
  border: 1px solid rgba(110, 90, 240, 0.1);
  background: rgba(255, 255, 255, 0.55);
  border-radius: 10px;
  backdrop-filter: blur(2px);
}
</style>
