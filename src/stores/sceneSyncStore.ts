/**
 * 场景云端同步：把本地场景文档推到后端、拉取与删除远端场景。
 *
 * 后端是**可选增强**：所有方法失败都不抛错，只把 `state` 落到
 * offline（后端不在）或 error（真错误），界面据此决定要不要提示。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import {
  createScene,
  deleteScene as deleteRemoteScene,
  listScenes,
  updateScene,
  type SceneSummary,
} from '@/services/api/scenes'
import type { SceneDocument } from '@/types'

/**
 * 场景同步状态。
 *
 * ⚠️ 本 store **永远不抛错**给调用方：后端缺席是正常状态，不是异常。
 * 上层只根据 `state` 决定要不要提示用户。
 */
export type SceneSyncState = 'offline' | 'online' | 'syncing' | 'error'

export const useSceneSyncStore = defineStore('sceneSync', () => {
  const state = ref<SceneSyncState>('offline')
  const remoteScenes = ref<SceneSummary[]>([])
  const lastError = ref<string | null>(null)

  const isOnline = computed(() => state.value === 'online')

  /** 把任意异常翻译成「后端不在」或「真错误」。 */
  const classify = (error: unknown): SceneSyncState => {
    if (isApiUnavailable(error)) return 'offline'
    lastError.value = error instanceof Error ? error.message : String(error)
    return 'error'
  }

  /** 把一条摘要并进远端列表（按 id 去重，新的排前面）。 */
  const upsertRemote = (summary: SceneSummary): void => {
    remoteScenes.value = [summary, ...remoteScenes.value.filter((item) => item.id !== summary.id)]
  }

  /** 拉取远端场景列表；后端不在时落回 offline，列表清空 */
  const refresh = async (): Promise<void> => {
    state.value = 'syncing'
    try {
      remoteScenes.value = await listScenes()
      state.value = 'online'
      lastError.value = null
    } catch (error) {
      state.value = classify(error)
      remoteScenes.value = []
    }
  }

  /**
   * 推送一个场景到后端。
   *
   * 幂等：先试新建，冲突（409）则改为更新。
   * 返回是否成功——**失败不是异常**，调用方据此决定要不要提示。
   */
  const pushScene = async (document: SceneDocument): Promise<boolean> => {
    state.value = 'syncing'
    const payload = { name: document.name, document }
    try {
      let summary: SceneSummary
      try {
        summary = await createScene(payload)
      } catch (error) {
        if (error instanceof ApiError && error.status === 409) {
          summary = await updateScene(document.id, payload)
        } else {
          throw error
        }
      }
      upsertRemote(summary)
      state.value = 'online'
      lastError.value = null
      return true
    } catch (error) {
      state.value = classify(error)
      return false
    }
  }

  /** 删除远端场景；失败不抛错，返回是否成功 */
  const removeScene = async (id: string): Promise<boolean> => {
    try {
      await deleteRemoteScene(id)
      remoteScenes.value = remoteScenes.value.filter((item) => item.id !== id)
      state.value = 'online'
      lastError.value = null
      return true
    } catch (error) {
      state.value = classify(error)
      return false
    }
  }

  /** 探测后端是否在线：只更新 state，不动本地数据 */
  const probe = async (): Promise<boolean> => {
    try {
      await listScenes()
      state.value = 'online'
      return true
    } catch (error) {
      state.value = classify(error)
      return false
    }
  }

  return {
    state,
    remoteScenes,
    lastError,
    isOnline,
    refresh,
    pushScene,
    removeScene,
    probe,
  }
})
