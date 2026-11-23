<template>
  <!-- 这是Three.js渲染的容器，画布会通过JS动态挂载到这个div中 -->
  <div class="viewport-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, type Ref } from 'vue'
import * as THREE from 'three'
import type { Scene, Camera, WebGLRenderer, Object3D } from 'three'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import type { SceneDocument } from '@/types'

// 定义相机更新事件的数据类型
interface CameraUpdateData {
  type: 'perspective' | 'orthographic'
  aspect?: number
  left?: number
  right?: number
  top?: number
  bottom?: number
}

// 定义性能警告接口
interface PerformanceWarning {
  message: string
  timestamp: number
  details?: Record<string, unknown>
}

// 明确接收的props类型（允许null，但使用时会做非空判断）
const props = defineProps<{
  scene: Scene | null
  camera: Camera | null
  renderer: WebGLRenderer | null
  /**
   * 每帧调用一次的物理推进函数。
   *
   * 参数是 `requestAnimationFrame` 给的时间戳（毫秒）：物理要按**固定步长**推进，
   * 就必须知道「这一帧过了多少真实时间」，否则步进次数会被显示刷新率绑架。
   */
  updatePhysics: (timestamp?: number) => void
}>()

// 声明事件类型
const emit = defineEmits<{
  (e: 'viewport-click', object: Object3D | null): void
  (e: 'update-camera', cameraData: CameraUpdateData): void
  (e: 'performance-warning', warning: PerformanceWarning): void
}>()

// 容器DOM引用
const containerRef: Ref<HTMLDivElement | null> = ref<HTMLDivElement | null>(null)

// 本地渲染器引用
const localRenderer = ref<WebGLRenderer | null>(null)

// 渲染循环控制
const isRendering = ref(false)

// 初始化射线投射器，用于鼠标交互
const raycaster = new THREE.Raycaster()
const mouse = new THREE.Vector2()
let animationFrameId: number | null = null

/**
 * 拖拽状态。
 *
 * 拾取与相机旋转共用左键：只有**按住物体**时才进入拖拽，并在捕获阶段
 * 阻断 pointerdown 的传播——OrbitControls 收不到这一下，就不会一边拖物体一边转相机。
 */
interface ObjectDragState {
  uuid: string
  object: THREE.Object3D
  pointerId: number
  startClientX: number
  startClientY: number
  /** 物体在拖拽平面上的高度（沿地面水平拖动） */
  planeY: number
  /** 按下点与物体中心的偏移，避免物体瞬间跳到指针下 */
  offset: THREE.Vector3
  beforeDocument: SceneDocument
  moved: boolean
  wasPaused: boolean
}

let dragState: ObjectDragState | null = null
const DRAG_THRESHOLD_PX = 4
/** 最近一次左键按下的位置：用来区分「点击」与「转完相机后补发的 click」 */
let pressStart: { x: number; y: number } | null = null
/** 刚拖过相机/物体：抑制随后补发的 click，避免转完视角把选中清掉 */
let suppressNextClick = false

// Pinia store 是全局单例，直接取用（与 Toolbar.vue 的写法一致）
const sceneEditorStore = useSceneEditorStore()
let resizeObserver: ResizeObserver | null = null
let initRetryCount = 0
const MAX_INIT_RETRIES = 10
/** ResizeObserver 的防抖句柄：容器宽度过渡期间每帧触发，合帧到过渡结束 */
let resizeDebounce: number | null = null
const isUnmounted = ref(false)

// 调试日志已移除

/**
 * 初始化渲染器：将Three.js的canvas插入到容器中
 */
const initRenderer = () => {
  // 如果组件已卸载，不进行初始化
  if (isUnmounted.value) return

  // 检查props有效性
  if (!props.scene || !props.camera || !props.renderer) {
    // renderer 可能在异步初始化链（initPhysicsWorld 等）尚未产出的窗口期缺席：
    // 与容器尺寸重试同机制等待，而不是静默放弃（静默放弃 = 画布永久黑屏）。
    initRetryCount++
    if (initRetryCount < MAX_INIT_RETRIES) {
      setTimeout(() => {
        if (!isUnmounted.value) {
          initRenderer()
        }
      }, 200)
    } else {
      console.warn('[Viewport] 渲染器初始化重试耗尽——检查场景编辑器的初始化链路')
    }
    return
  }

  // 确保容器存在且尺寸有效
  const container = containerRef.value
  if (!container) {
    return
  }

  const containerWidth = container.clientWidth
  const containerHeight = container.clientHeight

  // 如果容器尺寸无效（小于10像素），等待一下再尝试
  if (containerWidth < 10 || containerHeight < 10) {
    initRetryCount++
    if (initRetryCount < MAX_INIT_RETRIES) {
      setTimeout(() => {
        if (!isUnmounted.value) {
          initRenderer()
        }
      }, 200)
    } else {
      // 使用备用尺寸
      props.renderer.setSize(800, 600, false)
      if (!container.contains(props.renderer.domElement)) {
        container.appendChild(props.renderer.domElement)
      }
      localRenderer.value = props.renderer
    }
    return
  }

  // 重置重试计数
  initRetryCount = 0

  // 设置渲染器尺寸与相机比例
  // handleResize 会一并发出 update-camera：相机的宽高比必须跟着真实视口走
  handleResize()

  // 如果canvas不在容器中，则添加
  if (!container.contains(props.renderer.domElement)) {
    container.appendChild(props.renderer.domElement)
  }

  // 更新本地引用
  localRenderer.value = props.renderer
}

/**
 * 渲染循环：持续渲染场景
 *
 * `timestamp` 是 requestAnimationFrame 回调的第一个参数（毫秒时间戳），
 * 原样传给物理推进函数——固定步长累加器需要它来算真实时间。
 */
const renderLoop = (timestamp?: number) => {
  // 如果组件已卸载，停止渲染
  if (isUnmounted.value) return

  if (!props.scene || !props.camera || !props.renderer || !isRendering.value) {
    // 如果props为空或渲染已停止，跳过渲染
    animationFrameId = requestAnimationFrame(renderLoop)
    return
  }

  // 调用物理更新函数
  if (props.updatePhysics) {
    try {
      props.updatePhysics(timestamp)
    } catch (error) {
      // 在store中记录错误
      sceneEditorStore.addPhysicsError('Viewport物理更新失败', error as Error)
    }
  }

  // 渲染场景
  if (import.meta.env.DEV) {
    // 开发环境下测量单帧渲染耗时，超过 16ms（60fps 帧预算）时记入 store 并广播
    const startTime = performance.now()
    props.renderer.render(props.scene, props.camera)
    const renderTime = performance.now() - startTime

    if (renderTime > 16) {
      const warning: PerformanceWarning = {
        message: `渲染耗时超过阈值: ${renderTime.toFixed(2)}ms`,
        timestamp: Date.now(),
        details: {
          renderTime: renderTime,
          threshold: 16,
        },
      }

      // 在store中记录性能警告
      sceneEditorStore.addPerformanceWarning(warning.message, warning.details)

      // 发出性能警告事件
      emit('performance-warning', warning)
    }
  } else {
    // 生产环境直接渲染
    props.renderer.render(props.scene, props.camera)
  }

  animationFrameId = requestAnimationFrame(renderLoop)
}

/**
 * 启动渲染循环
 */
const startRendering = () => {
  if (isRendering.value) return
  isRendering.value = true
  sceneEditorStore.renderState.isRenderLoopActive = true
  renderLoop()
}

/**
 * 停止渲染循环
 */
const stopRendering = () => {
  isRendering.value = false
  sceneEditorStore.renderState.isRenderLoopActive = false
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
}

/**
 * 处理鼠标点击：检测点击的3D物体
 */
const handleClick = (event: MouseEvent) => {
  if (!props.scene || !props.camera || !props.renderer) return

  // 转相机或拖物体后浏览器补发的 click 不是「点选」，不能拿它改选中
  if (suppressNextClick) {
    suppressNextClick = false
    return
  }

  // 计算鼠标在标准化设备坐标中的位置（-1到1）
  // 必须用容器的边界矩形换算，clientWidth/clientHeight 会忽略容器在视口中的偏移
  if (!containerRef.value) return
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width === 0 || rect.height === 0) return

  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  // 射线检测：只检测 store 管理的对象，避免命中地面/辅助线后选中一个不存在的对象
  raycaster.setFromCamera(mouse, props.camera)

  const pickable = sceneEditorStore.objects
    .filter((item) => item.visible !== false && item.threeObject)
    .map((item) => item.threeObject as THREE.Object3D)

  const intersects = pickable.length > 0 ? raycaster.intersectObjects(pickable, true) : []

  // 触发点击事件
  const clickedObject = intersects.length > 0 ? intersects[0].object : null
  emit('viewport-click', clickedObject)
}

/** 从命中的子对象往上找到 store 里登记的根对象（模型是 Group，命中是子 mesh） */
const findStoreRoot = (object: Object3D): Object3D | null => {
  let root: Object3D = object
  while (root.parent && root.parent !== props.scene) root = root.parent
  return sceneEditorStore.objects.some((item) => item.uuid === root.uuid) ? root : null
}

/** 把屏幕坐标换成命中结果；只检测 store 管理的对象，地面/辅助线永远选不中 */
const pickAtClient = (
  clientX: number,
  clientY: number,
): { root: Object3D; point: THREE.Vector3 } | null => {
  if (!containerRef.value || !props.camera) return null
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, props.camera)

  const pickable = sceneEditorStore.objects
    .filter((item) => item.visible !== false && item.threeObject)
    .map((item) => item.threeObject as Object3D)
  const intersects = pickable.length > 0 ? raycaster.intersectObjects(pickable, true) : []
  if (intersects.length === 0) return null

  const root = findStoreRoot(intersects[0].object)
  if (!root) return null
  return { root, point: intersects[0].point.clone() }
}

/** 射线与「过 planeY 的水平面」的交点；相机与地面平行时可能没有交点 */
const intersectHorizontalPlane = (
  clientX: number,
  clientY: number,
  planeY: number,
): THREE.Vector3 | null => {
  if (!containerRef.value || !props.camera) return null
  const rect = containerRef.value.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null

  mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1
  raycaster.setFromCamera(mouse, props.camera)

  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY)
  const point = new THREE.Vector3()
  return raycaster.ray.intersectPlane(plane, point) ? point : null
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value))

/**
 * 按住物体开始拖拽。
 *
 * 在**捕获阶段**调用并阻断传播：OrbitControls 挂在 canvas 上，
 * 它收不到 pointerdown 就不会启动相机旋转。
 */
const handlePointerDown = (event: PointerEvent) => {
  if (event.button !== 0) return

  // 记录按下点：无论后面是「拖物体」还是「交给 OrbitControls 转相机」，
  // 松手后的 click 都要靠它判断是不是一次真正的点选
  pressStart = { x: event.clientX, y: event.clientY }
  suppressNextClick = false

  const hit = pickAtClient(event.clientX, event.clientY)
  if (!hit) return

  event.stopPropagation()
  event.preventDefault()

  // 立即选中：不用等浏览器补发 click，拖动过程中属性面板就能看到
  sceneEditorStore.setSelectedObject(hit.root.uuid)

  dragState = {
    uuid: hit.root.uuid,
    object: hit.root,
    pointerId: event.pointerId,
    startClientX: event.clientX,
    startClientY: event.clientY,
    planeY: hit.root.position.y,
    offset: new THREE.Vector3(
      hit.root.position.x - hit.point.x,
      0,
      hit.root.position.z - hit.point.z,
    ),
    beforeDocument: sceneEditorStore.snapshotForHistory(),
    moved: false,
    wasPaused: sceneEditorStore.simulationState.isPaused,
  }

  // 拖拽期间停物理：否则刚体每帧把 mesh 拉回去，拖起来像在跟弹簧较劲
  sceneEditorStore.simulationState.isPaused = true
  if (containerRef.value) {
    containerRef.value.style.cursor = 'grabbing'
    try {
      containerRef.value.setPointerCapture(event.pointerId)
    } catch {
      // jsdom / 老浏览器不支持指针捕获：window 监听仍能收到 move/up
    }
  }

  window.addEventListener('pointermove', handlePointerMove, { passive: false })
  window.addEventListener('pointerup', handlePointerUp)
  window.addEventListener('pointercancel', handlePointerUp)
}

const handlePointerMove = (event: PointerEvent) => {
  const state = dragState
  if (!state) return

  if (!state.moved) {
    const distance = Math.hypot(
      event.clientX - state.startClientX,
      event.clientY - state.startClientY,
    )
    if (distance < DRAG_THRESHOLD_PX) return

    // 第一次真正移动才入历史栈：单击选中不会留下一条空撤销
    sceneEditorStore.pushHistory('拖动物体', state.beforeDocument)
    state.moved = true
  }

  event.preventDefault()

  const point = intersectHorizontalPlane(event.clientX, event.clientY, state.planeY)
  if (!point) return

  // 留 0.4 米边距：物体中心不能被拖到地面边缘之外
  const half = Math.max(1, sceneEditorStore.worldSize / 2 - 0.4)
  // 按住 Shift 吸附到 0.5 米网格：教学/展厅里要精确对齐时不用去属性面板敲数字
  const snap = (value: number): number => (event.shiftKey ? Math.round(value * 2) / 2 : value)
  sceneEditorStore.updateObject(state.uuid, {
    position: {
      x: clamp(snap(point.x + state.offset.x), -half, half),
      y: state.planeY,
      z: clamp(snap(point.z + state.offset.z), -half, half),
    },
  })
}

const handlePointerUp = () => {
  const state = dragState
  if (!state) return
  dragState = null

  // 恢复用户原来的暂停状态：本来暂停就继续暂停，本来在跑就继续跑
  sceneEditorStore.simulationState.isPaused = state.wasPaused
  if (containerRef.value) {
    containerRef.value.style.cursor = ' '
    try {
      containerRef.value.releasePointerCapture(state.pointerId)
    } catch {
      // 没捕获成功时释放会抛错：忽略
    }
  }

  window.removeEventListener('pointermove', handlePointerMove)
  window.removeEventListener('pointerup', handlePointerUp)
  window.removeEventListener('pointercancel', handlePointerUp)
}

/** 松手时记录这一次按下有没有移动过：移动过就抑制随后补发的 click */
const handleContainerPointerUp = (event: PointerEvent) => {
  if (event.button !== 0 || !pressStart) return
  const distance = Math.hypot(event.clientX - pressStart.x, event.clientY - pressStart.y)
  if (distance > DRAG_THRESHOLD_PX) suppressNextClick = true
  pressStart = null
}

/** 悬停到可拖拽物体上时把光标换成抓取手型 */
const handleHover = (event: PointerEvent) => {
  if (dragState || !containerRef.value) return
  const hit = pickAtClient(event.clientX, event.clientY)
  containerRef.value.style.cursor = hit ? 'grab' : ''
}

/**
 * 处理尺寸变化：调整渲染器和相机
 */
const handleResize = () => {
  if (!containerRef.value || !props.renderer || !props.camera) return

  const { clientWidth, clientHeight } = containerRef.value
  // 尺寸为 0 时算出来的比例是 NaN，会让整个投影矩阵失效
  if (clientWidth <= 0 || clientHeight <= 0) return

  props.renderer.setSize(clientWidth, clientHeight, false)

  // 发送事件让父组件更新相机，而不是直接修改props
  // 仅对透视相机/正交相机处理aspect（解决"updateProjectionMatrix不存在"的问题）
  if (props.camera instanceof THREE.PerspectiveCamera) {
    emit('update-camera', {
      type: 'perspective',
      aspect: clientWidth / clientHeight,
    })
  } else if (props.camera instanceof THREE.OrthographicCamera) {
    // 正交相机特殊处理（根据需要调整）
    emit('update-camera', {
      type: 'orthographic',
      left: -clientWidth / 2,
      right: clientWidth / 2,
      top: clientHeight / 2,
      bottom: -clientHeight / 2,
    })
  }

  // ⚠️ 同步补一帧渲染：setSize 重置 drawing buffer（清空画布），渲染循环的
  // 下一帧在下一个 rAF 才到——清空帧会被合成器采样输出成黑闪（侧边栏
  // hover 展开每次交互闪 1-2 次的最终根因）。同一回调内立即 render，
  // 清空帧被新内容覆盖，合成器无空帧可采。
  if (props.scene) {
    props.renderer.render(props.scene, props.camera)
  }
}

// 生命周期
onMounted(() => {
  const container = containerRef.value
  if (!container) {
    return
  }

  // 使用nextTick确保DOM完全渲染后再初始化
  nextTick(() => {
    // 初始化渲染器
    initRenderer()

    // 启动渲染循环
    startRendering()

    // 绑定点击事件（选中/取消选中）
    container.addEventListener('click', handleClick)
    // 拖拽：捕获阶段拦下按在物体上的 pointerdown，避免 OrbitControls 同时转相机
    container.addEventListener('pointerdown', handlePointerDown, true)
    container.addEventListener('pointerup', handleContainerPointerUp)
    container.addEventListener('pointermove', handleHover)
    pressStart = null
    suppressNextClick = false
    container.addEventListener('pointerleave', () => {
      if (!dragState && containerRef.value) containerRef.value.style.cursor = ''
    })

    // 监听尺寸变化（使用ResizeObserver替代useThree.size，避免依赖）。
    // ⚠️ 回调防抖：侧边栏 hover 展开是 CSS 过渡，宽度每帧都在变——
    // ResizeObserver 每帧触发 setSize 会反复重置 drawing buffer（清空画布）
    // → 肉眼可见的闪烁。防抖到过渡结束后一次性精确对齐；过渡期间 canvas
    // 由 CSS width/height 100% 平滑拉伸显示，无跳变。
    resizeObserver = new ResizeObserver(() => {
      if (resizeDebounce !== null) window.clearTimeout(resizeDebounce)
      resizeDebounce = window.setTimeout(() => {
        resizeDebounce = null
        if (!isUnmounted.value) handleResize()
      }, 220)
    })
    resizeObserver.observe(container)
  })
})

onUnmounted(() => {
  // 标记组件已卸载
  isUnmounted.value = true

  // 清理渲染循环
  stopRendering()

  // 清理防抖
  if (resizeDebounce !== null) {
    window.clearTimeout(resizeDebounce)
    resizeDebounce = null
  }

  // 移除事件监听
  const container = containerRef.value
  if (container) {
    container.removeEventListener('click', handleClick)
    container.removeEventListener('pointerdown', handlePointerDown, true)
    container.removeEventListener('pointerup', handleContainerPointerUp)
    container.removeEventListener('pointermove', handleHover)
  }

  // 拖到一半卸载：把 window 上的临时监听与暂停状态收干净
  if (dragState) {
    dragState = null
    sceneEditorStore.simulationState.isPaused = false
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', handlePointerUp)
    window.removeEventListener('pointercancel', handlePointerUp)
  }

  // 停止尺寸监听
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// 监听props变化（场景/相机/渲染器更新时重新初始化）
watch(
  () => [props.scene, props.camera, props.renderer],
  (newValues) => {
    // 只有当所有三个值都存在时，才重新初始化渲染器
    if (newValues[0] && newValues[1] && newValues[2]) {
      // 确保canvas已添加到DOM中
      const renderer = newValues[2]
      if (
        containerRef.value &&
        renderer instanceof THREE.WebGLRenderer &&
        !containerRef.value.contains(renderer.domElement)
      ) {
        containerRef.value.appendChild(renderer.domElement)
      }

      // 重新初始化渲染器尺寸与相机比例
      // 相机可能比视口晚到（物理引擎是异步加载的）：
      // 这一步必须把比例重新发出去，否则画面会一直停在初始的 4:3。
      const container = containerRef.value
      if (container) {
        handleResize()
      }
    }
  },
)

// 监听 store 的仿真状态
//
// ⚠️ 这里**只能**启动渲染，不能因为标志变 false 就停：
// `renderState.isSimulationRunning` 是「仿真/记账循环是否在跑」的标志，
// 「暂停模拟」会把它置为 false。若把它当成渲染开关，暂停就会把整个画布冻住
// （画面不再刷新、连相机都转不动）。
// 渲染循环的生命周期归组件所有：挂载时启动，卸载时停止。
watch(
  () => sceneEditorStore.renderState.isSimulationRunning,
  (newState) => {
    if (newState && !isRendering.value) {
      startRendering()
    }
  },
  { immediate: true },
)
</script>

<style scoped>
.viewport-container {
  width: 100%;
  height: 100%;
  min-height: 500px; /* 确保有最小高度 */
  overflow: hidden;
  position: relative;
  background-color: var(--bg-canvas); /* 深色背景，便于区分3D物体 */
  transition: background-color 0.5s ease; /* 添加过渡效果 */
}

/* 组件加载时的特殊样式 */
.viewport-container.loading {
  background-color: var(--bg-inset); /* 加载时的背景色 */
  animation: pulse 2s infinite; /* 脉冲动画 */
}

@keyframes pulse {
  0% {
    border-color: var(--accent);
  }
  50% {
    border-color: var(--success);
  }
  100% {
    border-color: var(--accent);
  }
}

/* 确保Three.js画布占满容器 */
:deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  touch-action: none; /* 禁用触摸缩放，避免交互冲突 */
}
</style>
