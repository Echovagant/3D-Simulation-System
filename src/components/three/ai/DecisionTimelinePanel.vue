<template>
  <div class="decision-timeline">
    <!-- 工具条：按智能体筛选，右侧给出条数 -->
    <div class="dt-toolbar">
      <select v-model="agentFilter" class="dt-agent-filter" aria-label="按智能体筛选决策">
        <option value="all">全部智能体</option>
        <option v-for="option in agentOptions" :key="option.id" :value="option.id">
          {{ option.name }}（{{ option.count }}）
        </option>
      </select>
      <span class="dt-count">最近 {{ rows.length }} 条 · 最新在上</span>
    </div>

    <!-- 决策列表：最新在上，不需要滚动跟随 -->
    <div class="dt-list">
      <p v-if="rows.length === 0" class="dt-empty">
        {{ emptyText }}
      </p>

      <ul v-else class="dt-rows">
        <li
          v-for="row in rows"
          :key="row.key"
          class="dt-row"
          :class="{ 'dt-row-blocked': row.blocked }"
        >
          <div class="dt-row-head">
            <span class="dt-clock">{{ row.clock }}</span>
            <span class="dt-sim" title="决策时的仿真时间">仿真 {{ row.simTime }}</span>
            <span class="dt-agent">{{ row.agentName }}</span>
            <span
              class="dt-badge"
              :class="row.source === 'llm' ? 'dt-badge-llm' : 'dt-badge-rule'"
            >
              {{ row.sourceLabel }}
            </span>
            <span v-if="row.blocked" class="dt-badge dt-badge-blocked">受阻</span>
          </div>

          <div class="dt-action" :title="row.actionText">{{ row.actionText }}</div>

          <div class="dt-row-meta">
            <span>感知半径 {{ row.awarenessText }}</span>
            <span>最近障碍 {{ row.distanceText }}</span>
            <span>视野内 {{ row.obstaclesText }} 个</span>
          </div>
        </li>
      </ul>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from 'vue'
import type { AiDecision } from '@/types'
import {
  TIMELINE_LIMIT,
  collectTimelineAgents,
  toTimelineRows,
} from '@/utils/decisionTimeline'

const props = withDefaults(
  defineProps<{
    /** 决策队列（按时间先后排列，最新的在最后） */
    decisions: AiDecision[]
    /** 最多展示最近多少条 */
    limit?: number
  }>(),
  { limit: TIMELINE_LIMIT },
)

const agentFilter = ref('all')

const agentOptions = computed(() => collectTimelineAgents(props.decisions))

const rows = computed(() =>
  toTimelineRows(props.decisions, { agentId: agentFilter.value, limit: props.limit }),
)

/** 选中的智能体被删除后，筛选自动退回「全部」 */
watch(agentOptions, (options) => {
  if (agentFilter.value === 'all') return
  if (!options.some((option) => option.id === agentFilter.value)) agentFilter.value = 'all'
})

const emptyText = computed(() =>
  agentFilter.value === 'all'
    ? '还没有决策记录：点击「开始」后，智能体每次做决定都会出现在这里'
    : '该智能体还没有决策记录',
)
</script>

<style scoped>
.decision-timeline {
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.dt-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin-bottom: 0.25rem;
}

.dt-agent-filter {
  padding: 0.125rem 0.25rem;
  font-size: 0.75rem;
  color: var(--text-1);
  background: var(--bg-panel-raised);
  border: 1px solid var(--bg-inset);
  border-radius: 4px;
}

.dt-count {
  font-size: 0.6875rem;
  color: var(--text-3);
  white-space: nowrap;
}

/* 与日志列表同一套滚动约束：自己滚，不把面板撑高 */
.dt-list {
  max-height: 260px;
  min-height: 0;
  overflow-y: auto;
  padding: 0.5rem;
  background: var(--shadow-pop);
  border-radius: 4px;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 161, 23, 0.45) transparent;
}

.dt-empty {
  margin: 0;
  padding: 1rem 0;
  font-size: 0.75rem;
  color: var(--text-3);
  text-align: center;
  font-style: italic;
}

.dt-rows {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0;
  list-style: none;
}

.dt-row {
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
  border-left: 2px solid var(--accent-2);
  background: var(--bg-panel-raised);
}

/* 受阻的决策用危险色左边线标出来，扫一眼就能找到 */
.dt-row-blocked {
  border-left-color: var(--danger);
}

.dt-row-head {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.6875rem;
  line-height: 1.4;
  color: var(--text-3);
  white-space: nowrap;
}

.dt-clock {
  color: var(--text-2);
  font-variant-numeric: tabular-nums;
}

.dt-sim {
  font-variant-numeric: tabular-nums;
}

.dt-agent {
  overflow: hidden;
  text-overflow: ellipsis;
  color: var(--text-1);
}

.dt-badge {
  padding: 0 0.3rem;
  font-size: 0.625rem;
  line-height: 1.25rem;
  border-radius: 9999px;
  border: 1px solid transparent;
}

/* 规则式：琥珀；LLM：蓝（与面板的强调蓝一致） */
.dt-badge-rule {
  color: var(--accent-2);
  border-color: rgba(255, 161, 23, 0.45);
}

.dt-badge-llm {
  color: var(--accent);
  border-color: rgba(56, 189, 248, 0.45);
}

.dt-badge-blocked {
  color: var(--danger);
  border-color: rgba(240, 97, 106, 0.45);
  margin-left: auto;
}

.dt-action {
  margin-top: 0.125rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dt-row-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.125rem;
  font-size: 0.6875rem;
  line-height: 1.4;
  color: var(--text-2);
}
</style>
