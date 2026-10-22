<template>
  <div class="ai-form sim-batch-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber ai-mb-4">
    <h3 class="ai-t-amber ai-fs-lg ai-fw-bold ai-mb-3">批量仿真</h3>

    <!-- 后端是可选增强：缺席时只说明情况，不影响本页其它功能 -->
    <p v-if="backendMissing" class="ai-fs-xs ai-t-amber-soft ai-mb-3 sim-backend-missing">
      后端不在，批量仿真暂不可用。浏览器里的实时仿真不受影响。
    </p>
    <p v-else-if="backendChecked" class="ai-fs-xs ai-t-faint ai-mb-3 sim-backend-online">
      后端在线<template v-if="recentJobCount > 0"> · 最近 {{ recentJobCount }} 个任务</template>
    </p>

    <!-- 场景来源 -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-scene-source">场景来源</label>
      <select id="sim-scene-source" v-model="sceneSource" class="ai-w-full">
        <option value="library">本地场景库</option>
        <option value="paste">粘贴场景文档</option>
      </select>
    </div>

    <div v-if="sceneSource === 'library'" class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-scene-id">场景</label>
      <select id="sim-scene-id" v-model="selectedSceneId" class="ai-w-full">
        <option value="">（未选择）</option>
        <option v-for="scene in savedScenes" :key="scene.id" :value="scene.id">
          {{ scene.name }}（{{ scene.objectCount }} 个物体）
        </option>
      </select>
    </div>

    <div v-else class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-scene-json">场景文档 JSON</label>
      <textarea
        id="sim-scene-json"
        v-model="pastedScene"
        class="ai-w-full"
        rows="4"
        spellcheck="false"
      ></textarea>
    </div>

    <!-- 运行参数 -->
    <div class="ai-mb-3 ai-flex ai-gap-2">
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-steps">步数</label>
        <input id="sim-steps" v-model="steps" type="number" class="ai-w-full" min="1" step="1" />
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-dt">步长 dt</label>
        <!-- step="any"：1/60 这种值不落在 0.0001 的步进格上，
             定死步进会让浏览器把默认值判成非法值 -->
        <input id="sim-dt" v-model="dt" type="number" class="ai-w-full" step="any" />
      </div>
    </div>

    <div class="ai-mb-3 ai-flex ai-gap-2">
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-gravity">重力 Y</label>
        <input id="sim-gravity" v-model="gravityY" type="number" class="ai-w-full" step="0.01" />
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-friction">摩擦</label>
        <input
          id="sim-friction"
          v-model="friction"
          type="number"
          class="ai-w-full"
          step="0.01"
          placeholder="留空=默认"
        />
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-restitution">弹性</label>
        <input
          id="sim-restitution"
          v-model="restitution"
          type="number"
          class="ai-w-full"
          step="0.01"
          placeholder="留空=默认"
        />
      </div>
    </div>

    <!-- 参数扫描 -->
    <div class="ai-mb-3 ai-flex ai-gap-2">
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-sweep-param">扫描维度</label>
        <select id="sim-sweep-param" v-model="sweepParam" class="ai-w-full">
          <option value="none">不扫描</option>
          <option value="gravityY">重力</option>
          <option value="friction">摩擦</option>
          <option value="restitution">弹性</option>
          <option value="initialVelocityY">初始竖直速度</option>
        </select>
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-sweep-values">取值（逗号分隔）</label>
        <input
          id="sim-sweep-values"
          v-model="sweepValues"
          type="text"
          class="ai-w-full"
          placeholder="0.1, 0.5, 0.9"
          spellcheck="false"
        />
      </div>
    </div>

    <div class="ai-mb-3 ai-flex ai-gap-2">
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-label">任务名</label>
        <input
          id="sim-label"
          v-model="label"
          type="text"
          class="ai-w-full"
          placeholder="摩擦扫描"
          spellcheck="false"
        />
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="sim-trace">轨迹</label>
        <select id="sim-trace" v-model="traceMode" class="ai-w-full">
          <option value="off">不记录</option>
          <option value="on">逐帧记录</option>
        </select>
      </div>
    </div>

    <button
      class="ai-py-15 ai-fs-sm ai-bg-amber ai-t-on-amber ai-r-sm ai-w-full sim-submit"
      title="提交批量仿真"
      :disabled="submitting"
      @click="submit"
    >
      {{ submitting ? '提交中…' : '提交批量仿真' }}
    </button>

    <!-- 进度 -->
    <div v-if="jobId" class="ai-mt-3 ai-mb-3 sim-progress">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1 sim-job-line">
        <span class="ai-fs-xs ai-t-amber sim-job-id" :title="jobId">任务 {{ jobId }}</span>
        <span class="ai-fs-xs ai-t-muted sim-status">{{ statusText }}</span>
      </div>
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <span class="ai-fs-xs ai-t-muted">进度</span>
        <span class="ai-fs-xs ai-t-muted sim-progress-text">{{ progressText }}</span>
      </div>
      <progress class="sim-progress-bar" :value="progressPercent" max="100"></progress>
      <p v-if="jobError" class="ai-fs-xs ai-t-red ai-mt-1 sim-job-error">{{ jobError }}</p>
    </div>

    <p v-if="pollStopped" class="ai-fs-xs ai-t-amber-soft ai-mb-2 sim-poll-stopped">
      轮询已达上限（{{ MAX_POLL_ATTEMPTS }} 次），已停止等待；任务可能仍在后端跑，稍后重新提交即可。
    </p>

    <p v-if="notice" class="ai-fs-xs ai-t-red ai-mb-2 sim-notice">{{ notice }}</p>

    <!-- 结果 -->
    <div v-if="results" class="ai-mt-3 sim-results">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <span class="ai-fs-xs ai-t-amber">结果汇总</span>
      </div>
      <p class="ai-fs-xs ai-t-muted ai-mb-2 sim-summary">
        {{ results.summary.runs }} 次运行 · {{ results.summary.settledRuns }} 次落地 · 最大穿透
        {{ formatNumber(results.summary.maxPenetration) }} m
      </p>
      <div
        v-for="run in results.runs"
        :key="run.index"
        class="ai-bg-soft ai-r-sm ai-p-2 ai-mb-1 sim-run-row"
      >
        <div class="ai-flex ai-justify-between ai-items-center ai-fs-xs">
          <span class="ai-t">#{{ run.index }} {{ formatRunParams(run.params) }}</span>
          <span class="ai-t-faint">{{ run.durationMs }} ms</span>
        </div>
        <div class="ai-fs-xs ai-t-muted ai-mt-1">
          落地帧 {{ formatFrame(run.metrics.settledAtFrame) }} · 最大穿透
          {{ formatNumber(run.metrics.maxPenetration) }} m · 下落距离
          {{ formatNumber(run.metrics.totalFallDistance) }} m
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import {
  createSimulationJob,
  getSimulationJob,
  getSimulationResults,
  listSimulationJobs,
  type SimulationJobRequest,
  type SimulationJobStatus,
  type SimulationParams,
  type SimulationResults,
  type SimulationSweep,
  type SimulationSweepParam,
} from '@/services/api/simulations'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import type { SceneDocument, SceneIndexEntry } from '@/types'

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 1500

/**
 * 轮询次数上限。
 *
 * 任务可能一直卡在队列里；没有上限的话面板会永远挂着请求，
 * 页面一开就一直在打后端。
 */
const MAX_POLL_ATTEMPTS = 120

/** 状态机的中文文案 */
const STATUS_TEXT: Record<SimulationJobStatus, string> = {
  queued: '排队中',
  running: '运行中',
  succeeded: '已完成',
  failed: '失败',
}

const sceneEditorStore = useSceneEditorStore()

// 场景来源
const savedScenes = ref<SceneIndexEntry[]>([])
const sceneSource = ref<'library' | 'paste'>('library')
const selectedSceneId = ref('')
const pastedScene = ref('')

// 运行参数
// ⚠️ 数字输入框的值有两种类型：初始是字符串，用户一改就变成 number
// （`<input type="number">` 的 v-model 会自动转换），两种都得收下
const label = ref('')
const steps = ref<string | number>('240')
const dt = ref<string | number>('0.016666666666666666')
const gravityY = ref<string | number>('-9.81')
const friction = ref<string | number>('')
const restitution = ref<string | number>('')

// 参数扫描
const sweepParam = ref<'none' | SimulationSweepParam>('none')
const sweepValues = ref('')

// 轨迹
const traceMode = ref<'off' | 'on'>('off')

// 任务状态
const submitting = ref(false)
const jobId = ref('')
const jobStatus = ref<SimulationJobStatus | ''>('')
const jobDone = ref(0)
const jobTotal = ref(0)
const jobError = ref('')
const pollStopped = ref(false)
const results = ref<SimulationResults | null>(null)

// 后端状态与提示
const backendMissing = ref(false)
const backendChecked = ref(false)
const recentJobCount = ref(0)
const notice = ref('')

const statusText = computed(() => (jobStatus.value ? STATUS_TEXT[jobStatus.value] : ''))
const progressText = computed(() => `${jobDone.value} / ${jobTotal.value}`)
const progressPercent = computed(() => {
  if (jobTotal.value <= 0) return 0
  return Math.min(100, Math.round((jobDone.value / jobTotal.value) * 100))
})

/**
 * 数字输入框的值：空串表示「不覆盖」，不是 0。
 *
 * ⚠️ 必须同时接受 string 与 number：`<input type="number">` 的 v-model
 * 会把用户输入转成 number，只当字符串处理的话，用户一改输入框就会抛
 * `raw.trim is not a function`。
 */
const parseNumber = (raw: string | number): number | undefined => {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : undefined
  const trimmed = raw.trim()
  if (!trimmed) return undefined
  const value = Number(trimmed)
  return Number.isFinite(value) ? value : undefined
}

/** 刷新本地场景列表 */
const refreshScenes = (): void => {
  savedScenes.value = sceneEditorStore.listScenes()
  if (!savedScenes.value.some((scene) => scene.id === selectedSceneId.value)) {
    selectedSceneId.value = savedScenes.value[0]?.id ?? ''
  }
}

/** 取出要提交的场景文档；拿不到就返回 null */
const resolveScene = (): SceneDocument | null => {
  if (sceneSource.value === 'paste') {
    const raw = pastedScene.value.trim()
    if (!raw) return null
    try {
      const parsed = JSON.parse(raw) as SceneDocument
      if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.objects)) return null
      return parsed
    } catch {
      return null
    }
  }
  if (!selectedSceneId.value) return null
  return sceneEditorStore.getSceneDocument(selectedSceneId.value)
}

/** 组装单次运行的参数 */
const buildParams = (): SimulationParams => {
  const params: SimulationParams = {}
  const gravity = parseNumber(gravityY.value)
  if (gravity !== undefined) params.gravityY = gravity
  const f = parseNumber(friction.value)
  if (f !== undefined) params.friction = f
  const r = parseNumber(restitution.value)
  if (r !== undefined) params.restitution = r
  const step = parseNumber(steps.value)
  if (step !== undefined) params.steps = step
  const delta = parseNumber(dt.value)
  if (delta !== undefined) params.dt = delta
  if (traceMode.value === 'on') params.trace = true
  return params
}

/** 组装扫描参数：一次只扫一个维度 */
const buildSweep = (): SimulationSweep | undefined => {
  if (sweepParam.value === 'none') return undefined
  const values = sweepValues.value
    .split(/[\s,，;；]+/)
    .map((part) => parseNumber(part))
    .filter((value): value is number => value !== undefined)
  if (values.length === 0) return undefined
  return { param: sweepParam.value, values }
}

/**
 * 把一次失败翻译成「后端不在」还是「业务错误」。
 *
 * ⚠️ 队列不通时后端回 503，但它**好好地应答了**——
 * 那不是「后端不在」，而是队列的问题，不能混为一谈。
 */
const describeFailure = (error: unknown): { unavailable: boolean; message: string } => {
  if (error instanceof ApiError) {
    if (error.code === 'simulation_queue_unavailable') {
      return { unavailable: false, message: '仿真队列不可用（Redis 没连上），任务没能入队。' }
    }
    return { unavailable: isApiUnavailable(error), message: error.message }
  }
  if (isApiUnavailable(error)) {
    return { unavailable: true, message: '后端不在，批量仿真暂不可用。' }
  }
  return { unavailable: false, message: error instanceof Error ? error.message : String(error) }
}

const formatNumber = (value: number | null | undefined, digits = 3): string =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) : '—'

const formatFrame = (value: number | null | undefined): string =>
  typeof value === 'number' && Number.isFinite(value) ? String(value) : '—'

const formatRunParams = (params: Record<string, number>): string => {
  const entries = Object.entries(params ?? {})
  if (entries.length === 0) return '（无扫描参数）'
  return entries.map(([key, value]) => `${key}=${value}`).join(' · ')
}

// 轮询
let pollTimer: number | null = null
let pollAttempts = 0

const stopPolling = (): void => {
  if (pollTimer !== null) {
    window.clearTimeout(pollTimer)
    pollTimer = null
  }
}

const schedulePoll = (): void => {
  stopPolling()
  pollTimer = window.setTimeout(() => {
    pollTimer = null
    void pollOnce()
  }, POLL_INTERVAL_MS)
}

const loadResults = async (): Promise<void> => {
  try {
    results.value = await getSimulationResults(jobId.value)
  } catch (error) {
    const failure = describeFailure(error)
    if (failure.unavailable) backendMissing.value = true
    notice.value = failure.message
  }
}

const pollOnce = async (): Promise<void> => {
  pollAttempts += 1
  try {
    const job = await getSimulationJob(jobId.value)
    jobStatus.value = job.status
    jobDone.value = job.done
    jobTotal.value = job.total
    jobError.value = job.error ?? ''

    if (job.status === 'succeeded') {
      await loadResults()
      return
    }
    if (job.status === 'failed') {
      notice.value = job.error ? `任务失败：${job.error}` : '任务失败。'
      return
    }
    if (pollAttempts >= MAX_POLL_ATTEMPTS) {
      pollStopped.value = true
      return
    }
    schedulePoll()
  } catch (error) {
    const failure = describeFailure(error)
    if (failure.unavailable) backendMissing.value = true
    notice.value = failure.message
  }
}

const startPolling = (): void => {
  stopPolling()
  pollAttempts = 0
  pollStopped.value = false
  void pollOnce()
}

/**
 * 拼出提交载荷。
 *
 * 这一步只碰本地数据，出错就是**输入或序列化**的问题，
 * 跟后端在不在没关系——所以它必须在网络请求的 try 之外，
 * 否则本地 TypeError 会被当成「后端缺席」，界面给出误导性的提示。
 */
const buildPayload = (scene: SceneDocument, sweep?: SimulationSweep): SimulationJobRequest => ({
  ...(label.value.trim() ? { label: label.value.trim() } : {}),
  scene,
  params: buildParams(),
  ...(sweep ? { sweep } : {}),
})

/** 提交任务并开始轮询 */
const submit = async (): Promise<void> => {
  if (submitting.value) return

  const scene = resolveScene()
  if (!scene) {
    notice.value =
      sceneSource.value === 'paste' ? '场景文档 JSON 解析不出来，先检查格式。' : '先选一个场景。'
    return
  }

  const sweep = buildSweep()
  if (sweepParam.value !== 'none' && !sweep) {
    notice.value = '扫描维度的取值不能为空。'
    return
  }

  // 载荷在本地拼好并试序列化一次：这里失败是内容的问题，不能说成后端不在
  let payload: SimulationJobRequest
  try {
    payload = buildPayload(scene, sweep)
    JSON.stringify(payload)
  } catch (error) {
    notice.value = `请求内容有问题，没能提交：${error instanceof Error ? error.message : String(error)}`
    return
  }

  submitting.value = true
  notice.value = ''
  results.value = null
  jobError.value = ''
  pollStopped.value = false

  try {
    const created = await createSimulationJob(payload)
    jobId.value = created.jobId
    jobStatus.value = 'queued'
    jobDone.value = 0
    jobTotal.value = 0
    startPolling()
  } catch (error) {
    const failure = describeFailure(error)
    if (failure.unavailable) backendMissing.value = true
    notice.value = failure.message
  } finally {
    submitting.value = false
  }
}

/** 探一次后端：缺席是正常状态，明确告诉用户，不弹错 */
const probeBackend = async (): Promise<void> => {
  try {
    const jobs = await listSimulationJobs()
    backendMissing.value = false
    recentJobCount.value = jobs.length
  } catch (error) {
    const failure = describeFailure(error)
    if (failure.unavailable) {
      backendMissing.value = true
    } else {
      // 后端答复了（只是这个接口还没就绪）：不算「后端不在」
      notice.value = failure.message
    }
  } finally {
    backendChecked.value = true
  }
}

onMounted(() => {
  refreshScenes()
  void probeBackend()
})

onBeforeUnmount(() => {
  stopPolling()
})
</script>

<style scoped>
/* 进度条：沿用面板工具层的强调色，不另立一套配色 */
.sim-progress-bar {
  width: 100%;
  height: 6px;
  accent-color: #ffa117;
}

/* 任务 ID 是 32 位十六进制，挤在一行里会把状态文字压成竖排：
   ID 省略显示、状态不换行 */
.sim-job-line {
  gap: 0.5rem;
}

.sim-job-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sim-status {
  white-space: nowrap;
  flex: none;
}
</style>
