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
        title="重置模拟（回到物体初始位置）"
      >
        <i class="fas fa-undo-alt"></i>
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
        @click="handleAddRamp"
        :disabled="!isSceneInitialized"
        title="添加斜面"
      >
        <i class="fas fa-mountain"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleImportModel"
        :disabled="!isSceneInitialized"
        title="导入模型"
      >
        <i class="fas fa-box"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="showAiSceneDialog = true"
        :disabled="!isSceneInitialized"
        title="AI 生成场景"
      >
        <i class="fas fa-wand-magic-sparkles"></i>
      </button>
    </div>

    <!-- 编辑与历史 -->
    <div class="toolbar-group">
      <button
        class="toolbar-btn"
        :disabled="!store.canUndo"
        title="撤销（Ctrl+Z）"
        @click="handleUndo"
      >
        <i class="fas fa-undo"></i>
      </button>
      <button
        class="toolbar-btn"
        :disabled="!store.canRedo"
        title="重做（Ctrl+Y / Ctrl+Shift+Z）"
        @click="handleRedo"
      >
        <i class="fas fa-redo"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleRemoveSelected"
        :disabled="!hasSelectedObject"
        title="删除选中对象（Delete）"
      >
        <i class="fas fa-trash"></i>
      </button>
    </div>

    <!-- 存取与场景文件 -->
    <div class="toolbar-group">
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
      <button
        class="toolbar-btn"
        @click="handleImportClick"
        :disabled="!isSceneInitialized"
        title="导入场景 JSON"
      >
        <i class="fas fa-file-import"></i>
      </button>
      <button
        class="toolbar-btn"
        @click="handleRecallFallen"
        :disabled="store.objects.length === 0"
        title="召回掉出场地的物体（放回初始位置）"
      >
        <i class="fas fa-arrow-up-from-bracket"></i>
      </button>
    </div>

    <!-- 场地尺寸 -->
    <div class="toolbar-group toolbar-world">
      <label class="world-label" for="world-size">场地</label>
      <select
        id="world-size"
        class="world-select"
        :value="store.worldSize"
        :disabled="!isSceneInitialized"
        title="切换编辑场地大小"
        @change="handleWorldSizeChange"
      >
        <option v-for="size in SCENE_WORLD_SIZES" :key="size" :value="size">
          {{ size }} × {{ size }}
        </option>
      </select>
    </div>

    <input
      ref="fileInput"
      class="toolbar-file-input"
      type="file"
      accept=".json,application/json"
      @change="handleImportFile"
    />

    <!-- 状态提示 -->
    <div class="toolbar-status" v-if="statusMessage">
      {{ statusMessage }}
    </div>
  </div>
  <ImportModelDialog
    v-if="showImportDialog"
    @close="showImportDialog = false"
  />
  <AiSceneDialog
    v-if="showAiSceneDialog"
    @close="showAiSceneDialog = false"
  />
</template>

<script setup>
import { inject, computed, ref, watch } from 'vue';
import { useSceneEditorStore } from '@/stores/sceneEditorStore';
import { useModelStore } from '@/stores/modelStore';
import { reportError } from '@/services/api/telemetry';
import { parseSceneDocumentJson } from '@/utils/sceneDocument';
import { SCENE_WORLD_SIZES } from '@/config/sceneEditor';
import ImportModelDialog from './ImportModelDialog.vue';
import AiSceneDialog from './AiSceneDialog.vue';

// 状态管理
const store = useSceneEditorStore();
const modelStore = useModelStore();

// 从父组件注入的方法。兜底成「返回 false」的空实现：
// 没有上游提供时按钮点了不炸，只提示失败
const addCube = inject('addCube') ?? (() => false);
const addSphere = inject('addSphere') ?? (() => false);
const addRamp = inject('addRamp') ?? (() => false);
const importModel = inject('importModel') ?? (async () => false);
const getIsSceneInitialized = inject('getIsSceneInitialized') ?? (() => false);

// 状态
const statusMessage = ref('');
const importingModel = ref(false);
const showImportDialog = ref(false);
const showAiSceneDialog = ref(false);
const fileInput = ref(null);

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
  // 切换**前**先记住当前状态：isPlaying 在切换调用里就同步翻转了，
  // 之后再读读到的是切换后的状态，提示语会与实际动作正好相反。
  const wasPlaying = isPlaying.value;
  store.togglePlayStateWithTransition();
  showTempMessage(wasPlaying ? '已暂停物理模拟' : '已开始物理模拟');
};

// 重置模拟
const handleResetSimulation = () => {
  store.resetSimulation();
  showTempMessage('重置物理模拟');
};

// 添加基本体：先拍快照，成功后才入历史栈（失败不留空撤销）
const addWithHistory = (label, create) => {
  const before = store.snapshotForHistory();
  const success = create();
  if (success) store.pushHistory(label, before);
  return success;
};

// 添加立方体
const handleAddCube = () => {
  const success = addWithHistory('添加立方体', () => addCube());
  showTempMessage(success ? '立方体添加成功' : '立方体添加失败', success ? 2000 : 3000);
};

// 添加球体
const handleAddSphere = () => {
  const success = addWithHistory('添加球体', () => addSphere());
  showTempMessage(success ? '球体添加成功' : '球体添加失败', success ? 2000 : 3000);
};

// 添加斜面
const handleAddRamp = () => {
  const success = addWithHistory('添加斜面', () => addRamp());
  showTempMessage(success ? '斜面添加成功' : '斜面添加失败', success ? 2000 : 3000);
};

// 撤销 / 重做
const handleUndo = async () => {
  const ok = await store.undo();
  showTempMessage(ok ? '已撤销' : '没有可撤销的操作', ok ? 1500 : 3000);
};

const handleRedo = async () => {
  const ok = await store.redo();
  showTempMessage(ok ? '已重做' : '没有可重做的操作', ok ? 1500 : 3000);
};

// 召回掉出场地的物体
const handleRecallFallen = () => {
  const before = store.snapshotForHistory();
  const count = store.recallFallenObjects();
  if (count > 0) {
    store.pushHistory('召回掉落物体', before);
    showTempMessage(`已召回 ${count} 个掉出场地的物体`);
  } else {
    showTempMessage('没有掉出场地的物体', 2500);
  }
};

// 切换场地大小
const handleWorldSizeChange = (event) => {
  const size = Number(event.target.value);
  if (!Number.isFinite(size) || size === store.worldSize) return;

  const before = store.snapshotForHistory();
  store.pushHistory('切换场地尺寸', before);
  store.setWorldSize(size);
  showTempMessage(`场地已切换为 ${size} × ${size}`);
};

// 导入模型：编辑器内直接选（不再跳模型库页）。
// 选择写进 modelStore.selectedModelId，由下方 watch 消费——与「模型库页跳回
// 编辑器」是同一条导入链路，导入逻辑零重复。
const handleImportModel = () => {
  if (!isSceneInitialized.value) return;
  showImportDialog.value = true;
};

// 删除选中对象
const handleRemoveSelected = () => {
  if (!hasSelectedObject.value) return;

  const objectName = store.selectedObject?.name || '对象';

  const beforeCount = store.objects.length;
  const snapshot = store.snapshotForHistory();
  try {
    store.removeSelectedObject();
  } catch {
    // 删除失败时走下面的“未删除”分支，不谎报成功
  }
  const afterCount = store.objects.length;

  if (afterCount < beforeCount) {
    store.pushHistory(`删除 ${objectName}`, snapshot);
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
    console.warn('[Toolbar] 场景保存失败', error)
    reportError(error, '/scene-editor')
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
    console.warn('[Toolbar] 导出场景失败', error)
    reportError(error, '/scene-editor')
    showTempMessage('导出场景失败', 3000);
  }
};

// 导入场景 JSON：文件选择 → 运行时校验 → 本地库 → 重建世界
const handleImportClick = () => {
  if (!isSceneInitialized.value) return;
  fileInput.value?.click();
};

const handleImportFile = async (event) => {
  const input = event.target;
  const file = input.files?.[0];
  if (!file) return;

  const snapshot = store.snapshotForHistory();
  try {
    const parsed = parseSceneDocumentJson(await file.text());
    if (!parsed.ok) {
      showTempMessage(`导入失败：${parsed.error}`, 6000);
      return;
    }

    // 先收进本地库（出现在「我的场景」），再重建世界
    store.importSceneDocument(parsed.document);
    const result = await store.loadSceneDocument(parsed.document);
    if (!result.ok) {
      showTempMessage(`导入失败：${result.reason ?? '场景无法重建'}`, 6000);
      return;
    }

    store.pushHistory(`导入场景 ${parsed.document.name}`, snapshot);
    showTempMessage(
      `已导入「${parsed.document.name}」：${result.restored}/${result.total} 个物体`,
      4000,
    );
  } catch (error) {
    console.warn('[Toolbar] 导入场景失败', error);
    reportError(error, '/scene-editor');
    showTempMessage('导入失败：文件读取错误', 5000);
  } finally {
    // 清空 value：同一个文件改完再导入也能触发 change
    input.value = '';
  }
};

// 导入「模型库交接过来的模型」
//
// 模型库把选中的模型写进 modelStore.selectedModelId，再跳回场景编辑器；
// 场景就绪后在这里完成导入。
//
// 导入必须走 useSceneEditor 的 importModel：它会连同 Rapier 刚体与包围盒碰撞体
// 一起建好。直接往 store 里塞对象只会得到一个不会下落、不会碰撞的空壳。
//
// 监听的是「选中的模型」而不是路由：场景编辑器可能是在模型库之后才挂载的，
// 那时路由早已切换完，路由监听器永远不会触发。
watch(
  () => [isSceneInitialized.value, modelStore.selectedModelId],
  async ([ready, modelId]) => {
    if (!ready || !modelId || importingModel.value) return;

    const modelInfo = modelStore.getModelById(modelId);
    if (!modelInfo) {
      modelStore.selectedModelId = null;
      showTempMessage('选中的模型已不存在', 3000);
      return;
    }

    importingModel.value = true;
    const snapshot = store.snapshotForHistory();
    try {
      const success = await importModel(modelId);
      if (success) store.pushHistory(`导入模型 ${modelInfo.name}`, snapshot);
      showTempMessage(
        success ? `模型 "${modelInfo.name}" 导入成功` : `模型 "${modelInfo.name}" 导入失败`,
        success ? 2000 : 3000,
      );
    } finally {
      // 清除选中状态，避免同一个模型被重复导入
      modelStore.selectedModelId = null;
      importingModel.value = false;
    }
  },
  { immediate: true },
);
</script>

<style scoped>
/*
 * 底色、边框、内边距与组间距由 app-global.css 的工作台骨架类 .ws-toolbar
 * 统一提供（SceneEditor 给根元素附加了 ws-toolbar），这里只保留差异部分。
 */
.toolbar {
  display: flex;
  align-items: center;
  height: 50px;
  color: var(--text-1);
}

.toolbar-group {
  display: flex;
  gap: 4px;
}

/* 组与组之间的分隔：靠兄弟选择器画一条淡分隔线，不再依赖纯间距猜分组 */
.toolbar-group + .toolbar-group {
  border-left: 1px solid var(--border-subtle);
  padding-left: 10px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background-color: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.2s;
  gap: 6px;
  padding: 0 8px;
}

.toolbar-btn:hover {
  background-color: var(--bg-hover);
}

.toolbar-btn:disabled {
  background-color: transparent;
  color: var(--text-3);
  cursor: not-allowed;
}

.toolbar-btn i {
  font-size: 16px;
}

.toolbar-world {
  align-items: center;
  gap: 6px;
}

.world-label {
  color: var(--text-3);
  font-size: 12px;
  white-space: nowrap;
}

.world-select {
  height: 30px;
  padding: 0 6px;
  border: 1px solid var(--border-subtle);
  border-radius: 4px;
  background-color: var(--bg-inset);
  color: var(--text-1);
  font-size: 12px;
  cursor: pointer;
}

.world-select:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.toolbar-file-input {
  display: none;
}

.toolbar-status {
  margin-left: auto;
  color: var(--text-2);
  font-size: 14px;
  padding: 4px 8px;
  border-radius: 4px;
  background-color: var(--bg-inset);
}
</style>
