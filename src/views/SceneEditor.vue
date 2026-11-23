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
        <p class="viewport-hint">
          左键点选 · 按住拖动 · Shift 吸附网格 · Ctrl+Z 撤销 · Delete 删除
        </p>
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
import { ref, onMounted, onUnmounted, provide, watch } from 'vue'
import type { ScenePrimitiveSpec } from '@/types'
import type { PrimitiveCreateOptions } from '@/stores/sceneEditorStore'
import { useRouter } from 'vue-router'
import * as THREE from 'three'
import ThreeScene from '@/components/three/core/ThreeScene.vue'
import Toolbar from '@/components/three/panels/Toolbar.vue'
import PropertyPanel from '@/components/three/panels/PropertyPanel.vue'
import SceneList from '@/components/three/panels/SceneList.vue'
import Viewport from '@/components/three/panels/Viewport.vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useModelStore } from '@/stores/modelStore'
import { SHOWCASE_SCENES } from '@/data/showcaseScenes'

// 组件引用与状态
const threeScene = ref<InstanceType<typeof ThreeScene> | null>(null)
const isLoading = ref(true)
const errorMessage = ref('')
// 加载动画最短可见时长：本地热缓存下 Three.js 初始化瞬间完成，动画会
// 一闪而过（用户感知为「加载动画取消了」），低于此时长则补足剩余时间。
const LOADING_MIN_MS = 600
const loadingStartedAt = Date.now()

// 右栏当前 tab：「属性」编辑与「场景」管理两条动线分开。
// 两个面板都 v-show 挂载——切换 tab 不卸载组件，选中状态与场景列表不丢。
const editorTab = ref<'props' | 'scenes'>('props')

// 状态管理
const sceneStore = useSceneEditorStore()
const modelStore = useModelStore()
const router = useRouter()

// 场景方法
const sceneMethods = ref<{
  addCube: (options?: PrimitiveCreateOptions) => boolean
  addSphere: (options?: PrimitiveCreateOptions) => boolean
  addRamp: (options?: PrimitiveCreateOptions) => boolean
  addPrimitive: (spec: ScenePrimitiveSpec) => boolean
  importModel: (modelId: string) => Promise<boolean>
  getIsSceneInitialized: () => boolean
  // 物理推进函数接收 rAF 的时间戳：固定步长累加器靠它算真实时间
  updatePhysics: (timestamp?: number) => void
  setWorldSize: (size: number) => boolean
  focusScene: () => boolean
  applySceneCamera: (camera: unknown) => boolean
}>({
  addCube: () => false,
  addSphere: () => false,
  addRamp: () => false,
  addPrimitive: () => false,
  importModel: async () => false,
  getIsSceneInitialized: () => false,
  updatePhysics: () => {},
  setWorldSize: () => false,
  focusScene: () => false,
  applySceneCamera: () => false,
})

// 提供方法给Toolbar组件
provide('addCube', (options?: PrimitiveCreateOptions) => sceneMethods.value.addCube(options))
provide('addSphere', (options?: PrimitiveCreateOptions) => sceneMethods.value.addSphere(options))
provide('addRamp', (options?: PrimitiveCreateOptions) => sceneMethods.value.addRamp(options))
provide(
  'addPrimitive',
  (spec: ScenePrimitiveSpec) => sceneMethods.value.addPrimitive(spec),
)
provide('importModel', (modelId: string) => sceneMethods.value.importModel(modelId))
provide('getIsSceneInitialized', () => sceneMethods.value.getIsSceneInitialized())
provide('setWorldSize', (size: number) => sceneMethods.value.setWorldSize(size))
provide('focusScene', () => sceneMethods.value.focusScene())
provide('applySceneCamera', (camera: unknown) => sceneMethods.value.applySceneCamera(camera))

// 接收ThreeScene暴露的方法
const exposeMethods = (methods: {
  addCube: (options?: PrimitiveCreateOptions) => boolean
  addSphere: (options?: PrimitiveCreateOptions) => boolean
  addRamp: (options?: PrimitiveCreateOptions) => boolean
  addPrimitive: (spec: ScenePrimitiveSpec) => boolean
  importModel: (modelId: string) => Promise<boolean>
  getIsSceneInitialized: () => boolean
  updatePhysics: (timestamp?: number) => void
  setWorldSize: (size: number) => boolean
  focusScene: () => boolean
  applySceneCamera: (camera: unknown) => boolean
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
  errorMessage.value = ''

  // 启用物理模拟
  sceneStore.togglePlayState()

  // 加载动画保底可见：不足最短时长则补足后再收起遮罩
  const remain = LOADING_MIN_MS - (Date.now() - loadingStartedAt)
  if (remain > 0) {
    window.setTimeout(() => {
      isLoading.value = false
    }, remain)
  } else {
    isLoading.value = false
  }
}

// 重试初始化
const retryInit = () => {
  errorMessage.value = ''
  isLoading.value = true
  threeScene.value?.reinit()
}

// 处理视口点击事件：把命中的对象映射到 store 管理的对象
const handleViewportClick = (object: THREE.Object3D | null) => {
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
  sceneStore.setSelectedObject(matched?.uuid ?? null)
}

/**
 * 选中高亮的唯一写入点。
 *
 * 视口拖拽在 pointerdown 就会改选中（不依赖浏览器补发 click），
 * 高亮必须跟着 store 的选中状态走，而不是只在点击回调里刷一次。
 */
const applySelectionHighlight = () => {
  const highlight = (object: THREE.Object3D | undefined, color: number) => {
    if (!object) return
    object.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      materials.forEach((material) => {
        const standard = material as THREE.MeshStandardMaterial
        standard.emissive?.set(color)
      })
    })
  }

  sceneStore.objects.forEach((item) => highlight(item.threeObject, 0x000000))
  const selected = sceneStore.selectedObject
  if (selected) highlight(selected.threeObject, 0xffff00)
}

watch(() => sceneStore.selectedObjectUuid, applySelectionHighlight)

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
 * 加载路由指定的场景或模板。
 *
 * ⚠️ 必须等**物理方法就绪之后**再加载：`loadScene` 靠基本体工厂把物体连同
 * 刚体一起重建，而工厂是「场景列表」组件注册的，它用的 `addCube` 来自
 * `ThreeScene` 暴露的方法——那要等场景初始化完成才拿得到。
 * 早一步调用，工厂建体返回 false，场景看着在列表里、3D 视图却是空的。
 *
 * `?template=` 来自资源中心的「在编辑器中打开」；两者同时出现时以模板为准。
 */
let loadedRouteSceneKey = ''

const loadSceneFromRoute = async () => {
  const query = router.currentRoute.value.query
  const templateId = typeof query.template === 'string' ? query.template : ''
  const sceneId = typeof query.sceneId === 'string' ? query.sceneId : ''

  // 同一个路由目标只加载一次：初始化与路由 watcher 都会走到这里
  const key = templateId ? `template:${templateId}` : sceneId ? `scene:${sceneId}` : ''
  if (!key) {
    loadedRouteSceneKey = ''
    return
  }
  if (key === loadedRouteSceneKey) return
  loadedRouteSceneKey = key

  if (templateId) {
    const template = SHOWCASE_SCENES.find((item) => item.id === templateId)
    if (!template) {
      console.warn(`[SceneEditor] 模板不存在：${templateId}`)
      return
    }

    // 可撤销：载入前入历史栈，误点可以 Ctrl+Z 回去
    sceneStore.pushHistory(`载入模板：${template.name}`)
    try {
      const result = await sceneStore.loadSceneDocument(template.document)
      if (result.ok) {
        console.info(
          `[SceneEditor] 已载入模板「${template.name}」（${result.restored}/${result.total} 个物体）`,
        )
      } else {
        console.warn(
          `[SceneEditor] 载入模板「${template.name}」失败：${result.reason ?? '场景无法重建'}`,
        )
      }
    } catch (err: unknown) {
      // 加载失败不打断页面，但现场必须留下来
      console.warn('[SceneEditor] 载入模板失败', err)
    }
    return
  }

  try {
    await sceneStore.loadScene(sceneId)
  } catch (err: unknown) {
    // 加载失败不打断页面，但现场必须留下来
    console.warn('[SceneEditor] 加载场景失败', err)
  }
}

// 路由里的场景 / 模板变了就重新加载：物理方法就绪后第一次，之后每次切换都跟。
watch(
  () => [router.currentRoute.value.query.sceneId, router.currentRoute.value.query.template],
  () => {
    void loadSceneFromRoute()
  },
)

// 场地尺寸是 store 里的意图：变了就交给 useSceneEditor 重建网格与物理地面
watch(
  () => sceneStore.worldSize,
  (size) => {
    sceneMethods.value.setWorldSize(size)
  },
)

/** 输入框里按 Ctrl+Z 应该撤销文字，不是撤销场景 */
const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}

const handleKeydown = (event: KeyboardEvent) => {
  if (isTypingTarget(event.target)) return

  const modifier = event.ctrlKey || event.metaKey
  if (modifier && event.key.toLowerCase() === 'z') {
    event.preventDefault()
    void (event.shiftKey ? sceneStore.redo() : sceneStore.undo())
    return
  }
  if (modifier && event.key.toLowerCase() === 'y') {
    event.preventDefault()
    void sceneStore.redo()
    return
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && sceneStore.selectedObject) {
    event.preventDefault()
    sceneStore.pushHistory('删除物体')
    sceneStore.removeSelectedObject()
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

// 当组件卸载时清理状态
onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
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

/* 操作提示：贴在视口左下角，不拦截鼠标事件 */
.viewport-hint {
  position: absolute;
  left: 12px;
  bottom: 10px;
  margin: 0;
  padding: 4px 9px;
  border-radius: 999px;
  background-color: rgba(16, 20, 26, 0.62);
  border: 1px solid var(--border-subtle);
  color: var(--text-2);
  font-size: 11px;
  line-height: 1.4;
  pointer-events: none;
  user-select: none;
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
  color: var(--accent-on);
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
