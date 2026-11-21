<template>
  <div class="ai-form ai-debug-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber ai-h-full ai-flex ai-flex-col">
    <!-- 仿真控制 -->
    <div class="ai-flex ai-gap-2 ai-mb-4">
      <button
        @click="handleSimulationToggle"
        class="ai-flex-1 ai-py-15 ai-fs-sm ai-r-sm transition-colors"
        :class="simulationActive ? 'ai-bg-red' : 'ai-bg-green'"
      >
        <i :class="simulationActive ? 'fa fa-pause ai-mr-1' : 'fa fa-play ai-mr-1'"></i>
        {{ simulationActive ? '暂停' : '开始' }}
      </button>

      <button
        @click="resetSimulation"
        class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-chip hover:bg-gray-500 ai-r-sm transition-colors"
      >
        <i class="fa fa-refresh ai-mr-1"></i>重置
      </button>

      <button
        @click="clearLogs"
        class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-chip hover:bg-gray-500 ai-r-sm transition-colors"
      >
        <i class="fa fa-trash ai-mr-1"></i>清空日志
      </button>
    </div>

    <!-- 仿真信息 -->
    <div class="ai-fs-xs ai-t ai-mb-3 ai-grid ai-grid-2 ai-gap-2">
      <div>
        <span class="ai-t-amber">仿真时间:</span> {{ formatTime(simulationTime) }}
      </div>
      <div>
        <span class="ai-t-amber">活跃代理:</span> {{ activeAgentsCount }}
      </div>
      <div>
        <span class="ai-t-amber">场景类型:</span> {{ formatScenario(environmentSettings.scenario) }}
      </div>
      <div>
        <span class="ai-t-amber">难度:</span> {{ formatDifficulty(environmentSettings.difficulty) }}
      </div>
    </div>

    <!-- 运行指标：导航成功率 / 碰撞 / 路径效率。口径见 utils/agentMetrics.ts -->
    <div class="ai-fs-xs ai-t ai-mb-3 ai-grid ai-grid-2 ai-gap-2">
      <div>
        <span class="ai-t-amber">导航成功率:</span> {{ metricsDisplay.successRate }}
      </div>
      <div>
        <span class="ai-t-amber">碰撞次数:</span> {{ metricsDisplay.collisions }}
      </div>
      <div>
        <span class="ai-t-amber">平均路径效率:</span> {{ metricsDisplay.efficiency }}
      </div>
      <div>
        <span class="ai-t-amber">达成目标:</span> {{ metricsDisplay.goals }}
      </div>
    </div>

    <!-- 物理模式：如实说明碰撞由 Rapier 刚体引擎求解 -->
    <p class="physics-mode">物理模式：Rapier 刚体物理（质量 · 摩擦 · 弹性 · 固定步长 1/60 秒）</p>

    <!-- 日志显示 -->
    <div class="ai-flex-1 ai-clip ai-flex ai-flex-col ai-log-wrap">
      <div class="ai-fs-xs ai-t-muted ai-mb-1 ai-flex ai-justify-between ai-items-center ai-gap-2">
        <span>代理日志</span>
        <div class="ai-flex ai-items-center ai-gap-2">
          <select
            v-model="logFilter"
            class="ai-bg-sunken ai-t-strong ai-r-sm ai-px-1 ai-py-05"
          >
            <option value="all">所有日志</option>
            <option value="info">信息</option>
            <option value="warning">警告</option>
            <option value="error">错误</option>
          </select>
          <button
            @click="exportLogs"
            class="ai-bg-chip hover:bg-gray-500 ai-r-sm ai-px-2 ai-py-05 ai-log-export"
            title="把当前筛选出的日志导出为 .jsonl 文件"
          >
            导出
          </button>
        </div>
      </div>

      <!--
        日志条数说明：现在**全部**日志都在列表里，可以往上翻回看。
        渲染的开销由虚拟滚动管着——不管多少条，DOM 里始终只有视口里那十几行。
      -->
      <div
        v-if="filteredLogs.length > 0"
        class="ai-fs-xs ai-t-faint ai-mb-1"
      >
        共 {{ filteredLogs.length }} 条，可往上翻看更早的记录
      </div>

      <div
        ref="logBoxRef"
        class="ai-flex-1 ai-scroll ai-bg-soft ai-r-sm ai-p-2 ai-fs-xs ai-log-list"
        @scroll.passive="handleLogScroll"
      >
        <!--
          虚拟滚动：外层按「总条数 × 行高」撑出高度，滚动条据此反映真实条数；
          内层只画视口里那十几行，其余的留空但位置对得上。
        -->
        <div class="ai-log-spacer" :style="{ height: `${totalHeight}px` }">
          <div
            v-for="(log, index) in windowLogs"
            :key="log.seq"
            class="ai-log-row"
            :class="[
              log.type === 'info' ? 'ai-t-blue' :
              log.type === 'warning' ? 'ai-t-amber' : 'ai-t-red',
            ]"
            :style="{ transform: `translateY(${(windowStart + index) * LOG_ROW_HEIGHT}px)` }"
            :title="`${log.agentName}: ${log.message}`"
          >
            <span class="ai-t-faint">[{{ formatLogTime(log.timestamp) }}]</span>
            <span class="ai-t-blue"> {{ log.agentName }}:</span>
            <span class="ai-log-text"> {{ log.message }}</span>
          </div>
        </div>

        <div
          v-if="filteredLogs.length === 0"
          class="ai-t-faint italic ai-text-center ai-py-4"
        >
          没有符合条件的日志
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useAiStore } from '@/stores/aiStore'
import { useAI } from '@/composables/useAI'
import { serializeAgentLogs, exportFileStamp } from '@/utils/agentLogExport'
import { computeAgentMetrics, formatMetricsSummary, type AgentMetrics } from '@/utils/agentMetrics'

const aiStore = useAiStore()
const ai = useAI()

// ===================== 运行指标 =====================
// runtime 不是响应式的：500ms 轮询一次快照，指标条够新鲜又不抢主线程
const METRICS_REFRESH_MS = 500

const metrics = ref<AgentMetrics | null>(null)
let metricsTimer: number | undefined

const refreshMetrics = (): void => {
  metrics.value = computeAgentMetrics(ai.getMetricsSnapshot())
}

const metricsDisplay = computed(() => ({
  successRate:
    metrics.value?.successRate == null
      ? '—'
      : `${(metrics.value.successRate * 100).toFixed(0)}%`,
  collisions: String(metrics.value?.collisionCountTotal ?? 0),
  efficiency:
    metrics.value?.meanPathEfficiency == null ? '—' : metrics.value.meanPathEfficiency.toFixed(2),
  goals:
    metrics.value === null ? '—' : `${metrics.value.goalReachedCount} / ${metrics.value.totalAgents}`,
}))

onMounted(() => {
  refreshMetrics()
  metricsTimer = window.setInterval(refreshMetrics, METRICS_REFRESH_MS)
})

onBeforeUnmount(() => {
  if (metricsTimer !== undefined) window.clearInterval(metricsTimer)
})

// 状态
const simulationActive = computed(() => aiStore.simulationActive)
const simulationTime = computed(() => aiStore.simulationTime)
const environmentSettings = computed(() => aiStore.environmentSettings)
const activeAgentsCount = computed(() => aiStore.activeAgents.length)
const logFilter = ref('all')

/**
 * 全部日志——store 里就是**一张按时间排好的全局表**，代理是谁记在条目上。
 *
 * ⚠️ 这里不复制、不排序：以前是"每个代理各存一份 → 面板合并 → 重新排序"，
 * 每来一条日志就把所有条目复制一遍。几千条之后光这一步就够吃主线程。
 */
const filteredLogs = computed(() => {
  const all = aiStore.logs
  if (logFilter.value === 'all') return all
  return all.filter((log) => log.type === logFilter.value)
})

/**
 * 一行的像素高度——**必须和样式里的行高一致**。
 *
 * 虚拟滚动靠它把「滚动位置」换算成「第几行」。两处对不上，
 * 滚动时就会看到错位的行。
 */
const LOG_ROW_HEIGHT = 18

/** 视口外多画几行，滚动时不会露出空白 */
const LOG_OVERSCAN = 6

/** 视口高度：布局量出来之前先用样式里的上限顶着 */
const LOG_VIEWPORT_FALLBACK = 260

const logBoxRef = ref<HTMLElement | null>(null)
const logScrollTop = ref(0)
const logViewportHeight = ref(LOG_VIEWPORT_FALLBACK)

/** 整张列表要占多高——滚动条靠它反映真实条数 */
const totalHeight = computed(() => filteredLogs.value.length * LOG_ROW_HEIGHT)

/** 视口里第一条该画的是第几行 */
const windowStart = computed(() => {
  const first = Math.floor(logScrollTop.value / LOG_ROW_HEIGHT) - LOG_OVERSCAN
  return Math.max(0, first)
})

/** 视口里最后一条该画到第几行 */
const windowEnd = computed(() => {
  const rows = Math.ceil(logViewportHeight.value / LOG_ROW_HEIGHT) + 1
  return Math.min(filteredLogs.value.length, windowStart.value + rows + LOG_OVERSCAN * 2)
})

/** 真正画出来的那一批 */
const windowLogs = computed(() => filteredLogs.value.slice(windowStart.value, windowEnd.value))

/**
 * 用户是不是还贴在底部。
 *
 * ⚠️ 往上翻看历史时不要把他拽回底部——那是日志窗口最烦人的行为。
 */
const pinnedToBottom = ref(true)

const handleLogScroll = (): void => {
  const box = logBoxRef.value
  if (!box) return
  logScrollTop.value = box.scrollTop
  pinnedToBottom.value = box.scrollHeight - box.scrollTop - box.clientHeight < 24
}

/** 视口高度变了要重算画哪几行——面板被拉伸或折叠时会发生 */
let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const box = logBoxRef.value
  if (!box) return
  logViewportHeight.value = box.clientHeight || LOG_VIEWPORT_FALLBACK
  // jsdom 里没有 ResizeObserver——测试环境要能跑
  if (typeof ResizeObserver === 'undefined') return
  resizeObserver = new ResizeObserver(() => {
    logViewportHeight.value = box.clientHeight || LOG_VIEWPORT_FALLBACK
  })
  resizeObserver.observe(box)
})

onBeforeUnmount(() => {
  resizeObserver?.disconnect()
  resizeObserver = null
})

/** 最后一条可见日志的序号——新日志到了它就变 */
const lastVisibleSeq = computed(() => {
  const list = filteredLogs.value
  return list.length > 0 ? list[list.length - 1].seq : null
})

/**
 * 新日志到了就滚到底——日志窗口本来就该跟着最新一条走。
 *
 * ⚠️ 盯的是**最后一条的序号**，不是列表长度：日志满了之后
 * 长度不再变化（超上限的旧日志被丢掉），盯长度会就此停住不动。
 */
watch(
  () => lastVisibleSeq.value,
  async (seq) => {
    if (seq === null || !pinnedToBottom.value) return
    await nextTick()
    const box = logBoxRef.value
    if (box) box.scrollTop = box.scrollHeight
  },
)

/** 换了筛选条件就回到底部——筛选后的末尾才是当前想看的那批 */
watch(logFilter, async () => {
  await nextTick()
  const box = logBoxRef.value
  if (!box) return
  box.scrollTop = box.scrollHeight
  logScrollTop.value = box.scrollTop
})

// 方法
const handleSimulationToggle = () => {
  if (simulationActive.value) {
    aiStore.pauseSimulation()
  } else {
    aiStore.startSimulation()
  }
}

const resetSimulation = () => {
  aiStore.resetSimulation()
}

const clearLogs = () => {
  aiStore.clearLogs()
}

/**
 * 把当前筛选出的日志导出成 .jsonl。
 *
 * ⚠️ 屏幕上只显示一行（长的会截断），但**导出的是全文**——
 * 事后复盘要的是完整信息，不是省略号。
 */
const exportLogs = (): void => {
  // 指标摘要追加在最后一行（type: metrics）——复盘时先看这一行
  const metricsLine = JSON.stringify({
    time: new Date().toISOString(),
    type: 'metrics',
    message: formatMetricsSummary(computeAgentMetrics(ai.getMetricsSnapshot())),
  })
  const logLines = serializeAgentLogs(filteredLogs.value)
  const text = logLines ? `${logLines}${metricsLine}\n` : `${metricsLine}\n`
  const blob = new Blob([text], { type: 'application/x-ndjson;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `ai-logs-${exportFileStamp()}.jsonl`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 立刻 revoke 会把还没开始的下载掐掉——延后一点再释放
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// 格式化辅助函数
const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`
}

/**
 * 日志时间——固定格式的 HH:MM:SS。
 *
 * ⚠️ 这里**不能**用 `toLocaleTimeString`：它每次调用都要新建一个 Intl 格式化器，
 * 实测单次约 97 微秒。日志面板每行、每次重渲染都要过一次这个格式化——
 * 两百多行、每秒重渲几次，就是每秒上百毫秒的主线程时间，
 * 代理一多界面就跟着卡住。
 */
const pad2 = (value: number): string => (value < 10 ? `0${value}` : String(value))
const formatLogTime = (timestamp: number): string => {
  const date = new Date(timestamp)
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

const formatScenario = (scenario: string) => {
  const scenarioMap: Record<string, string> = {
    'navigation': '导航挑战',
    'interaction': '物体交互',
    'combat': '对抗模拟',
    'custom': '自定义场景'
  }
  return scenarioMap[scenario] || scenario
}

const formatDifficulty = (difficulty: string) => {
  const difficultyMap: Record<string, string> = {
    'easy': '简单',
    'medium': '中等',
    'hard': '困难'
  }
  return difficultyMap[difficulty] || difficulty
}
</script>

<style scoped>
/* 物理模式说明：碰撞由 Rapier 刚体引擎求解 */
.physics-mode {
  margin: 0 0 0.5rem;
  font-size: 0.7rem;
  line-height: 1.5;
  color: var(--text-2);
  opacity: 0.85;
}

/**
 * 日志区：**自己滚动，绝不把整页撑高**。
 *
 * 之前日志框只有 overflow-y:auto、没定高度上限，代理一跑日志就持续变长，
 * 面板跟着长 → 整页布局被顶开，滚动条也永远不出现（因为盒子在长高，
 * 从来没“溢出”过）。给它一个上限，日志就老老实实在框里滚。
 */
.ai-log-list {
  max-height: 260px;
  min-height: 0;
}

/* flex 里的滚动区要允许被压缩，否则 min-height:auto 会顶住 */
.ai-log-wrap {
  min-height: 0;
}

/**
 * 虚拟滚动的占位层：高度 = 总条数 × 行高。
 *
 * 滚动条的长度就是按它算的——日志有多少条，滚动条就有多长。
 */
.ai-log-spacer {
  position: relative;
  width: 100%;
}

/**
 * 真正画出来的一行。
 *
 * ⚠️ 绝对定位 + 固定行高：行高必须与脚本里的 `LOG_ROW_HEIGHT` 一致，
 * 否则滚动位置换算出来的行号会跟实际错开。
 *
 * 单行不折行：折行会让行高变得不固定，虚拟滚动就没法算了。
 * 完整内容放在 title 里（悬停可见），导出文件里是全文。
 */
.ai-log-row {
  position: absolute;
  left: 0;
  right: 0;
  top: 0;
  height: 18px;
  line-height: 18px;
  display: flex;
  align-items: center;
  white-space: nowrap;
  overflow: hidden;
}

/* 消息太长时省略号收尾，省略掉的部分在 title 里 */
.ai-log-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* 导出按钮 */
.ai-log-export {
  cursor: pointer;
  font-size: 0.6875rem;
  line-height: 1.25rem;
}
</style>
