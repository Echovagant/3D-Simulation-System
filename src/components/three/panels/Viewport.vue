<template>
  <!-- 这是Three.js渲染的容器，画布会通过JS动态挂载到这个div中 -->
  <div class="viewport-container" ref="containerRef"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, type Ref } from 'vue'
import * as THREE from 'three'
import type { Scene, Camera, WebGLRenderer, Object3D } from 'three'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

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

// Pinia store 是全局单例，直接取用（与 Toolbar.vue 的写法一致）
const sceneEditorStore = useSceneEditorStore()
let resizeObserver: ResizeObserver | null = null
let initRetryCount = 0
const MAX_INIT_RETRIES = 10
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
      props.renderer.setSize(800, 600)
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

/**
 * 处理尺寸变化：调整渲染器和相机
 */
const handleResize = () => {
  if (!containerRef.value || !props.renderer || !props.camera) return

  const { clientWidth, clientHeight } = containerRef.value
  // 尺寸为 0 时算出来的比例是 NaN，会让整个投影矩阵失效
  if (clientWidth <= 0 || clientHeight <= 0) return

  props.renderer.setSize(clientWidth, clientHeight)

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

    // 绑定点击事件
    container.addEventListener('click', handleClick)

    // 监听尺寸变化（使用ResizeObserver替代useThree.size，避免依赖）
    resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0) handleResize()
    })
    resizeObserver.observe(container)
  })
})

onUnmounted(() => {
  // 标记组件已卸载
  isUnmounted.value = true

  // 清理渲染循环
  stopRendering()

  // 移除事件监听
  const container = containerRef.value
  if (container) {
    container.removeEventListener('click', handleClick)
  }

  // 停止尺寸监听
  if (resizeObserver) {
    resizeObserver.disconnect()
  }
})

// 监听props变化（场景/相机/渲染器更新时重新初始化）
watch(
  () => [props.scene, props.camera, props.renderer],
  (newValues, oldValues) => {
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
  background-color: #1a1a1a; /* 深色背景，便于区分3D物体 */
  transition: background-color 0.5s ease; /* 添加过渡效果 */
}

/* 组件加载时的特殊样式 */
.viewport-container.loading {
  background-color: #2d3748; /* 加载时的背景色 */
  animation: pulse 2s infinite; /* 脉冲动画 */
}

@keyframes pulse {
  0% {
    border-color: #3b82f6;
  }
  50% {
    border-color: #10b981;
  }
  100% {
    border-color: #3b82f6;
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
