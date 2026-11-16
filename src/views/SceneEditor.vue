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

    <Toolbar class="editor-toolbar ws-toolbar" />
    <div class="editor-main-content">
      <!-- ThreeScene组件在整个生命周期都需要存在，负责初始化和管理场景 -->
      <ThreeScene
        ref="threeScene"
        @expose-methods="exposeMethods"
        @init-success="handleSceneInitSuccess"
        @init-error="handleInitError"
      />

      <!-- Viewport组件也在整个生命周期存在，负责渲染场景 -->
      <div class="viewport-wrapper ws-viewport">
        <Viewport
          :scene="sceneStore.getScene()"
          :camera="sceneStore.getCamera()"
          :renderer="sceneStore.getRenderer()"
          :update-physics="sceneMethods.updatePhysics"
          @viewport-click="handleViewportClick"
          @update-camera="handleUpdateCamera"
        />
      </div>

      <!-- 右栏：属性编辑与场景管理两条动线分 tab，v-show 保持挂载（选中状态不丢） -->
      <aside class="editor-side ws-side">
        <div class="side-tabs" role="tablist" aria-label="编辑器侧栏">
          <button
            type="button"
            class="side-tab"
            :class="{ active: editorTab === 'props' }"
            role="tab"
            :aria-selected="editorTab === 'props'"
            @click="editorTab = 'props'"
          >
            属性
          </button>
          <button
            type="button"
            class="side-tab"
            :class="{ active: editorTab === 'scenes' }"
            role="tab"
            :aria-selected="editorTab === 'scenes'"
            @click="editorTab = 'scenes'"
          >
            场景
          </button>
        </div>
        <div v-show="editorTab === 'props'" class="side-body">
          <PropertyPanel />
        </div>
        <div v-show="editorTab === 'scenes'" class="side-body">
          <SceneList />
        </div>
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onUnmounted, provide, watch } from 'vue'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import ThreeScene from '@/components/three/core/ThreeScene.vue'
import Toolbar from '@/components/three/panels/Toolbar.vue'
import PropertyPanel from '@/components/three/panels/PropertyPanel.vue'
import SceneList from '@/components/three/panels/SceneList.vue'
import Viewport from '@/components/three/panels/Viewport.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useModelStore } from '@/stores/modelStore'

// 组件引用与状态
const threeScene = ref<InstanceType<typeof ThreeScene> | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')

// 右栏当前 tab：「属性」编辑与「场景」管理两条动线分开。
// 两个面板都 v-show 挂载——切换 tab 不卸载组件，选中状态与场景列表不丢。
const editorTab = ref<'props' | 'scenes'>('props')

// 状态管理
const sceneStore = useSceneEditorStore()
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
  // 基本体工厂依赖这些方法（建体要真能建出来），到这里才具备条件：
  // 场景编辑器据此把路由指定的场景真正放进 3D 视图。
  void loadSceneFromRoute()
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

  // 启用物理模拟
  sceneStore.togglePlayState()
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

// 视口把真实的宽高比交回来
//
// 相机的比例必须跟着视口走：初始化时用的是 800×600 的兜底比例（4:3），
// 不接这个事件的话画面会一直横向拉宽。
const handleUpdateCamera = (data: { type: 'perspective' | 'orthographic'; aspect?: number }) => {
  const camera = sceneStore.getCamera()
  if (!camera || data.type !== 'perspective' || !data.aspect) return

  if (camera instanceof THREE.PerspectiveCamera) {
    camera.aspect = data.aspect
    camera.updateProjectionMatrix()
  }
}

/**
 * 加载路由指定的场景。
 *
 * ⚠️ 必须等**物理方法就绪之后**再加载：`loadScene` 靠基本体工厂把物体连同
 * 刚体一起重建，而工厂是「场景列表」组件注册的，它用的 `addCube` 来自
 * `ThreeScene` 暴露的方法——那要等场景初始化完成才拿得到。
 * 早一步调用，工厂建体返回 false，场景看着在列表里、3D 视图却是空的。
 */
const loadSceneFromRoute = async () => {
  const sceneId = router.currentRoute.value.query.sceneId
  if (!sceneId || typeof sceneId !== 'string') return
  try {
    await sceneStore.loadScene(sceneId)
  } catch (err: unknown) {
    // 加载失败不打断页面，但现场必须留下来
    console.warn('[SceneEditor] 加载场景失败', err)
  }
}

// 路由里的场景变了就重新加载：物理方法就绪后第一次，之后每次切换都跟。
watch(
  () => router.currentRoute.value.query.sceneId,
  () => {
    void loadSceneFromRoute()
  },
)

// 当组件卸载时清理状态
onUnmounted(() => {
  // 未被消费的「待导入模型」不能留到下次进入编辑器时被意外导入
  modelStore.selectedModelId = null
})
</script>

<style scoped>
/*
 * 骨架类分工：.ws-toolbar（工具条底色/分隔）、.ws-viewport（视口底色）、
 * .ws-side（右栏底色/边框）由 app-global.css 统一提供，
 * 这里只保留各容器的差异化布局。
 */
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
}

.editor-side {
  flex: 0 0 300px;
  /* tab 常驻：滚动交给 .side-body，骨架类的 overflow-y:auto 在此收口 */
  overflow: hidden;
}

/* 「属性 | 场景」tab 条：样式对齐 ModelLibrary 的 category-tab 风格 */
.side-tabs {
  display: flex;
  gap: 8px;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border-subtle);
  flex: 0 0 auto;
}

.side-tab {
  flex: 1 1 0;
  padding: 7px 12px;
  background-color: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.side-tab.active {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
  font-weight: 600;
}

.side-tab:hover:not(.active) {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-1);
}

.side-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

/* 窄屏：视口在上（固定高度），右栏全宽落到下方，整页纵向滚动 */
@media (max-width: 992px) {
  .scene-editor {
    height: auto;
    min-height: 100vh;
  }

  .editor-main-content {
    flex: 0 0 auto;
    flex-direction: column;
    overflow: visible;
  }

  .viewport-wrapper {
    flex: 0 0 auto;
    width: 100%;
    height: 420px;
    min-height: 420px;
  }

  .editor-side {
    flex: 0 0 auto;
    width: 100%;
    border-left: 0;
  }
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
  color: var(--text-1);
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 5px solid var(--border-strong);
  border-radius: 50%;
  border-top-color: var(--text-1);
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
  color: var(--text-1);
}

.error-message {
  color: var(--danger);
  font-size: 18px;
  margin-bottom: 20px;
}

.retry-btn {
  padding: 10px 20px;
  background: var(--accent-strong);
  color: #ffffff;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.retry-btn:hover {
  background: var(--accent-strong-hover);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}
</style>
