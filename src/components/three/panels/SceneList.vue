<template>
  <div class="scene-list">
    <h3>我的场景</h3>

    <p v-if="scenes.length === 0" class="scene-hint">
      还没有保存过场景。用顶部工具栏的「保存场景」按钮存档，之后可以在这里打开。
    </p>

    <ul v-else class="scene-items">
      <li v-for="scene in scenes" :key="scene.id" class="scene-item">
        <button class="scene-open" :disabled="isLoading" @click="openScene(scene.id)">
          <span class="scene-name">{{ scene.name }}</span>
          <span class="scene-meta"
            >{{ scene.objectCount }} 个物体 · {{ formatTime(scene.createdAt) }}</span
          >
        </button>
        <button class="scene-delete" title="删除场景" @click="removeScene(scene)">✕</button>
      </li>
    </ul>

    <p v-if="statusMessage" class="scene-status">{{ statusMessage }}</p>

    <!-- 精选场景：不依赖后端，随时可载入；云端在线时可一键同步到云端 -->
    <div class="scene-showcase">
      <div class="scene-remote-head">
        <h4>精选场景</h4>
        <button
          v-if="sync.state === 'online'"
          class="scene-refresh"
          :disabled="syncingShowcases"
          title="把精选场景写入云端，换设备也能打开"
          @click="syncShowcasesToCloud"
        >
          {{ syncingShowcases ? '同步中…' : '同步到云端' }}
        </button>
      </div>
      <p class="scene-hint">
        开箱即用的示例作品：教学实验、具身智能训练场、企业陈列、城市天际线。
      </p>

      <ul class="scene-items">
        <li v-for="scene in SHOWCASE_SCENES" :key="scene.id" class="showcase-item">
          <button
            class="scene-open"
            :disabled="isLoading || loadingShowcaseId !== ''"
            @click="loadShowcase(scene)"
          >
            <span class="showcase-head">
              <span class="scene-name">{{ scene.name }}</span>
              <span class="scene-badge">{{ scene.audience }}</span>
            </span>
            <span class="showcase-desc">{{ scene.description }}</span>
            <span class="scene-meta">{{ scene.document.objects.length }} 个物体 · 精选示例</span>
          </button>
        </li>
      </ul>
    </div>

    <!-- 云端场景：后端在场时才有。换一台设备保存的场景，从这里就能打开。 -->
    <div v-if="sync.state === 'online'" class="scene-remote">
      <div class="scene-remote-head">
        <h4>云端场景</h4>
        <button class="scene-refresh" :disabled="isLoading" @click="refreshRemote">刷新</button>
      </div>

      <p v-if="sync.remoteScenes.length === 0" class="scene-hint">
        云端还没有场景。在别的设备上保存后，刷新这里就能看到。
      </p>

      <ul v-else class="scene-items">
        <li v-for="scene in sync.remoteScenes" :key="scene.id" class="scene-item">
          <button class="scene-open" :disabled="isLoading" @click="openRemoteScene(scene)">
            <span class="showcase-head">
              <span class="scene-name">{{ scene.name }}</span>
              <span v-if="scene.name.startsWith('精选 ·')" class="scene-badge">精选</span>
            </span>
            <span class="scene-meta">
              {{ scene.objectCount }} 个物体 · {{ formatTime(scene.createdAt) }} · 云端
            </span>
          </button>
          <button class="scene-delete" title="从云端删除场景" @click="removeRemoteScene(scene)">
            ✕
          </button>
        </li>
      </ul>
    </div>

    <p v-else-if="probeDone" class="scene-hint scene-hint-remote">
      云端不可用：场景只保存在这台设备上。
    </p>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SceneIndexEntry } from '@/types'
import {
  useSceneEditorStore,
  type PrimitiveCreateOptions,
} from '@/stores/sceneEditorStore'
import { useSceneSyncStore } from '@/stores/sceneSyncStore'
import { getScene, type SceneSummary } from '@/services/api/scenes'
import { reportError } from '@/services/api/telemetry'
import { SHOWCASE_SCENES, type ShowcaseScene } from '@/data/showcaseScenes'

const store = useSceneEditorStore()
const sync = useSceneSyncStore()

const scenes = ref<SceneIndexEntry[]>([])
const isLoading = ref(false)
const loadingShowcaseId = ref('')
const syncingShowcases = ref(false)
const statusMessage = ref('')
/** 后端探测过没有——没探测过就别急着说「云端不可用」 */
const probeDone = ref(false)

/**
 * 场景编辑器通过 provide 把「创建基本体」的方法交下来。
 *
 * 刚体与碰撞体归 useSceneEditor 所有，store 不能自己造刚体——
 * 加载场景时正是靠这两个方法把基本体连同物理一起重建出来。
 */
const addCube = inject<(options?: PrimitiveCreateOptions) => boolean>('addCube', () => false)
const addSphere = inject<(options?: PrimitiveCreateOptions) => boolean>('addSphere', () => false)
const addRamp = inject<(options?: PrimitiveCreateOptions) => boolean>('addRamp', () => false)
const importModel = inject<(modelId: string) => Promise<boolean>>(
  'importModel',
  async () => false,
)

const refresh = () => {
  scenes.value = store.listScenes()
}

const formatTime = (iso: string) => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '时间未知'

  const pad = (value: number) => String(value).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

const openScene = async (sceneId: string) => {
  isLoading.value = true
  statusMessage.value = ''

  try {
    const result = await store.loadScene(sceneId)
    const scene = scenes.value.find((item) => item.id === sceneId)
    const name = scene?.name ?? sceneId

    if (!result.ok) {
      statusMessage.value = `加载失败：${result.reason ?? '场景不存在或已损坏'}`
      return
    }

    statusMessage.value =
      result.restored < result.total
        ? `已加载场景：${name}（恢复了 ${result.restored}/${result.total} 个物体）`
        : `已加载场景：${name}`
  } catch (error) {
    console.warn('[SceneList] 加载场景失败', error)
    reportError(error, '/scene-editor')
    statusMessage.value = '加载场景失败'
  } finally {
    isLoading.value = false
  }
}

/** 载入精选场景：不进「我的场景」索引，想保存再由用户自己点保存 */
const loadShowcase = async (scene: ShowcaseScene) => {
  if (loadingShowcaseId.value) return
  isLoading.value = true
  loadingShowcaseId.value = scene.id
  statusMessage.value = ''

  try {
    // 可撤销：载入前拍快照，误点可以 Ctrl+Z 回去
    store.pushHistory(`载入精选：${scene.name}`)
    const result = await store.loadSceneDocument(scene.document)
    statusMessage.value = result.ok
      ? `已载入 ${scene.name}（${result.restored}/${result.total} 个物体）`
      : `载入失败：${result.reason ?? '场景无法重建'}`
  } catch (error) {
    console.warn('[SceneList] 载入精选场景失败', error)
    reportError(error, '/scene-editor')
    statusMessage.value = '载入精选场景失败'
  } finally {
    loadingShowcaseId.value = ''
    isLoading.value = false
  }
}

/** 把精选场景推送（幂等覆盖）到云端 */
const syncShowcasesToCloud = async () => {
  if (syncingShowcases.value) return
  syncingShowcases.value = true
  statusMessage.value = ''

  let pushed = 0
  try {
    for (const scene of SHOWCASE_SCENES) {
      if (await sync.pushScene(scene.document)) pushed += 1
    }
    await sync.refresh()
    statusMessage.value =
      pushed === SHOWCASE_SCENES.length
        ? `已同步 ${pushed} 个精选场景到云端`
        : `已同步 ${pushed}/${SHOWCASE_SCENES.length} 个（其余失败，后端可能不可用）`
  } finally {
    syncingShowcases.value = false
  }
}

const removeScene = (scene: SceneIndexEntry) => {
  if (!window.confirm(`确定要删除场景「${scene.name}」吗？此操作不可撤销。`)) return

  const removed = store.deleteScene(scene.id)
  statusMessage.value = removed ? `已删除场景：${scene.name}` : '删除失败'
  refresh()
}

/** 拉一次云端场景列表。 */
const refreshRemote = async () => {
  isLoading.value = true
  try {
    await sync.refresh()
  } finally {
    isLoading.value = false
  }
}

/**
 * 打开一个云端场景。
 *
 * 先把文档收进本地再打开：本地是缓存，之后后端不在了也照样打得开。
 */
const openRemoteScene = async (scene: SceneSummary) => {
  isLoading.value = true
  statusMessage.value = ''

  try {
    const detail = await getScene(scene.id)
    store.importSceneDocument(detail.document)
    const result = await store.loadScene(scene.id)
    statusMessage.value = result.ok
      ? result.restored < result.total
        ? `已从云端加载场景：${detail.document.name}（恢复了 ${result.restored}/${result.total} 个物体）`
        : `已从云端加载场景：${detail.document.name}`
      : `云端场景加载失败：${result.reason ?? scene.id}`
  } catch (error) {
    console.warn('[SceneList] 云端场景加载失败', error)
    reportError(error, '/scene-editor')
    statusMessage.value = '云端场景加载失败'
  } finally {
    isLoading.value = false
  }
}

/** 从云端删掉一个场景。 */
const removeRemoteScene = async (scene: SceneSummary) => {
  if (!window.confirm(`确定要从云端删除场景「${scene.name}」吗？此操作不可撤销。`)) return

  const removed = await sync.removeScene(scene.id)
  statusMessage.value = removed ? `已从云端删除场景：${scene.name}` : '云端删除失败'
}

onMounted(async () => {
  refresh()
  // 注册基本体工厂：让「加载出来的基本体」重新获得刚体与碰撞体
  store.registerPrimitiveFactory({
    createCube: (options) => addCube(options),
    createSphere: (options) => addSphere(options),
    createRamp: (options) => addRamp(options),
    importModel: (modelId) => importModel(modelId),
  })

  // 后端是可选增强：探不通就安静降级，不打扰用户
  probeDone.value = true
  if (await sync.probe()) {
    await sync.refresh()
  }
})

onUnmounted(() => {
  store.registerPrimitiveFactory(null)
})

// 保存 / 删除之后索引会变，重新拉一次列表
watch(
  () => store.sceneIndexVersion,
  () => refresh(),
)
</script>

<style scoped>
/* 挂在编辑器右栏「场景」tab 下：tab 条已提供分隔与留白，这里不再重复画线 */
.scene-list {
  padding: 0;
}

.scene-list h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: var(--text-1);
}

.scene-hint {
  font-size: 12px;
  color: var(--text-3);
  line-height: 1.6;
  margin: 0;
}

.scene-items {
  list-style: none;
  margin: 0;
  padding: 0;
}

.scene-item {
  display: flex;
  align-items: stretch;
  gap: 4px;
  margin-bottom: 6px;
}

.scene-open {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: 7px 9px;
  background-color: transparent;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: var(--text-1);
  transition: border-color 0.2s, background-color 0.2s;
}

.scene-open:hover:not(:disabled) {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
}

.scene-open:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.scene-name {
  font-weight: 600;
}

.scene-meta {
  font-size: 11px;
  color: var(--text-3);
}

.scene-delete {
  width: 28px;
  border: 1px solid var(--border-subtle);
  background-color: transparent;
  color: var(--danger);
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s;
}

.scene-delete:hover {
  background-color: var(--bg-hover);
}

.scene-status {
  margin: 10px 0 0 0;
  font-size: 12px;
  color: var(--text-2);
  background-color: var(--bg-inset);
  border-radius: 4px;
  padding: 6px 8px;
}

.scene-showcase {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-subtle);
}

.showcase-item {
  margin-bottom: 6px;
}

.showcase-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
}

.showcase-desc {
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-2);
}

.scene-badge {
  flex: 0 0 auto;
  padding: 1px 6px;
  border-radius: 999px;
  background-color: var(--accent-soft);
  color: var(--accent);
  font-size: 10px;
  font-weight: 600;
}

.scene-remote {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-subtle);
}

.scene-remote-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}

.scene-remote-head h4 {
  margin: 0;
  font-size: 13px;
  color: var(--text-2);
}

.scene-refresh {
  padding: 2px 8px;
  border: 1px solid var(--border-subtle);
  background-color: transparent;
  color: var(--text-2);
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
  transition: border-color 0.2s, background-color 0.2s;
}

.scene-refresh:hover:not(:disabled) {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
}

.scene-refresh:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.scene-hint-remote {
  margin-top: 14px;
}
</style>
