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
          <span class="scene-meta">{{ scene.objectCount }} 个物体 · {{ formatTime(scene.createdAt) }}</span>
        </button>
        <button class="scene-delete" title="删除场景" @click="removeScene(scene)">✕</button>
      </li>
    </ul>

    <p v-if="statusMessage" class="scene-status">{{ statusMessage }}</p>
  </div>
</template>

<script setup lang="ts">
import { inject, onMounted, onUnmounted, ref, watch } from 'vue'
import type { SceneIndexEntry } from '@/types'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

const store = useSceneEditorStore()

const scenes = ref<SceneIndexEntry[]>([])
const isLoading = ref(false)
const statusMessage = ref('')

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

    // 场景编辑器初始化完成后约 1 秒会补两个演示立方体。
    // 如果它们刚好落在「加载场景」之后，场景里就会凭空多出两个物体。
    // 这里盯一小会儿：数量比存档多就再加载一次（loadScene 会把多出来的清掉）。
    const expected = scene?.objectCount ?? store.objects.length
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setTimeout(resolve, 200))
      if (store.objects.length <= expected) break
      await store.loadScene(sceneId)
    }

    statusMessage.value = `已加载场景：${scene?.name ?? sceneId}`
  } catch (error) {
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

onMounted(() => {
  refresh()
  // 注册基本体工厂：让「加载出来的基本体」重新获得刚体与碰撞体
  store.registerPrimitiveFactory({
    createCube: () => addCube(),
    createSphere: () => addSphere(),
  })
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
</style>
