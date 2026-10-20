<template>
  <div class="toolbar">
    <!-- 场景控制按钮组 -->
    <div class="toolbar-group">
      <button
        class="toolbar-btn"
        @click="handlePlayPause"
        :title="isPlaying ? '暂停模拟' : '开始模拟'"
      >
        <i class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleResetSimulation"
        title="重置模拟"
      >
        <i class="fas fa-redo"></i>
      </button>
    </div>

    <!-- 物体添加按钮组 -->
    <div class="toolbar-group">
      <button
        class="toolbar-btn"
        @click="handleAddCube"
        :disabled="!isSceneInitialized"
        title="添加立方体"
      >
        <i class="fas fa-cube"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleAddSphere"
        :disabled="!isSceneInitialized"
        title="添加球体"
      >
        <i class="fas fa-circle"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleImportModel"
        :disabled="!isSceneInitialized"
        title="导入模型"
      >
        <i class="fas fa-box"></i>
      </button>
    </div>

    <!-- 物体操作按钮组 -->
    <div class="toolbar-group">
      <button
        class="toolbar-btn"
        @click="handleRemoveSelected"
        :disabled="!hasSelectedObject"
        title="删除选中对象"
      >
        <i class="fas fa-trash"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleSaveScene"
        :disabled="!isSceneInitialized"
        title="保存场景"
      >
        <i class="fas fa-save"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleExportScene"
        :disabled="!isSceneInitialized"
        title="导出场景 JSON"
      >
        <i class="fas fa-file-export"></i>
      </button>
    </div>

    <!-- 状态提示 -->
    <div class="toolbar-status" v-if="statusMessage">
      {{ statusMessage }}
    </div>
  </div>
</template>

<script setup>
import { inject, computed, ref, watch } from 'vue';
import { useSceneEditorStore } from '@/stores/sceneEditorStore';
import { useRouter } from 'vue-router';
import { useModelStore } from '@/stores/modelStore';

// 状态管理
const store = useSceneEditorStore();
const router = useRouter();

// 从父组件注入的方法（修改后）
const addCube = inject('addCube') ?? (() => false);
const addSphere = inject('addSphere') ?? (() => false);
const importModel = inject('importModel') ?? (async () => false);
const getIsSceneInitialized = inject('getIsSceneInitialized') ?? (() => false);

// 状态
const statusMessage = ref('');
const importModelInProgress = ref(false);

// 计算属性
const isSceneInitialized = computed(() => getIsSceneInitialized());
const isPlaying = computed(() => store.simulationState.isPlaying);
const hasSelectedObject = computed(() => !!store.selectedObject);

// 显示临时消息
const showTempMessage = (message, duration = 2000) => {
  statusMessage.value = message;
  setTimeout(() => {
    statusMessage.value = '';
  }, duration);
};

// 播放/暂停模拟
const handlePlayPause = () => {
  store.togglePlayStateWithTransition();
  showTempMessage(isPlaying.value ? '开始物理模拟' : '暂停物理模拟');
};

// 重置模拟
const handleResetSimulation = () => {
  store.resetSimulation();
  showTempMessage('重置物理模拟');
};

// 添加立方体
const handleAddCube = () => {
  const success = addCube();
  if (success) {
    showTempMessage('立方体添加成功');
  } else {
    showTempMessage('立方体添加失败', 3000);
  }
};

// 添加球体
const handleAddSphere = () => {
  const success = addSphere();
  if (success) {
    showTempMessage('球体添加成功');
  } else {
    showTempMessage('球体添加失败', 3000);
  }
};

// 导入模型
const handleImportModel = async () => {
  if (!isSceneInitialized.value) return;

  // 记录当前路由作为返回地址
  const returnUrl = router.currentRoute.value.fullPath;
  importModelInProgress.value = true;

  // 跳转到模型库页面
  await router.push(`/model-library?returnUrl=${encodeURIComponent(returnUrl)}`);
};

// 删除选中对象
const handleRemoveSelected = () => {
  if (!hasSelectedObject.value) return;

  const objectName = store.selectedObject?.name || '对象';

  const before = store.objects.length;
  try {
    store.removeSelectedObject();
  } catch {
    // 删除失败时走下面的“未删除”分支，不谎报成功
  }
  const after = store.objects.length;

  if (after < before) {
    showTempMessage(`已删除 ${objectName}`);
  } else {
    showTempMessage('未选中可删除的对象', 3000);
  }
};

// 保存场景
const handleSaveScene = async () => {
  const sceneName = prompt('请输入场景名称:', `场景_${new Date().getTime().toString().slice(-4)}`);
  if (!sceneName) return;

  try {
    // 场景 id 必须拿住：它是「找回这个场景」的凭据
    // （右侧「我的场景」列表与仿真实验室的「从编辑器加载」都靠它）
    const sceneId = await store.saveScene(sceneName);
    showTempMessage(`场景保存成功: ${sceneName}（ID: ${sceneId}，可在右侧「我的场景」中打开）`, 5000);
  } catch (error) {

    showTempMessage('场景保存失败', 3000);
  }
};

// 导出场景 JSON（用的是与保存完全相同的场景文档格式）
const handleExportScene = () => {
  try {
    const doc = store.buildSceneDocument('导出场景');
    const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `scene-${doc.id}.json`;
    link.click();
    URL.revokeObjectURL(url);
    showTempMessage('场景已导出为 JSON', 3000);
  } catch (error) {
    showTempMessage('导出场景失败', 3000);
  }
};

// 监听路由变化，处理从模型库返回的情况
watch(
  () => router.currentRoute.value,
  (route) => {
    if (importModelInProgress.value && route.name !== 'model-library') {
      importModelInProgress.value = false;

      // 检查是否有选中的模型需要导入
      const modelStore = useModelStore();
      if (modelStore.selectedModelId) {
        const modelId = modelStore.selectedModelId;
        const modelInfo = modelStore.getModelById(modelId);

        if (modelInfo) {
          // 导入选中的模型
          importModel(modelId)
            .then(success => {
              if (success) {
                showTempMessage(`模型 "${modelInfo.name}" 导入成功`);
              } else {
                showTempMessage(`模型 "${modelInfo.name}" 导入失败`, 3000);
              }
            })
            .finally(() => {
              // 清除选中状态
              modelStore.selectedModelId = null;
            });
        }
      }
    }
  }
);
</script>

<style scoped>
.toolbar {
  display: flex;
  align-items: center;
  padding: 0 15px;
  height: 50px;
  background-color: #2c3e50;
  color: white;
  border-bottom: 1px solid #34495e;
  gap: 10px;
}

.toolbar-group {
  display: flex;
  gap: 2px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background-color: #34495e;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
  gap: 6px;
  padding: 0 8px;
}

.toolbar-btn:hover {
  background-color: #3d5a7c;
}

.toolbar-btn:disabled {
  background-color: #4a6988;
  color: #95a5a6;
  cursor: not-allowed;
}

.toolbar-btn i {
  font-size: 16px;
}

.toolbar-status {
  margin-left: auto;
  color: #ecf0f1;
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: rgba(255, 255, 255, 0.1);
}
</style>
