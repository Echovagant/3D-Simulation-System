<template>
  <div class="scene-editor">
    <!-- 加载状态 -->
    <div v-if="isLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>SceneEditor场景初始化中...</p>
    </div>

    <!-- 错误提示 -->
    <div v-if="errorMessage" class="error-overlay">
      <p class="error-message">{{ errorMessage }}</p>
      <button @click="retryInit" class="retry-btn">重试</button>
    </div>

    <Toolbar class="editor-toolbar" @import-model="handleImportModel" />
    <div class="editor-main-content">
      <!-- ThreeScene组件在整个生命周期都需要存在，负责初始化和管理场景 -->
      <ThreeScene
        ref="threeScene"
        @expose-methods="exposeMethods"
        @init-success="handleSceneInitSuccess"
        @init-error="handleInitError"
      />

      <!-- Viewport组件也在整个生命周期存在，负责渲染场景 -->
      <div class="viewport-wrapper" ref="containerRef">
        <Viewport
          :scene="sceneStore.getScene()"
          :camera="sceneStore.getCamera()"
          :renderer="sceneStore.getRenderer()"
          :update-physics="sceneMethods.updatePhysics"
          @viewport-click="handleViewportClick"
        />
      </div>
      <PropertyPanel class="property-panel" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, provide } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import ThreeScene from '@/components/three/core/ThreeScene.vue'
import Toolbar from '@/components/three/panels/Toolbar.vue'
import PropertyPanel from '@/components/three/panels/PropertyPanel.vue'
import Viewport from '@/components/three/panels/Viewport.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useSceneEditor } from '@/composables/useSceneEditor'
import { useModelStore } from '@/stores/modelStore'

// 组件引用与状态
const threeScene = ref<InstanceType<typeof ThreeScene> | null>(null)
const containerRef = ref<HTMLDivElement | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')
const importModelInProgress = ref(false)

// 状态管理
const sceneStore = useSceneEditorStore()
const sceneEditor = useSceneEditor(containerRef)
const modelStore = useModelStore()
const router = useRouter()

// 场景方法
const sceneMethods = ref<{
  addCube: () => boolean
  addSphere: () => boolean
  importModel: (modelId: string) => Promise<boolean>
  getIsSceneInitialized: () => boolean
  // 物理推进函数接收 rAF 的时间戳：固定步长累加器靠它算真实时间
  updatePhysics: (timestamp?: number) => void
}>({
  addCube: () => false,
  addSphere: () => false,
  importModel: async () => false,
  getIsSceneInitialized: () => false,
  updatePhysics: () => {},
})

// 提供方法给Toolbar组件
provide('addCube', () => sceneMethods.value.addCube())
provide('addSphere', () => sceneMethods.value.addSphere())
provide('importModel', (modelId: string) => sceneMethods.value.importModel(modelId))
provide('getIsSceneInitialized', () => sceneMethods.value.getIsSceneInitialized())

// 接收ThreeScene暴露的方法
const exposeMethods = (methods: {
  addCube: () => boolean
  addSphere: () => boolean
  importModel: (modelId: string) => Promise<boolean>
  getIsSceneInitialized: () => boolean
  updatePhysics: (timestamp?: number) => void
}) => {
  sceneMethods.value = methods
}

// 处理初始化错误
const handleInitError = (err: string) => {
  isLoading.value = false
  errorMessage.value = err
}

// 处理场景初始化成功
const handleSceneInitSuccess = () => {
  isLoading.value = false
  errorMessage.value = ''

  // 直接在编辑器中创建立方体进行测试
  setTimeout(() => {
    if (sceneMethods.value.addCube()) {
      if (import.meta.env.DEV) {
      }
    } else {
      if (import.meta.env.DEV) {
      }
    }
  }, 1000)

  // 启用物理模拟
  sceneStore.togglePlayState()

  if (import.meta.env.DEV) {
  }
}

// 重试初始化
const retryInit = () => {
  errorMessage.value = ''
  isLoading.value = true
  threeScene.value?.reinit()
}

// 处理视口点击事件：把命中的对象映射到 store 管理的对象，并维护选中高亮
const handleViewportClick = (object: THREE.Object3D | null) => {
  // 先复位所有物体的高亮
  sceneStore.objects.forEach((item) => {
    const mesh = item.threeObject
    if (mesh && mesh instanceof THREE.Mesh) {
      const material = mesh.material as THREE.MeshStandardMaterial
      if (material.emissive) material.emissive.set(0x000000)
    }
  })

  if (!object) {
    sceneStore.setSelectedObject(null)
    return
  }

  // 查找根对象，处理子对象的情况
  let rootObject = object
  while (rootObject.parent && rootObject.parent.type !== 'Scene') {
    rootObject = rootObject.parent
  }

  // 只有 store 里真实存在的对象才能被选中（命中地面/辅助线时不产生选中）
  const matched = sceneStore.objects.find((item) => item.uuid === rootObject.uuid)
  if (!matched) {
    sceneStore.setSelectedObject(null)
    return
  }

  // 设置选中对象
  sceneStore.setSelectedObject(matched.uuid)

  // 高亮选中对象
  const mesh = matched.threeObject
  if (mesh && mesh instanceof THREE.Mesh) {
    const material = mesh.material as THREE.MeshStandardMaterial
    if (material.emissive) material.emissive.set(0xffff00)
  }
}

// 导入模型（与模型库交互）
const handleImportModel = async () => {
  if (!sceneMethods.value.getIsSceneInitialized()) {
    alert('场景尚未初始化完成，请稍后再试')
    return
  }

  // 跳转到模型库，并传递返回URL
  const returnUrl = router.currentRoute.value.fullPath
  importModelInProgress.value = true

  try {
    await router.push(`/model-library?returnUrl=${encodeURIComponent(returnUrl)}`)

    // 监听modelStore的selectedModelId变化
    const unwatch = watch(
      () => modelStore.selectedModelId,
      async (modelId) => {
        if (modelId && sceneMethods.value.getIsSceneInitialized()) {
          // 调用场景方法导入模型
          const success = await sceneMethods.value.importModel(modelId)

          if (success) {
          } else {
          }

          // 清除选中状态
          modelStore.selectedModelId = null
          unwatch()
          importModelInProgress.value = false
        }
      },
    )

    // 监听路由变化，如果用户取消选择返回，也需要清理状态
    const routeUnwatch = watch(
      () => router.currentRoute.value.path,
      (path) => {
        if (path !== '/model-library' && importModelInProgress.value) {
          importModelInProgress.value = false
          unwatch()
          routeUnwatch()
        }
      },
    )
  } catch (error) {
    importModelInProgress.value = false
  }
}

// 监听路由参数加载场景
onMounted(() => {
  const sceneId = router.currentRoute.value.query.sceneId
  if (sceneId && typeof sceneId === 'string') {
    sceneStore.loadScene(sceneId).catch((err: unknown) => {})
  }
})

// 当组件卸载时清理状态
onUnmounted(() => {
  if (importModelInProgress.value) {
    modelStore.selectedModelId = null
  }
})
</script>

<style scoped>
.scene-editor {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.editor-toolbar {
  flex: 0 0 auto;
  position: relative;
  z-index: 5; /* 确保低于侧边栏的z-index:10 */
}

.editor-main-content {
  display: flex;
  flex: 1 1 auto;
  overflow: hidden;
}

.viewport-wrapper {
  flex: 1 1 auto;
  position: relative;
  height: 100%;
  background: #000; /* 添加黑色背景以便更好地显示3D内容 */
}

.property-panel {
  flex: 0 0 300px;
  height: 100%;
}

.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  color: white;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 5px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
}

.error-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  color: white;
}

.error-message {
  color: #ff4444;
  font-size: 18px;
  margin-bottom: 20px;
}

.retry-btn {
  padding: 10px 20px;
  background: #3b82f6;
  color: white;
  border: none;
  border-radius: 4px;
  cursor: pointer;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
