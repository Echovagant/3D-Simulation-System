<template>
  <section class="wb-panel" aria-label="Gym 会话面板">
    <div class="wb-panel-head">
      <h3 class="wb-panel-title">会话</h3>
      <button
        type="button"
        class="wb-mini-btn"
        title="刷新会话列表"
        :disabled="store.creating"
        @click="onRefresh"
      >
        刷新
      </button>
    </div>

    <p v-if="store.listError" class="wb-error-line">{{ store.listError }}</p>

    <!-- 实时演练交接：成功横幅 / 无动态物体警告 / 没有交接数据 -->
    <div v-if="handoffNotices.length" class="wb-handoff-block" role="status">
      <p
        v-for="(notice, index) in handoffNotices"
        :key="index"
        class="wb-handoff-note"
        :class="notice.tone"
      >
        {{ notice.text }}
      </p>
    </div>

    <!-- 会话列表 -->
    <ul class="wb-session-list">
      <li v-if="store.sessions.length === 0" class="wb-empty-line">
        还没有会话——在下方表单建一个
      </li>
      <li v-for="item in store.sessions" :key="item.sessionId">
        <button
          type="button"
          class="wb-session-item"
          :class="{ active: item.sessionId === store.currentSessionId }"
          :title="item.sessionId"
          @click="store.selectSession(item.sessionId)"
        >
          <span class="wb-session-id">{{ shortId(item.sessionId) }}</span>
          <span class="wb-session-meta">
            第 {{ item.step }}/{{ item.maxSteps }} 步
            <template v-if="item.terminated"> · 终局</template>
            <template v-else-if="item.truncated"> · 截断</template>
          </span>
        </button>
      </li>
    </ul>

    <!-- 新建会话表单：字段按 openapi 的 GymSessionCreateRequest 实查 -->
    <div class="wb-form-block">
      <h4 class="wb-form-title">新建会话</h4>
      <label class="wb-field-label" for="wb-scene-json">场景文档 JSON（objects 至少一个动态物体）</label>
      <textarea
        id="wb-scene-json"
        v-model="sceneJson"
        class="wb-textarea"
        rows="8"
        spellcheck="false"
      ></textarea>

      <div class="wb-field-row">
        <div class="wb-field">
          <label class="wb-field-label" for="wb-target-x">目标 X</label>
          <input id="wb-target-x" v-model.number="targetX" type="number" step="0.5" />
        </div>
        <div class="wb-field">
          <label class="wb-field-label" for="wb-target-z">目标 Z</label>
          <input id="wb-target-z" v-model.number="targetZ" type="number" step="0.5" />
        </div>
        <div class="wb-field">
          <label class="wb-field-label" for="wb-max-steps">回合上限</label>
          <input id="wb-max-steps" v-model.number="maxSteps" type="number" min="1" max="10000" />
        </div>
      </div>

      <label class="wb-field-label" for="wb-params-json">物理参数 JSON（可留空，缺省回落见回显区）</label>
      <textarea
        id="wb-params-json"
        v-model="paramsJson"
        class="wb-textarea wb-textarea-compact"
        rows="2"
        placeholder='{"gravityY": -9.81}'
        spellcheck="false"
      ></textarea>

      <label class="wb-field-label" for="wb-agents-json">
        多智能体 agents JSON（可选；非空则进入多智能体模式）
      </label>
      <textarea
        id="wb-agents-json"
        v-model="agentsJson"
        class="wb-textarea wb-textarea-compact"
        rows="3"
        placeholder='[{"uuid":"agent-1","target":{"x":3,"z":0}}]'
        spellcheck="false"
      ></textarea>
      <button
        type="button"
        class="wb-mini-btn"
        title="把场景与 agents 填成两个 1kg 立方体、各朝一边的双智能体示例"
        @click="fillTeamExample"
      >
        填入双智能体示例
      </button>

      <button
        type="button"
        class="wb-primary-btn"
        :disabled="store.creating"
        @click="onCreate"
      >
        {{ store.creating ? '创建中…' : '创建会话' }}
      </button>
    </div>

    <!-- 当前会话参数回显：生效参数 / 丢键 / 回落键 / 力上限，来自 create/reset 响应 -->
    <div v-if="store.currentParams" class="wb-echo-block">
      <h4 class="wb-form-title">
        当前参数口径
        <span v-if="forceLimitText" class="wb-echo-limit">{{ forceLimitText }}</span>
      </h4>
      <dl class="wb-echo-list">
        <div v-for="row in effectiveRows" :key="row.key" class="wb-echo-row">
          <dt>{{ row.key }}</dt>
          <dd :class="{ nullable: row.value === 'null' }">{{ row.value }}</dd>
        </div>
      </dl>
      <p v-if="store.currentParams.droppedParamKeys.length" class="wb-echo-note dropped">
        丢键：{{ store.currentParams.droppedParamKeys.join('、') }}
      </p>
      <p v-if="store.currentParams.defaultedParamKeys.length" class="wb-echo-note defaulted">
        回落键：{{ store.currentParams.defaultedParamKeys.join('、') }}
      </p>
      <p v-if="!store.currentParams.droppedParamKeys.length && !store.currentParams.defaultedParamKeys.length" class="wb-echo-note ok">
        无丢键、无回落键——传什么生效什么
      </p>
    </div>

    <button
      v-if="store.currentSessionId"
      type="button"
      class="wb-danger-btn"
      :disabled="store.creating"
      @click="onDelete"
    >
      销毁当前会话
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useGymWorkbenchStore } from '@/stores/gymWorkbenchStore'
import type { GymAgentSpec } from '@/services/api/gymWorkbench'
import { clearAiLabHandoff, readAiLabHandoff, type AiLabHandoff } from '@/utils/aiLabHandoff'

const store = useGymWorkbenchStore()
// 测试与独立挂载时可能没有路由器；交接预填本身不依赖 query，缺省时按 key 是否存在决定
const route = useRoute()

/**
 * 默认演示场景：一个 1kg 的立方体智能体。
 * 字段口径与批量仿真的场景文档一致（后端 simulator.build_world 校验），
 * 已实测可建会话；用户可以直接贴场景编辑器保存的场景 JSON。
 */
const DEFAULT_SCENE = `{
  "name": "工作台演示场景",
  "objects": [
    {
      "uuid": "agent-1",
      "type": "cube",
      "name": "智能体",
      "position": { "x": 0, "y": 1, "z": 0 },
      "rotation": { "x": 0, "y": 0, "z": 0 },
      "scale": { "x": 1, "y": 1, "z": 1 },
      "physics": {
        "type": "dynamic",
        "shape": "cube",
        "halfExtents": { "x": 0.5, "y": 0.5, "z": 0.5 },
        "mass": 1,
        "friction": 0.5,
        "restitution": 0.2
      }
    }
  ]
}`

const sceneJson = ref(DEFAULT_SCENE)
const paramsJson = ref('')
const agentsJson = ref('')
const targetX = ref(3)
const targetZ = ref(0)
const maxSteps = ref(300)

/** 实时演练交接的提示：成功横幅、无动态物体警告、没有交接数据 */
const handoffNotices = ref<Array<{ tone: 'info' | 'warning'; text: string }>>([])

/**
 * 把交接数据填进表单——只预填，不自动创建会话。
 *
 * 用户仍要自己检查场景/目标/agents 后点「创建会话」：交接的是场地快照，
 * 参数口径是否合适只有看过的人能判断。
 */
const applyHandoff = (handoff: AiLabHandoff): void => {
  sceneJson.value = JSON.stringify(handoff.scene, null, 2)
  targetX.value = handoff.target.x
  targetZ.value = handoff.target.z
  maxSteps.value = handoff.maxSteps
  agentsJson.value = handoff.agents.length ? JSON.stringify(handoff.agents, null, 2) : ''

  const objects = handoff.scene.objects
  const obstacleCount = objects.filter(
    (object) => object.uuid.startsWith('arena-obstacle-') || object.physics?.type === 'static',
  ).length
  const dynamicCount = objects.filter((object) => object.physics?.type === 'dynamic').length
  const agentCount = handoff.agents.length

  const notices: Array<{ tone: 'info' | 'warning'; text: string }> = [
    {
      tone: 'info',
      text: `已从实时演练载入：${obstacleCount} 个障碍 + ${agentCount} 个智能体；检查参数后点创建会话`,
    },
  ]
  if (dynamicCount === 0) {
    notices.push({
      tone: 'warning',
      text: '场景里没有动态物体，Gym 需要至少一个动态物体才能创建会话——请检查场景 JSON 或 agents',
    })
  }
  handoffNotices.value = notices

  // 一次有效：读完即删，下次进入评测台不重复预填
  clearAiLabHandoff()
}

onMounted(() => {
  const fromPlayground = route?.query?.from === 'playground'
  const handoff = readAiLabHandoff()
  if (!handoff) {
    if (fromPlayground) {
      handoffNotices.value = [
        {
          tone: 'warning',
          text: '没有找到可用的实时演练交接数据，请回到实时演练重新点「去评测台」',
        },
      ]
    }
    return
  }
  applyHandoff(handoff)
})

/**
 * 双智能体示例：两个 1kg 立方体，一个朝 +X、一个朝 -X。
 * agents 里的 uuid 必须与场景一致（后端按 uuid 绑定受控物体）。
 */
const TEAM_SCENE_JSON = JSON.stringify(
  {
    name: '双智能体演示场景',
    objects: [
      {
        uuid: 'agent-1',
        type: 'cube',
        name: '甲',
        position: { x: -1, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: {
          type: 'dynamic',
          shape: 'cube',
          halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
          mass: 1,
          friction: 0.5,
          restitution: 0.2,
        },
      },
      {
        uuid: 'agent-2',
        type: 'cube',
        name: '乙',
        position: { x: 1, y: 1, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: {
          type: 'dynamic',
          shape: 'cube',
          halfExtents: { x: 0.5, y: 0.5, z: 0.5 },
          mass: 1,
          friction: 0.5,
          restitution: 0.2,
        },
      },
    ],
  },
  null,
  2,
)

const TEAM_AGENTS_JSON = JSON.stringify(
  [
    { uuid: 'agent-1', target: { x: 4, z: 0 } },
    { uuid: 'agent-2', target: { x: -4, z: 0 } },
  ],
  null,
  2,
)

/** 一键把表单填成双智能体示例（场景 + agents 一起换） */
const fillTeamExample = (): void => {
  sceneJson.value = TEAM_SCENE_JSON
  agentsJson.value = TEAM_AGENTS_JSON
  store.listError = ''
}

/** 会话 id 只留前 8 位，完整 id 放 title */
const shortId = (id: string): string => id.slice(0, 8)

/** 生效参数的展示行（保持固定顺序，friction/restitution 缺省时如实写 null） */
const effectiveRows = computed(() => {
  const params = store.currentParams?.effectiveParams
  if (!params) return []
  const entries: Array<[string, string | number | boolean | null]> = [
    ['重力 gravityY', params.gravityY],
    ['摩擦 friction', params.friction],
    ['弹性 restitution', params.restitution],
    ['步长 dt', params.dt],
    ['步数 steps', params.steps],
    ['轨迹 trace', params.trace],
    ['初速 initialVelocityY', params.initialVelocityY],
  ]
  return entries.map(([key, value]) => ({
    key,
    value: value === null ? 'null' : typeof value === 'boolean' ? (value ? '开' : '关') : String(value),
  }))
})

const forceLimitText = computed(() => {
  const limit = store.currentParams?.forceLimit
  return typeof limit === 'number' ? `力上限 ${limit.toFixed(2)}N` : ''
})

/** 解析一个 JSON 文本域；解析失败返回 null 并写错误信息 */
const parseJsonField = (raw: string, label: string): Record<string, unknown> | null => {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed: unknown = JSON.parse(trimmed)
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      store.listError = `${label}要是一个 JSON 对象`
      return null
    }
    return parsed as Record<string, unknown>
  } catch {
    store.listError = `${label}不是合法 JSON`
    return null
  }
}

/** 解析 agents 数组；空文本 = 单智能体模式（返回空数组） */
const parseAgentsField = (): GymAgentSpec[] | null => {
  const trimmed = agentsJson.value.trim()
  if (!trimmed) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(trimmed)
  } catch {
    store.listError = 'agents 不是合法 JSON'
    return null
  }
  if (!Array.isArray(parsed)) {
    store.listError = 'agents 要是一个数组'
    return null
  }
  const specs: GymAgentSpec[] = []
  for (const item of parsed) {
    if (
      !item ||
      typeof item !== 'object' ||
      typeof (item as { uuid?: unknown }).uuid !== 'string' ||
      !(item as { target?: unknown }).target ||
      typeof (item as { target: { x?: unknown } }).target.x !== 'number' ||
      typeof (item as { target: { z?: unknown } }).target.z !== 'number'
    ) {
      store.listError = 'agents 每一项都要有 uuid 与 target {x, z}'
      return null
    }
    const spec = item as { uuid: string; target: { x: number; z: number } }
    specs.push({ uuid: spec.uuid, target: { x: spec.target.x, z: spec.target.z } })
  }
  return specs
}

const onCreate = async (): Promise<void> => {
  const scene = parseJsonField(sceneJson.value, '场景文档')
  if (!scene) return
  const params = parseJsonField(paramsJson.value, '物理参数')
  if (!params) return
  const agents = parseAgentsField()
  if (!agents) return
  await store.createSession({
    scene,
    ...(Object.keys(params).length ? { params } : {}),
    target: { x: targetX.value, z: targetZ.value },
    ...(Number.isFinite(maxSteps.value) ? { maxSteps: maxSteps.value } : {}),
    ...(agents.length > 0 ? { agents } : {}),
  })
}

const onDelete = async (): Promise<void> => {
  await store.deleteCurrent()
}

const onRefresh = async (): Promise<void> => {
  await store.refreshSessions()
}
</script>

<style scoped>
.wb-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  overflow-y: auto;
}

.wb-panel-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
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

.wb-error-line {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

/* 实时演练交接提示：成功一条，缺动态物体时再加一条警告 */
.wb-handoff-block {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.wb-handoff-note {
  margin: 0;
  font-size: 12px;
  line-height: 1.5;
}

.wb-handoff-note.info {
  color: var(--text-2);
}

.wb-handoff-note.warning {
  color: var(--accent-2);
}

.wb-empty-line {
  font-size: 12px;
  color: var(--text-3);
  padding: 6px 0;
}

.wb-session-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-session-item {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  width: 100%;
  padding: 6px 10px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  cursor: pointer;
  text-align: left;
}

.wb-session-item:hover {
  background: var(--bg-hover);
}

.wb-session-item.active {
  border-color: rgba(var(--accent-rgb), 0.5);
  background: var(--accent-soft);
}

.wb-session-id {
  font-family: var(--font-mono);
  font-size: 12px;
}

.wb-session-meta {
  font-size: 11px;
  color: var(--text-3);
}

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
  font-size: 11px;
  line-height: 1.5;
  resize: vertical;
  color-scheme: dark;
}

.wb-textarea-compact {
  font-size: 12px;
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

.wb-field input {
  width: 100%;
  padding: 4px 8px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 12px;
  color-scheme: dark;
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

.wb-danger-btn {
  padding: 6px 12px;
  background: transparent;
  color: var(--danger);
  border: 1px solid var(--danger);
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.wb-danger-btn:hover:not(:disabled) {
  background: rgba(240, 97, 106, 0.12);
}

/* 参数回显区 */
.wb-echo-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px;
  background: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.wb-echo-limit {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 500;
  color: var(--accent);
}

.wb-echo-list {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.wb-echo-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 12px;
}

.wb-echo-row dt {
  color: var(--text-3);
}

.wb-echo-row dd {
  margin: 0;
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  color: var(--text-1);
}

.wb-echo-row dd.nullable {
  color: var(--text-3);
}

.wb-echo-note {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
}

.wb-echo-note.dropped {
  color: var(--danger);
}

.wb-echo-note.defaulted {
  color: var(--accent-2);
}

.wb-echo-note.ok {
  color: var(--text-3);
}
</style>
