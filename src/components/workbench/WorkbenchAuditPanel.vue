<template>
  <section class="wb-panel" aria-label="审计流面板">
    <div class="wb-panel-head">
      <h3 class="wb-panel-title">审计流</h3>
      <select
        v-model.number="roundModel"
        class="wb-round-select"
        aria-label="回合过滤"
        title="只看某一回合的审计（归属过滤 = 当前会话）"
      >
        <option :value="EMPTY_ROUND">全部回合</option>
        <option v-for="round in roundOptions" :key="round" :value="round">第 {{ round }} 回合</option>
      </select>
    </div>

    <p v-if="!store.currentSessionId" class="wb-empty-line">选中会话后这里开始滚动审计流。</p>
    <template v-else>
      <p class="wb-poll-line" :class="{ error: Boolean(store.logsError) }">
        <template v-if="store.logsError">{{ store.logsError }}</template>
        <template v-else>
          每 3 秒轮询 · 共 {{ store.logs.length }} 条 · 最新在最上
        </template>
      </p>

      <ul class="wb-log-list">
        <li v-if="store.logs.length === 0" class="wb-empty-line">还没有审计条目——发一个动作试试。</li>
        <li v-for="item in logsNewestFirst" :key="item.id" class="wb-log-item">
          <div class="wb-log-top">
            <span class="wb-log-time">{{ formatTime(item.ts) }}</span>
            <span class="wb-log-round">R{{ item.roundIndex }}·S{{ item.stepIndex }}</span>
            <span class="wb-log-badge" :class="item.applied ? 'ok' : 'rejected'">
              {{ item.applied ? '已施加' : '被拒' }}
            </span>
            <span v-if="item.terminated" class="wb-log-badge done">终局</span>
            <span v-else-if="item.truncated" class="wb-log-badge truncated">截断</span>
          </div>
          <div class="wb-log-detail">
            <span class="wb-log-force">
              F({{ formatNum(item.forceX) }}, {{ formatNum(item.forceZ) }})N · 上限
              {{ formatNum(item.forceLimit) }}N
            </span>
            <span v-if="item.errorCode" class="wb-log-error">{{ item.errorCode }}</span>
          </div>
          <div class="wb-log-detail">
            <span>
              距离 {{ item.distance === null ? '—' : formatNum(item.distance) }}m · reward
              {{ item.reward === null ? '—' : formatNum(item.reward) }} · {{ item.latencyMs }}ms
            </span>
          </div>
        </li>
      </ul>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useGymWorkbenchStore, AUDIT_POLL_INTERVAL_MS } from '@/stores/gymWorkbenchStore'

/** 回合过滤下拉里「全部」的哨兵值（select 的 value 只能是字符串，用 NaN 当哨兵不稳） */
const EMPTY_ROUND = -1

const store = useGymWorkbenchStore()

/** 轮询间隔：面板只在标题上展示，真正的定时器在 store 里 */
void AUDIT_POLL_INTERVAL_MS

/**
 * 回合过滤的双向绑定。
 * select 值与 store 的 number | undefined 之间换一层：EMPTY_ROUND = 全部回合。
 */
const roundModel = computed<number>({
  get: () => store.logRoundFilter ?? EMPTY_ROUND,
  set: (value) => {
    store.setLogRoundFilter(value === EMPTY_ROUND ? undefined : value)
  },
})

/** 回合选项从当前日志里取，避免枚举到不存在的回合 */
const roundOptions = computed<number[]>(() =>
  [...new Set(store.logs.map((item) => item.roundIndex))].sort((a, b) => a - b),
)

/** 日志按 id 倒序渲染：最新在最上 */
const logsNewestFirst = computed(() => [...store.logs].reverse())

/** 切换会话时把过滤重置回「全部」：旧会话的回合号对不上新会话 */
watch(
  () => store.currentSessionId,
  () => {
    if (roundModel.value !== EMPTY_ROUND) roundModel.value = EMPTY_ROUND
  },
)

const formatTime = (ts: string): string => {
  const date = new Date(ts)
  if (Number.isNaN(date.getTime())) return ts
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

const formatNum = (value: number): string =>
  Number.isFinite(value) ? value.toFixed(2) : String(value)
</script>

<style scoped>
.wb-panel {
  display: flex;
  flex-direction: column;
  gap: 10px;
  height: 100%;
  min-height: 0;
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

.wb-round-select {
  padding: 4px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
  color-scheme: dark;
}

.wb-empty-line {
  margin: 0;
  font-size: 12px;
  color: var(--text-3);
}

.wb-poll-line {
  margin: 0;
  font-size: 11px;
  color: var(--text-3);
}

.wb-poll-line.error {
  color: var(--danger);
}

.wb-log-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.wb-log-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-log-top {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-wrap: wrap;
}

.wb-log-time {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 12px;
  color: var(--text-2);
}

.wb-log-round {
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
}

.wb-log-badge {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 11px;
}

.wb-log-badge.ok {
  background: rgba(67, 192, 127, 0.14);
  color: var(--success);
}

.wb-log-badge.rejected {
  background: rgba(240, 97, 106, 0.14);
  color: var(--danger);
}

.wb-log-badge.done {
  background: rgba(var(--accent-rgb), 0.16);
  color: var(--accent);
}

.wb-log-badge.truncated {
  background: rgba(var(--accent-2-rgb), 0.16);
  color: var(--accent-2);
}

.wb-log-detail {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 11px;
  color: var(--text-2);
}

.wb-log-force {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}

.wb-log-error {
  font-family: var(--font-mono);
  color: var(--danger);
}
</style>
