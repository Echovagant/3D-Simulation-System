<template>
  <div class="model-library-container">
    <!-- 页面标题 -->
    <div class="page-header">
      <h1>📦 3D模型资源库</h1>
      <p>浏览、管理和使用各类3D模型资产</p>
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
        <div class="model-preview">
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
          <p class="model-meta">{{ formatFileSize(model.size) }} · {{ formatDate(model.uploadDate) }}</p>
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
            <div class="model-preview-large">
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
                  <td>{{ selectedModel.format }}</td>
                </tr>
                <tr>
                  <th>文件大小</th>
                  <td>{{ formatFileSize(selectedModel.size) }}</td>
                </tr>
                <tr>
                  <th>上传日期</th>
                  <td>{{ formatDate(selectedModel.uploadDate) }}</td>
                </tr>
                <tr>
                  <th>多边形数量</th>
                  <td>{{ selectedModel.polyCount.toLocaleString() }}</td>
                </tr>
                <tr>
                  <th>材质数量</th>
                  <td>{{ selectedModel.materialCount }}</td>
                </tr>
                <tr>
                  <th>是否包含动画</th>
                  <td>{{ selectedModel.hasAnimation ? '是' : '否' }}</td>
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
import { ref, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useModelStore } from '@/stores/modelStore';
import { formatFileSize, formatDate } from '@/utils/formatHelpers';

// ===================== 类型定义 =====================
interface Model {
  id: string;
  name: string;
  thumbnailUrl: string;
  category: 'characters' | 'environments' | 'props';
  format: string;
  size: number;
  uploadDate: string;
  polyCount: number;
  materialCount: number;
  hasAnimation: boolean;
  description?: string; // 可选描述
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
    console.error('上传失败:', error);
    alert('模型上传失败，请重试');
  } finally {
    isUploading.value = false;
  }
};

const handleAddToScene = (model: Model) => {
  modelStore.addModelToScene(model.id);
  router.push('/scene-editor');
};

const handleDownloadModel = (model: Model) => {
  console.log(`下载模型: ${model.name}`);
  alert(`开始下载模型: ${model.name}`);
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
  color: #333;
}

.page-header h1 {
  font-size: 2.2rem;
  margin-bottom: 10px;
  color: #000;
}

.page-header p {
  font-size: 1.1rem;
  color: #666;
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
  background-color: rgba(0, 0, 0, 0.6);
  color: #FFD700;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 8px;
  white-space: nowrap;
  transition: all 0.3s ease;
}

.category-tab.active {
  background-color: #FFD700;
  color: #000;
  font-weight: bold;
  box-shadow: 0 4px 8px rgba(255, 215, 0, 0.3);
}

.category-tab:hover:not(.active) {
  background-color: rgba(0, 0, 0, 0.8);
  transform: translateY(-2px);
}

.model-count {
  font-size: 0.85rem;
  opacity: 0.8;
}

.action-toolbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 25px;
  flex-wrap: wrap;
  gap: 15px;
}

.search-filter {
  display: flex;
  gap: 10px;
  align-items: center;
  flex-wrap: wrap;
}

.search-input {
  padding: 10px 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  min-width: 250px;
  font-size: 1rem;
}

.sort-select {
  padding: 10px 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  background-color: white;
  font-size: 1rem;
  cursor: pointer;
}

.models-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 25px;
  margin-bottom: 40px;
}

.model-card {
  background-color: white;
  border-radius: 12px;
  overflow: hidden;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  transition: all 0.3s ease;
  cursor: pointer;
  position: relative;
}

.model-card:hover {
  transform: translateY(-5px);
  box-shadow: 0 8px 20px rgba(0, 0, 0, 0.15);
}

.model-preview {
  position: relative;
  height: 160px;
  overflow: hidden;
  background-color: #f5f5f5;
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
  background-color: rgba(0, 0, 0, 0.7);
  color: white;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background-color: #FFD700;
  color: #000;
}

.model-info {
  padding: 15px;
}

.model-name {
  font-size: 1.1rem;
  margin-bottom: 5px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-meta {
  font-size: 0.85rem;
  color: #666;
  display: flex;
  justify-content: space-between;
}

.empty-state {
  text-align: center;
  padding: 60px 20px;
  background-color: white;
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
}

.empty-state i {
  font-size: 4rem;
  color: #ddd;
  margin-bottom: 20px;
}

.empty-state h3 {
  font-size: 1.5rem;
  margin-bottom: 10px;
  color: #333;
}

.empty-state p {
  font-size: 1rem;
  color: #666;
  margin-bottom: 30px;
}

/* 按钮样式 */
.primary-btn {
  padding: 10px 20px;
  background-color: #FFD700;
  color: #000;
  border: none;
  border-radius: 8px;
  font-weight: bold;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.primary-btn:hover {
  background-color: #e6c200;
  transform: translateY(-2px);
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
}

.primary-btn:disabled {
  background-color: #ccc;
  cursor: not-allowed;
  transform: none;
  box-shadow: none;
}

.secondary-btn {
  padding: 10px 20px;
  background-color: #f0f0f0;
  color: #333;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 8px;
  transition: all 0.2s ease;
}

.secondary-btn:hover {
  background-color: #e0e0e0;
}

.cancel-btn {
  padding: 10px 20px;
  background-color: #f8f8f8;
  color: #666;
  border: 1px solid #ddd;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.cancel-btn:hover {
  background-color: #f0f0f0;
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
  background-color: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.modal-content {
  background-color: white;
  border-radius: 12px;
  width: 100%;
  max-width: 600px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 10px 30px rgba(0, 0, 0, 0.2);
}

.model-detail-modal {
  max-width: 900px;
}

.modal-header {
  padding: 20px;
  border-bottom: 1px solid #eee;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.modal-header h2 {
  margin: 0;
  font-size: 1.5rem;
}

.close-btn {
  background: none;
  border: none;
  font-size: 1.5rem;
  cursor: pointer;
  color: #666;
  transition: color 0.2s ease;
}

.close-btn:hover {
  color: #000;
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
  color: #333;
}

.form-group input,
.form-group select {
  width: 100%;
  padding: 12px 15px;
  border: 1px solid #ddd;
  border-radius: 8px;
  font-size: 1rem;
}

.file-upload-area {
  border: 2px dashed #ddd;
  border-radius: 8px;
  padding: 30px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
}

.file-upload-area:hover {
  border-color: #FFD700;
  background-color: #fff8e6;
}

.file-upload-area input {
  display: none;
}

.upload-placeholder i {
  font-size: 2.5rem;
  color: #ccc;
  margin-bottom: 15px;
}

.upload-placeholder p {
  margin: 0 0 5px 0;
  color: #666;
}

.file-formats {
  font-size: 0.85rem;
  color: #999;
}

.file-selected {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px;
  background-color: #f5f5f5;
  border-radius: 8px;
}

.file-selected i {
  color: #666;
  margin-right: 10px;
}

.remove-file {
  background: none;
  border: none;
  color: #e74c3c;
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
  background-color: #f5f5f5;
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
  border-bottom: 1px solid #eee;
}

.model-properties th {
  width: 35%;
  font-weight: 600;
  color: #666;
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
