<template>
  <div class="ai-debug-panel p-4 bg-black/70 rounded-lg border border-yellow-500/30 h-full flex flex-col">
    <h3 class="text-yellow-400 text-lg font-bold mb-3 flex items-center">
      <i class="fa fa-terminal mr-2"></i>AI调试面板
    </h3>

    <!-- 仿真控制 -->
    <div class="flex gap-2 mb-4">
      <button
        @click="handleSimulationToggle"
        class="flex-1 py-1.5 text-sm rounded transition-colors"
        :class="simulationActive ?
          'bg-red-600 hover:bg-red-500' :
          'bg-green-600 hover:bg-green-500'"
      >
        <i :class="simulationActive ? 'fa fa-pause mr-1' : 'fa fa-play mr-1'"></i>
        {{ simulationActive ? '暂停' : '开始' }}
      </button>

      <button
        @click="resetSimulation"
        class="flex-1 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors"
      >
        <i class="fa fa-refresh mr-1"></i>重置
      </button>

      <button
        @click="clearLogs"
        class="flex-1 py-1.5 text-sm bg-gray-600 hover:bg-gray-500 rounded transition-colors"
      >
        <i class="fa fa-trash mr-1"></i>清空日志
      </button>
    </div>

    <!-- 仿真信息 -->
    <div class="text-xs text-gray-300 mb-3 grid grid-cols-2 gap-2">
      <div>
        <span class="text-yellow-400">仿真时间:</span> {{ formatTime(simulationTime) }}
      </div>
      <div>
        <span class="text-yellow-400">活跃代理:</span> {{ activeAgentsCount }}
      </div>
      <div>
        <span class="text-yellow-400">场景类型:</span> {{ formatScenario(environmentSettings.scenario) }}
      </div>
      <div>
        <span class="text-yellow-400">难度:</span> {{ formatDifficulty(environmentSettings.difficulty) }}
      </div>
    </div>

    <!-- 日志显示 -->
    <div class="flex-1 overflow-hidden flex flex-col">
      <div class="text-xs text-gray-400 mb-1 flex justify-between items-center">
        <span>代理日志</span>
        <select
          v-model="logFilter"
          class="bg-gray-800 text-gray-200 rounded px-1 py-0.5"
        >
          <option value="all">所有日志</option>
          <option value="info">信息</option>
          <option value="warning">警告</option>
          <option value="error">错误</option>
        </select>
      </div>

      <div class="flex-1 overflow-y-auto bg-black/50 rounded p-2 text-xs space-y-1">
        <div
          v-for="(log, index) in filteredLogs"
          :key="index"
          :class="{
            'text-green-400': log.type === 'info',
            'text-yellow-400': log.type === 'warning',
            'text-red-400': log.type === 'error'
          }"
        >
          <span class="text-gray-500">[{{ formatLogTime(log.timestamp) }}]</span>
          <span class="text-blue-400"> {{ log.agentName }}:</span>
          <span> {{ log.message }}</span>
        </div>

        <div v-if="filteredLogs.length === 0" class="text-gray-500 italic text-center py-4">
          没有符合条件的日志
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { useAiStore } from '@/stores/aiStore'

const aiStore = useAiStore()

// 状态
const simulationActive = computed(() => aiStore.simulationActive)
const simulationTime = computed(() => aiStore.simulationTime)
const environmentSettings = computed(() => aiStore.environmentSettings)
const activeAgentsCount = computed(() => aiStore.activeAgents.length)
const logFilter = ref('all')

// 整合所有代理的日志
const allLogs = computed(() => {
  const logs: Array<{
    agentId: string
    agentName: string
    timestamp: number
    message: string
    type: 'info' | 'warning' | 'error'
  }> = []

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

const formatLogTime = (timestamp: number) => {
  const date = new Date(timestamp)
  return date.toLocaleTimeString('zh-CN', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
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
