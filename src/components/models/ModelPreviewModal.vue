<template>
  <div class="preview-backdrop" @click.self="$emit('close')">
    <div
      class="preview-modal"
      role="dialog"
      aria-modal="true"
      :aria-label="`${model.name} 3D 预览`"
    >
      <div class="preview-header">
        <div class="preview-title">
          <i class="fas fa-cube" aria-hidden="true"></i>
          <span>{{ model.name }} · 3D 预览</span>
        </div>
        <button class="preview-close" type="button" title="关闭" aria-label="关闭" @click="$emit('close')">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <div ref="containerRef" class="preview-stage">
        <div v-if="status === 'loading'" class="preview-overlay">
          <i class="fas fa-spinner fa-spin"></i>
          <p>正在加载模型…</p>
        </div>
        <div v-else-if="status === 'error'" class="preview-overlay preview-overlay--error">
          <i class="fas fa-triangle-exclamation"></i>
          <p>模型加载失败</p>
          <p v-if="errorMessage" class="preview-error-detail">{{ errorMessage }}</p>
        </div>
        <p v-else class="preview-hint">拖拽旋转 · 滚轮缩放</p>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup name="ModelPreviewModal">
/**
 * 模型真 3D 预览弹窗。
 *
 * 加载统一走 `modelStore.loadModelById(id)`——内置 URL、后端持久化 URL、
 * 会话 blob URL 三条路都在 store 里分派，这里不重复写加载分支。
 *
 * 因为加载出来的是**新解析**的对象（store 不在库里缓存 Object3D），
 * 直接 clone 一份摆进预览场景即可；关闭时只 dispose 这份克隆体与渲染器，
 * 不会影响模型库里的任何实例。
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { RENDER_POWER_PREFERENCE } from '@/config/rendering'
import { useModelStore } from '@/stores/modelStore'

/** 归一后的目标最大边长（米）：保证不同尺度的模型在视口里大小一致 */
const TARGET_MAX_EDGE = 2

const props = defineProps<{
  /** 任何带 id 与 name 的模型对象（内置 / 上传 / 生成条目都满足） */
  model: { id: string; name: string }
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const modelStore = useModelStore()
const containerRef = ref<HTMLDivElement | null>(null)
const status = ref<'loading' | 'ready' | 'error'>('loading')
const errorMessage = ref('')

let renderer: THREE.WebGLRenderer | null = null
let scene: THREE.Scene | null = null
let camera: THREE.PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let previewObject: THREE.Object3D | null = null
let resizeObserver: ResizeObserver | null = null
let frameId = 0
let disposed = false

const onKeydown = (event: KeyboardEvent): void => {
  // 组件的唯一出口：让父级用 v-if 摘掉自己，卸载钩子统一收尾
  if (event.key === 'Escape') emit('close')
}

const resize = (): void => {
  const container = containerRef.value
  if (!container || !renderer || !camera) return
  const width = container.clientWidth
  const height = container.clientHeight
  if (width <= 0 || height <= 0) return
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

const animate = (): void => {
  if (disposed) return
  frameId = requestAnimationFrame(animate)
  controls?.update()
  if (renderer && scene && camera) renderer.render(scene, camera)
}

/**
 * 克隆一份模型，居中并按最大边归一。
 *
 * 顺序：先把克隆体放进 holder，再缩放 holder、平移 holder，
 * 这样即使模型根节点自带旋转/缩放，也能把包围盒中心落到原点。
 */
const buildFramedObject = (source: THREE.Object3D): THREE.Object3D => {
  const object = source.clone(true)
  const holder = new THREE.Group()
  holder.add(object)

  const box = new THREE.Box3().setFromObject(object)
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const maxEdge = Math.max(size.x, size.y, size.z)

  if (Number.isFinite(maxEdge) && maxEdge > 0) {
    const scale = TARGET_MAX_EDGE / maxEdge
    holder.scale.setScalar(scale)
    holder.position.copy(center).multiplyScalar(-scale)
  }
  holder.updateMatrixWorld(true)
  return holder
}

const disposePreviewObject = (): void => {
  if (!previewObject) return
  const geometries = new Set<THREE.BufferGeometry>()
  const materials = new Set<THREE.Material>()
  previewObject.traverse((child) => {
    const mesh = child as THREE.Mesh
    if (mesh.geometry) geometries.add(mesh.geometry)
    const material = mesh.material
    if (Array.isArray(material)) material.forEach((item) => materials.add(item))
    else if (material) materials.add(material)
  })
  geometries.forEach((geometry) => geometry.dispose())
  materials.forEach((material) => material.dispose())
  scene?.remove(previewObject)
  previewObject = null
}

const setup = async (): Promise<void> => {
  const container = containerRef.value
  if (!container) return

  renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: false,
    // 双显卡笔记本上不让浏览器默认挑核显（见 src/config/rendering.ts）
    powerPreference: RENDER_POWER_PREFERENCE,
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
  renderer.setClearColor(0x1f1f1f, 1)
  renderer.domElement.style.display = 'block'
  renderer.domElement.style.width = '100%'
  renderer.domElement.style.height = '100%'
  container.appendChild(renderer.domElement)

  scene = new THREE.Scene()
  scene.background = new THREE.Color(0x1f1f1f)

  camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100)
  camera.position.set(2.8, 2.1, 3.4)

  controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.dampingFactor = 0.08
  controls.minDistance = 0.5
  controls.maxDistance = 20
  controls.target.set(0, 0, 0)
  controls.update()

  scene.add(new THREE.AmbientLight(0xffffff, 1.4))
  const keyLight = new THREE.DirectionalLight(0xffffff, 2.6)
  keyLight.position.set(6, 10, 8)
  scene.add(keyLight)
  const fillLight = new THREE.DirectionalLight(0xffffff, 1.2)
  fillLight.position.set(-6, 4, -8)
  scene.add(fillLight)

  const grid = new THREE.GridHelper(10, 20, 0x555555, 0x3a3a3a)
  grid.position.y = -1
  scene.add(grid)

  resize()
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(resize)
    resizeObserver.observe(container)
  } else {
    window.addEventListener('resize', resize)
  }
  window.addEventListener('keydown', onKeydown)

  animate()

  try {
    const loaded = await modelStore.loadModelById(props.model.id)
    if (disposed) return
    if (!loaded) throw new Error('模型不存在或没有可加载的文件')
    previewObject = buildFramedObject(loaded)
    scene.add(previewObject)
    status.value = 'ready'
  } catch (error) {
    if (disposed) return
    status.value = 'error'
    errorMessage.value = error instanceof Error ? error.message : ''
  }
}

onMounted(() => {
  void setup()
})

onBeforeUnmount(() => {
  disposed = true
  if (frameId) {
    cancelAnimationFrame(frameId)
    frameId = 0
  }
  if (resizeObserver) {
    resizeObserver.disconnect()
    resizeObserver = null
  } else {
    window.removeEventListener('resize', resize)
  }
  window.removeEventListener('keydown', onKeydown)
  controls?.dispose()
  controls = null
  disposePreviewObject()
  if (renderer) {
    renderer.dispose()
    renderer.forceContextLoss()
    renderer.domElement.remove()
    renderer = null
  }
  scene = null
  camera = null
})
</script>

<style scoped>
.preview-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 遮罩是元素自带底色，允许黑色 rgba */
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  /* 叠在模型库详情弹窗之上，关闭后回到详情 */
  z-index: 1100;
  padding: 20px;
}

.preview-modal {
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
  width: 100%;
  max-width: 960px;
  height: 78vh;
  max-height: 720px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.preview-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--border-subtle);
}

.preview-title {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  color: var(--text-1);
  font-size: 1rem;
  font-weight: 600;
}

.preview-title span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.preview-close {
  flex-shrink: 0;
  background: none;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  padding: 6px;
  border-radius: var(--radius-sm);
  transition: color 0.2s ease, background-color 0.2s ease;
}

.preview-close:hover {
  color: var(--text-1);
  background-color: var(--bg-hover);
}

.preview-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.preview-stage {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: hidden;
  background-color: var(--bg-canvas);
}

.preview-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: var(--text-2);
  font-size: 0.9rem;
  text-align: center;
  padding: 20px;
  pointer-events: none;
}

.preview-overlay i {
  font-size: 1.6rem;
  color: var(--text-3);
}

.preview-overlay--error i {
  color: var(--danger);
}

.preview-error-detail {
  max-width: 420px;
  color: var(--text-3);
  font-size: 0.8rem;
  word-break: break-word;
}

.preview-hint {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  margin: 0;
  padding: 4px 10px;
  border-radius: var(--radius-sm);
  background-color: rgba(0, 0, 0, 0.45);
  color: var(--text-3);
  font-size: 0.75rem;
  pointer-events: none;
}

@media (max-width: 768px) {
  .preview-modal {
    height: 70vh;
  }
}
</style>
