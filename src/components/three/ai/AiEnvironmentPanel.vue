<template>
  <div class="ai-environment-panel p-4 bg-black/70 rounded-lg border border-yellow-500/30">
    <h3 class="text-yellow-400 text-lg font-bold mb-3 flex items-center">
      <i class="fa fa-cogs mr-2"></i>环境设置
    </h3>

    <form @submit.prevent="saveSettings">
      <div class="space-y-4">
        <!-- 场景类型 -->
        <div>
          <label class="block text-yellow-300 text-sm mb-1">场景类型</label>
          <select
            v-model="settings.scenario"
            @change="updateSettings"
            class="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
            <option value="navigation">导航挑战</option>
            <option value="interaction">物体交互</option>
            <option value="combat">对抗模拟</option>
            <option value="custom">自定义场景</option>
          </select>
        </div>

        <!-- 难度设置 -->
        <div>
          <label class="block text-yellow-300 text-sm mb-1">难度级别</label>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value="easy"
                v-model="settings.difficulty"
                @change="updateSettings"
                class="sr-only peer accent-yellow-500"
              >
              <span class="text-sm text-gray-300">简单</span>
            </label>
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value="medium"
                v-model="settings.difficulty"
                @change="updateSettings"
                class="sr-only peer accent-yellow-500"
              >
              <span class="text-sm text-gray-300">中等</span>
            </label>
            <label class="inline-flex items-center cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value="hard"
                v-model="settings.difficulty"
                @change="updateSettings"
                class="sr-only peer accent-yellow-500"
              >
              <span class="text-sm text-gray-300">困难</span>
            </label>
          </div>
        </div>

        <!-- 障碍物密度（使用计算属性格式化） -->
        <div>
          <label class="block text-yellow-300 text-sm mb-1">
            障碍物密度: {{ formattedObstaclesDensity }}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            v-model.number="settings.obstaclesDensity"
            @input="updateSettings"
            class="w-full accent-yellow-500"
          >
        </div>

        <!-- 时间限制 -->
        <div>
          <label class="block text-yellow-300 text-sm mb-1">
            时间限制 (秒，0表示无限制)
          </label>
          <input
            type="number"
            min="0"
            max="300"
            step="10"
            v-model.number="settings.timeLimit"
            @change="updateSettings"
            class="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
        </div>

        <!-- 胜利条件 -->
        <div>
          <label class="block text-yellow-300 text-sm mb-1">胜利条件</label>
          <input
            type="text"
            v-model="settings.winCondition"
            @change="updateSettings"
            class="w-full bg-gray-800 border border-gray-700 text-white rounded px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
        </div>

        <button
          type="submit"
          class="w-full bg-yellow-600 text-black font-medium py-2 px-4 rounded hover:bg-yellow-500 transition-colors text-sm mt-2"
        >
          应用设置
        </button>
      </div>
    </form>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from 'vue'
import { useAiStore } from '@/stores/aiStore'
import type { AiEnvironmentSettings } from '@/types'

const aiStore = useAiStore()
const settings = ref<AiEnvironmentSettings>({ ...aiStore.environmentSettings })

// 计算属性：将小数转为百分比字符串
const formattedObstaclesDensity = computed(() =>
  `${Math.round(settings.value.obstaclesDensity * 100)}%`
)

watch(
  () => aiStore.environmentSettings,
  (newSettings) => { settings.value = { ...newSettings } }
)

const updateSettings = () => {} // 实时更新逻辑（可扩展）
const saveSettings = () => aiStore.updateEnvironmentSettings(settings.value)
</script>
