<template>
  <div class="ai-form ai-environment-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber">
    <form @submit.prevent="saveSettings">
      <div class="ai-space-y-4">
        <!-- 场景类型：只列系统真的实现了的场景 -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">场景类型</label>
          <select
            v-model="settings.scenario"
            @change="updateSettings"
            class="ai-w-full ai-bg-sunken ai-b ai-b-gray ai-t-primary ai-r-sm ai-px-3 ai-py-2 ai-fs-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
            <option
              v-for="option in selectableScenarios"
              :key="option.value"
              :value="option.value"
            >
              {{ option.label }}
            </option>
          </select>
          <p class="ai-fs-xs ai-t-muted ai-mt-1">
            物体交互与对抗模拟需要智能体之间真的交互与对抗，系统没有这套机制，因此不作为可选项。
          </p>
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

        <!-- 胜利条件：固定为「到达目标点」 -->
        <div>
          <label class="block ai-t-amber-soft ai-fs-sm ai-mb-1">胜利条件</label>
          <select
            v-model="settings.winCondition"
            @change="updateSettings"
            class="ai-w-full ai-bg-sunken ai-b ai-b-gray ai-t-primary ai-r-sm ai-px-3 ai-py-2 ai-fs-sm focus:outline-none focus:ring-1 focus:ring-yellow-500"
          >
            <option value="到达目标点">到达目标点</option>
          </select>
          <p class="ai-fs-xs ai-t-muted ai-mt-1">
            智能体抵达当前目标点即算达成，日志里会记一笔。
          </p>
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
import { ref, computed, watch, onUnmounted } from 'vue'
import { useAiStore } from '@/stores/aiStore'
import type { AiEnvironmentSettings } from '@/types'

const aiStore = useAiStore()
const settings = ref<AiEnvironmentSettings>({ ...aiStore.environmentSettings })

/**
 * 障碍物密度会触发场地重建——拖动滑块时按 150ms 防抖，
 * 别每移动一格就把整块场地重建一次。
 */
const DENSITY_DEBOUNCE_MS = 150
let densityTimer: ReturnType<typeof setTimeout> | null = null

/** 界面上可以真的选到的场景类型 */
const selectableScenarios = computed(() => aiStore.selectableScenarioOptions)

// 计算属性：将小数转为百分比字符串
const formattedObstaclesDensity = computed(() =>
  `${Math.round(settings.value.obstaclesDensity * 100)}%`
)

watch(
  () => aiStore.environmentSettings,
  (newSettings) => {
    // 密度正在防抖写入时，仓库里还是旧值——不能把用户正在拖的值覆盖回去
    settings.value = densityTimer
      ? { ...newSettings, obstaclesDensity: settings.value.obstaclesDensity }
      : { ...newSettings }
  }
)

const writeDensity = () => {
  densityTimer = null
  aiStore.updateEnvironmentSettings({ obstaclesDensity: settings.value.obstaclesDensity })
}

/**
 * 实时写入：场景类型、难度、时间限制、胜利条件立刻生效，
 * 障碍物密度防抖后生效（它会重建场地）。
 */
const updateSettings = () => {
  aiStore.updateEnvironmentSettings({
    scenario: settings.value.scenario,
    difficulty: settings.value.difficulty,
    timeLimit: settings.value.timeLimit,
    winCondition: settings.value.winCondition
  })
  if (densityTimer) clearTimeout(densityTimer)
  densityTimer = setTimeout(writeDensity, DENSITY_DEBOUNCE_MS)
}

/** 「应用设置」：一次性提交全部字段（含密度），并撤掉待执行的防抖写入 */
const saveSettings = () => {
  if (densityTimer) {
    clearTimeout(densityTimer)
    densityTimer = null
  }
  aiStore.updateEnvironmentSettings(settings.value)
}

onUnmounted(() => {
  if (densityTimer) clearTimeout(densityTimer)
})
</script>
