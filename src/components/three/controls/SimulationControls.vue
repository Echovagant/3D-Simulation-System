<template>
  <div class="simulation-controls">
    <div class="control-group">
      <button
        class="control-btn"
        @click="$emit('play-pause')"
      >
        {{ isPlaying ? '⏸️ 暂停' : '▶️ 播放' }}
      </button>

      <button
        class="control-btn"
        @click="$emit('step')"
      >
        ⏭️ 单步
      </button>

      <button
        class="control-btn"
        @click="$emit('reset')"
      >
        🔄 重置
      </button>
    </div>

    <div class="settings-group">
      <div class="setting-item">
        <label>速度: {{ speed }}x</label>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          :value="speed"
          @input="(e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target) $emit('speed-change', parseFloat(target.value));
          }"
        >
      </div>

      <div class="setting-item">
        <label>步长: {{ stepSize }}s</label>
        <input
          type="range"
          min="0.01"
          max="1"
          step="0.01"
          :value="stepSize"
          @input="(e: Event) => {
            const target = e.target as HTMLInputElement;
            if (target) $emit('step-size-change', parseFloat(target.value));
          }"
        >
      </div>
    </div>

    <div class="simulation-stats">
      <p>仿真时间: {{ simulationTime.toFixed(2) }}s</p>
      <p>帧率: {{ fps }} FPS</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';

const props = defineProps<{
  isPlaying: boolean;
  speed: number;
  stepSize: number;
}>();

const emits = defineEmits<{
  (e: 'play-pause'): void;
  (e: 'step'): void;
  (e: 'reset'): void;
  (e: 'speed-change', speed: number): void;
  (e: 'step-size-change', stepSize: number): void;
}>();

// 状态
const simulationTime = ref(0);
const fps = ref(0);
let lastTime = 0;
let frameCount = 0;
let fpsTimer: number;

// 帧率计算
const updateFps = () => {
  const now = performance.now();
  frameCount++;

  if (now - lastTime >= 1000) {
    fps.value = Math.round((frameCount * 1000) / (now - lastTime));
    frameCount = 0;
    lastTime = now;
  }

  fpsTimer = requestAnimationFrame(updateFps);
};

onMounted(() => {
  lastTime = performance.now();
  updateFps();
});

onUnmounted(() => {
  cancelAnimationFrame(fpsTimer);
});
</script>

<style scoped>
.simulation-controls {
  background: #2c3e50;
  color: white;
  padding: 1rem;
  border-radius: 4px;
  margin: 1rem;
}

.control-group {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.control-btn {
  background: #3498db;
  border: none;
  color: white;
  padding: 0.5rem 1rem;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.3s;
}

.control-btn:hover {
  background: #2980b9;
}

.settings-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.setting-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.setting-item input {
  flex: 1;
}

.simulation-stats {
  font-size: 0.9rem;
  color: #bdc3c7;
}
</style>
