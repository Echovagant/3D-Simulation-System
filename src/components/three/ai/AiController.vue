<template>
  <div class="ai-form ai-controller ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber">
    <h3 class="ai-t-amber ai-fs-lg ai-fw-bold ai-mb-3 ai-flex ai-items-center">
      <i class="fa fa-robot ai-mr-2"></i>AI代理控制
    </h3>

    <!-- 代理列表 -->
    <div class="ai-mb-4">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-2">
        <label class="ai-t-amber-soft ai-fs-sm">代理列表</label>
        <button
          @click="addNewAgent"
          class="ai-fs-xs ai-bg-amber ai-t-on-amber ai-px-2 ai-py-1 ai-r-sm hover:bg-yellow-500 transition-colors"
        >
          <i class="fa fa-plus ai-mr-1"></i>添加代理
        </button>
      </div>

      <div class="ai-space-y-2 max-h-40 ai-scroll pr-1">
        <div
          v-for="agent in agents"
          :key="agent.id"
          @click="selectAgent(agent.id)"
          class="ai-p-2 ai-r-sm ai-b cursor-pointer transition-all"
          :class="[
              selectedAgentId === agent.id ? 'ai-b-amber ai-bg-amber-faint' : 'ai-b-gray',
            ]"
        >
          <div class="ai-flex ai-justify-between ai-items-center">
            <span class="ai-t-primary ai-fs-sm">{{ agent.name }}</span>
            <span
              class="ai-fs-xs ai-px-1 ai-py-05 ai-r-sm"
              :class="[
                agent.status === 'running' ? 'ai-bg-green' :
                agent.status === 'paused' ? 'ai-bg-amber' :
                agent.status === 'error' ? 'ai-bg-red' : 'ai-bg-chip',
              ]"
            >
              {{ formatStatus(agent.status) }}
            </span>
          </div>
          <div class="ai-fs-xs ai-t-muted ai-mt-1">
            类型: {{ formatAgentType(agent.type) }}
          </div>
        </div>
      </div>
    </div>

    <!-- 选中代理的参数设置 -->
    <div v-if="selectedAgent" class="ai-mt-4">
      <h4 class="ai-t-amber-soft ai-fs-sm ai-fw-semibold ai-mb-2">
        {{ selectedAgent.name }} 参数设置
      </h4>

      <div class="ai-grid ai-grid-2 ai-gap-2 ai-fs-xs">
        <div v-if="selectedAgent.type === 'basic'">
          <label class="ai-t block ai-mb-1">移动速度</label>
          <input
            type="range"
            min="1"
            max="10"
            step="0.5"
            v-model.number="selectedAgent.parameters.speed"
            @change="updateAgentParameters"
            class="ai-w-full accent-yellow-500"
          >
          <span class="ai-t-amber">{{ selectedAgent.parameters.speed }}</span>
        </div>

        <div v-if="selectedAgent.type === 'basic' || selectedAgent.type === 'advanced'">
          <label class="ai-t block ai-mb-1">反应时间 (s)</label>
          <input
            type="range"
            min="0.1"
            max="2"
            step="0.1"
            v-model.number="selectedAgent.parameters.reactionTime"
            @change="updateAgentParameters"
            class="ai-w-full accent-yellow-500"
          >
          <span class="ai-t-amber">{{ selectedAgent.parameters.reactionTime }}</span>
        </div>

        <div v-if="selectedAgent.type === 'basic' || selectedAgent.type === 'advanced'">
          <label class="ai-t block ai-mb-1">感知范围</label>
          <input
            type="range"
            min="1"
            max="20"
            step="1"
            v-model.number="selectedAgent.parameters.awarenessRange"
            @change="updateAgentParameters"
            class="ai-w-full accent-yellow-500"
          >
          <span class="ai-t-amber">{{ selectedAgent.parameters.awarenessRange }}</span>
        </div>

        <div v-if="selectedAgent.type === 'basic' || selectedAgent.type === 'advanced'">
          <label class="ai-t block ai-mb-1">避障</label>
          <div class="ai-flex ai-items-center ai-mt-1">
            <label class="inline-flex ai-items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="selectedAgent.parameters.avoidObstacles"
                @change="updateAgentParameters"
                class="sr-only peer"
              >
              <div class="ai-relative ai-w-9 ai-h-5 ai-bg-raised peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-500 ai-r-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-600"></div>
            </label>
          </div>
        </div>

        <div v-if="selectedAgent.type === 'advanced'">
          <label class="ai-t block ai-mb-1">启用学习</label>
          <div class="ai-flex ai-items-center ai-mt-1">
            <label class="inline-flex ai-items-center cursor-pointer">
              <input
                type="checkbox"
                v-model="selectedAgent.parameters.learningEnabled"
                @change="updateAgentParameters"
                class="sr-only peer"
              >
              <div class="ai-relative ai-w-9 ai-h-5 ai-bg-raised peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-yellow-500 ai-r-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-yellow-600"></div>
            </label>
          </div>
        </div>

        <div v-if="selectedAgent.type === 'advanced'">
          <label class="ai-t block ai-mb-1">记忆保留 (s)</label>
          <input
            type="range"
            min="10"
            max="300"
            step="10"
            v-model.number="selectedAgent.parameters.memoryRetention"
            @change="updateAgentParameters"
            class="ai-w-full accent-yellow-500"
          >
          <span class="ai-t-amber">{{ selectedAgent.parameters.memoryRetention }}</span>
        </div>
      </div>

      <div class="ai-mt-3 ai-flex ai-justify-end">
        <button
          @click="removeSelectedAgent"
          class="ai-fs-xs ai-t-red hover:text-red-300 transition-colors"
        >
          <i class="fa fa-trash ai-mr-1"></i>移除代理
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
