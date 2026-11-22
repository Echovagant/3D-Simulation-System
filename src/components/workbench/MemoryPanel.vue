<template>
  <section class="wb-panel" aria-label="记忆面板">
    <div class="wb-panel-head">
      <h3 class="wb-panel-title">记忆</h3>
      <div class="wb-head-actions">
        <button
          type="button"
          class="wb-conv-btn"
          title="把 gym 审计里重复出现的失败模式提炼成程序性记忆（幂等，重跑是更新）"
          :disabled="store.consolidating"
          @click="onConsolidate"
        >
          {{ store.consolidating ? '提炼中…' : '从审计提炼' }}
        </button>
        <button
          type="button"
          class="wb-mini-btn"
          title="刷新记忆列表"
          :disabled="store.memoryWriting"
          @click="onRefresh"
        >
          刷新
        </button>
      </div>
    </div>

    <!-- 检索行：有关键词走后端衰减打分，清掉还原最近优先 -->
    <div class="wb-search-row">
      <input
        v-model="searchInput"
        class="wb-search-input"
        type="text"
        maxlength="200"
        placeholder="关键词检索（回车确认）"
        aria-label="记忆检索关键词"
        @keyup.enter="onSearch"
      />
      <button type="button" class="wb-mini-btn" :disabled="!canSearch" @click="onSearch">检索</button>
      <button v-if="searched !== null" type="button" class="wb-mini-btn" @click="onClearSearch">
        还原
      </button>
    </div>

    <p v-if="store.memoriesError" class="wb-error-line">{{ store.memoriesError }}</p>
    <p v-else-if="store.memoryActionError" class="wb-error-line">{{ store.memoryActionError }}</p>

    <!-- 提炼结果：行内展示（扫了多少、提炼/更新了几条、模式明细） -->
    <div v-if="store.consolidateResult" class="wb-conv-result">
      <p class="wb-conv-summary">
        提炼完成：扫描 {{ store.consolidateResult.scannedLogs }} 条审计 · 新提炼
        {{ store.consolidateResult.created }} · 更新 {{ store.consolidateResult.updated }}
      </p>
      <p v-if="store.consolidateResult.patterns.length === 0" class="wb-conv-none">
        没有重复出现的失败模式——审计流里得先有同类失败。
      </p>
      <ul v-else class="wb-conv-patterns">
        <li v-for="p in store.consolidateResult.patterns" :key="`${p.sessionId}-${p.errorCode}`" class="wb-conv-pattern">
          <span class="wb-conv-code">{{ p.errorCode }}</span>
          <span class="wb-conv-meta">
            会话 {{ shortId(p.sessionId) }} · {{ p.occurrences }} 次
          </span>
          <span class="wb-mem-kind" :class="p.action === 'created' ? 'semantic' : 'procedural'">
            {{ p.action === 'created' ? '新建' : '更新' }}
          </span>
        </li>
      </ul>
    </div>

    <p class="wb-count-line">
      <template v-if="searched !== null">检索「{{ searched }}」· {{ store.memories.length }} 条命中</template>
      <template v-else>共 {{ store.memories.length }} 条 · 最近访问优先</template>
    </p>

    <!-- 记忆列表：kind 徽标 / 内容 / 权重 / 来源 / 时间 -->
    <ul class="wb-mem-list">
      <li v-if="store.memories.length === 0" class="wb-empty-line">
        还没有记忆——下方写一条，或点「从审计提炼」。
      </li>
      <li v-for="item in store.memories" :key="item.id" class="wb-mem-item">
        <div class="wb-mem-top">
          <span class="wb-mem-kind" :class="item.kind">{{ kindLabel(item.kind) }}</span>
          <span class="wb-mem-source">{{ sourceLabel(item.source) }}</span>
          <span class="wb-mem-importance" :title="`权重 ${item.importance.toFixed(2)}`">
            权重 {{ item.importance.toFixed(1) }}
          </span>
          <button
            type="button"
            class="wb-mem-del"
            title="删除这条记忆"
            :disabled="isDeleting(item.id)"
            @click="onDelete(item.id)"
          >
            {{ isDeleting(item.id) ? '删除中…' : '删除' }}
          </button>
        </div>
        <p class="wb-mem-content">{{ item.content }}</p>
        <p class="wb-mem-time">写于 {{ formatTime(item.createdAt) }} · 最近访问 {{ formatTime(item.lastAccessedAt) }}</p>
      </li>
    </ul>

    <!-- 手动写入小表单 -->
    <div class="wb-form-block">
      <h4 class="wb-form-title">手动写入</h4>
      <div class="wb-field-row">
        <div class="wb-field">
          <label class="wb-field-label" for="wb-mem-kind">类型</label>
          <select id="wb-mem-kind" v-model="kind" class="wb-kind-select">
            <option value="semantic">语义 semantic</option>
            <option value="episodic">情节 episodic</option>
            <option value="procedural">程序 procedural</option>
          </select>
        </div>
        <div class="wb-field wb-field-importance">
          <label class="wb-field-label" for="wb-mem-importance">
            权重 <span class="wb-importance-value">{{ importance.toFixed(1) }}</span>
          </label>
          <input
            id="wb-mem-importance"
            v-model.number="importance"
            type="range"
            min="0"
            max="1"
            step="0.1"
          />
        </div>
      </div>
      <label class="wb-field-label" for="wb-mem-content">内容</label>
      <input
        id="wb-mem-content"
        v-model="content"
        class="wb-content-input"
        type="text"
        maxlength="4000"
        placeholder="一条独立成句的事实或经验"
        @keyup.enter="onWrite"
      />
      <button type="button" class="wb-primary-btn" :disabled="store.memoryWriting" @click="onWrite">
        {{ store.memoryWriting ? '写入中…' : '写入记忆' }}
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useGymWorkbenchStore } from '@/stores/gymWorkbenchStore'

const store = useGymWorkbenchStore()

/** 检索输入框的本地状态；searched 是已生效的关键词（null = 最近优先列表） */
const searchInput = ref('')
const searched = ref<string | null>(null)

/** 写入表单的本地状态 */
const kind = ref('semantic')
const importance = ref(0.5)
const content = ref('')

/** 内容为空不允许检索（省一次注定空泛的往返） */
const canSearch = computed(() => searchInput.value.trim().length > 0)

/** 检索打分里有会话 id，展示时只留前 8 位 */
const shortId = (id: string): string => id.slice(0, 8)

const kindLabel = (value: string): string => {
  if (value === 'semantic') return '语义'
  if (value === 'episodic') return '情节'
  if (value === 'procedural') return '程序'
  return value
}

const sourceLabel = (value: string): string =>
  value === 'audit_distilled' ? '审计提炼' : value === 'manual' ? '手动' : value

const isDeleting = (id: number): boolean => store.memoryDeletingIds.includes(id)

/** 时间戳到本地短格式：记忆是跨天的，带日期 */
const formatTime = (ts: string): string => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

onMounted(() => {
  // 记忆不轮询：进面板拉一次，之后靠刷新/检索/写入后的本地同步
  void store.fetchMemories()
})

const onSearch = async (): Promise<void> => {
  const keyword = searchInput.value.trim()
  if (!keyword) return
  searched.value = keyword
  await store.fetchMemories(keyword)
}

const onClearSearch = async (): Promise<void> => {
  searchInput.value = ''
  searched.value = null
  await store.fetchMemories()
}

const onRefresh = async (): Promise<void> => {
  await store.fetchMemories(searched.value ?? undefined)
}

const onDelete = async (id: number): Promise<void> => {
  await store.deleteMemory(id)
}

const onConsolidate = async (): Promise<void> => {
  await store.consolidate()
}

/** 写一条记忆；内容不能是空白，写成功后清空输入框 */
const onWrite = async (): Promise<void> => {
  const text = content.value.trim()
  if (!text) {
    store.memoryActionError = '内容不能是空白'
    return
  }
  const ok = await store.createMemory({ kind: kind.value, content: text, importance: importance.value })
  if (ok) content.value = ''
}
</script>

<style scoped>
.wb-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  /* 与会话面板同一策略：整面板滚动。半屏分块放不下头部+表单+列表时，
     裁掉表单会让写入入口不可用，宁可整体滚 */
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

.wb-head-actions {
  display: flex;
  align-items: center;
  gap: 6px;
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

.wb-conv-btn {
  padding: 3px 10px;
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent);
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.wb-conv-btn:hover:not(:disabled) {
  background: rgba(var(--accent-rgb), 0.28);
}

.wb-conv-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* 检索行 */
.wb-search-row {
  display: flex;
  gap: 6px;
}

.wb-search-input {
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

.wb-search-input::placeholder {
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

/* 提炼结果 */
.wb-conv-result {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-conv-summary {
  margin: 0;
  font-size: 12px;
  color: var(--text-1);
}

.wb-conv-none {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

.wb-conv-patterns {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-conv-pattern {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
}

.wb-conv-code {
  font-family: var(--font-mono);
  color: var(--danger);
}

.wb-conv-meta {
  flex: 1 1 auto;
  min-width: 0;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* 记忆列表：自然高度，超出随整面板滚动（与会话面板一致） */
.wb-mem-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex-shrink: 0;
}

.wb-empty-line {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.wb-mem-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-mem-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wb-mem-kind {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
}

.wb-mem-kind.semantic {
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent);
}

.wb-mem-kind.episodic {
  background: rgba(var(--accent-2-rgb), 0.16);
  color: var(--accent-2);
}

.wb-mem-kind.procedural {
  background: rgba(67, 192, 127, 0.14);
  color: var(--success);
}

.wb-mem-source {
  font-size: 11px;
  color: var(--text-3);
}

.wb-mem-importance {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 11px;
  color: var(--text-2);
}

.wb-mem-del {
  margin-left: auto;
  padding: 1px 8px;
  background: transparent;
  color: var(--danger);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
}

.wb-mem-del:hover:not(:disabled) {
  border-color: var(--danger);
}

.wb-mem-del:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.wb-mem-content {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
  color: var(--text-1);
  word-break: break-word;
  white-space: pre-wrap;
}

.wb-mem-time {
  margin: 0;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
}

/* 手动写入表单 */
.wb-form-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.wb-form-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.wb-field-row {
  display: flex;
  gap: 8px;
}

.wb-field {
  flex: 1 1 0;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-field-importance {
  flex: 0 0 45%;
}

.wb-field-label {
  font-size: 12px;
  color: var(--text-2);
}

.wb-importance-value {
  margin-left: 4px;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--accent);
}

.wb-kind-select {
  padding: 4px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  color-scheme: dark;
}

.wb-content-input {
  width: 100%;
  padding: 4px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color-scheme: dark;
}

.wb-content-input::placeholder {
  color: var(--text-3);
}

.wb-primary-btn {
  padding: 8px 12px;
  background: var(--accent-strong);
  color: var(--accent-on);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.wb-primary-btn:hover:not(:disabled) {
  background: var(--accent-strong-hover);
}

.wb-primary-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
