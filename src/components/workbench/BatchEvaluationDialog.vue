<template>
  <div class="bev-backdrop" @click.self="close">
    <div class="bev-dialog" role="dialog" aria-modal="true" aria-label="批量评测">
      <header class="bev-header">
        <div class="bev-header-text">
          <h3 class="bev-title">批量评测</h3>
          <p class="bev-subtitle">
            逐任务建会话 → 规则策略推进 → 销毁会话；结果可导出 JSON / CSV。
          </p>
        </div>
        <button type="button" class="bev-close" aria-label="关闭" @click="close">×</button>
      </header>

      <div class="bev-body">
        <!-- 左：套件列表与导入导出 -->
        <aside class="bev-suites">
          <h4 class="bev-section-title">任务套件</h4>

          <input
            v-model="newSuiteName"
            class="bev-input"
            type="text"
            placeholder="新套件名称"
            aria-label="新套件名称"
          />
          <button
            type="button"
            class="bev-new-suite-btn"
            :disabled="!currentScene"
            :title="currentScene ? '把当前会话场景内嵌成第一个任务' : '没有当前会话场景'"
            @click="onCreateSuite"
          >
            用当前会话场景新建套件
          </button>
          <p v-if="!currentScene" class="bev-hint">
            当前没有会话场景：先在会话面板建一个会话，建会话时的场景 JSON 会被套件内嵌。
          </p>

          <div class="bev-actions">
            <button type="button" class="bev-mini-btn" @click="triggerImport">导入 JSON</button>
            <button type="button" class="bev-mini-btn" :disabled="!currentSuite" @click="exportSuiteJson">
              导出 JSON
            </button>
            <input
              ref="importInput"
              class="bev-file-input"
              type="file"
              accept=".json,application/json"
              @change="onImportFile"
            />
          </div>
          <p v-if="localError" class="bev-error">{{ localError }}</p>

          <ul class="bev-suite-list">
            <li v-if="evaluation.suites.length === 0" class="bev-empty">还没有任务套件。</li>
            <li v-for="suite in evaluation.suites" :key="suite.id">
              <button
                type="button"
                class="bev-suite-item"
                :class="{ active: suite.id === evaluation.currentSuiteId }"
                @click="onSelectSuite(suite.id)"
              >
                <span class="bev-suite-name">{{ suite.name }}</span>
                <span class="bev-suite-meta">{{ suite.tasks.length }} 个任务</span>
              </button>
            </li>
          </ul>

          <button
            v-if="currentSuite"
            type="button"
            class="bev-danger-btn"
            @click="onDeleteSuite"
          >
            删除当前套件
          </button>

          <p v-if="evaluation.lastError" class="bev-error">{{ evaluation.lastError }}</p>
        </aside>

        <!-- 右：任务、运行与结果 -->
        <section class="bev-main">
          <template v-if="currentSuite">
            <div class="bev-suite-head">
              <h4 class="bev-section-title">{{ currentSuite.name }}</h4>
              <span class="bev-suite-summary">
                {{ currentSuite.tasks.length }} 个任务 · 选中 {{ selectedPolicies.length }} 个策略 →
                {{ runCount }} 次运行
              </span>
            </div>

            <ul class="bev-task-list">
              <li v-if="currentSuite.tasks.length === 0" class="bev-empty">这套里还没有任务。</li>
              <li v-for="task in currentSuite.tasks" :key="task.id" class="bev-task-row">
                <div class="bev-task-main">
                  <span class="bev-task-name">{{ task.name }}</span>
                  <span class="bev-task-meta">
                    目标 ({{ formatNumber(task.target.x) }}, {{ formatNumber(task.target.z) }})
                    · 上限 {{ task.maxSteps }} 步
                    <template v-if="task.params"> · 参数已设</template>
                  </span>
                </div>
                <div class="bev-task-actions">
                  <button type="button" class="bev-mini-btn" @click="startEdit(task)">编辑</button>
                  <button
                    type="button"
                    class="bev-mini-btn danger"
                    @click="onRemoveTask(task.id)"
                  >
                    删除
                  </button>
                </div>
              </li>
            </ul>

            <button
              type="button"
              class="bev-mini-btn"
              :disabled="!currentScene"
              :title="currentScene ? '用当前会话场景追加一个任务' : '没有当前会话场景，无法新增任务'"
              @click="onAddTask"
            >
              新增任务
            </button>

            <!-- 任务编辑：目标 / 步数 / 参数，场景沿用任务里内嵌的那份 -->
            <div v-if="editingTaskId" class="bev-task-editor">
              <h5 class="bev-editor-title">编辑任务</h5>
              <div class="bev-field-row">
                <label class="bev-field">
                  名称
                  <input v-model="taskDraft.name" type="text" />
                </label>
                <label class="bev-field">
                  目标 X
                  <input v-model.number="taskDraft.targetX" type="number" step="0.5" />
                </label>
                <label class="bev-field">
                  目标 Z
                  <input v-model.number="taskDraft.targetZ" type="number" step="0.5" />
                </label>
                <label class="bev-field">
                  步数上限
                  <input v-model.number="taskDraft.maxSteps" type="number" min="1" max="10000" />
                </label>
              </div>
              <label class="bev-field">
                物理参数 JSON（可留空；键值对由后端逐键校验）
                <textarea v-model="taskDraft.paramsJson" rows="2" spellcheck="false"></textarea>
              </label>
              <p v-if="editError" class="bev-error">{{ editError }}</p>
              <div class="bev-actions">
                <button type="button" class="bev-primary-btn" @click="saveEdit">保存</button>
                <button type="button" class="bev-mini-btn" @click="cancelEdit">取消</button>
              </div>
            </div>

            <!-- 运行区 -->
            <div class="bev-run-block">
              <h4 class="bev-section-title">运行</h4>
              <div class="bev-policy-row">
                <label class="bev-policy">
                  <input
                    type="checkbox"
                    :checked="hasPolicy('constant')"
                    @change="togglePolicy('constant')"
                  />
                  <span>恒定推力</span>
                  <small>力大小 = 力上限 × 50%</small>
                </label>
                <label class="bev-policy">
                  <input
                    type="checkbox"
                    :checked="hasPolicy('proportional')"
                    @change="togglePolicy('proportional')"
                  />
                  <span>比例控制</span>
                  <small>力大小 = min(力上限 × 80%, 距离 × 2)</small>
                </label>
              </div>
              <p class="bev-hint">策略只用观测计算，不调用 LLM；LLM 策略与并发评测未实现。</p>
              <p v-if="checkingBackend" class="bev-hint">正在检查后端…</p>
              <p v-else-if="backendOffline" class="bev-warn">
                后端不在，无法建 Gym 会话；套件编辑与导入导出仍可用。
              </p>

              <button
                type="button"
                class="bev-primary-btn bev-run-btn"
                :disabled="!canRun"
                @click="runEvaluation"
              >
                {{ evaluation.running ? '评测中…' : '开始评测' }}
              </button>

              <div
                v-if="evaluation.running || evaluation.progress.total > 0"
                class="bev-progress"
              >
                <div class="bev-progress-bar">
                  <span :style="{ width: `${progressPercent}%` }"></span>
                </div>
                <span class="bev-progress-text">
                  {{ evaluation.progress.completed }} / {{ evaluation.progress.total }}
                  <template v-if="evaluation.progress.currentTaskName">
                    · {{ evaluation.progress.currentTaskName }}（{{
                      policyLabel(evaluation.progress.currentPolicyId)
                    }}）
                  </template>
                </span>
              </div>

              <p v-if="runError" class="bev-error">{{ runError }}</p>
              <p v-else-if="evaluation.lastRunError" class="bev-error">
                {{ evaluation.lastRunError }}
              </p>
            </div>
          </template>

          <p v-else class="bev-empty">左侧选一套套件，或从当前会话场景新建。</p>

          <!-- 结果区 -->
          <div v-if="summary" class="bev-results">
            <div class="bev-results-head">
              <h4 class="bev-section-title">结果</h4>
              <div class="bev-actions">
                <button
                  type="button"
                  class="bev-mini-btn"
                  :disabled="evaluation.lastResults.length === 0"
                  @click="exportResultsJson"
                >
                  导出 JSON
                </button>
                <button
                  type="button"
                  class="bev-mini-btn"
                  :disabled="evaluation.lastResults.length === 0"
                  @click="exportResultsCsv"
                >
                  导出 CSV
                </button>
              </div>
            </div>

            <div class="bev-summary-cards">
              <div class="bev-card">
                <span>运行</span><strong>{{ summary.totalRuns }}</strong>
              </div>
              <div class="bev-card">
                <span>成功率</span><strong>{{ formatPercent(summary.successRate) }}</strong>
              </div>
              <div class="bev-card">
                <span>平均步数</span><strong>{{ formatNumber(summary.avgSteps) }}</strong>
              </div>
              <div class="bev-card">
                <span>平均 reward</span><strong>{{ formatNumber(summary.avgReward) }}</strong>
              </div>
              <div class="bev-card">
                <span>平均耗时</span><strong>{{ formatDuration(summary.avgLatencyMs) }}</strong>
              </div>
            </div>

            <!-- 策略对比：并排指标 + Δ，再按任务拆开看差异来自哪条 -->
            <div v-if="comparison" class="bev-compare">
              <div class="bev-results-head">
                <h4 class="bev-section-title">策略对比</h4>
                <span class="bev-hint">
                  Δ = 当前策略 − 基准（{{ policyLabel(comparison.baselinePolicyId) }}）
                </span>
              </div>

              <table class="bev-table bev-compare-table">
                <thead>
                  <tr>
                    <th>指标</th>
                    <th v-for="row in comparison.policies" :key="row.policyId">
                      {{ policyLabel(row.policyId) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="metric in compareMetrics" :key="metric.key">
                    <td>{{ metric.label }}</td>
                    <td
                      v-for="(row, index) in comparison.policies"
                      :key="row.policyId"
                      class="bev-compare-cell"
                    >
                      <span>{{ metric.value(row) }}</span>
                      <span
                        v-if="index > 0"
                        class="bev-delta"
                        :class="metric.deltaClass(row)"
                      >
                        Δ {{ metric.delta(row) }}
                      </span>
                    </td>
                  </tr>
                </tbody>
              </table>

              <h5 class="bev-matrix-title">逐任务对比（成功 / 步数 / 错误）</h5>
              <table class="bev-table bev-matrix-table">
                <thead>
                  <tr>
                    <th>任务</th>
                    <th v-for="row in comparison.policies" :key="row.policyId">
                      {{ policyLabel(row.policyId) }}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  <tr v-for="task in comparison.matrix" :key="task.taskId">
                    <td>{{ task.taskName }}</td>
                    <td v-for="(cell, index) in task.cells" :key="index" class="bev-matrix-cell">
                      <template v-if="!cell">—</template>
                      <template v-else-if="cell.error">
                        <span class="bev-bad" :title="cell.error">错误</span>
                      </template>
                      <template v-else>
                        <span :class="cell.success ? 'bev-ok' : 'bev-bad'">
                          {{ cell.success ? '成功' : '失败' }}
                        </span>
                        <span class="bev-cell-steps">{{ cell.steps }} 步</span>
                      </template>
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            <table class="bev-table">
              <thead>
                <tr>
                  <th>策略</th>
                  <th>运行</th>
                  <th>成功</th>
                  <th>成功率</th>
                  <th>平均步数</th>
                  <th>平均 reward</th>
                  <th>平均耗时</th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="row in summary.byPolicy" :key="row.policyId">
                  <td>{{ policyLabel(row.policyId) }}</td>
                  <td>{{ row.runs }}</td>
                  <td>{{ row.successes }}</td>
                  <td>{{ formatPercent(row.successRate) }}</td>
                  <td>{{ formatNumber(row.avgSteps) }}</td>
                  <td>{{ formatNumber(row.avgReward) }}</td>
                  <td>{{ formatDuration(row.avgLatencyMs) }}</td>
                </tr>
              </tbody>
            </table>

            <table class="bev-table bev-detail-table">
              <thead>
                <tr>
                  <th>任务</th>
                  <th>策略</th>
                  <th>成功</th>
                  <th>步数</th>
                  <th>reward</th>
                  <th>耗时</th>
                  <th>错误</th>
                </tr>
              </thead>
              <tbody>
                <tr
                  v-for="(result, index) in evaluation.lastResults"
                  :key="`${result.taskId}-${result.policyId}-${index}`"
                >
                  <td>{{ result.taskName }}</td>
                  <td>{{ policyLabel(result.policyId) }}</td>
                  <td :class="{ 'bev-ok': result.success, 'bev-bad': !result.success }">
                    {{ result.success ? '是' : '否' }}
                  </td>
                  <td>{{ result.steps }}</td>
                  <td>{{ formatNumber(result.totalReward) }}</td>
                  <td>{{ formatDuration(result.wallClockMs) }}</td>
                  <td class="bev-error-cell">{{ result.error ?? '—' }}</td>
                </tr>
              </tbody>
            </table>

            <p class="bev-hint">
              平均值只统计无错误的运行；成功率分母包含失败运行。success = 最终距离 ≤ 0.5m
              （terminated 也可能是坠落失败，不能只看它）。
            </p>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * Agent 评测台 · 批量评测弹窗。
 *
 * 只做三件事：编排套件（新建 / 导入导出 / 任务增删改）、选择基线策略并跑、
 * 展示汇总与明细。评测本身在 `services/gym/evaluate.ts`，这里不碰 HTTP。
 *
 * 后端不在时只禁用「开始评测」：套件编辑与导入导出是纯本地能力，照常可用。
 */
import { computed, onMounted, reactive, ref } from 'vue'
import {
  compareGymEvalResults,
  evaluateTaskSuite,
  serializeGymEvalResultsCsv,
  type GymPolicyComparison,
} from '@/services/gym/evaluate'
import {
  useGymEvaluationStore,
  type GymEvalPolicyId,
  type GymTask,
} from '@/stores/gymEvaluationStore'
import { useGymWorkbenchStore } from '@/stores/gymWorkbenchStore'
import { useLlmStore } from '@/stores/llmStore'

const emit = defineEmits<{ (e: 'close'): void }>()

const evaluation = useGymEvaluationStore()
const workbench = useGymWorkbenchStore()
const llmStore = useLlmStore()

/** 后端是否不可用（进弹窗时主动探一次） */
const backendOffline = ref(false)
const checkingBackend = ref(true)
/** 本地操作（导入失败 / 运行异常）的提示 */
const localError = ref('')
const runError = ref('')

const newSuiteName = ref('新任务套件')
const importInput = ref<HTMLInputElement | null>(null)

const currentScene = computed(() => workbench.currentScene)
const currentSuite = computed(() => evaluation.currentSuite)
const summary = computed(() => evaluation.lastSummary)

/**
 * 策略对比：只展示本次运行实际参与的策略（汇总里的 byPolicy 顺序），
 * 差值以第一个策略为基准；没有结果时为 null，整个区块不渲染。
 */
const comparison = computed(() => {
  if (!summary.value || evaluation.lastResults.length === 0) return null
  const policyIds = summary.value.byPolicy.map((row) => row.policyId)
  return compareGymEvalResults(evaluation.lastResults, policyIds)
})

const selectedPolicies = ref<GymEvalPolicyId[]>(['constant', 'proportional'])
const runCount = computed(
  () => (currentSuite.value?.tasks.length ?? 0) * selectedPolicies.value.length,
)
const canRun = computed(
  () =>
    Boolean(currentSuite.value) &&
    (currentSuite.value?.tasks.length ?? 0) > 0 &&
    selectedPolicies.value.length > 0 &&
    !evaluation.running &&
    !checkingBackend.value &&
    !backendOffline.value,
)

const progressPercent = computed(() => {
  const { completed, total } = evaluation.progress
  if (total <= 0) return 0
  return Math.min(100, Math.round((completed / total) * 100))
})

onMounted(async () => {
  evaluation.listSuites()
  evaluation.listRuns()
  backendOffline.value = !(await workbench.refreshSessions())
  checkingBackend.value = false
})

const close = (): void => {
  emit('close')
}

const hasPolicy = (id: GymEvalPolicyId): boolean => selectedPolicies.value.includes(id)

const togglePolicy = (id: GymEvalPolicyId): void => {
  selectedPolicies.value = selectedPolicies.value.includes(id)
    ? selectedPolicies.value.filter((item) => item !== id)
    : [...selectedPolicies.value, id]
}

const policyLabel = (id: GymEvalPolicyId | null): string => {
  if (id === 'constant') return '恒定推力'
  if (id === 'proportional') return '比例控制'
  return '—'
}

const formatNumber = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  return String(Math.round(value * 1000) / 1000)
}

const formatPercent = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toFixed(1)}%`
}

const formatDuration = (ms: number): string => {
  if (!Number.isFinite(ms) || ms < 0) return '—'
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`
}

const formatDistance = (meters: number | null): string => {
  if (meters === null || !Number.isFinite(meters)) return '—'
  return `${formatNumber(meters)} m`
}

/** 带符号的数字：+1.5 / -2 / ±0（差值展示用） */
const signedNumber = (value: number, digits = 3): string => {
  if (!Number.isFinite(value)) return '—'
  const rounded = Number(value.toFixed(digits))
  if (rounded === 0) return '±0'
  return `${rounded > 0 ? '+' : ''}${rounded}`
}

/** 成功率差值按百分点展示：+12.5% */
const signedPercent = (value: number): string => {
  if (!Number.isFinite(value)) return '—'
  const points = Math.round(value * 1000) / 10
  if (points === 0) return '±0%'
  return `${points > 0 ? '+' : ''}${points}%`
}

const signedOrDash = (value: number | null): string =>
  value === null || !Number.isFinite(value) ? '—' : signedNumber(value)

/** 差值着色只表达方向（正 / 负），不暗示哪个更好 */
const deltaClassOf = (value: number | null): string => {
  if (value === null || !Number.isFinite(value) || value === 0) return ''
  return value > 0 ? 'up' : 'down'
}

interface CompareMetric {
  key: string
  label: string
  value: (row: GymPolicyComparison) => string
  delta: (row: GymPolicyComparison) => string
  deltaClass: (row: GymPolicyComparison) => string
}

/** 策略对比的六个指标（顺序固定，与需求一致） */
const compareMetrics = computed<CompareMetric[]>(() => [
  {
    key: 'runs',
    label: '运行数',
    value: (row) => String(row.runs),
    delta: (row) => signedNumber(row.runsDelta, 0),
    deltaClass: (row) => deltaClassOf(row.runsDelta),
  },
  {
    key: 'successRate',
    label: '成功率',
    value: (row) => formatPercent(row.successRate),
    delta: (row) => signedPercent(row.successRateDelta),
    deltaClass: (row) => deltaClassOf(row.successRateDelta),
  },
  {
    key: 'avgSteps',
    label: '平均步数',
    value: (row) => formatNumber(row.avgSteps),
    delta: (row) => signedNumber(row.avgStepsDelta),
    deltaClass: (row) => deltaClassOf(row.avgStepsDelta),
  },
  {
    key: 'avgReward',
    label: '平均 reward',
    value: (row) => formatNumber(row.avgReward),
    delta: (row) => signedNumber(row.avgRewardDelta),
    deltaClass: (row) => deltaClassOf(row.avgRewardDelta),
  },
  {
    key: 'avgFinalDistance',
    label: '平均最终距离',
    value: (row) => formatDistance(row.avgFinalDistance),
    delta: (row) => signedOrDash(row.avgFinalDistanceDelta),
    deltaClass: (row) => deltaClassOf(row.avgFinalDistanceDelta),
  },
  {
    key: 'errors',
    label: '错误数',
    value: (row) => String(row.errors),
    delta: (row) => signedNumber(row.errorsDelta, 0),
    deltaClass: (row) => deltaClassOf(row.errorsDelta),
  },
])

/** 场景是 JSON 文档：克隆一份，避免套件与当前会话共享同一个响应式对象 */
const cloneScene = (scene: Record<string, unknown>): Record<string, unknown> => {
  try {
    return JSON.parse(JSON.stringify(scene)) as Record<string, unknown>
  } catch {
    return scene
  }
}

interface TaskDraft {
  name: string
  targetX: number
  targetZ: number
  maxSteps: number
  paramsJson: string
}

const editingTaskId = ref('')
const editError = ref('')
const taskDraft = reactive<TaskDraft>({
  name: '',
  targetX: 0,
  targetZ: 0,
  maxSteps: 300,
  paramsJson: '',
})

const onCreateSuite = (): void => {
  localError.value = ''
  const scene = currentScene.value
  if (!scene) return

  const target = workbench.lastObservation?.target ?? { x: 3, z: 0 }
  const maxSteps = workbench.lastObservation?.maxSteps ?? 300
  const created = evaluation.createSuite({
    name: newSuiteName.value,
    tasks: [
      {
        name: '任务 1',
        scene: cloneScene(scene),
        target: { x: target.x, z: target.z },
        maxSteps,
      },
    ],
  })
  if (created) newSuiteName.value = '新任务套件'
}

const onSelectSuite = (id: string): void => {
  cancelEdit()
  localError.value = ''
  evaluation.selectSuite(id)
}

const onDeleteSuite = (): void => {
  const suite = currentSuite.value
  if (!suite) return
  cancelEdit()
  evaluation.deleteSuite(suite.id)
}

const onAddTask = (): void => {
  const suite = currentSuite.value
  const scene = currentScene.value
  if (!suite || !scene) return

  const target = workbench.lastObservation?.target ?? { x: 3, z: 0 }
  const maxSteps = workbench.lastObservation?.maxSteps ?? 300
  evaluation.addTask(suite.id, {
    name: `任务 ${suite.tasks.length + 1}`,
    scene: cloneScene(scene),
    target: { x: target.x, z: target.z },
    maxSteps,
  })
}

const onRemoveTask = (taskId: string): void => {
  const suite = currentSuite.value
  if (!suite) return
  if (editingTaskId.value === taskId) cancelEdit()
  evaluation.removeTask(suite.id, taskId)
}

const startEdit = (task: GymTask): void => {
  editingTaskId.value = task.id
  editError.value = ''
  taskDraft.name = task.name
  taskDraft.targetX = task.target.x
  taskDraft.targetZ = task.target.z
  taskDraft.maxSteps = task.maxSteps
  taskDraft.paramsJson = task.params ? JSON.stringify(task.params, null, 2) : ''
}

const cancelEdit = (): void => {
  editingTaskId.value = ''
  editError.value = ''
}

const saveEdit = (): void => {
  const suite = currentSuite.value
  if (!suite || !editingTaskId.value) return

  const targetX = Number(taskDraft.targetX)
  const targetZ = Number(taskDraft.targetZ)
  const maxSteps = Math.round(Number(taskDraft.maxSteps))
  if (!Number.isFinite(targetX) || !Number.isFinite(targetZ)) {
    editError.value = '目标坐标要是数字'
    return
  }
  if (!Number.isFinite(maxSteps) || maxSteps < 1) {
    editError.value = '步数上限至少为 1'
    return
  }

  let params: Record<string, unknown> | undefined
  const paramsText = taskDraft.paramsJson.trim()
  if (paramsText) {
    try {
      const parsed: unknown = JSON.parse(paramsText)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        editError.value = '参数要是一个 JSON 对象'
        return
      }
      params = parsed as Record<string, unknown>
    } catch {
      editError.value = '参数不是合法 JSON'
      return
    }
  }

  const original = suite.tasks.find((task) => task.id === editingTaskId.value)
  if (!original) {
    editError.value = '任务不存在，可能已被删除'
    return
  }

  const ok = evaluation.updateTask(suite.id, {
    id: original.id,
    name: taskDraft.name.trim() || original.name,
    scene: original.scene,
    target: { x: targetX, z: targetZ },
    maxSteps,
    ...(params ? { params } : {}),
  })
  if (ok) cancelEdit()
}

/** 文件名安全化：Windows 非法字符替换成横线 */
const safeFileName = (name: string): string => {
  const cleaned = name.replace(/[\\/:*?"<>|]+/g, '-').trim()
  return cleaned || 'gym-task-suite'
}

const fileStamp = (): string => new Date().toISOString().replace(/[:.]/g, '-')

const downloadText = (text: string, filename: string, mime: string): void => {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 立刻 revoke 会把还没开始的下载掐掉——延后释放
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const triggerImport = (): void => {
  localError.value = ''
  importInput.value?.click()
}

const onImportFile = async (event: Event): Promise<void> => {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    evaluation.importSuiteJson(text)
  } catch (error) {
    console.warn('[BatchEvaluationDialog] 读取导入文件失败', error)
    localError.value = '读取导入文件失败'
  } finally {
    input.value = ''
  }
}

const exportSuiteJson = (): void => {
  localError.value = ''
  const suite = currentSuite.value
  if (!suite) return
  const text = evaluation.exportSuite(suite.id)
  if (!text) return
  downloadText(
    text,
    `${safeFileName(suite.name)}-${fileStamp()}.json`,
    'application/json;charset=utf-8',
  )
}

const exportResultsJson = (): void => {
  const results = evaluation.lastResults
  if (results.length === 0) return
  const payload = {
    suite: currentSuite.value
      ? { name: currentSuite.value.name, tasks: currentSuite.value.tasks }
      : null,
    policies: selectedPolicies.value,
    summary: evaluation.lastSummary,
    // 导出格式保持原样：finalDistance 只用于界面上的策略对比，不写进 JSON
    results: results.map((result) => ({
      taskId: result.taskId,
      taskName: result.taskName,
      policyId: result.policyId,
      success: result.success,
      steps: result.steps,
      totalReward: result.totalReward,
      wallClockMs: result.wallClockMs,
      error: result.error,
    })),
  }
  downloadText(
    JSON.stringify(payload, null, 2),
    `gym-eval-${fileStamp()}.json`,
    'application/json;charset=utf-8',
  )
}

const exportResultsCsv = (): void => {
  const results = evaluation.lastResults
  if (results.length === 0) return
  // BOM：Excel 直接打开中文表头不乱码
  downloadText(
    `\uFEFF${serializeGymEvalResultsCsv(results)}`,
    `gym-eval-${fileStamp()}.csv`,
    'text/csv;charset=utf-8',
  )
}

const describeError = (error: unknown): string => {
  if (error instanceof Error && error.message) return error.message
  return '批量评测没有跑完'
}

const runEvaluation = async (): Promise<void> => {
  const suite = currentSuite.value
  if (!suite || !canRun.value) return

  runError.value = ''
  const policies = [...selectedPolicies.value]
  evaluation.beginRun(runCount.value)
  try {
    const result = await evaluateTaskSuite({
      suite,
      policies,
      ownerToken: llmStore.ownerToken,
      onProgress: (progress) => evaluation.updateProgress(progress),
    })
    evaluation.finishRun({
      suite,
      policies,
      results: result.results,
      wallClockMs: result.wallClockMs,
    })
  } catch (error) {
    evaluation.failRun(describeError(error))
  }
}
</script>

<style scoped>
.bev-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: rgba(0, 0, 0, 0.62);
}

.bev-dialog {
  display: flex;
  flex-direction: column;
  width: min(1000px, calc(100vw - 32px));
  max-height: 90vh;
  overflow: hidden;
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}

.bev-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.bev-header-text {
  min-width: 0;
}

.bev-title {
  margin: 0;
  font-size: 16px;
  color: var(--text-1);
}

.bev-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-3);
}

.bev-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.bev-close:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.bev-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: grid;
  grid-template-columns: 260px minmax(0, 1fr);
  gap: 16px;
  padding: 16px 18px 20px;
}

.bev-suites {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding-right: 16px;
  border-right: 1px solid var(--border-subtle);
}

.bev-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.bev-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.bev-suite-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 10px;
}

.bev-suite-summary {
  font-size: 11px;
  color: var(--text-3);
}

.bev-input {
  width: 100%;
  padding: 5px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  color-scheme: dark;
}

.bev-new-suite-btn {
  width: 100%;
  padding: 6px 10px;
  background: var(--accent-soft);
  color: var(--accent);
  border: 1px solid rgba(var(--accent-rgb), 0.35);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.bev-new-suite-btn:hover:not(:disabled) {
  border-color: var(--accent);
}

.bev-new-suite-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.bev-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.bev-file-input {
  display: none;
}

.bev-suite-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 300px;
  overflow-y: auto;
}

.bev-suite-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 6px 9px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  text-align: left;
  cursor: pointer;
}

.bev-suite-item:hover {
  background: var(--bg-hover);
}

.bev-suite-item.active {
  border-color: rgba(var(--accent-rgb), 0.5);
  background: var(--accent-soft);
}

.bev-suite-name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
}

.bev-suite-meta {
  font-size: 11px;
  color: var(--text-3);
}

.bev-task-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bev-task-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 9px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.bev-task-main {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.bev-task-name {
  font-size: 12px;
  color: var(--text-1);
}

.bev-task-meta {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.bev-task-actions {
  flex-shrink: 0;
  display: flex;
  gap: 4px;
}

.bev-mini-btn {
  padding: 3px 9px;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
}

.bev-mini-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-1);
}

.bev-mini-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.bev-mini-btn.danger {
  color: var(--danger);
  border-color: rgba(240, 97, 106, 0.4);
}

.bev-danger-btn {
  padding: 5px 10px;
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  font-size: 11px;
  cursor: pointer;
}

.bev-danger-btn:hover {
  background: rgba(240, 97, 106, 0.12);
}

.bev-task-editor {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.bev-editor-title {
  margin: 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.bev-field-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 8px;
}

.bev-field {
  display: flex;
  flex-direction: column;
  gap: 4px;
  font-size: 11px;
  color: var(--text-3);
}

.bev-field input,
.bev-field textarea {
  width: 100%;
  padding: 4px 7px;
  background: var(--bg-panel);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  color-scheme: dark;
}

.bev-field textarea {
  resize: vertical;
  line-height: 1.4;
}

.bev-run-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.bev-policy-row {
  display: flex;
  flex-wrap: wrap;
  gap: 14px;
}

.bev-policy {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-1);
  cursor: pointer;
}

.bev-policy small {
  color: var(--text-3);
  font-size: 10px;
}

.bev-policy input {
  accent-color: var(--accent);
}

.bev-primary-btn {
  align-self: flex-start;
  padding: 7px 16px;
  background: var(--accent-strong);
  color: var(--accent-on);
  border: none;
  border-radius: var(--radius-sm);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

.bev-primary-btn:hover:not(:disabled) {
  background: var(--accent-strong-hover);
}

.bev-primary-btn:disabled {
  opacity: 0.55;
  cursor: not-allowed;
}

.bev-progress {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.bev-progress-bar {
  width: 100%;
  height: 6px;
  overflow: hidden;
  background: var(--bg-inset);
  border-radius: 999px;
}

.bev-progress-bar span {
  display: block;
  height: 100%;
  background: var(--accent);
  transition: width 0.2s ease;
}

.bev-progress-text {
  font-size: 11px;
  color: var(--text-3);
  font-variant-numeric: tabular-nums;
}

.bev-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}

.bev-warn {
  margin: 0;
  font-size: 11px;
  color: var(--accent-2);
}

.bev-error {
  margin: 0;
  font-size: 11px;
  color: var(--danger);
}

.bev-empty {
  padding: 8px 0;
  font-size: 12px;
  color: var(--text-3);
}

.bev-results {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding-top: 10px;
  border-top: 1px solid var(--border-subtle);
}

.bev-results-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.bev-summary-cards {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  gap: 8px;
}

.bev-card {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.bev-card span {
  font-size: 10px;
  color: var(--text-3);
}

.bev-card strong {
  font-size: 16px;
  color: var(--text-1);
  font-variant-numeric: tabular-nums;
}

.bev-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.bev-table th,
.bev-table td {
  padding: 5px 8px;
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.bev-table th {
  color: var(--text-3);
  font-weight: 500;
}

.bev-table td {
  color: var(--text-1);
}

.bev-detail-table td.bev-error-cell {
  max-width: 240px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--text-3);
}

/* 策略对比：指标并排 + 差值，下面是逐任务矩阵 */
.bev-compare {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.bev-compare-cell {
  font-variant-numeric: tabular-nums;
}

.bev-delta {
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-3);
}

.bev-delta.up {
  color: var(--accent);
}

.bev-delta.down {
  color: var(--accent-2);
}

.bev-matrix-title {
  margin: 4px 0 0;
  font-size: 12px;
  font-weight: 600;
  color: var(--text-1);
}

.bev-matrix-cell {
  font-variant-numeric: tabular-nums;
}

.bev-cell-steps {
  margin-left: 6px;
  font-size: 10px;
  color: var(--text-3);
}

.bev-ok {
  color: var(--success);
}

.bev-bad {
  color: var(--danger);
}

@media (max-width: 820px) {
  .bev-body {
    grid-template-columns: minmax(0, 1fr);
  }

  .bev-suites {
    padding-right: 0;
    padding-bottom: 12px;
    border-right: none;
    border-bottom: 1px solid var(--border-subtle);
  }

  .bev-summary-cards {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .bev-field-row {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
