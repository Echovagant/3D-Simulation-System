<template>
  <div class="ai-form ai-environment-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber">
    <h3 class="ai-t-amber ai-fs-lg ai-fw-bold ai-mb-3 ai-flex ai-items-center">
      <i class="fa fa-cogs ai-mr-2"></i>环境设置
    </h3>

    <form @submit.prevent="saveSettings">
      <div class="ai-space-y-4">
        <!-- 场景类型 -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">场景类型</label>
          <select
            v-model="settings.scenario"
            @change="updateSettings"
            class="ai-w-full ai-bg-sunken ai-b ai-b-gray ai-t-primary ai-r-sm ai-px-3 ai-py-2 ai-fs-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
            <option value="navigation">导航挑战</option>
            <option value="interaction">物体交互</option>
            <option value="combat">对抗模拟</option>
            <option value="custom">自定义场景</option>
          </select>
        </div>

        <!-- 难度设置 -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">难度级别</label>
          <div class="ai-flex ai-items-center ai-gap-2">
            <label class="inline-flex ai-items-center cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value="easy"
                v-model="settings.difficulty"
                @change="updateSettings"
                class="sr-only peer accent-yellow-500"
              >
              <span class="ai-fs-sm ai-t">简单</span>
            </label>
            <label class="inline-flex ai-items-center cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value="medium"
                v-model="settings.difficulty"
                @change="updateSettings"
                class="sr-only peer accent-yellow-500"
              >
              <span class="ai-fs-sm ai-t">中等</span>
            </label>
            <label class="inline-flex ai-items-center cursor-pointer">
              <input
                type="radio"
                name="difficulty"
                value="hard"
                v-model="settings.difficulty"
                @change="updateSettings"
                class="sr-only peer accent-yellow-500"
              >
              <span class="ai-fs-sm ai-t">困难</span>
            </label>
          </div>
        </div>

        <!-- 障碍物密度（使用计算属性格式化） -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">
            障碍物密度: {{ formattedObstaclesDensity }}
          </label>
          <input
            type="range"
            min="0"
            max="1"
            step="0.1"
            v-model.number="settings.obstaclesDensity"
            @input="updateSettings"
            class="ai-w-full accent-yellow-500"
          >
        </div>

        <!-- 时间限制 -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">
            时间限制 (秒，0表示无限制)
          </label>
          <input
            type="number"
            min="0"
            max="300"
            step="10"
            v-model.number="settings.timeLimit"
            @change="updateSettings"
            class="ai-w-full ai-bg-sunken ai-b ai-b-gray ai-t-primary ai-r-sm ai-px-3 ai-py-2 ai-fs-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
        </div>

        <!-- 胜利条件 -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">胜利条件</label>
          <input
            type="text"
            v-model="settings.winCondition"
            @change="updateSettings"
            class="ai-w-full ai-bg-sunken ai-b ai-b-gray ai-t-primary ai-r-sm ai-px-3 ai-py-2 ai-fs-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
        </div>

        <button
          type="submit"
          class="ai-w-full ai-bg-amber ai-t-on-amber ai-fw-medium ai-py-2 ai-px-4 ai-r-sm hover:bg-yellow-500 transition-colors ai-fs-sm ai-mt-2"
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
