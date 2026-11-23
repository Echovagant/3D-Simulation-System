<template>
  <section class="wb-viewport" aria-label="3D 视口">
    <div class="viewport-head">
      <h3 class="viewport-title">3D 视口</h3>
      <span class="viewport-meta">{{ metaLabel }}</span>
    </div>
    <div ref="host" class="viewport-canvas">
      <p v-if="unsupported" class="viewport-fallback">
        当前环境不支持 WebGL，3D 视口不可用（会话与决策功能不受影响）。
      </p>
    </div>
    <p class="viewport-legend">金色 = 受控智能体 · 圆环 = 目标 · 拖拽旋转 / 滚轮缩放</p>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RENDER_POWER_PREFERENCE } from '@/config/rendering'
import type { GymObservation } from '@/services/api/gymWorkbench'
import { buildViewportModel, type ViewportModel } from './viewportModel'

/**
 * 工作台 3D 视口。
 *
 * 场景文档给几何类型/尺寸，最新观测给位置/目标/完成状态；每次观测更新
 * 只重建内部 Mesh（物体数量很少），相机与控制器保持不动，避免视角跳变。
 *
 * WebGL 不可用（jsdom / 老浏览器 / 远程桌面）时只显示一行说明，
 * 不抛异常、不影响工作台其余功能。
 */
const props = defineProps<{
  scene: Record<string, unknown> | null
  observation: GymObservation | null
}>()

const host = ref<HTMLElement | null>(null)
const unsupported = ref(false)

const model = computed<ViewportModel>(() => buildViewportModel(props.scene, props.observation))

const metaLabel = computed(() => {
  const agents = model.value.objects.filter((item) => item.isAgent).length
  if (model.value.objects.length === 0) return '等待会话'
  return `${model.value.objects.length} 个物体 · ${agents} 个受控智能体`
})

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let objectGroup: THREE.Group | null = null
let targetGroup: THREE.Group | null = null
let frameId = 0
let resizeFrame = 0
let resizeObserver: ResizeObserver | null = null
let lastWidth = 0
let lastHeight = 0

/** 清掉一个 Group 下所有 Mesh 的几何与材质，避免每次观测更新漏显存 */
const disposeGroup = (group: THREE.Group | null): void => {
  if (!group) return
  for (const child of group.children) {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose()
      const material = child.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else material.dispose()
    }
  }
  group.clear()
}

const makeObjectMesh = (item: ViewportModel['objects'][number]): THREE.Mesh => {
  const scale = item.scale
  let geometry: THREE.BufferGeometry
  if (item.kind === 'sphere') {
    geometry = new THREE.SphereGeometry(Math.max(0.1, scale.x * 0.5), 20, 14)
  } else if (item.kind === 'cylinder') {
    const radius = Math.max(0.1, scale.x * 0.5)
    geometry = new THREE.CylinderGeometry(radius, radius, Math.max(0.1, scale.y), 20)
  } else {
    geometry = new THREE.BoxGeometry(
      Math.max(0.05, scale.x),
      Math.max(0.05, scale.y),
      Math.max(0.05, scale.z),
    )
  }
  const material = new THREE.MeshStandardMaterial({
    color: item.isAgent ? 0xf5b942 : 0x7d8b9c,
    emissive: item.isAgent ? 0x5a3c00 : 0x000000,
    roughness: 0.55,
    metalness: 0.1,
    transparent: item.done,
    opacity: item.done ? 0.35 : 1,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(item.position.x, item.position.y, item.position.z)
  mesh.userData.uuid = item.uuid
  return mesh
}

const makeTargetRing = (target: ViewportModel['targets'][number]): THREE.Mesh => {
  const geometry = new THREE.RingGeometry(0.42, 0.6, 32)
  const material = new THREE.MeshBasicMaterial({
    color: target.done ? 0x34d399 : 0xf5b942,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.rotation.x = -Math.PI / 2
  ring.position.set(target.x, 0.02, target.z)
  return ring
}

/** 按最新模型重建两组 Mesh（相机/控制器不动） */
const rebuildModel = (): void => {
  if (!objectGroup || !targetGroup) return
  disposeGroup(objectGroup)
  disposeGroup(targetGroup)
  for (const item of model.value.objects) objectGroup.add(makeObjectMesh(item))
  for (const target of model.value.targets) targetGroup.add(makeTargetRing(target))
}

const resize = (): void => {
  if (!renderer || !camera || !host.value) return
  const width = Math.max(1, host.value.clientWidth)
  const height = Math.max(1, host.value.clientHeight)
  // 尺寸没变就不重设：ResizeObserver 回调里同步改 canvas 尺寸会触发
  // 「loop completed with undelivered notifications」告警
  if (width === lastWidth && height === lastHeight) return
  lastWidth = width
  lastHeight = height
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

/** 观察回调只排到下一帧再量，避免在回调内同步触发布局变化 */
const scheduleResize = (): void => {
  window.cancelAnimationFrame(resizeFrame)
  resizeFrame = window.requestAnimationFrame(resize)
}

const init = (): void => {
  if (!host.value) return
  // jsdom / 老浏览器没有 WebGL 构造器：直接降级，不去触发无意义的上下文创建
  if (typeof WebGL2RenderingContext === 'undefined' && typeof WebGLRenderingContext === 'undefined') {
    unsupported.value = true
    return
  }
  const canvas = document.createElement('canvas')
  let context: WebGLRenderingContext | WebGL2RenderingContext | null = null
  try {
    context = canvas.getContext('webgl2') ?? canvas.getContext('webgl')
  } catch {
    context = null
  }
  if (!context) {
    unsupported.value = true
    return
  }

  renderer = new THREE.WebGLRenderer({
    canvas,
    context,
    antialias: true,
    // 双显卡笔记本上不让浏览器默认挑核显（见 src/config/rendering.ts）
    powerPreference: RENDER_POWER_PREFERENCE,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  host.value.appendChild(canvas)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x12161c)
  camera = new THREE.PerspectiveCamera(50, 1, 0.1, 300)
  camera.position.set(7, 7, 9)

  controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.target.set(0, 0.6, 0)
  controls.update()

  scene.add(new THREE.HemisphereLight(0xffffff, 0x334155, 1.1))
  const directional = new THREE.DirectionalLight(0xffffff, 1.2)
  directional.position.set(8, 12, 6)
  scene.add(directional)
  scene.add(new THREE.GridHelper(24, 24, 0x6f7c8c, 0x39414f))

  objectGroup = new THREE.Group()
  targetGroup = new THREE.Group()
  scene.add(objectGroup, targetGroup)
  rebuildModel()
  resize()

  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(scheduleResize)
    resizeObserver.observe(host.value)
  } else {
    window.addEventListener('resize', scheduleResize)
  }

  const loop = (): void => {
    frameId = window.requestAnimationFrame(loop)
    controls?.update()
    if (renderer && scene && camera) renderer.render(scene, camera)
  }
  loop()
}

onMounted(init)

watch(model, rebuildModel, { deep: true })

onBeforeUnmount(() => {
  window.cancelAnimationFrame(frameId)
  window.cancelAnimationFrame(resizeFrame)
  resizeObserver?.disconnect()
  window.removeEventListener('resize', scheduleResize)
  controls?.dispose()
  disposeGroup(objectGroup)
  disposeGroup(targetGroup)
  renderer?.dispose()
  renderer?.domElement.remove()
  renderer = null
  scene = null
  camera = null
  controls = null
  objectGroup = null
  targetGroup = null
})
</script>

<style scoped>
.wb-viewport {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--bg-panel);
}

.viewport-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px 6px;
}

.viewport-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--accent);
}

.viewport-meta {
  font-size: 11px;
  color: var(--text-3);
  font-family: var(--font-mono);
}

.viewport-canvas {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  margin: 0 12px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: #12161c;
}

.viewport-canvas canvas {
  display: block;
  width: 100%;
  height: 100%;
}

.viewport-fallback {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  margin: 0;
  padding: 16px;
  font-size: 12px;
  color: var(--text-3);
  text-align: center;
}

.viewport-legend {
  margin: 0;
  padding: 6px 12px 8px;
  font-size: 11px;
  color: var(--text-3);
}
</style>
