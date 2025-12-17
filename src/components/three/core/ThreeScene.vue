<template>
  <div ref="container" class="three-scene-container">
    <!-- 显示场景初始化状态 -->
    <div v-if="isInitializing" class="init-status-overlay">
      <div class="loading-spinner">这是Three.js场景初始化中...</div>
      <p>ThreeScene初始化中...</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted, type Ref } from 'vue';
import { useSceneEditor } from '@/composables/useSceneEditor';


const container: Ref<HTMLDivElement | null> = ref<HTMLDivElement | null>(null);
const isInitializing = ref(true);
const emits = defineEmits<{
  (e: 'expose-methods', methods: {
    addCube: () => boolean;
    addSphere: () => boolean;
    importModel: (modelId: string) => Promise<boolean>;
    getIsSceneInitialized: () => boolean;
    updatePhysics: () => void;
  }): void;
  (e: 'init-success'): void;
  (e: 'init-error', err: string): void;
}>();

// 初始化场景编辑器逻辑
const {
  initEditor,
  reinit,
  cleanupEditor,
  addCube,
  addSphere,
  importModel,
  getIsSceneInitialized,
  updatePhysics,
  onInitSuccess,
  onInitError
} = useSceneEditor(container);

// 暴露重新初始化方法
const exposeReinit = () => reinit();

// 监听初始化结果
onInitSuccess.value = () => {
  isInitializing.value = false;
  console.log('ThreeScene初始化成功');
  
  // 现有逻辑：添加示例立方体
  setTimeout(() => {
    addCube();
  }, 1000);
  emits('init-success');
};


onInitError.value = (err) => {
  isInitializing.value = false;
  emits('init-error', err);
};

// 组件挂载后初始化
onMounted(() => {
  console.log('ThreeScene组件挂载');
  if (container.value) {
    initEditor().then(() => {
      // 向父组件暴露方法
      emits('expose-methods', {
        addCube,
        addSphere,
        importModel,
        getIsSceneInitialized,
        updatePhysics
      });
    });
  }
});

// 组件卸载时清理
onUnmounted(() => {
  console.log('ThreeScene组件卸载');
  cleanupEditor();
});

// 暴露给父组件的方法
defineExpose({
  reinit: exposeReinit
});
</script>

<style scoped>
.three-scene-container {
  display: none; /* 隐藏ThreeScene容器，让Viewport组件负责显示 */
}

.init-status-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  background: rgba(0, 0, 0, 0.5);
  color: white;
  z-index: 10;
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 5px solid rgba(255, 255, 255, 0.3);
  border-radius: 50%;
  border-top-color: white;
  animation: spin 1s ease-in-out infinite;
  margin-bottom: 15px;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}
</style>
