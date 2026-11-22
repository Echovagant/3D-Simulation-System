<template>
  <section class="wb-panel" aria-label="动作执行面板">
    <div class="wb-panel-head">
      <h3 class="wb-panel-title">动作执行</h3>
      <span v-if="store.currentSessionId" class="wb-current-id" :title="store.currentSessionId">
        会话 {{ shortId(store.currentSessionId) }}
      </span>
      <span v-else class="wb-current-id none">未选中会话</span>
    </div>

    <p v-if="!store.currentSessionId" class="wb-empty-line">
      先在左侧建一个会话（或选一个已有的），这里才能发动作。
    </p>

    <template v-if="store.currentSessionId">
      <!-- 动作输入：step 的动作就是 { forceX, forceZ } 两个数（牛顿） -->
      <label class="wb-field-label" for="wb-action-json">
        动作 JSON（forceX / forceZ，单位牛）
      </label>
      <textarea
        id="wb-action-json"
        v-model="actionJson"
        class="wb-textarea"
        rows="2"
        spellcheck="false"
      ></textarea>

      <!-- 预设动作：step 走 /step，重置走 /reset——两个端点，别混成一个"动作" -->
      <div class="wb-preset-row" role="group" aria-label="预设动作">
        <button
          v-for="preset in forcePresets"
          :key="preset.label"
          type="button"
          class="wb-preset-btn"
          :title="preset.title"
          :disabled="store.stepping"
          @click="applyPreset(preset.forceX, preset.forceZ)"
        >
          {{ preset.label }}
        </button>
        <button
          type="button"
          class="wb-preset-btn reset"
          title="重建世界回到初始状态（POST /reset）"
          :disabled="store.stepping"
          @click="onReset"
        >
          重置回合
        </button>
      </div>

      <button
        type="button"
        class="wb-primary-btn"
        :disabled="store.stepping"
        @click="onSend"
      >
        {{ store.stepping ? '执行中…' : '发送动作' }}
      </button>

      <p v-if="localError" class="wb-error-line">{{ localError }}</p>
      <p v-else-if="store.stepError" class="wb-error-line">{{ store.stepError }}</p>

      <!-- 422 修复指令：后端给的原文原样展示（核心卖点） -->
      <div v-if="store.repairHint" class="wb-repair" role="alert">
        <span class="wb-repair-title">修复指令 · {{ store.repairHint.code }}</span>
        <p class="wb-repair-text">{{ store.repairHint.message }}</p>
      </div>

      <!-- 执行结果 -->
      <div v-if="store.lastStep" class="wb-result-block">
        <h4 class="wb-form-title">最近一步</h4>
        <dl class="wb-result-list">
          <div class="wb-result-row">
            <dt>reward</dt>
            <dd :class="rewardClass">{{ formatNumber(store.lastStep.reward) }}</dd>
          </div>
          <div class="wb-result-row">
            <dt>terminated</dt>
            <dd :class="{ bad: store.lastStep.terminated }">
              {{ store.lastStep.terminated ? '回合结束' : '否' }}
            </dd>
          </div>
          <div class="wb-result-row">
            <dt>truncated</dt>
            <dd :class="{ warn: store.lastStep.truncated }">
              {{ store.lastStep.truncated ? '步数截断' : '否' }}
            </dd>
          </div>
        </dl>
      </div>

      <!-- 观测摘要 -->
      <div v-if="observationRows.length" class="wb-result-block">
        <h4 class="wb-form-title">观测摘要</h4>
        <dl class="wb-result-list">
          <div v-for="row in observationRows" :key="row.key" class="wb-result-row">
            <dt>{{ row.key }}</dt>
            <dd>{{ row.value }}</dd>
          </div>
        </dl>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { useGymWorkbenchStore } from '@/stores/gymWorkbenchStore'

const store = useGymWorkbenchStore()

const actionJson = ref('{ "forceX": 5, "forceZ": 0 }')
const localError = ref('')

const shortId = (id: string): string => id.slice(0, 8)

/** 预设力：按当前力上限的一半算；没建会话（没有回显）时按 1kg 默认 15N */
const HALF_DEFAULT_FORCE = 15

const presetForce = computed<number>(() => {
  const limit = store.currentParams?.forceLimit
  return typeof limit === 'number' && limit > 0 ? Math.round(limit * 0.5) : HALF_DEFAULT_FORCE
})

const forcePresets = computed(() => {
  const n = presetForce.value
  return [
    { label: `推 +X ${n}N`, title: `沿 +X 施加 ${n}N 水平力并推进一步`, forceX: n, forceZ: 0 },
    { label: `拉 -X ${n}N`, title: `沿 -X 施加 ${n}N 水平力并推进一步`, forceX: -n, forceZ: 0 },
    { label: `侧推 +Z ${n}N`, title: `沿 +Z 施加 ${n}N 水平力并推进一步`, forceX: 0, forceZ: n },
    { label: `侧推 -Z ${n}N`, title: `沿 -Z 施加 ${n}N 水平力并推进一步`, forceX: 0, forceZ: -n },
  ]
})

const formatNumber = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(4) : '—'

const rewardClass = computed(() => {
  const reward = store.lastStep?.reward
  if (typeof reward !== 'number') return ''
  if (reward > 0) return 'good'
  if (reward < 0) return 'bad'
  return ''
})

/** 观测摘要的展示行：智能体位置 / 速度 / 距目标距离 / 步数 / 物体数 */
const observationRows = computed(() => {
  const obs = store.lastObservation
  if (!obs) return []
  const pos = obs.agent?.position
  const vel = obs.agent?.velocity
  const fmt = (v: { x: number; y: number; z: number } | undefined): string =>
    v ? `(${v.x.toFixed(3)}, ${v.y.toFixed(3)}, ${v.z.toFixed(3)})` : '—'
  const rows: Array<{ key: string; value: string }> = [
    { key: '智能体', value: obs.agent?.uuid ?? '无' },
    { key: '位置', value: fmt(pos) },
    { key: '速度', value: fmt(vel) },
    { key: '距目标', value: `${formatNumber(obs.distance)} m` },
    { key: '步数', value: `${obs.step}/${obs.maxSteps}` },
    { key: '物体数', value: String(obs.objects.length) },
  ]
  return rows
})

/** 解析动作文本域：只认 { forceX, forceZ } 两个有限数，其余一律拒在本地 */
const parseAction = (): { forceX: number; forceZ: number } | null => {
  localError.value = ''
  let parsed: unknown
  try {
    parsed = JSON.parse(actionJson.value)
  } catch {
    localError.value = '动作不是合法 JSON——示例：{ "forceX": 5, "forceZ": 0 }'
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    localError.value = '动作要是一个 JSON 对象：{ "forceX": 5, "forceZ": 0 }'
    return null
  }
  const { forceX, forceZ } = parsed as Record<string, unknown>
  if (typeof forceX !== 'number' || typeof forceZ !== 'number') {
    localError.value = 'forceX 与 forceZ 都要给，且必须是数字（单位牛）'
    return null
  }
  if (!Number.isFinite(forceX) || !Number.isFinite(forceZ)) {
    // NaN / Infinity 送到后端也是 422：SQLite 存不了非有限数，不如在本地就拦下
    localError.value = 'forceX / forceZ 必须是有限数（NaN / Infinity 一律不收）'
    return null
  }
  return { forceX, forceZ }
}

const applyPreset = async (forceX: number, forceZ: number): Promise<void> => {
  actionJson.value = JSON.stringify({ forceX, forceZ })
  await store.stepCurrent(forceX, forceZ)
}

const onSend = async (): Promise<void> => {
  const action = parseAction()
  if (!action) return
  await store.stepCurrent(action.forceX, action.forceZ)
}

const onReset = async (): Promise<void> => {
  localError.value = ''
  await store.resetCurrent()
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
  gap: 10px;
}

.wb-panel-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
}

.wb-current-id {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--text-2);
}

.wb-current-id.none {
  color: var(--text-3);
}

.wb-empty-line {
  margin: 0;
  font-size: 13px;
  color: var(--text-3);
}

.wb-field-label {
  font-size: 12px;
  color: var(--text-2);
}

.wb-textarea {
  width: 100%;
  padding: 6px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.5;
  resize: vertical;
  color-scheme: dark;
}

.wb-preset-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wb-preset-btn {
  padding: 5px 10px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.wb-preset-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  border-color: var(--border-strong);
}

.wb-preset-btn.reset {
  color: var(--accent-2);
  border-color: rgba(var(--accent-2-rgb), 0.4);
}

.wb-preset-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.wb-error-line {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

/* 422 修复指令：琥珀色警示框，原文展示 */
.wb-repair {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px 12px;
  background: var(--accent-2-soft);
  border: 1px solid rgba(var(--accent-2-rgb), 0.45);
  border-radius: var(--radius-sm);
}

.wb-repair-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--accent-2);
}

.wb-repair-text {
  margin: 0;
  font-size: 13px;
  line-height: 1.6;
  color: var(--text-1);
  font-family: var(--font-mono);
}

.wb-result-block {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-form-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.wb-result-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-result-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.wb-result-row dt {
  color: var(--text-3);
}

.wb-result-row dd {
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.wb-result-row dd.good {
  color: var(--success);
}

.wb-result-row dd.bad {
  color: var(--danger);
}

.wb-result-row dd.warn {
  color: var(--accent-2);
}
</style>
