<template>
  <div class="ai-controller p-4 bg-black/70 rounded-lg border border-yellow-500/30">
    <h3 class="text-yellow-400 text-lg font-bold mb-3 flex items-center">
      <i class="fa fa-robot mr-2"></i>AI代理控制
    </h3>

    <!-- 代理列表 -->
    <div class="mb-4">
      <div class="flex justify-between items-center mb-2">
        <label class="text-yellow-300 text-sm">代理列表</label>
        <button
          @click="addNewAgent"
          class="text-xs bg-yellow-600 text-black px-2 py-1 rounded hover:bg-yellow-500 transition-colors"
        >
          <i class="fa fa-plus mr-1"></i>添加代理
        </button>
      </div>

      <div class="space-y-2 max-h-40 overflow-y-auto pr-1">
        <div
          v-for="agent in agents"
          :key="agent.id"
          @click="selectAgent(agent.id)"
          class="p-2 rounded border cursor-pointer transition-all"
          :class="{
            'border-yellow-500 bg-yellow-500/10': selectedAgentId === agent.id,
            'border-gray-600 hover:border-gray-400' : selectedAgentId !== agent.id
          }"
        >
          <div class="flex justify-between items-center">
            <span class="text-white text-sm">{{ agent.name }}</span>
            <span
              class="text-xs px-1.5 py-0.5 rounded"
              :class="{
                'bg-green-600': agent.status === 'running',
                'bg-yellow-600': agent.status === 'paused',
                'bg-gray-600': agent.status === 'idle',
                'bg-red-600': agent.status === 'error'
              }"
            >
              {{ formatStatus(agent.status) }}
            </span>
          </div>
          <div class="text-xs text-gray-400 mt-1">
            类型: {{ formatAgentType(agent.type) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 选中代理的参数设置 -->
    <div v-if="selectedAgent" class="mt-4">
      <h4 class="text-yellow-300 text-sm font-semibold mb-2">
        {{ selectedAgent.name }} 参数设置
      </h4>

      <div class="grid grid-cols-2 gap-2 text-xs">
        <div v-if="selectedAgent.type === 'basic'">
          <label class="text-gray-300 block mb-1">移动速度</label>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            v-model.number="selectedAgent.parameters.speed"
            @change="updateAgentParameters"
            class="w-full accent-yellow-500"
          >
          <span class="text-yellow-400">{{ selectedAgent.parameters.speed }}</span>
        </div>

        <div v-if="selectedAgent.type === 'basic' || selectedAgent.type === 'advanced'">
          <label class="text-gray-300 block mb-1">反应时间 (s)</label>
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.1"
            v-model.number="selectedAgent.parameters.reactionTime"
            @change="updateAgentParameters"
            class="w-full accent-yellow-500"
          >
          <span class="text-yellow-400">{{ selectedAgent.parameters.reactionTime }}</span>
        </div>

        <div v-if="selectedAgent.type === 'basic' || selectedAgent.type === 'advanced'">
          <label class="text-gray-300 block mb-1">感知范围</label>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            v-model.number="selectedAgent.parameters.awarenessRange"
            @change="updateAgentParameters"
            class="w-full accent-yellow-500"
          >
          <span class="text-yellow-400">{{ selectedAgent.parameters.awarenessRange }}</span>
        </div>

        <div v-if="selectedAgent.type === 'basic' || selectedAgent.type === 'advanced'">
          <label class="text-gray-300 block mb-1">避障</label>
          <div class="flex items-center mt-1">
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="selectedAgent.parameters.avoidObstacles"
                @change="updateAgentParameters"
                class="sr-only peer"
              >
              <div class="relative w-9 h-5 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-600"></div>
            </label>
          </div>
        </div>

        <div v-if="selectedAgent.type === 'advanced'">
          <label class="text-gray-300 block mb-1">启用学习</label>
          <div class="flex items-center mt-1">
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="selectedAgent.parameters.learningEnabled"
                @change="updateAgentParameters"
                class="sr-only peer"
              >
              <div class="relative w-9 h-5 bg-gray-700 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-500 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-600"></div>
            </label>
          </div>
        </div>

        <div v-if="selectedAgent.type === 'advanced'">
          <label class="text-gray-300 block mb-1">记忆保留 (s)</label>
          <input
            type="range"
            min="10"
            max="300"
            step="10"
            v-model.number="selectedAgent.parameters.memoryRetention"
            @change="updateAgentParameters"
            class="w-full accent-yellow-500"
          >
          <span class="text-yellow-400">{{ selectedAgent.parameters.memoryRetention }}</span>
        </div>
      </div>

      <div class="mt-3 flex justify-end">
        <button
          @click="removeSelectedAgent"
          class="text-xs text-red-400 hover:text-red-300 transition-colors"
        >
          <i class="fa fa-trash mr-1"></i>移除代理
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed } from 'vue'
import { useAiStore } from '@/stores/aiStore'

const aiStore = useAiStore()

// 状态
const agents = computed(() => aiStore.agents)
const selectedAgentId = computed({
  get: () => aiStore.selectedAgentId,
  set: (value) => aiStore.selectedAgentId = value
})
const selectedAgent = computed(() => aiStore.selectedAgent)

// 方法
const selectAgent = (id: string) => {
  aiStore.selectedAgentId = id
}

const addNewAgent = () => {
  const agentCount = aiStore.agents.length + 1
  aiStore.createAgent(`AI代理 ${agentCount}`, 'basic')
}

const removeSelectedAgent = () => {
  if (selectedAgentId.value) {
    aiStore.removeAgent(selectedAgentId.value)
  }
}

const updateAgentParameters = () => {
  if (selectedAgentId.value && selectedAgent.value) {
    aiStore.updateAgentParameters(selectedAgentId.value, selectedAgent.value.parameters)
  }
}

// 格式化辅助函数
const formatStatus = (status: string) => {
  const statusMap: Record<string, string> = {
    'idle': '空闲',
    'running': '运行中',
    'paused': '已暂停',
    'error': '错误'
  }
  return statusMap[status] || status
}

const formatAgentType = (type: string) => {
  const typeMap: Record<string, string> = {
    'basic': '基础型',
    'advanced': '高级型',
    'custom': '自定义'
  }
  return typeMap[type] || type
}
</script>
