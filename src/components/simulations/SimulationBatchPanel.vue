<template>
  <div class="sim-form sim-batch-panel sim-p-4 sim-bg-panel sim-r-lg sim-b sim-b-accent sim-mb-4">
    <h3 class="sim-t-accent sim-fs-lg sim-fw-bold sim-mb-3">
      批量仿真
      <InfoTip
        label="关于批量仿真的物体支持"
        text="只支持立方体与球体，其它类型（包括模型）会被跳过；场景里一个可渲染物体都没有时判为场景无效。"
      />
    </h3>

    <!-- 后端是可选增强：缺席时只说明情况，不影响本页其它功能 -->
    <p v-if="backendMissing" class="sim-fs-xs sim-t-accent-soft sim-mb-3 sim-backend-missing">
      后端不在，批量仿真暂不可用。浏览器里的实时仿真不受影响。
    </p>
    <p v-else-if="backendChecked" class="sim-fs-xs sim-t-faint sim-mb-3 sim-backend-online">
      后端在线<template v-if="recentJobCount > 0"> · 最近 {{ recentJobCount }} 个任务</template>
    </p>

    <!-- 场景来源 -->
    <div class="sim-mb-3">
      <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-scene-source">场景来源</label>
      <select id="sim-scene-source" v-model="sceneSource" class="sim-w-full">
        <option value="library">本地场景库</option>
        <option value="paste">粘贴场景文档</option>
      </select>
    </div>

    <div v-if="sceneSource === 'library'" class="sim-mb-3">
      <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-scene-id">场景</label>
      <select id="sim-scene-id" v-model="selectedSceneId" class="sim-w-full">
        <option value="">（未选择）</option>
        <option v-for="scene in savedScenes" :key="scene.id" :value="scene.id">
          {{ scene.name }}（{{ scene.objectCount }} 个物体）
        </option>
      </select>
    </div>

    <div v-else class="sim-mb-3">
      <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-scene-json">场景文档 JSON</label>
      <textarea
        id="sim-scene-json"
        v-model="pastedScene"
        class="sim-w-full"
        rows="4"
        spellcheck="false"
      ></textarea>
    </div>

    <!-- 运行参数 -->
    <div class="sim-mb-3 sim-flex sim-gap-2">
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-steps">步数</label>
        <input id="sim-steps" v-model="steps" type="number" class="sim-w-full" min="1" step="1" />
      </div>
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-dt">步长 dt</label>
        <!-- step="any"：1/60 这种值不落在 0.0001 的步进格上，
             定死步进会让浏览器把默认值判成非法值 -->
        <input id="sim-dt" v-model="dt" type="number" class="sim-w-full" step="any" />
      </div>
    </div>

    <div class="sim-mb-3 sim-flex sim-gap-2">
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-gravity">重力 Y</label>
        <input id="sim-gravity" v-model="gravityY" type="number" class="sim-w-full" step="0.01" />
      </div>
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-friction">摩擦</label>
        <input
          id="sim-friction"
          v-model="friction"
          type="number"
          class="sim-w-full"
          step="0.01"
          placeholder="留空=默认"
        />
      </div>
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-restitution">弹性</label>
        <input
          id="sim-restitution"
          v-model="restitution"
          type="number"
          class="sim-w-full"
          step="0.01"
          placeholder="留空=默认"
        />
      </div>
    </div>

    <!-- 多维参数扫描：各维度取值做笛卡尔积 -->
    <div class="sim-mb-3 sim-sweeps">
      <div class="sim-fs-xs sim-t-muted sim-mb-1">参数扫描（多维取笛卡尔积）</div>
      <div
        v-for="(row, index) in sweepRows"
        :key="row.id"
        class="sim-sweep-row sim-flex sim-gap-2 sim-mb-1"
      >
        <select
          v-model="row.param"
          class="sim-flex-1"
          :aria-label="`第 ${index + 1} 行扫描维度`"
        >
          <option value="none">不扫描</option>
          <option value="gravityY">重力</option>
          <option value="friction">摩擦</option>
          <option value="restitution">弹性</option>
          <option value="initialVelocityY">初始竖直速度</option>
        </select>
        <input
          v-model="row.values"
          type="text"
          class="sim-flex-1"
          placeholder="取值：0.1, 0.5, 0.9"
          spellcheck="false"
          :aria-label="`第 ${index + 1} 行扫描取值`"
        />
        <button
          type="button"
          class="sim-sweep-remove"
          title="删除这一行"
          @click="removeSweepRow(row.id)"
        >
          删除
        </button>
      </div>
      <button type="button" class="sim-sweep-add" @click="addSweepRow">添加扫描维度</button>
    </div>

    <!-- 随机种子与扰动 -->
    <div class="sim-mb-3 sim-flex sim-gap-2">
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-seeds">
          随机种子（逗号/空格分隔）
        </label>
        <input
          id="sim-seeds"
          v-model="seedsInput"
          type="text"
          class="sim-w-full"
          placeholder="留空 = 0"
          spellcheck="false"
        />
      </div>
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-randomization">
          随机扰动幅度
        </label>
        <input
          id="sim-randomization"
          v-model="randomizationInput"
          type="number"
          class="sim-w-full"
          step="0.01"
          min="0"
          placeholder="留空 = 0"
        />
      </div>
    </div>

    <div class="sim-mb-3 sim-flex sim-gap-2">
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-label">任务名</label>
        <input
          id="sim-label"
          v-model="label"
          type="text"
          class="sim-w-full"
          placeholder="摩擦扫描"
          spellcheck="false"
        />
      </div>
      <div class="sim-flex-1">
        <label class="sim-fs-xs sim-t-muted sim-mb-1" for="sim-trace">轨迹</label>
        <select id="sim-trace" v-model="traceMode" class="sim-w-full">
          <option value="off">不记录</option>
          <option value="on">逐帧记录</option>
        </select>
      </div>
    </div>

    <button
      class="sim-py-15 sim-fs-sm sim-bg-accent sim-t-on-accent sim-r-sm sim-w-full sim-submit"
      title="提交批量仿真"
      :disabled="submitting"
      @click="submit"
    >
      {{ submitting ? '提交中…' : '提交批量仿真' }}
    </button>
    <InfoTip
      label="关于批量仿真的队列依赖"
      text="提交提示队列不可用（返回 503，任务不会被收下）：批量仿真走 Redis 队列，需另起 worker 进程——先 cd backend，再运行 uv run arq app.workers.simulation.WorkerSettings。"
    />

    <!-- 进度 -->
    <div v-if="jobId" class="sim-mt-3 sim-mb-3 sim-progress">
      <div class="sim-flex sim-justify-between sim-items-center sim-mb-1 sim-job-line">
        <span class="sim-fs-xs sim-t-accent sim-job-id" :title="jobId">任务 {{ jobId }}</span>
        <span class="sim-fs-xs sim-t-muted sim-status">{{ statusText }}</span>
      </div>
      <div class="sim-flex sim-justify-between sim-items-center sim-mb-1">
        <span class="sim-fs-xs sim-t-muted">进度</span>
        <span class="sim-fs-xs sim-t-muted sim-progress-text">{{ progressText }}</span>
      </div>
      <progress class="sim-progress-bar" :value="progressPercent" max="100"></progress>
      <p v-if="jobError" class="sim-fs-xs sim-t-danger sim-mt-1 sim-job-error">{{ jobError }}</p>
    </div>

    <p v-if="pollStopped" class="sim-fs-xs sim-t-accent-soft sim-mb-2 sim-poll-stopped">
      轮询已达上限（{{ MAX_POLL_ATTEMPTS }} 次），已停止等待；任务可能仍在后端跑，稍后重新提交即可。
    </p>

    <p v-if="notice" class="sim-fs-xs sim-t-danger sim-mb-2 sim-notice">{{ notice }}</p>

    <!-- 结果 -->
    <div v-if="results" class="sim-mt-3 sim-results">
      <div class="sim-flex sim-justify-between sim-items-center sim-mb-1">
        <span class="sim-fs-xs sim-t-accent">结果汇总</span>
      </div>
      <p class="sim-fs-xs sim-t-muted sim-mb-2 sim-summary">
        {{ results.summary.runs }} 次运行 · {{ results.summary.settledRuns }} 次落地 · 最大穿透
        {{ formatNumber(results.summary.maxPenetration) }} m
      </p>
      <div
        v-for="run in results.runs"
        :key="run.index"
        class="sim-bg-soft sim-r-sm sim-p-2 sim-mb-1 sim-run-row"
      >
        <div class="sim-flex sim-justify-between sim-items-center sim-fs-xs">
          <span class="sim-t">#{{ run.index }} {{ formatRunParams(run.params) }}</span>
          <span class="sim-t-faint">{{ run.durationMs }} ms</span>
        </div>
        <div class="sim-fs-xs sim-t-muted sim-mt-1">
          落地帧 {{ formatFrame(run.metrics.settledAtFrame) }} · 最大穿透
          {{ formatNumber(run.metrics.maxPenetration) }} m · 下落距离
          {{ formatNumber(run.metrics.totalFallDistance) }} m
        </div>
      </div>

      <!-- 按 seed 汇总：同一 seed 下的波动与落地情况 -->
      <div v-if="seedSummary.length > 0" class="sim-mt-3 sim-seed-summary">
        <div class="sim-flex sim-justify-between sim-items-center sim-mb-1">
          <span class="sim-fs-xs sim-t-accent">按 seed 汇总</span>
        </div>
        <table class="sim-seed-table">
          <thead>
            <tr>
              <th>seed</th>
              <th>运行</th>
              <th>落地</th>
              <th>最大穿透均值</th>
              <th>最大穿透最大值</th>
              <th>平均下落距离</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="row in seedSummary" :key="row.seed" class="sim-seed-row">
              <td>{{ row.seed }}</td>
              <td>{{ row.runs }}</td>
              <td>{{ row.settledRuns }}</td>
              <td>{{ formatNumber(row.maxPenetrationAvg) }}</td>
              <td>{{ formatNumber(row.maxPenetrationMax) }}</td>
              <td>{{ formatNumber(row.avgFallDistance) }}</td>
            </tr>
          </tbody>
        </table>
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
  type SimulationSweepParam,
} from '@/services/api/simulations'
import {
  buildSimulationBatchPayload,
  buildSweeps,
  parseRandomization,
  parseSeeds,
  summarizeBySeed,
} from '@/utils/simulationBatch'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import type { SceneDocument, SceneIndexEntry } from '@/types'
import InfoTip from '@/components/common/InfoTip.vue'

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

// 参数扫描：多行，可增删；维度为 none 的行提交时忽略
interface SweepRow {
  id: number
  param: SimulationSweepParam | 'none'
  values: string
}

let sweepRowSeq = 0
const createSweepRow = (): SweepRow => ({ id: (sweepRowSeq += 1), param: 'none', values: '' })
const sweepRows = ref<SweepRow[]>([createSweepRow()])

const addSweepRow = (): void => {
  sweepRows.value.push(createSweepRow())
}

const removeSweepRow = (id: number): void => {
  sweepRows.value = sweepRows.value.filter((row) => row.id !== id)
}

// 随机种子与扰动
const seedsInput = ref('')
const randomizationInput = ref<string | number>('')

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

/** 按 seed 汇总结果；没有结果时为空表 */
const seedSummary = computed(() => (results.value ? summarizeBySeed(results.value.runs) : []))

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

/** 组装扫描参数：多行合并成 sweeps，维度为 none 的行忽略 */
const buildSweepList = () => buildSweeps(sweepRows.value)

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
    // 「后端不在」时给一句人话，别把原始报错甩给用户
    const unavailable = isApiUnavailable(error)
    return {
      unavailable,
      message: unavailable ? '后端不在，批量仿真暂不可用。' : error.message,
    }
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
  // seed 放最前面：它决定这一轮用哪组随机扰动，比扫描值更值得先看
  const seedEntry = entries.find(([key]) => key === 'seed')
  const ordered = seedEntry ? [seedEntry, ...entries.filter(([key]) => key !== 'seed')] : entries
  return ordered.map(([key, value]) => `${key}=${value}`).join(' · ')
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
 * 提交任务并开始轮询。
 *
 * 载荷只碰本地数据，出错就是**输入或序列化**的问题，跟后端在不在没关系——
 * 所以它必须在网络请求的 try 之外，否则本地 TypeError 会被当成「后端缺席」。
 */
const submit = async (): Promise<void> => {
  if (submitting.value) return

  const scene = resolveScene()
  if (!scene) {
    notice.value =
      sceneSource.value === 'paste' ? '场景文档 JSON 解析不出来，先检查格式。' : '先选一个场景。'
    return
  }

  const { sweeps, error: sweepError } = buildSweepList()
  if (sweepError) {
    notice.value = sweepError
    return
  }

  const parsedSeeds = parseSeeds(seedsInput.value)
  if (parsedSeeds.error) {
    notice.value = parsedSeeds.error
    return
  }

  const parsedRandomization = parseRandomization(randomizationInput.value)
  if (parsedRandomization.error) {
    notice.value = parsedRandomization.error
    return
  }

  // 载荷在本地拼好并试序列化一次：这里失败是内容的问题，不能说成后端不在
  let payload: SimulationJobRequest
  try {
    payload = buildSimulationBatchPayload({
      label: label.value,
      scene,
      params: buildParams(),
      sweeps,
      seeds: parsedSeeds.seeds,
      randomization: parsedRandomization.value,
    })
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
/* 面板标题：这一页的 h3 沿用旧样式（深蓝字 + 蓝下划线），
   面板按 DESIGN.md 走品牌靛紫，不跟旧样式混 */
.sim-batch-panel h3 {
  color: var(--accent);
  border-bottom-color: var(--accent);
}

/* 进度条：用品牌靛紫，与这一页的浅色面板同一套配色 */
.sim-progress-bar {
  width: 100%;
  height: 6px;
  accent-color: var(--accent);
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

/* 扫描行：输入框占满剩余宽度，删除按钮不换行 */
.sim-sweep-row {
  align-items: center;
}

.sim-sweep-add,
.sim-sweep-remove {
  background: var(--bg-inset);
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  cursor: pointer;
  white-space: nowrap;
}

.sim-sweep-add:hover,
.sim-sweep-remove:hover {
  color: var(--text-1);
  border-color: var(--accent);
}

/* 按 seed 汇总表：窄面板里也能横向塞下 6 列 */
.sim-seed-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

.sim-seed-table th,
.sim-seed-table td {
  padding: 4px 6px;
  text-align: left;
  border-bottom: 1px solid var(--border-subtle);
  white-space: nowrap;
}

.sim-seed-table th {
  color: var(--text-3);
  font-weight: 500;
}

.sim-seed-table td {
  color: var(--text-1);
}
</style>
