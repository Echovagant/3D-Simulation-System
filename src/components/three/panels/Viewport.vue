<template>
  <!-- 这是Three.js渲染的容器，画布会通过JS动态挂载到这个div中 -->
  <div class="viewport-container" ref="containerRef">
    <div class="debug-indicator">Viewport组件已加载</div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, type Ref, inject } from 'vue'
import * as THREE from 'three'
import type { Scene, Camera, WebGLRenderer,  Object3D } from 'three'
import type { SceneEditorStore } from '@/types'

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
    updatePhysics: () => void
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

// 注入store
const sceneEditorStore = inject<SceneEditorStore>('sceneEditorStore')
let resizeObserver: ResizeObserver | null = null

// 调试：记录props接收状态
  if (import.meta.env.DEV) {
    console.log('[Viewport] 组件创建，接收到的props:')
    console.log('[Viewport] scene:', props.scene)
    console.log('[Viewport] camera:', props.camera)
    console.log('[Viewport] renderer:', props.renderer)
    console.log('[Viewport] updatePhysics:', props.updatePhysics)
  }

  // 添加定时器持续检查props状态
  if (import.meta.env.DEV) {
    setInterval(() => {
      console.log('[Viewport] 定时检查props状态:')
      console.log('[Viewport] scene存在吗?', !!props.scene)
      console.log('[Viewport] camera存在吗?', !!props.camera)
      console.log('[Viewport] renderer存在吗?', !!props.renderer)
      console.log('[Viewport] 渲染循环正在运行吗?', isRendering.value)
    }, 3000);
  }

/**
   * 初始化渲染器：将Three.js的canvas插入到容器中
   */
  const initRenderer = () => {

    // 检查props有效性
  if (!props.scene || !props.camera || !props.renderer) {

      // 清理现有渲染器
      if (localRenderer.value) {
        containerRef.value?.removeChild(localRenderer.value.domElement)
        localRenderer.value.dispose()
        localRenderer.value = null
      }

      // 创建备用场景和渲染器
      if (!containerRef.value) {
        if (import.meta.env.DEV) {
          console.log('[Viewport] 容器不存在')
        }
        return
      }

      try {
        // 创建简单的Three.js场景进行测试
        const testScene = new THREE.Scene();
        testScene.background = new THREE.Color(0x000000);

        // 创建相机
        const testCamera = new THREE.PerspectiveCamera(
          75,
          containerRef.value.clientWidth / containerRef.value.clientHeight,
          0.1,
          1000
        );
        testCamera.position.z = 5;

        // 创建渲染器
        const testRenderer = new THREE.WebGLRenderer({ antialias: true });
        testRenderer.setSize(
          containerRef.value.clientWidth,
          containerRef.value.clientHeight
        );

        // 创建一个简单的立方体
        const geometry = new THREE.BoxGeometry();
        const material = new THREE.MeshBasicMaterial({
          color: 0x00ff00,
          wireframe: true
        });
        const cube = new THREE.Mesh(geometry, material);
        testScene.add(cube);

        // 添加辅助坐标轴
        const axesHelper = new THREE.AxesHelper(3);
        testScene.add(axesHelper);

        // 添加到容器
        containerRef.value.appendChild(testRenderer.domElement);

        // 确保canvas元素有正确的尺寸和样式
        testRenderer.domElement.style.width = '100%';
        testRenderer.domElement.style.height = '100%';
        testRenderer.domElement.style.display = 'block';
        testRenderer.domElement.style.position = 'absolute';
        testRenderer.domElement.style.top = '0';
        testRenderer.domElement.style.left = '0';

        // 保存本地引用
        localRenderer.value = testRenderer;

        // 修改渲染循环以使用测试场景
        const testRenderLoop = () => {
          if (!isRendering.value) return;

          // 简单的旋转动画
          if (cube) {
            cube.rotation.x += 0.01;
            cube.rotation.y += 0.01;
          }

          testRenderer.render(testScene, testCamera);
          animationFrameId = requestAnimationFrame(testRenderLoop);
        };

        // 如果渲染循环已启动，使用测试循环
        if (isRendering.value) {
          stopRendering();
          isRendering.value = true;
          testRenderLoop();
        }

        return;
      } catch (error) {
        if (import.meta.env.DEV) {
          console.error('[Viewport] 创建备用场景失败:', error)
        }
        return;
      }
    }

  // 确保容器存在
  if (!containerRef.value) {
    if (import.meta.env.DEV) {
      console.log('[Viewport] 容器不存在')
    }
    return
  }

  if (import.meta.env.DEV) {
    console.log('[Viewport] 开始初始化渲染器')
    console.log(
      '[Viewport] 容器尺寸:',
      containerRef.value.clientWidth,
      'x',
      containerRef.value.clientHeight,
    )
  }

  // 确保props有效
  if (!props.scene || !props.camera || !props.renderer) {
    if (import.meta.env.DEV) {
      console.log('[Viewport] props无效，无法完成渲染器初始化')
    }
    return
  }

  // 设置渲染器尺寸
  props.renderer.setSize(containerRef.value.clientWidth, containerRef.value.clientHeight)

  // 如果canvas不在容器中，则添加
  if (!containerRef.value.contains(props.renderer.domElement)) {
    if (import.meta.env.DEV) {
      console.log('[Viewport] 添加canvas到容器')
      console.log('[Viewport] canvas元素:', props.renderer.domElement)
      console.log(
        '[Viewport] canvas尺寸:',
        props.renderer.domElement.width,
        'x',
        props.renderer.domElement.height,
      )
    }
    containerRef.value.appendChild(props.renderer.domElement)
  } else {
    if (import.meta.env.DEV) {
      console.log('[Viewport] canvas已在容器中')
    }
  }

  // 检查场景中的对象数量
  if (import.meta.env.DEV) {
    console.log('[Viewport] 场景中的对象数量:', props.scene.children.length);
    // 列出场景中的主要对象类型
    const objectTypes = props.scene.children.map(child => child.type);
    console.log('[Viewport] 场景中的对象类型:', objectTypes);
  }

  // 检查canvas是否真的在DOM中
  setTimeout(() => {
    if (import.meta.env.DEV) {
      const canvasInDOM = containerRef.value?.contains(props.renderer!.domElement)
      console.log('[Viewport] 验证canvas是否在DOM中:', canvasInDOM)

      // 检查canvas是否可见
      if (props.renderer?.domElement) {
        const style = props.renderer.domElement
          ? window.getComputedStyle(props.renderer.domElement)
          : null
        console.log('[Viewport] canvas显示状态:', style?.display)
        console.log('[Viewport] canvas可见性:', style?.visibility)
        console.log('[Viewport] canvas透明度:', style?.opacity)
      }
    }
  }, 100)

  // 更新本地引用
  localRenderer.value = props.renderer
  if (import.meta.env.DEV) {
    console.log('[Viewport] 渲染器初始化完成')
  }
}

/**
 * 渲染循环：持续渲染场景
 */
const renderLoop = () => {
  if (!props.scene || !props.camera || !props.renderer || !isRendering.value) {
    // 如果props为空或渲染已停止，跳过渲染
    animationFrameId = requestAnimationFrame(renderLoop);
    return;
  }

  // 更新store中的渲染状态
  if (sceneEditorStore) {
    sceneEditorStore.renderState.isRendering = true;
  }

  // 调用物理更新函数
  if (props.updatePhysics) {
    try {
      props.updatePhysics();
    } catch (error) {
      if (import.meta.env.DEV) {
        console.error('[Viewport] 物理更新出错:', error);
      }
      // 在store中记录错误
      if (sceneEditorStore) {
        sceneEditorStore.addPhysicsError('Viewport物理更新失败', error as Error);
      }
    }
  }

  // 只在开发环境下输出性能日志
  if (import.meta.env.DEV) {
    const startTime = performance.now();
    props.renderer.render(props.scene, props.camera);
    const renderTime = performance.now() - startTime;

    // 只在渲染时间较长时输出警告
    if (renderTime > 16) { // 60fps的帧时间约为16ms
      console.warn(`[Viewport] 渲染耗时: ${renderTime.toFixed(2)}ms`);
      const warning: PerformanceWarning = {
        message: `渲染耗时超过阈值`,
        timestamp: Date.now(),
        details: {
          renderTime: renderTime,
          threshold: 16
        }
      };
      
      // 在store中记录性能警告
      if (sceneEditorStore) {
        sceneEditorStore.addPerformanceWarning(`渲染耗时超过阈值: ${renderTime.toFixed(2)}ms`, warning.details);
      }
      
      // 发出性能警告事件
      emit('performance-warning', warning);
    }
  } else {
    // 生产环境直接渲染，无日志
    props.renderer.render(props.scene, props.camera);
  }

  animationFrameId = requestAnimationFrame(renderLoop);
};

/**
 * 启动渲染循环
 */
const startRendering = () => {
  if (isRendering.value) return
  isRendering.value = true
  if (import.meta.env.DEV) {
    console.log('[Viewport] 启动渲染循环')
  }
  renderLoop()
}

/**
 * 停止渲染循环
 */
const stopRendering = () => {
  isRendering.value = false
  if (import.meta.env.DEV) {
    console.log('[Viewport] 停止渲染循环')
  }
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId)
  }
  
  // 更新store中的渲染状态
  if (sceneEditorStore) {
    sceneEditorStore.renderState.isRendering = false;
  }
}

/**
 * 处理鼠标点击：检测点击的3D物体
 */
const handleClick = (event: MouseEvent) => {
  if (!props.scene || !props.camera || !props.renderer) return

  // 计算鼠标在标准化设备坐标中的位置（-1到1）
  if (!containerRef.value) return
  const { clientWidth, clientHeight } = containerRef.value
  mouse.x = (event.clientX / clientWidth) * 2 - 1
  mouse.y = -(event.clientY / clientHeight) * 2 + 1

  // 射线检测
  raycaster.setFromCamera(mouse, props.camera)
  const intersects = props.scene ? raycaster.intersectObjects(props.scene.children, true) : []

  // 触发点击事件
  emit('viewport-click', intersects.length > 0 ? intersects[0].object : null)
}

/**
 * 处理尺寸变化：调整渲染器和相机
 */
const handleResize = () => {
  if (!containerRef.value || !props.renderer || !props.camera) return

  const { clientWidth, clientHeight } = containerRef.value
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
  if (import.meta.env.DEV) {
    console.log('[Viewport] 组件挂载');
  }
  const container = containerRef.value;
  if (!container) {
    if (import.meta.env.DEV) {
      console.log('[Viewport] 容器不存在，无法初始化');
    }
    return;
  }

  if (import.meta.env.DEV) {
    console.log('[Viewport] 容器尺寸:', container.clientWidth, 'x', container.clientHeight);
  }

  // 初始化渲染器
  initRenderer();

  // 启动渲染循环
  startRendering();

  // 绑定点击事件
  container.addEventListener('click', handleClick);

  // 监听尺寸变化（使用ResizeObserver替代useThree.size，避免依赖）
  resizeObserver = new ResizeObserver(entries => {
    if (import.meta.env.DEV && entries.length > 0) {
      console.log('[Viewport] 容器尺寸变化:', entries[0]?.contentRect);
    }
    if (entries.length > 0) handleResize();
  });
  resizeObserver.observe(container);
});

onUnmounted(() => {
  if (import.meta.env.DEV) {
    console.log('[Viewport] 组件卸载')
  }
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
    if (import.meta.env.DEV) {
      console.log('[Viewport] props变化，重新初始化渲染器')
      console.log('[Viewport] 新scene:', newValues[0])
      console.log('[Viewport] 新camera:', newValues[1])
      console.log('[Viewport] 新renderer:', newValues[2])
      console.log('[Viewport] 旧scene:', oldValues[0])
      console.log('[Viewport] 旧camera:', oldValues[1])
      console.log('[Viewport] 旧renderer:', oldValues[2])
    }

    // 重新初始化渲染器
    initRenderer()

    // 如果渲染器已启动，重新开始渲染循环
    if (isRendering.value) {
      stopRendering()
      startRendering()
    }
  },
  { deep: true },
)

// 监听store中的渲染状态变化
if (sceneEditorStore) {
  watch(
    () => sceneEditorStore.renderState.isRendering,
    (newState) => {
      if (newState !== isRendering.value) {
        if (newState) {
          startRendering()
        } else {
          stopRendering()
        }
      }
    },
    { immediate: true }
  )
}
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
  0% { border-color: #3b82f6; }
  50% { border-color: #10b981; }
  100% { border-color: #3b82f6; }
}

/* 调试指示器样式 */
.debug-indicator {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 1000;
}

/* 确保Three.js画布占满容器 */
:deep(canvas) {
  display: block;
  width: 100% !important;
  height: 100% !important;
  touch-action: none; /* 禁用触摸缩放，避免交互冲突 */
}
</style>
