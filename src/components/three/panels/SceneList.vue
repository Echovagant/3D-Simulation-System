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
            <span class="scene-name">{{ scene.name }}</span>
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
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useSceneSyncStore } from '@/stores/sceneSyncStore'
import { getScene, type SceneSummary } from '@/services/api/scenes'
import { reportError } from '@/services/api/telemetry'

const store = useSceneEditorStore()
const sync = useSceneSyncStore()

const scenes = ref<SceneIndexEntry[]>([])
const isLoading = ref(false)
const statusMessage = ref('')
/** 后端探测过没有——没探测过就别急着说「云端不可用」 */
const probeDone = ref(false)

/**
 * 场景编辑器通过 provide 把「创建基本体」的方法交下来。
 *
 * 刚体与碰撞体归 useSceneEditor 所有，store 不能自己造刚体——
 * 加载场景时正是靠这两个方法把基本体连同物理一起重建出来。
 */
const addCube = inject<() => boolean>('addCube', () => false)
const addSphere = inject<() => boolean>('addSphere', () => false)

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
    const loaded = await store.loadScene(sceneId)
    const scene = scenes.value.find((item) => item.id === sceneId)

    if (!loaded) {
      statusMessage.value = `场景不存在或已损坏：${sceneId}`
      return
    }

    statusMessage.value = `已加载场景：${scene?.name ?? sceneId}`
  } catch (error) {
    console.warn('[SceneList] 加载场景失败', error)
    reportError(error, '/scene-editor')
    statusMessage.value = '加载场景失败'
  } finally {
    isLoading.value = false
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
    const loaded = await store.loadScene(scene.id)
    statusMessage.value = loaded
      ? `已从云端加载场景：${detail.document.name}`
      : `云端场景加载失败：${scene.id}`
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
    createCube: () => addCube(),
    createSphere: () => addSphere(),
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
.scene-list {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #e0e0e0;
}

.scene-list h3 {
  margin: 0 0 12px 0;
  font-size: 14px;
  color: #2c3e50;
}

.scene-hint {
  font-size: 12px;
  color: #888;
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
  background-color: #fff;
  border: 1px solid #d5d8dc;
  border-radius: 4px;
  cursor: pointer;
  text-align: left;
  font-size: 13px;
  color: #2c3e50;
  transition: border-color 0.2s;
}

.scene-open:hover:not(:disabled) {
  border-color: #3498db;
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
  color: #888;
}

.scene-delete {
  width: 28px;
  border: 1px solid #d5d8dc;
  background-color: #fff;
  color: #a94442;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s;
}

.scene-delete:hover {
  background-color: #f5c6cb;
}

.scene-status {
  margin: 10px 0 0 0;
  font-size: 12px;
  color: #2c3e50;
  background-color: #eef5fb;
  border-radius: 4px;
  padding: 6px 8px;
}

.scene-remote {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed #d5d8dc;
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
  color: #2c3e50;
}

.scene-refresh {
  padding: 2px 8px;
  border: 1px solid #d5d8dc;
  background-color: #fff;
  color: #2c3e50;
  border-radius: 4px;
  cursor: pointer;
  font-size: 12px;
}

.scene-refresh:hover:not(:disabled) {
  border-color: #3498db;
}

.scene-refresh:disabled {
  cursor: not-allowed;
  opacity: 0.6;
}

.scene-hint-remote {
  margin-top: 14px;
}
</style>
