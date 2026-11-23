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

    <!-- 场景模板已迁到资源中心：编辑器只保留入口，不再维护模板列表 -->
    <div class="scene-template-entry">
      <button class="scene-template-btn" @click="goToTemplates">
        从资源中心选模板
      </button>
    </div>

    <!-- 后端存档：后端在场时才有。换一台设备保存的场景，从这里就能打开。 -->
    <div v-if="sync.state === 'online'" class="scene-remote">
      <div class="scene-remote-head">
        <h4>后端存档</h4>
        <button class="scene-refresh" :disabled="isLoading" @click="refreshRemote">刷新</button>
      </div>
      <p class="scene-hint">
        保存在本机后端数据库，不是云服务。
      </p>

      <p v-if="sync.remoteScenes.length === 0" class="scene-hint">
        后端还没有场景。在别的浏览器保存后，刷新这里就能看到。
      </p>

      <ul v-else class="scene-items">
        <li v-for="scene in sync.remoteScenes" :key="scene.id" class="scene-item">
          <button class="scene-open" :disabled="isLoading" @click="openRemoteScene(scene)">
            <span class="showcase-head">
              <span class="scene-name">{{ scene.name }}</span>
              <span v-if="scene.name.startsWith('精选 ·')" class="scene-badge">精选</span>
            </span>
            <span class="scene-meta">
              {{ scene.objectCount }} 个物体 · {{ formatTime(scene.createdAt) }} · 后端
            </span>
          </button>
          <button class="scene-delete" title="从后端删除场景" @click="removeRemoteScene(scene)">
            ✕
          </button>
        </li>
      </ul>
    </div>

    <p v-else-if="probeDone" class="scene-hint scene-hint-remote">
      后端不可用：场景只保存在这台浏览器上。
    </p>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import type { SceneIndexEntry } from '@/types'
import {
  useSceneEditorStore,
  type PrimitiveCreateOptions,
} from '@/stores/sceneEditorStore'
import { useSceneSyncStore } from '@/stores/sceneSyncStore'
import { getScene, type SceneSummary } from '@/services/api/scenes'
import { isApiUnavailable } from '@/services/api/client'
import { reportError } from '@/services/api/telemetry'
import { normalizeSceneDocument } from '@/utils/sceneDocument'

const store = useSceneEditorStore()
const sync = useSceneSyncStore()
const router = useRouter()

const scenes = ref<SceneIndexEntry[]>([])
const isLoading = ref(false)
const statusMessage = ref('')
/** 后端探测过没有——没探测过就别急着说「后端不可用」 */
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

/** 去资源中心挑场景模板（模板列表不再放在编辑器里） */
const goToTemplates = () => {
  void router.push('/resource-center/templates')
}

const removeScene = (scene: SceneIndexEntry) => {
  if (!window.confirm(`确定要删除场景「${scene.name}」吗？此操作不可撤销。`)) return

  const removed = store.deleteScene(scene.id)
  statusMessage.value = removed ? `已删除场景：${scene.name}` : '删除失败'
  refresh()
}

/** 拉一次后端场景列表。 */
const refreshRemote = async () => {
  isLoading.value = true
  try {
    await sync.refresh()
  } finally {
    isLoading.value = false
  }
}

/**
 * 打开一个后端场景。
 *
 * 先把文档收进本地再打开：本地是缓存，之后后端不在了也照样打得开。
 */
const openRemoteScene = async (scene: SceneSummary) => {
  isLoading.value = true
  statusMessage.value = ''

  try {
    const detail = await getScene(scene.id)

    // 后端存的是任意 JSON：先按当前场景格式校验，坏数据要说清坏在哪，
    // 而不是先写进本地缓存、再在重建阶段报一个「恢复了 0/N」。
    const parsed = normalizeSceneDocument(detail.document)
    if (!parsed.ok) {
      statusMessage.value = `后端存档无法解析：${parsed.error}`
      return
    }

    // 收进本地作为缓存，但重建直接用**刚校验过的文档**，不再回读 localStorage：
    // 少一次「写入 → 读取」链路，也不会被同 id 的旧缓存盖住。
    store.importSceneDocument(parsed.document)
    const result = await store.loadSceneDocument(parsed.document)
    if (result.ok) {
      // 打开后端场景 = 新基线，撤销不能跨场景回到上一个场景
      store.clearHistory()
      statusMessage.value =
        result.restored < result.total
          ? `已从后端加载：${parsed.document.name}（恢复了 ${result.restored}/${result.total} 个物体）`
          : `已从后端加载：${parsed.document.name}`
    } else {
      statusMessage.value = `后端存档加载失败：${result.reason ?? '场景无法重建'}`
    }
  } catch (error) {
    console.warn('[SceneList] 后端场景加载失败', error)
    reportError(error, '/scene-editor')
    statusMessage.value = isApiUnavailable(error)
      ? '后端不可达，请稍后点「刷新」重试'
      : '后端存档加载失败'
  } finally {
    isLoading.value = false
  }
}

/** 从后端删掉一个场景。 */
const removeRemoteScene = async (scene: SceneSummary) => {
  if (!window.confirm(`确定要从后端删除场景「${scene.name}」吗？此操作不可撤销。`)) return

  const removed = await sync.removeScene(scene.id)
  statusMessage.value = removed ? `已从后端删除场景：${scene.name}` : '后端删除失败'
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

.scene-template-entry {
  margin-top: 14px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-subtle);
}

.scene-template-btn {
  width: 100%;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background-color: transparent;
  color: var(--text-1);
  font-size: 13px;
  cursor: pointer;
  transition: border-color 0.2s, background-color 0.2s;
}

.scene-template-btn:hover {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
}

.showcase-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
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
