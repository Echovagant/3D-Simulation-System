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

    <!-- 物理模式：如实说明碰撞由 Rapier 刚体引擎求解 -->
    <p class="physics-mode">物理模式：Rapier 刚体物理（质量 · 摩擦 · 弹性 · 固定步长 1/60 秒）</p>

    <!-- 日志显示 -->
    <div class="ai-flex-1 ai-clip ai-flex ai-flex-col ai-log-wrap">
      <div class="ai-fs-xs ai-t-muted ai-mb-1 ai-flex ai-justify-between ai-items-center">
        <span>代理日志</span>
        <select
          v-model="logFilter"
          class="ai-bg-sunken ai-t-strong ai-r-sm ai-px-1 ai-py-05"
        >
          <option value="all">所有日志</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
        </select>
      </div>

      <!--
        日志行数有上限：日志框只有 260px 高，十来行就能看全，
        而代理一多、日志一旧，攒到几百行是常事。几百行每次重渲染都要
        重新布局与绘制，主线程就被它吃掉了——帧率会跟着代理数一起掉。
        这里只渲染最近的一批，旧的仍在 store 里，只是没画出来。
      -->
      <div
        v-if="filteredLogs.length > VISIBLE_LOG_LIMIT"
        class="ai-fs-xs ai-t-faint ai-mb-1"
      >
        共 {{ filteredLogs.length }} 条，列表只显示最近 {{ VISIBLE_LOG_LIMIT }} 条
      </div>

      <div
        ref="logBoxRef"
        class="ai-flex-1 ai-scroll ai-bg-soft ai-r-sm ai-p-2 ai-fs-xs ai-space-y-1 ai-log-list"
        @scroll.passive="handleLogScroll"
      >
        <div
          v-for="log in visibleLogs"
          :key="log.seq"
          :class="[
                log.type === 'info' ? 'ai-t-blue' :
                log.type === 'warning' ? 'ai-t-amber' : 'ai-t-red',
              ]"
        >
          <span class="ai-t-faint">[{{ formatLogTime(log.timestamp) }}]</span>
          <span class="ai-t-blue"> {{ log.agentName }}:</span>
          <span> {{ log.message }}</span>
        </div>

        <div v-if="visibleLogs.length === 0" class="ai-t-faint italic ai-text-center ai-py-4">
          没有符合条件的日志
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, nextTick } from 'vue'
import { useAiStore, type AiAgentLog } from '@/stores/aiStore'

const aiStore = useAiStore()

// 状态
const simulationActive = computed(() => aiStore.simulationActive)
const simulationTime = computed(() => aiStore.simulationTime)
const environmentSettings = computed(() => aiStore.environmentSettings)
const activeAgentsCount = computed(() => aiStore.activeAgents.length)
const logFilter = ref('all')

// 整合所有代理的日志
const allLogs = computed(() => {
  const logs: Array<AiAgentLog & { agentId: string; agentName: string }> = []

  aiStore.agents.forEach(agent => {
    agent.logs.forEach(log => {
      logs.push({
        agentId: agent.id,
        agentName: agent.name,
        ...log
      })
    })
  })

  // 按时间排序
  return logs.sort((a, b) => a.timestamp - b.timestamp)
})

// 根据过滤器筛选日志
const filteredLogs = computed(() => {
  if (logFilter.value === 'all') {
    return allLogs.value
  }
  return allLogs.value.filter(log => log.type === logFilter.value)
})

/**
 * 列表实际渲染的条数上限。
 *
 * ⚠️ 日志框只有 260px 高，十几行就能看全。日志框画几百行的话，
 * 每次重渲染都要重新布局与绘制几百行文字——主线程被它占住，
 * 帧率会跟着代理数一起掉。旧的日志还在 store 里，只是没画出来。
 */
const VISIBLE_LOG_LIMIT = 60

/** 实际渲染的那一批：最新的若干条 */
const visibleLogs = computed(() => filteredLogs.value.slice(-VISIBLE_LOG_LIMIT))

// 日志区自己滚，不把整页撑高
const logBoxRef = ref<HTMLElement | null>(null)

/**
 * 用户是不是还贴在底部。
 *
 * ⚠️ 往上翻看历史时不要把他拽回底部——那是日志窗口最烦人的行为。
 */
const pinnedToBottom = ref(true)
const handleLogScroll = (): void => {
  const box = logBoxRef.value
  if (!box) return
  pinnedToBottom.value = box.scrollHeight - box.scrollTop - box.clientHeight < 24
}

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
  // 清空所有代理的日志
  aiStore.agents.forEach(agent => {
    agent.logs = []
  })
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
  color: #9ca3af;
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
</style>
