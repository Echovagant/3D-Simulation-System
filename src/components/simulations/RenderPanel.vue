<template>
  <div class="ai-form sim-render-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber ai-mb-4">
    <h3 class="ai-t-amber ai-fs-lg ai-fw-bold ai-mb-3">服务端渲染</h3>

    <!-- 后端是可选增强：缺席时只说明情况，不影响本页其它功能 -->
    <p v-if="backendMissing" class="ai-fs-xs ai-t-amber-soft ai-mb-3 sim-backend-missing">
      后端不在，服务端渲染暂不可用。浏览器里的实时仿真不受影响。
    </p>
    <p v-else-if="backendChecked" class="ai-fs-xs ai-t-faint ai-mb-3 sim-backend-online">
      后端在线<template v-if="recentJobCount > 0"> · 最近 {{ recentJobCount }} 个任务</template>
    </p>

    <!-- 场景来源 -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-scene-source">场景来源</label>
      <select id="rnd-scene-source" v-model="sceneSource" class="ai-w-full">
        <option value="library">本地场景库</option>
        <option value="paste">粘贴场景文档</option>
      </select>
    </div>

    <div v-if="sceneSource === 'library'" class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-scene-id">场景</label>
      <select id="rnd-scene-id" v-model="selectedSceneId" class="ai-w-full">
        <option value="">（未选择）</option>
        <option v-for="scene in savedScenes" :key="scene.id" :value="scene.id">
          {{ scene.name }}（{{ scene.objectCount }} 个物体）
        </option>
      </select>
    </div>

    <div v-else class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-scene-json">场景文档 JSON</label>
      <textarea
        id="rnd-scene-json"
        v-model="pastedScene"
        class="ai-w-full"
        rows="4"
        spellcheck="false"
      ></textarea>
    </div>

    <!-- 画面参数 -->
    <div class="ai-mb-3 ai-flex ai-gap-2">
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-frames">帧数</label>
        <input id="rnd-frames" v-model="frames" type="number" class="ai-w-full" min="1" step="1" />
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-fps">帧率</label>
        <input id="rnd-fps" v-model="fps" type="number" class="ai-w-full" min="1" step="1" />
      </div>
    </div>

    <div class="ai-mb-3 ai-flex ai-gap-2">
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-width">宽</label>
        <input id="rnd-width" v-model="width" type="number" class="ai-w-full" min="16" step="1" />
      </div>
      <div class="ai-flex-1">
        <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-height">高</label>
        <input id="rnd-height" v-model="height" type="number" class="ai-w-full" min="16" step="1" />
      </div>
    </div>

    <!-- 动作脚本（可选） -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-actions">动作脚本（可选，JSON 数组）</label>
      <textarea
        id="rnd-actions"
        v-model="actionsJson"
        class="ai-w-full"
        rows="3"
        spellcheck="false"
        placeholder='[{"atFrame":0,"type":"addCube","params":{"size":1}}]'
      ></textarea>
    </div>

    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="rnd-label">任务名</label>
      <input
        id="rnd-label"
        v-model="label"
        type="text"
        class="ai-w-full"
        placeholder="落球演示"
        spellcheck="false"
      />
    </div>

    <button
      class="ai-py-15 ai-fs-sm ai-bg-amber ai-t-on-amber ai-r-sm ai-w-full sim-render-submit"
      title="提交渲染任务"
      :disabled="submitting"
      @click="submit"
    >
      {{ submitting ? '提交中…' : '提交渲染任务' }}
    </button>

    <!-- 进度 -->
    <div v-if="jobId" class="ai-mt-3 ai-mb-3 sim-render-progress">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1 sim-render-job-line">
        <span class="ai-fs-xs ai-t-amber sim-render-job-id" :title="jobId">任务 {{ jobId }}</span>
        <span class="ai-fs-xs ai-t-muted sim-render-status">{{ statusText }}</span>
      </div>
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <span class="ai-fs-xs ai-t-muted">进度</span>
        <span class="ai-fs-xs ai-t-muted sim-render-progress-text">{{ progress }}%</span>
      </div>
      <progress class="sim-render-progress-bar" :value="progress" max="100"></progress>
      <p v-if="jobError" class="ai-fs-xs ai-t-red ai-mt-1 sim-render-error">{{ jobError }}</p>
    </div>

    <p v-if="pollStopped" class="ai-fs-xs ai-t-amber-soft ai-mb-2 sim-render-poll-stopped">
      轮询已达上限（{{ MAX_POLL_ATTEMPTS }} 次），已停止等待；任务可能仍在后端跑，稍后重新提交即可。
    </p>

    <p v-if="notice" class="ai-fs-xs ai-t-red ai-mb-2 sim-render-notice">{{ notice }}</p>

    <!-- 产物 -->
    <div v-if="videoUrl" class="ai-mt-3 sim-render-result">
      <video class="sim-render-video" :src="videoUrl" controls preload="metadata"></video>
      <a class="ai-fs-xs ai-t-amber sim-render-download" :href="videoUrl" download>下载 MP4</a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import {
  apiUrl,
  createRenderJob,
  getRenderJob,
  listRenderJobs,
  renderVideoUrl,
  type RenderAction,
  type RenderJobRequest,
  type RenderJobStatus,
} from '@/services/api/render'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import type { SceneDocument, SceneIndexEntry } from '@/types'

/** 轮询间隔（毫秒） */
const POLL_INTERVAL_MS = 1500

/**
 * 轮询次数上限。
 *
 * 渲染要开浏览器、跑物理，比仿真慢得多；但没有上限的话面板会永远挂着请求，
 * 页面一开就一直在打后端。
 */
const MAX_POLL_ATTEMPTS = 120

/** 状态机的中文文案 */
const STATUS_TEXT: Record<RenderJobStatus, string> = {
  queued: '排队中',
  rendering: '渲染中',
  succeeded: '已完成',
  failed: '失败',
}

const sceneEditorStore = useSceneEditorStore()

// 场景来源
const savedScenes = ref<SceneIndexEntry[]>([])
const sceneSource = ref<'library' | 'paste'>('library')
const selectedSceneId = ref('')
const pastedScene = ref('')

// 画面参数
// ⚠️ 数字输入框的值有两种类型：初始是字符串，用户一改就变成 number
// （`<input type="number">` 的 v-model 会自动转换），两种都得收下
const frames = ref<string | number>('180')
const fps = ref<string | number>('30')
const width = ref<string | number>('1280')
const height = ref<string | number>('720')

// 动作脚本与任务名
const actionsJson = ref('')
const label = ref('')

// 任务状态
const submitting = ref(false)
const jobId = ref('')
const jobStatus = ref<RenderJobStatus | ''>('')
const progress = ref(0)
const jobError = ref('')
const pollStopped = ref(false)
const videoUrl = ref('')

// 后端状态与提示
const backendMissing = ref(false)
const backendChecked = ref(false)
const recentJobCount = ref(0)
const notice = ref('')

const statusText = computed(() => (jobStatus.value ? STATUS_TEXT[jobStatus.value] : ''))

/**
 * 数字输入框的值：空串表示「没填」。
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

/** 解析动作脚本；解析不出来返回 null——那是本地输入的问题，不是后端的问题 */
const parseActions = (): RenderAction[] | null => {
  const raw = actionsJson.value.trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return null
    return parsed as RenderAction[]
  } catch {
    return null
  }
}

/**
 * 把一次失败翻译成「后端不在」还是「业务错误」。
 *
 * ⚠️ 渲染的 503 是「后端在，但环境没准备好」（没构建 / 缺 Chrome / 缺 ffmpeg）——
 * 那种情况要说清楚缺什么，不能说成「后端不在」。所以先按错误码分派，
 * 分不出来再退回通用判断。
 */
const describeFailure = (error: unknown): { unavailable: boolean; message: string } => {
  if (error instanceof ApiError) {
    switch (error.code) {
      case 'render_build_missing':
        return {
          unavailable: false,
          message: '服务端还没构建生产产物：先跑 `npm run build`，再提交渲染任务。',
        }
      case 'render_browser_unavailable':
        return { unavailable: false, message: '服务端找不到 Chrome（无头浏览器），渲染跑不了。' }
      case 'render_ffmpeg_unavailable':
        return { unavailable: false, message: '服务端找不到 ffmpeg，渲染跑不了。' }
      case 'render_scene_invalid':
        return { unavailable: false, message: error.message }
      case 'render_failed':
        return { unavailable: false, message: `渲染失败：${error.message}` }
      case 'render_not_ready':
        return { unavailable: false, message: '视频还没生成好，稍后再试。' }
      default:
        break
    }
    if (error.status === 404) {
      return { unavailable: false, message: '后端还没有渲染接口（404）——后端版本太旧。' }
    }
    return { unavailable: isApiUnavailable(error), message: error.message }
  }
  if (isApiUnavailable(error)) {
    return { unavailable: true, message: '后端不在，服务端渲染暂不可用。' }
  }
  return { unavailable: false, message: error instanceof Error ? error.message : String(error) }
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

const pollOnce = async (): Promise<void> => {
  pollAttempts += 1
  try {
    const job = await getRenderJob(jobId.value)
    jobStatus.value = job.status
    progress.value = job.progress
    jobError.value = job.error ?? ''

    if (job.status === 'succeeded') {
      videoUrl.value = job.artifactUrl ? apiUrl(job.artifactUrl) : renderVideoUrl(job.jobId)
      return
    }
    if (job.status === 'failed') {
      notice.value = job.error ? `渲染失败：${job.error}` : '渲染失败。'
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
const buildPayload = (scene: SceneDocument, actions: RenderAction[]): RenderJobRequest => ({
  ...(label.value.trim() ? { label: label.value.trim() } : {}),
  scene,
  ...(actions.length > 0 ? { actions } : {}),
  frames: parseNumber(frames.value) ?? 180,
  fps: parseNumber(fps.value) ?? 30,
  width: parseNumber(width.value) ?? 1280,
  height: parseNumber(height.value) ?? 720,
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

  const actions = parseActions()
  if (actions === null) {
    notice.value = '动作脚本不是合法的 JSON 数组。'
    return
  }

  // 载荷在本地拼好并试序列化一次：这里失败是内容的问题，不能说成后端不在
  let payload: RenderJobRequest
  try {
    payload = buildPayload(scene, actions)
    JSON.stringify(payload)
  } catch (error) {
    notice.value = `请求内容有问题，没能提交：${error instanceof Error ? error.message : String(error)}`
    return
  }

  submitting.value = true
  notice.value = ''
  jobError.value = ''
  pollStopped.value = false
  videoUrl.value = ''

  try {
    const created = await createRenderJob(payload)
    jobId.value = created.jobId
    jobStatus.value = 'queued'
    progress.value = 0
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
    const jobs = await listRenderJobs()
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
.sim-render-progress-bar {
  width: 100%;
  height: 6px;
  accent-color: #ffa117;
}

/* 任务 ID 是 32 位十六进制，挤在一行里会把状态文字压成竖排 */
.sim-render-job-line {
  gap: 0.5rem;
}

.sim-render-job-id {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
}

.sim-render-status {
  white-space: nowrap;
  flex: none;
}

/* 预览视频：宽度撑满面板，高度按 16:9 走 */
.sim-render-video {
  display: block;
  width: 100%;
  aspect-ratio: 16 / 9;
  background: #101014;
  border-radius: 4px;
}

.sim-render-download {
  display: inline-block;
  margin-top: 0.5rem;
}
</style>
