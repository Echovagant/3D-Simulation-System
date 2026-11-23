<template>
  <div
    class="sim-form experiment-history sim-p-4 sim-bg-panel sim-r-lg sim-b sim-b-accent sim-mb-4"
  >
    <h3 class="sim-t-accent sim-fs-lg sim-fw-bold sim-mb-3">
      运行记录
      <span class="history-limit sim-fs-xs sim-t-faint">最多保留 {{ MAX_EXPERIMENT_RUNS }} 条</span>
    </h3>

    <!-- 读写失败要给可读提示，不静默 -->
    <p v-if="runStore.lastError" class="sim-fs-xs sim-t-danger sim-mb-3 experiment-history-error">
      {{ runStore.lastError }}
    </p>

    <EmptyState
      v-if="runStore.runs.length === 0"
      icon="fa-solid fa-clock-rotate-left"
      title="还没有运行记录"
      description="调好重力、摩擦与速度后，点右侧「记录本次运行」，这次实验的参数和场景来源会存在这台浏览器里，之后可以一键复现。"
    />

    <ul v-else class="run-list">
      <li v-for="run in runStore.runs" :key="run.id" class="run-item">
        <div class="run-head">
          <span class="run-name" :title="run.name">{{ run.name }}</span>
          <span class="run-time">{{ formatTime(run.createdAt) }}</span>
        </div>
        <div class="run-meta">
          <span>{{ sourceLabel(run.source) }}</span>
          <span>{{ run.objectCount }} 个物体</span>
          <span>{{ run.simulationTime.toFixed(2) }}s</span>
          <span v-if="run.recordedFrames > 0">{{ run.recordedFrames }} 帧</span>
        </div>
        <p class="run-config">
          重力 {{ run.config.gravity.toFixed(2) }} · 摩擦 {{ run.config.friction.toFixed(2) }} ·
          弹性 {{ run.config.restitution.toFixed(2) }} · 速度 {{ run.config.simulationSpeed }}x
        </p>
        <div class="run-actions">
          <button
            type="button"
            class="run-replay"
            title="重新加载来源场景并回填配置"
            @click="emit('replay', run)"
          >
            复现
          </button>
          <button
            type="button"
            class="run-delete"
            title="从本地存储删除这条记录"
            @click="remove(run)"
          >
            删除
          </button>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup lang="ts" name="ExperimentHistoryPanel">
import { onMounted } from 'vue'
import EmptyState from '@/components/common/EmptyState.vue'
import {
  MAX_EXPERIMENT_RUNS,
  useExperimentRunStore,
  type ExperimentRun,
  type ExperimentRunSource,
} from '@/stores/experimentRunStore'

/**
 * 运行记录面板。
 *
 * 列表与删除直接走 store（与「记录本次运行」共享同一份响应式列表）；
 * 「复现」要重建物理世界，只能交给 SimulationLab，所以走 emit。
 */
const emit = defineEmits<{
  replay: [run: ExperimentRun]
}>()

const runStore = useExperimentRunStore()

const SOURCE_LABEL: Record<ExperimentRunSource['kind'], string> = {
  preset: '预设',
  scene: '场景',
  handoff: '编辑器交接',
}

const sourceLabel = (source: ExperimentRunSource): string =>
  `${SOURCE_LABEL[source.kind] ?? '未知来源'} · ${source.name}`

/** 时间戳转本地可读时间；坏时间戳原样显示，不抛异常 */
const formatTime = (iso: string): string => {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleString('zh-CN', { hour12: false })
}

const remove = (run: ExperimentRun): void => {
  // 失败时 store.lastError 会给可读原因，面板顶部直接展示
  runStore.removeRun(run.id)
}

onMounted(() => {
  runStore.listRuns()
})
</script>

<style scoped>
.history-limit {
  margin-left: 0.5rem;
  font-weight: 400;
}

.run-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 0.625rem;
}

.run-item {
  padding: 0.625rem 0.75rem;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.run-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.5rem;
}

.run-name {
  font-size: var(--text-sm);
  font-weight: 600;
  color: var(--text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.run-time {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--text-3);
}

.run-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.25rem;
  font-size: var(--text-xs);
  color: var(--text-2);
}

.run-config {
  margin: 0.25rem 0 0;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.5;
  color: var(--text-3);
}

.run-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.run-replay,
.run-delete {
  padding: 0.25rem 0.625rem;
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  background: transparent;
  color: var(--text-2);
  font-size: var(--text-xs);
  cursor: pointer;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.run-replay {
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
}

.run-replay:hover {
  background: var(--accent-soft);
}

.run-delete:hover {
  background: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-1);
}

.run-replay:focus-visible,
.run-delete:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
