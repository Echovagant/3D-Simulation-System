<template>
  <div class="model-library-container">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1>📦 3D模型资源库</h1>
      <p>浏览、管理和使用各类3D模型资产</p>
    </div>

    <!-- 下载反馈：成功与失败都写在这里，3 秒后自动消失 -->
    <div
      v-if="downloadNotice"
      class="download-notice"
      :class="`download-notice--${downloadNotice.type}`"
      role="status"
    >
      <i
        class="fas"
        :class="downloadNotice.type === 'success' ? 'fa-check-circle' : 'fa-exclamation-circle'"
      ></i>
      <span>{{ downloadNotice.message }}</span>
    </div>

    <!-- 模型分类标签 -->
    <div class="category-tabs">
      <button
        v-for="category in categories"
        :key="category.id"
        :class="['category-tab', { active: activeCategory === category.id }]"
        @click="activeCategory = category.id"
      >
        {{ category.icon }} {{ category.name }}
        <span class="model-count">({{ category.count }})</span>
      </button>
    </div>

    <!-- 操作工具栏 -->
    <div class="action-toolbar">
      <button class="primary-btn" @click="showUploadModal = true">
        <i class="fas fa-upload"></i> 上传新模型
      </button>
      <InfoTip
        label="关于导入模型的出生点"
        text="模型导入场景时落在随机出生点（X/Z 在 -2.5 ~ 2.5，Y = 2），不在原点；导入后用属性面板把它移到你要的位置。"
      />
      <span class="upload-hint">
        上传的模型使用浏览器对象 URL，<strong>仅在当前会话有效</strong>：刷新页面后失效。
      </span>
      <div class="search-filter">
        <input
          type="text"
          placeholder="搜索模型..."
          v-model="searchQuery"
          class="search-input"
        >
        <select v-model="sortOption" class="sort-select">
          <option value="name">按名称排序</option>
          <option value="date">按日期排序</option>
          <option value="size">按大小排序</option>
        </select>
      </div>
    </div>

    <!-- 模型网格展示 -->
    <div class="models-grid">
      <div
        class="model-card"
        v-for="model in filteredModels"
        :key="model.id"
        @click="selectModel(model)"
      >
        <div class="model-preview" :class="`model-preview--${model.category}`">
          <img
            :src="model.thumbnailUrl"
            :alt="model.name"
            class="model-thumbnail"
            loading="lazy"
          >
          <div class="model-actions">
            <button class="action-btn" @click.stop="handleAddToScene(model)">
              <i class="fas fa-plus"></i>
            </button>
            <button class="action-btn" @click.stop="handleDownloadModel(model)">
              <i class="fas fa-download"></i>
            </button>
            <button class="action-btn" @click.stop="handleDeleteModel(model)">
              <i class="fas fa-trash"></i>
            </button>
          </div>
        </div>
        <div class="model-info">
          <h3 class="model-name">{{ model.name }}</h3>
          <p class="model-meta">{{ modelMeta(model) }}</p>
          <p v-if="model.sessionOnly" class="session-badge">仅本次会话有效</p>
        </div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <div class="empty-state" v-if="filteredModels.length === 0">
      <i class="fas fa-box-open"></i>
      <h3>没有找到模型</h3>
      <p>尝试更改筛选条件或上传新模型</p>
      <button class="primary-btn" @click="showUploadModal = true">
        <i class="fas fa-upload"></i> 上传模型
      </button>
    </div>

    <!-- 上传模型模态框 -->
    <div class="modal-backdrop" v-if="showUploadModal" @click="showUploadModal = false">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>上传新模型</h2>
          <button class="close-btn" @click="showUploadModal = false">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <form @submit.prevent="handleUpload">
            <div class="form-group">
              <label for="modelName">模型名称</label>
              <input
                type="text"
                id="modelName"
                v-model="newModel.name"
                required
                placeholder="输入模型名称"
              >
            </div>
            <div class="form-group">
              <label for="modelCategory">模型类别</label>
              <select
                id="modelCategory"
                v-model="newModel.category"
                required
              >
                <option value="">选择类别</option>
                <option value="characters">角色</option>
                <option value="environments">环境</option>
                <option value="props">道具</option>
              </select>
            </div>
            <div class="form-group">
              <label for="modelFile">模型文件</label>
              <div class="file-upload-area">
                <input
                  type="file"
                  id="modelFile"
                  accept=".glb,.gltf,.obj,.fbx"
                  @change="handleFileSelect"
                  required
                >
                <div class="upload-placeholder" v-if="!selectedFileName">
                  <i class="fas fa-cloud-upload-alt"></i>
                  <p>拖放文件到这里或点击选择</p>
                  <p class="file-formats">支持 .glb, .gltf, .obj, .fbx 格式</p>
                </div>
                <div class="file-selected" v-if="selectedFileName">
                  <i class="fas fa-file"></i>
                  <span>{{ selectedFileName }}</span>
                  <button type="button" class="remove-file" @click="clearFileSelection">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
            </div>
            <div class="form-actions">
              <button type="button" class="cancel-btn" @click="showUploadModal = false">取消</button>
              <button type="submit" class="primary-btn" :disabled="isUploading || !isUploadFormValid">
                <span v-if="isUploading"><i class="fas fa-spinner fa-spin"></i> 上传中...</span>
                <span v-else>确认上传</span>
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>

    <!-- 模型详情模态框 -->
    <div class="modal-backdrop" v-if="selectedModel" @click="selectedModel = null">
      <div class="modal-content model-detail-modal" @click.stop>
        <div class="modal-header">
          <h2>{{ selectedModel.name }}</h2>
          <button class="close-btn" @click="selectedModel = null">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="model-detail-grid">
            <div class="model-preview-large" :class="`model-preview--${selectedModel.category}`">
              <!-- 这里可以集成3D预览组件 -->
              <img
                :src="selectedModel.thumbnailUrl"
                :alt="selectedModel.name"
                class="model-thumbnail-large"
              >
            </div>
            <div class="model-details">
              <table class="model-properties">
                <tbody>
                <tr>
                  <th>类别</th>
                  <td>{{ getCategoryName(selectedModel.category) }}</td>
                </tr>
                <tr>
                  <th>文件格式</th>
                  <td>{{ isPlaceholder(selectedModel) ? '—' : selectedModel.format }}</td>
                </tr>
                <tr>
                  <th>文件大小</th>
                  <td>{{ isPlaceholder(selectedModel) ? '—' : formatFileSize(selectedModel.size) }}</td>
                </tr>
                <tr>
                  <th>上传日期</th>
                  <td>{{ formatDate(selectedModel.uploadDate) }}</td>
                </tr>
                <tr>
                  <th>多边形数量</th>
                  <td>{{ geomStat(selectedModel, selectedModel.polyCount.toLocaleString()) }}</td>
                </tr>
                <tr>
                  <th>材质数量</th>
                  <td>{{ geomStat(selectedModel, String(selectedModel.materialCount)) }}</td>
                </tr>
                <tr>
                  <th>是否包含动画</th>
                  <td>{{ geomStat(selectedModel, selectedModel.hasAnimation ? '是' : '否') }}</td>
                </tr>
                </tbody>
              </table>

              <div class="detail-actions">
                <button
                  class="primary-btn full-width"
                  @click="handleAddToScene(selectedModel); selectedModel = null"
                >
                  <i class="fas fa-plus"></i> 添加到场景编辑器
                </button>
                <button
                  class="secondary-btn full-width"
                  @click="handleDownloadModel(selectedModel)"
                >
                  <i class="fas fa-download"></i> 下载模型文件
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup name="ModelLibrary">
import { ref, computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useModelStore } from '@/stores/modelStore';
import { isPlaceholderModel } from '@/data/modelLibrary';
import { resolveModelUrl } from '@/utils/modelLoader';
import { reportError } from '@/services/api/telemetry';
import { formatFileSize, formatDate } from '@/utils/formatHelpers';
import InfoTip from '@/components/common/InfoTip.vue';

// ===================== 类型定义 =====================
interface Model {
  id: string;
  name: string;
  thumbnailUrl: string;
  category: 'characters' | 'environments' | 'props';
  /** 模型文件地址；'#' 表示占位条目（没有可加载的文件） */
  modelUrl: string;
  format: string;
  size: number;
  uploadDate: string;
  polyCount: number;
  materialCount: number;
  hasAnimation: boolean;
  description?: string; // 可选描述
  /** 本次会话上传的模型（对象 URL，刷新即失效） */
  sessionOnly?: boolean;
}

// 上传参数接口 - 明确file可以为null
interface UploadModelForm {
  name: string;
  category: 'characters' | 'environments' | 'props' | '';
  file: File | null;
}

// 实际上传到服务器的参数类型
interface UploadModelParams {
  name: string;
  category: 'characters' | 'environments' | 'props';
  file: File;
}

// ===================== 状态与响应式变量 =====================
const modelStore = useModelStore();
const router = useRouter();

// 分类数据
const categories = [
  { id: 'all', name: '全部模型', icon: '📁', count: computed(() => modelStore.models.length) },
  { id: 'characters', name: '角色模型', icon: '👤', count: computed(() => modelStore.models.filter(m => m.category === 'characters').length) },
  { id: 'environments', name: '环境模型', icon: '🌎', count: computed(() => modelStore.models.filter(m => m.category === 'environments').length) },
  { id: 'props', name: '道具模型', icon: '🔨', count: computed(() => modelStore.models.filter(m => m.category === 'props').length) }
];

// 响应式状态
const activeCategory = ref<string>('all');
const searchQuery = ref<string>('');
const sortOption = ref<string>('name');
const showUploadModal = ref<boolean>(false);
const selectedModel = ref<Model | null>(null);
const isUploading = ref<boolean>(false);
const selectedFileName = ref<string>('');

/** 下载反馈：成功与失败都写在这里，不用 alert 弹窗打断操作 */
const downloadNotice = ref<{ type: 'success' | 'error'; message: string } | null>(null);
let downloadNoticeTimer: number | undefined;

// 新模型上传表单 - 使用正确的类型定义
const newModel = ref<UploadModelForm>({
  name: '',
  category: '',
  file: null
});

// 表单验证状态
const isUploadFormValid = computed<boolean>(() => {
  return !!newModel.value.name &&
         !!newModel.value.category &&
         newModel.value.file !== null;
});

// ===================== 计算属性与方法 =====================
const filteredModels = computed<Model[]>(() => {
  let result = [...modelStore.models] as Model[];

  // 按类别筛选
  if (activeCategory.value !== 'all') {
    result = result.filter(model => model.category === activeCategory.value);
  }

  // 按搜索词筛选
  if (searchQuery.value) {
    const query = searchQuery.value.toLowerCase();
    result = result.filter(model =>
      model.name.toLowerCase().includes(query) ||
      (model.description && model.description.toLowerCase().includes(query))
    );
  }

  // 排序
  return result.sort((a, b) => {
    switch (sortOption.value) {
      case 'name':
        return a.name.localeCompare(b.name);
      case 'date':
        return new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime();
      case 'size':
        return b.size - a.size;
      default:
        return 0;
    }
  });
});

const selectModel = (model: Model) => {
  selectedModel.value = model;
};

const handleFileSelect = (e: Event) => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0] || null;
  if (file) {
    newModel.value.file = file;
    selectedFileName.value = file.name;

    // 自动填充模型名称（如果未填写）
    if (!newModel.value.name) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      newModel.value.name = nameWithoutExt;
    }
  }
};

const clearFileSelection = () => {
  newModel.value.file = null;
  selectedFileName.value = '';
  const fileInput = document.getElementById('modelFile') as HTMLInputElement;
  if (fileInput) fileInput.value = '';
};

const handleUpload = async () => {
  // 额外的类型检查，确保file不是null
  if (!newModel.value.name || !newModel.value.category || !newModel.value.file) return;

  isUploading.value = true;

  try {
    // 类型断言，因为我们已经通过前面的检查确保了file存在
    const uploadParams = newModel.value as unknown as UploadModelParams;
    await modelStore.uploadModel(uploadParams);

    // 上传成功后重置表单并关闭模态框
    newModel.value = { name: '', category: '', file: null };
    selectedFileName.value = '';
    showUploadModal.value = false;
  } catch (error) {
    console.warn('[ModelLibrary] 模型上传失败', error)
    reportError(error, '/model-library')
    alert('模型上传失败，请重试');
  } finally {
    isUploading.value = false;
  }
};

const handleAddToScene = (model: Model) => {
  // 把选中的模型交给场景编辑器去导入。
  // 导入走 useSceneEditor 的 importModel：它会连同 Rapier 刚体与包围盒碰撞体一起建好；
  // 直接往场景里塞对象只会得到一个不会下落、不会碰撞的空壳。
  modelStore.selectedModelId = model.id;
  router.push('/scene-editor');
};

/**
 * 下载文件名：模型名 + 小写扩展名。
 *
 * 名字里的路径分隔符要去掉——它会直接进 <a download>，
 * 留着就可能把文件写到别处去。扩展名取自 format 字段（GLB → .glb）。
 */
const buildDownloadFileName = (model: Model): string => {
  const safeName = model.name.replace(/[\\/:*?"<>|]/g, '_').trim() || 'model';
  const format = (model.format || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (format && format !== 'unknown') return `${safeName}.${format}`;

  // format 不可信时退回到地址上的扩展名：宁可没有扩展名，也不要写一个错的
  const fromUrl = model.modelUrl.split(/[?#]/)[0].match(/\.([a-z0-9]+)$/i)?.[1]?.toLowerCase();
  return fromUrl ? `${safeName}.${fromUrl}` : safeName;
};

/**
 * 取模型文件的字节。
 *
 * 入参是**已解析过**的地址：站内绝对路径要拼 BASE_URL（子路径部署时否则 404），
 * 这一步由 resolveModelUrl 负责。
 */
const fetchModelBlob = async (url: string): Promise<Blob> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  return await response.blob();
};

/** 触发浏览器把某个地址存成文件 */
const triggerUrlDownload = (url: string, fileName: string): void => {
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
};

/**
 * 把字节交给浏览器下载。
 *
 * 浏览器可能到 click() 之后才真正开始读这个 blob，
 * 立刻 revoke 会让下载变成 0 字节——因此延后回收。
 */
const triggerBlobDownload = (blob: Blob, fileName: string): void => {
  const objectUrl = URL.createObjectURL(blob);
  triggerUrlDownload(objectUrl, fileName);
  window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
};

/** 显示一条下载反馈，3 秒后自动消失 */
const showDownloadNotice = (type: 'success' | 'error', message: string): void => {
  downloadNotice.value = { type, message };
  if (downloadNoticeTimer !== undefined) {
    window.clearTimeout(downloadNoticeTimer);
  }
  downloadNoticeTimer = window.setTimeout(() => {
    downloadNotice.value = null;
    downloadNoticeTimer = undefined;
  }, 3000);
};

onUnmounted(() => {
  if (downloadNoticeTimer !== undefined) {
    window.clearTimeout(downloadNoticeTimer);
  }
});

/**
 * 下载模型文件：真的把文件存到本地。
 *
 * 站内地址走 fetch：非 2xx 与网络失败都能变成一条明确的失败提示，
 * 而不是浏览器静悄悄地什么都不做。
 *
 * 会话上传的模型是 blob: 地址，**不能**走 fetch——
 * 应用的 CSP `connect-src` 里没有 blob:，浏览器会把 fetch 直接拦掉。
 * 这种地址原样交给 <a download>，由浏览器自己去取字节。
 */
const handleDownloadModel = async (model: Model): Promise<void> => {
  const fileName = buildDownloadFileName(model);
  const url = resolveModelUrl(model.modelUrl);

  try {
    if (model.modelUrl.startsWith('blob:')) {
      triggerUrlDownload(url, fileName);
    } else {
      const blob = await fetchModelBlob(url);
      triggerBlobDownload(blob, fileName);
    }
    showDownloadNotice('success', `已下载：${fileName}`);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    showDownloadNotice('error', `下载失败：${reason}`);
  }
};

const handleDeleteModel = (model: Model) => {
  if (confirm(`确定要删除模型 "${model.name}" 吗？此操作不可撤销。`)) {
    modelStore.deleteModel(model.id);
  }
};

const getCategoryName = (categoryId: 'characters' | 'environments' | 'props') => {
  const category = categories.find(c => c.id === categoryId);
  return category ? category.name : '未知类别';
};

/**
 * 占位条目没有可加载的文件，因此不报告任何文件属性。
 * 界面显示「—」而不是一组看起来很真的假数字。
 */
const isPlaceholder = isPlaceholderModel;

/** 会话上传的模型没有做几何分析，面数/材质/动画是未知的 */
const statsPending = (model: Model): boolean => model.sessionOnly === true;

/**
 * 面数 / 材质数 / 动画的显示值。
 *
 * 三种状态各有各的实话可说：
 * - 占位条目：没有文件 → 「—」
 * - 会话上传：文件在，但没解析过几何 → 「待分析」
 * - 内置模型：数值真实，且由 verify:model-metadata 闸门逐项核对过
 */
const geomStat = (model: Model, value: string): string =>
  isPlaceholder(model) ? '—' : statsPending(model) ? '待分析' : value;

/** 卡片副标题：占位条目如实说明状态，其余显示真实文件属性 */
const modelMeta = (model: Model): string =>
  isPlaceholder(model)
    ? '占位条目 · 暂无可加载文件'
    : `${formatFileSize(model.size)} · ${formatDate(model.uploadDate)}`;
</script>

<style scoped>
.model-library-container {
  width: 100%;
  max-width: 1400px;
  margin: 0 auto;
  padding: 20px;
}

.page-header {
  text-align: center;
  margin-bottom: 30px;
  color: var(--text-2);
}

.page-header h1 {
  font-size: 2.2rem;
  margin-bottom: 10px;
  color: var(--text-1);
}

.page-header p {
  font-size: 1.1rem;
  color: var(--text-2);
}

/* 下载反馈条：成功与失败用两套配色，3 秒后自动消失 */
.download-notice {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 20px;
  padding: 10px 14px;
  border-radius: 8px;
  font-size: 0.9rem;
  border: 1px solid transparent;
}

.download-notice--success {
  color: var(--success);
  background-color: var(--bg-panel-raised);
  border-color: var(--success);
}

.download-notice--error {
  color: var(--danger);
  background-color: var(--bg-panel-raised);
  border-color: var(--danger);
}

.category-tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 25px;
  overflow-x: auto;
  padding-bottom: 10px;
}

.category-tab {
  padding: 10px 20px;
  background-color: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: all 0.3s ease;
}

.category-tab.active {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
  font-weight: bold;
  box-shadow: 0 4px 8px rgba(var(--accent-rgb), 0.3);
}

.category-tab:hover:not(.active) {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-1);
  transform: translateY(-2px);
}

.model-count {
  font-size: 0.85rem;
  color: var(--text-3);
}

.action-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  flex-wrap: wrap;
  gap: 15px;
}

.upload-hint {
  font-size: 0.8rem;
  color: var(--warning);
  background-color: var(--accent-2-soft);
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  padding: 6px 10px;
}

.session-badge {
  display: inline-block;
  margin: 6px 0 0 0;
  font-size: 0.72rem;
  color: var(--warning);
  background-color: var(--accent-2-soft);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 2px 6px;
}

.search-filter {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.search-input {
  padding: 10px 15px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--bg-inset);
  color: var(--text-1);
  min-width: 250px;
  font-size: 1rem;
}

.search-input::placeholder {
  color: var(--text-3);
}

.search-input:focus,
.sort-select:focus {
  border-color: var(--accent);
  outline: none;
}

.sort-select {
  padding: 10px 15px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--bg-inset);
  color: var(--text-1);
  font-size: 1rem;
  cursor: pointer;
}

/* 下拉展开项跟主题走，避免系统默认白底下出现浅色文字 */
.sort-select option,
.form-group select option {
  background-color: var(--bg-panel);
  color: var(--text-1);
}

.models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 25px;
  margin-bottom: 40px;
}

.model-card {
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  overflow: hidden;
  box-shadow: var(--shadow-panel);
  transition: all 0.3s ease;
  cursor: pointer;
  position: relative;
}

.model-card:hover {
  border-color: var(--accent);
  transform: translateY(-5px);
  box-shadow: var(--shadow-pop);
}

.model-preview {
  position: relative;
  height: 160px;
  overflow: hidden;
  background-color: var(--bg-inset);
}

/*
 * 分类底色是缩略图的背景层。
 * 卡片上看到的就是点进去加载到的东西（透明底渲染图叠在这层底色上）；
 * 底色全部走令牌：角色=靛紫、环境=琥珀、道具=中性嵌入底。
 */
.model-preview--characters,
.model-preview-large.model-preview--characters {
  background-color: var(--accent-soft);
}

.model-preview--environments,
.model-preview-large.model-preview--environments {
  background-color: var(--accent-2-soft);
}

.model-preview--props,
.model-preview-large.model-preview--props {
  background-color: var(--bg-inset);
}

.model-thumbnail {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}

.model-card:hover .model-thumbnail {
  transform: scale(1.05);
}

.model-actions {
  position: absolute;
  top: 10px;
  right: 10px;
  display: flex;
  gap: 5px;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.model-card:hover .model-actions {
  opacity: 1;
}

.action-btn {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  /* 浮在缩略图上的遮罩圆钮：半透明黑是元素自带底色，与模态遮罩同源 */
  background-color: rgba(0, 0, 0, 0.7);
  color: #ffffff;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background-color: var(--accent-strong);
  color: #ffffff;
}

.model-info {
  padding: 15px;
}

.model-name {
  font-size: 1.1rem;
  margin-bottom: 5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-meta {
  font-size: 0.85rem;
  color: var(--text-3);
  display: flex;
  justify-content: space-between;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}

.empty-state i {
  font-size: 4rem;
  color: var(--text-3);
  margin-bottom: 20px;
}

.empty-state h3 {
  font-size: 1.5rem;
  margin-bottom: 10px;
  color: var(--text-1);
}

.empty-state p {
  font-size: 1rem;
  color: var(--text-2);
  margin-bottom: 30px;
}

/* 按钮样式 */
.primary-btn {
  padding: 10px 20px;
  background-color: var(--accent-strong);
  /* 主色实底上的白字：项目约定写法（见 simulation-panel-kit.css 的 .sim-t-on-accent） */
  color: #ffffff;
  border: none;
  border-radius: var(--radius-md);
  font-weight: bold;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.primary-btn:hover {
  background-color: var(--accent-strong-hover);
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(var(--accent-rgb), 0.25);
}

.primary-btn:disabled {
  background-color: var(--bg-inset);
  color: var(--text-3);
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.secondary-btn {
  padding: 10px 20px;
  background-color: transparent;
  color: var(--text-1);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.secondary-btn:hover {
  background-color: var(--bg-hover);
  border-color: var(--accent);
}

.cancel-btn {
  padding: 10px 20px;
  background-color: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-strong);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn:hover {
  background-color: var(--bg-hover);
  color: var(--text-1);
}

.full-width {
  width: 100%;
  justify-content: center;
}

/* 模态框样式 */
.modal-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  /* 遮罩是元素自带底色，允许黑色 rgba */
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: var(--shadow-panel);
}

.model-detail-modal {
  max-width: 900px;
}

.modal-header {
  padding: 20px;
  border-bottom: 1px solid var(--border-subtle);
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
  color: var(--text-1);
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: var(--text-2);
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: var(--text-1);
}

.modal-body {
  padding: 20px;
}

/* 表单样式 */
.form-group {
  margin-bottom: 20px;
}

.form-group label {
  display: block;
  margin-bottom: 8px;
  font-weight: 500;
  color: var(--text-1);
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 12px 15px;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--bg-inset);
  color: var(--text-1);
  font-size: 1rem;
}

.form-group input:focus,
.form-group select:focus {
  border-color: var(--accent);
  outline: none;
}

.form-group input::placeholder {
  color: var(--text-3);
}

.file-upload-area {
  border: 2px dashed var(--border-strong);
  border-radius: var(--radius-md);
  background-color: var(--bg-inset);
  padding: 30px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-upload-area:hover {
  border-color: var(--accent);
  background-color: var(--accent-soft);
}

.file-upload-area input {
  display: none;
}

.upload-placeholder i {
  font-size: 2.5rem;
  color: var(--text-3);
  margin-bottom: 15px;
}

.upload-placeholder p {
  margin: 0 0 5px 0;
  color: var(--text-2);
}

.file-formats {
  font-size: 0.85rem;
  color: var(--text-3);
}

.file-selected {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  background-color: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.file-selected i {
  color: var(--text-2);
  margin-right: 10px;
}

.remove-file {
  background: none;
  border: none;
  color: var(--danger);
  cursor: pointer;
  padding: 5px;
}

.form-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 30px;
}

/* 模型详情样式 */
.model-detail-grid {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 25px;
}

.model-preview-large {
  border-radius: 8px;
  overflow: hidden;
  display: flex;
  align-items: center;
  justify-content: center;
  min-height: 300px;
}

.model-thumbnail-large {
  width: 100%;
  height: 100%;
  object-fit: contain;
}

.model-properties {
  width: 100%;
  border-collapse: collapse;
  margin-bottom: 25px;
}

.model-properties th,
.model-properties td {
  padding: 12px 15px;
  text-align: left;
  color: var(--text-1);
  border-bottom: 1px solid var(--border-subtle);
}

.model-properties th {
  width: 35%;
  font-weight: 600;
  color: var(--text-3);
}

.detail-actions {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

/* 响应式调整 */
@media (max-width: 768px) {
  .models-grid {
    grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  }

  .action-toolbar {
    flex-direction: column;
    align-items: stretch;
  }

  .search-input {
    min-width: 100%;
  }

  .model-detail-grid {
    grid-template-columns: 1fr;
  }

  .form-actions {
    flex-direction: column;
  }

  .form-actions button {
    width: 100%;
  }
}
</style>
