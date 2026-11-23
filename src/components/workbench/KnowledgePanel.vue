<template>
  <section class="wb-panel" aria-label="资料面板">
    <div class="wb-panel-head">
      <h3 class="wb-panel-title">资料</h3>
      <button
        type="button"
        class="wb-mini-btn"
        title="刷新资料列表"
        :disabled="store.loading"
        @click="onRefresh"
      >
        刷新
      </button>
    </div>

    <p class="wb-hint-line">
      带 <code>gym</code> 标签（或正文含 gym）的资料会在 LLM 提议前自动检索并注入提示词。
    </p>

    <!-- 检索行：有关键词走后端衰减打分，清掉还原列表 -->
    <div class="wb-search-row">
      <input
        v-model="searchInput"
        class="wb-search-input"
        type="text"
        maxlength="200"
        placeholder="关键词检索（空格分隔多词）"
        aria-label="资料检索关键词"
        @keyup.enter="onSearch"
      />
      <button type="button" class="wb-mini-btn" :disabled="!canSearch" @click="onSearch">检索</button>
      <button v-if="store.searched !== null" type="button" class="wb-mini-btn" @click="onClearSearch">
        还原
      </button>
    </div>

    <p v-if="store.listError" class="wb-error-line">{{ store.listError }}</p>
    <p v-else-if="store.actionError" class="wb-error-line">{{ store.actionError }}</p>

    <p class="wb-count-line">
      <template v-if="store.searched !== null">检索「{{ store.searched }}」· {{ store.entries.length }} 条命中</template>
      <template v-else>共 {{ store.entries.length }} 条 · 权重优先</template>
    </p>

    <!-- 资料列表：标题 / 标签 / 权重 / 正文摘要 / 时间 -->
    <ul class="wb-kn-list">
      <li v-if="store.entries.length === 0" class="wb-empty-line">
        还没有资料——下方写一条，并打上 gym 标签让决策引用。
      </li>
      <li v-for="item in store.entries" :key="item.id" class="wb-kn-item">
        <div class="wb-kn-top">
          <span class="wb-kn-title" :title="item.title">{{ item.title }}</span>
          <span class="wb-kn-importance" :title="`权重 ${item.importance.toFixed(2)}`">
            权重 {{ item.importance.toFixed(1) }}
          </span>
          <button
            type="button"
            class="wb-kn-del"
            title="删除这条资料"
            :disabled="store.isDeleting(item.id)"
            @click="onDelete(item.id)"
          >
            {{ store.isDeleting(item.id) ? '删除中…' : '删除' }}
          </button>
        </div>
        <p v-if="item.tags" class="wb-kn-tags">{{ item.tags }}</p>
        <p class="wb-kn-content">{{ item.content }}</p>
        <p class="wb-kn-time">写于 {{ formatTime(item.createdAt) }}</p>
      </li>
    </ul>

    <!-- 新增资料小表单 -->
    <div class="wb-form-block">
      <h4 class="wb-form-title">新增资料</h4>
      <label class="wb-field-label" for="wb-kn-title">标题</label>
      <input
        id="wb-kn-title"
        v-model="title"
        class="wb-text-input"
        type="text"
        maxlength="200"
        placeholder="一句话说明这条资料是什么"
      />
      <div class="wb-field-row">
        <div class="wb-field">
          <label class="wb-field-label" for="wb-kn-tags">标签（决策注入认 gym）</label>
          <input
            id="wb-kn-tags"
            v-model="tags"
            class="wb-text-input"
            type="text"
            maxlength="200"
            placeholder="gym, 力控"
          />
        </div>
        <div class="wb-field wb-field-importance">
          <label class="wb-field-label" for="wb-kn-importance">
            权重 <span class="wb-importance-value">{{ importance.toFixed(1) }}</span>
          </label>
          <input
            id="wb-kn-importance"
            v-model.number="importance"
            type="range"
            min="0"
            max="1"
            step="0.1"
          />
        </div>
      </div>
      <label class="wb-field-label" for="wb-kn-content">正文</label>
      <textarea
        id="wb-kn-content"
        v-model="content"
        class="wb-kn-textarea"
        rows="3"
        maxlength="8000"
        placeholder="可验证的事实、经验或操作步骤"
        spellcheck="false"
      ></textarea>
      <button type="button" class="wb-primary-btn" :disabled="store.creating" @click="onCreate">
        {{ store.creating ? '写入中…' : '写入资料' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useKnowledgeStore } from '@/stores/knowledgeStore'

/**
 * 领域资料面板。
 *
 * 列表 / 检索 / 写入 / 删除走 knowledgeStore；决策注入由工作台 store 在
 * 请求 LLM 前直接检索（gym 标签），不读这里的列表筛选状态。
 */
const store = useKnowledgeStore()

const searchInput = ref('')
const title = ref('')
const tags = ref('gym')
const importance = ref(0.5)
const content = ref('')

const canSearch = computed(() => searchInput.value.trim().length > 0 && !store.loading)

onMounted(() => {
  void store.fetchEntries()
})

/** 后端返的时间是 ISO 串：只留到分钟，读起来不噪 */
const formatTime = (value: string): string => {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}

const onSearch = async (): Promise<void> => {
  const keyword = searchInput.value.trim()
  if (!keyword) return
  await store.fetchEntries(keyword)
}

const onClearSearch = async (): Promise<void> => {
  searchInput.value = ''
  await store.fetchEntries()
}

const onRefresh = async (): Promise<void> => {
  await store.fetchEntries(store.searched ?? undefined)
}

const onDelete = async (id: number): Promise<void> => {
  await store.remove(id)
}

const onCreate = async (): Promise<void> => {
  if (!title.value.trim() || !content.value.trim()) {
    store.actionError = '标题与正文都不能是空白'
    return
  }
  const ok = await store.createEntry({
    title: title.value.trim(),
    content: content.value.trim(),
    tags: tags.value.trim(),
    importance: importance.value,
  })
  if (ok) {
    title.value = ''
    content.value = ''
  }
}
</script>

<style scoped>
.wb-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  overflow-y: auto;
}

.wb-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.wb-panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
}

.wb-mini-btn {
  padding: 3px 10px;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.wb-mini-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-1);
}

.wb-mini-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.wb-hint-line {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}

.wb-hint-line code {
  font-family: var(--font-mono);
  color: var(--accent);
}

.wb-search-row {
  display: flex;
  gap: 6px;
}

.wb-search-input,
.wb-text-input {
  flex: 1 1 auto;
  min-width: 0;
  padding: 4px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color-scheme: dark;
}

.wb-search-input::placeholder,
.wb-text-input::placeholder,
.wb-kn-textarea::placeholder {
  color: var(--text-3);
}

.wb-error-line {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.wb-count-line {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

.wb-kn-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.wb-empty-line {
  font-size: 12px;
  color: var(--text-3);
}

.wb-kn-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-kn-top {
  display: flex;
  align-items: center;
  gap: 6px;
}

.wb-kn-title {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wb-kn-importance {
  font-size: 11px;
  color: var(--text-3);
  white-space: nowrap;
}

.wb-kn-del {
  padding: 1px 6px;
  background: transparent;
  color: var(--text-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
}

.wb-kn-del:hover:not(:disabled) {
  color: var(--danger);
  border-color: var(--danger);
}

.wb-kn-del:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.wb-kn-tags {
  margin: 0;
  font-size: 11px;
  font-family: var(--font-mono);
  color: var(--accent-2);
}

.wb-kn-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.55;
  color: var(--text-2);
  overflow-wrap: anywhere;
}

.wb-kn-time {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

.wb-form-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-form-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-2);
}

.wb-field-label {
  font-size: 11px;
  color: var(--text-3);
}

.wb-field-row {
  display: flex;
  gap: 8px;
}

.wb-field {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.wb-field-importance {
  flex: 0 0 110px;
}

.wb-importance-value {
  color: var(--accent);
  font-family: var(--font-mono);
}

.wb-kn-textarea {
  padding: 6px 8px;
  background: var(--bg-panel);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-family: inherit;
  line-height: 1.5;
  resize: vertical;
  color-scheme: dark;
}

.wb-primary-btn {
  padding: 5px 12px;
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent);
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.wb-primary-btn:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.28);
}

.wb-primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
