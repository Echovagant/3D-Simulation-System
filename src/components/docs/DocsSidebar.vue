<template>
  <div class="docs-sidebar bg-gray-50 dark:bg-gray-900 p-4 h-full overflow-y-auto">
    <div class="mb-6">
      <h2 class="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">指南</h2>
      <ul class="space-y-2">
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'introduction'}"
            @click="$emit('change-section', 'guide/introduction')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            介绍
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'scene-editor'}"
            @click="$emit('change-section', 'guide/scene-editor')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            场景编辑器
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'simulation-lab'}"
            @click="$emit('change-section', 'guide/simulation-lab')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            仿真实验室
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'model-library'}"
            @click="$emit('change-section', 'guide/model-library')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            模型库
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'ai-playground'}"
            @click="$emit('change-section', 'guide/ai-playground')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            AI演武场
          </a>
        </li>
      </ul>
    </div>

    <div class="mb-6">
      <h2 class="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">API参考</h2>
      <ul class="space-y-2">
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'three-integration'}"
            @click="$emit('change-section', 'api/three-integration')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            Three.js集成
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'physics-engine'}"
            @click="$emit('change-section', 'api/physics-engine')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            物理引擎
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'ai-api'}"
            @click="$emit('change-section', 'api/ai-api')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            AI API
          </a>
        </li>
      </ul>
    </div>

    <div>
      <h2 class="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">示例</h2>
      <ul class="space-y-2">
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'basic-scene'}"
            @click="$emit('change-section', 'examples/basic-scene')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            基础场景
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'physics-simulation'}"
            @click="$emit('change-section', 'examples/physics-simulation')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            物理仿真
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'ai-interaction'}"
            @click="$emit('change-section', 'examples/ai-interaction')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            AI交互
          </a>
        </li>
      </ul>
    </div>
  </div>
</template>

<script setup lang="ts">
import {  defineEmits } from 'vue';

const props = defineProps<{
  currentSection: string;
}>();

const emit = defineEmits<{
  (e: 'change-section', section: string): void;
}>();
</script>

<style scoped>
.docs-sidebar {
  width: 260px;
  border-right: 1px solid #e2e8f0;
}
</style>
