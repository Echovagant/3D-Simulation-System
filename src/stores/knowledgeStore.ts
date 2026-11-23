/**
 * 领域资料索引 · 前端状态。
 *
 * 与记忆面板同构：列表 / 检索 / 写入 / 删除，后端缺席时安静降级。
 * 决策注入不读这里的列表状态——`gymWorkbenchStore.autoDecide` 直接调
 * `listKnowledge` 拉一份最新的，避免面板筛选条件影响决策输入。
 */
import { ref } from 'vue'
import { defineStore } from 'pinia'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import {
  createKnowledge,
  deleteKnowledge,
  listKnowledge,
  searchKnowledge,
  type KnowledgeCreateInput,
  type KnowledgeItem,
} from '@/services/api/knowledge'
import { useLlmStore } from './llmStore'

/** 把异常翻译成一句能直接显示的话（与工作台 store 同一口径） */
const describeError = (error: unknown, fallback: string): string => {
  if (isApiUnavailable(error)) return fallback
  if (error instanceof ApiError) return error.message || fallback
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export const useKnowledgeStore = defineStore('knowledge', () => {
  const llmStore = useLlmStore()

  /** 当前列表（无 query 按权重+更新时间，检索时按衰减打分） */
  const entries = ref<KnowledgeItem[]>([])
  /** 正在拉列表 */
  const loading = ref(false)
  /** 列表拉取失败原因 */
  const listError = ref('')
  /** 写入/删除失败原因 */
  const actionError = ref('')
  /** 正在写入 */
  const creating = ref(false)
  /** 正在删除的条目 id（按钮逐条转圈） */
  const deletingIds = ref<number[]>([])
  /** 最近一次检索词；null = 未检索（列表模式） */
  const searched = ref<string | null>(null)

  const isDeleting = (id: number): boolean => deletingIds.value.includes(id)

  /** 拉列表：有关键词走检索，否则按权重+更新时间。失败不清空已有列表。 */
  const fetchEntries = async (query?: string): Promise<boolean> => {
    const keyword = (query ?? '').trim()
    loading.value = true
    try {
      const result = keyword
        ? await searchKnowledge(llmStore.ownerToken, keyword)
        : await listKnowledge(llmStore.ownerToken)
      entries.value = result.items
      searched.value = keyword || null
      listError.value = ''
      return true
    } catch (error) {
      listError.value = describeError(error, '后端不可达，资料列表暂时拉不到')
      return false
    } finally {
      loading.value = false
    }
  }

  /** 写一条资料；成功后按当前视图重拉（后端排序口径不由前端猜） */
  const createEntry = async (input: KnowledgeCreateInput): Promise<boolean> => {
    creating.value = true
    actionError.value = ''
    try {
      await createKnowledge(llmStore.ownerToken, input)
      await fetchEntries(searched.value ?? undefined)
      return true
    } catch (error) {
      actionError.value = describeError(error, '后端不可达，资料没写进去')
      return false
    } finally {
      creating.value = false
    }
  }

  /** 删除一条资料；后端成功才动本地列表（404 也算删成了——目标已经不在） */
  const remove = async (id: number): Promise<boolean> => {
    actionError.value = ''
    deletingIds.value = [...deletingIds.value, id]
    try {
      await deleteKnowledge(llmStore.ownerToken, id)
      entries.value = entries.value.filter((item) => item.id !== id)
      return true
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        entries.value = entries.value.filter((item) => item.id !== id)
        return true
      }
      actionError.value = describeError(error, '后端不可达，资料没删掉')
      return false
    } finally {
      deletingIds.value = deletingIds.value.filter((busyId) => busyId !== id)
    }
  }

  return {
    entries,
    loading,
    listError,
    actionError,
    creating,
    deletingIds,
    searched,
    isDeleting,
    fetchEntries,
    createEntry,
    remove,
  }
})
