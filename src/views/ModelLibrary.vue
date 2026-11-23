<template>
  <div class="model-library-container">
    <!-- 页面标题 -->
    <PageHeader title="3D 模型资源库" lead="浏览、管理和使用各类 3D 模型资产" />

    <!-- 反馈条：下载成败（3 秒自清）与上传失败（可手动关）共用一条通道 -->
    <AppNotice
      v-if="downloadNotice"
      :type="downloadNotice.type === 'success' ? 'success' : 'danger'"
      :message="downloadNotice.message"
      class="library-notice"
    />
    <AppNotice
      v-else-if="uploadNotice"
      type="danger"
      :message="uploadNotice"
      dismissible
      class="library-notice"
      @dismiss="uploadNotice = null"
    />

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

    <!-- 操作工具栏：上行是「动作 + 过滤」，会话提示降级为下方警示条 -->
    <div class="action-toolbar">
      <div class="toolbar-actions">
        <button class="primary-btn" @click="showUploadModal = true">
          <i class="fas fa-upload"></i> 上传新模型
        </button>
        <button class="primary-btn" @click="openGenerateModal" title="单张图片生成 3D 模型（TripoSR 本地推理）">
          <i class="fas fa-wand-magic-sparkles"></i> AI 生成
        </button>
        <InfoTip
          label="关于导入模型的出生点"
          text="模型导入场景时落在随机出生点（X/Z 在 -2.5 ~ 2.5，Y = 2），不在原点；导入后用属性面板把它移到你要的位置。"
        />
      </div>
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

    <AppNotice
      type="warning"
      message="接入后端时上传的模型自动持久化（刷新后仍在）；后端不可达时回退为会话内对象 URL，仅在当前会话有效、刷新后失效。"
      class="library-notice"
    />

    <!-- 模型网格展示 -->
    <div class="models-grid">
      <div
        class="model-card"
        :class="{ 'model-card--placeholder': isPlaceholder(model) }"
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
        </div>
        <div class="model-info">
          <div class="model-name-row">
            <h3 class="model-name">{{ model.name }}</h3>
            <span v-if="model.aiGenerated" class="ai-badge">AI 生成</span>
            <span v-if="isPlaceholder(model)" class="placeholder-badge">不可加载</span>
          </div>
          <p class="model-meta">{{ modelMeta(model) }}</p>
          <div class="model-foot">
            <p v-if="model.sessionOnly" class="session-badge">仅本次会话有效</p>
            <p v-else-if="model.persisted" class="session-badge persisted-badge">已持久化</p>
            <!-- 删除走两段式行内确认，替代原生 confirm() -->
            <div v-if="pendingDeleteId === model.id" class="model-confirm">
              <span class="confirm-text">确认删除？</span>
              <button class="action-btn action-btn--confirm" @click.stop="confirmDeleteModel(model)" title="确认删除" aria-label="确认删除">
                <i class="fas fa-check"></i>
              </button>
              <button class="action-btn" @click.stop="pendingDeleteId = null" title="取消" aria-label="取消删除">
                <i class="fas fa-times"></i>
              </button>
            </div>
            <div v-else class="model-actions">
              <button class="action-btn" @click.stop="handleAddToScene(model)" title="添加到场景编辑器" aria-label="添加到场景编辑器">
                <i class="fas fa-plus"></i>
              </button>
              <button
                v-if="!isPlaceholder(model)"
                class="action-btn"
                @click.stop="openPreview(model)"
                title="3D 预览"
                aria-label="3D 预览"
              >
                <i class="fas fa-cube"></i>
              </button>
              <button
                v-if="!isPlaceholder(model)"
                class="action-btn"
                @click.stop="handleDownloadModel(model)"
                title="下载模型文件"
                aria-label="下载模型文件"
              >
                <i class="fas fa-download"></i>
              </button>
              <button class="action-btn action-btn--danger" @click.stop="handleDeleteClick(model)" title="删除模型" aria-label="删除模型">
                <i class="fas fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 空状态提示 -->
    <EmptyState
      v-if="filteredModels.length === 0"
      icon="fa-solid fa-box-open"
      title="没有找到模型"
      description="尝试更改筛选条件或上传新模型"
      class="models-empty"
    >
      <template #cta>
        <button class="primary-btn" @click="showUploadModal = true">
          <i class="fas fa-upload"></i> 上传模型
        </button>
      </template>
    </EmptyState>

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
          <AppNotice
            v-if="uploadNotice"
            type="danger"
            :message="uploadNotice"
            dismissible
            class="modal-notice"
            @dismiss="uploadNotice = null"
          />
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

    <!-- AI 生成模型模态框（TripoSR 本地推理） -->
    <div class="modal-backdrop" v-if="showGenerateModal" @click="closeGenerateModal">
      <div class="modal-content" @click.stop>
        <div class="modal-header">
          <h2>AI 生成模型（单图 → 3D）</h2>
          <button class="close-btn" @click="closeGenerateModal">
            <i class="fas fa-times"></i>
          </button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label for="generateProvider">生成通道</label>
            <select id="generateProvider" v-model="generateProvider" :disabled="isGenerating">
              <option value="local">本地 TripoSR（图片不出本机，免费）</option>
              <option value="hunyuan3d">腾讯混元生 3D（云端，有免费积分）</option>
              <option value="bailian-tripo">阿里百炼 Tripo（云端，按量计费）</option>
            </select>
          </div>
          <AppNotice
            v-if="generateProvider === 'local'"
            type="warning"
            message="TripoSR 在本机推理：图片不会离开这台电脑。CPU 推理约 1-5 分钟；生成的模型与上传模型一样只在当前会话有效。"
            class="modal-notice"
          />
          <AppNotice
            v-else-if="cloudReady === false"
            type="warning"
            :message="cloudError"
            class="modal-notice"
          />
          <template v-else-if="activeCloudProvider">
            <div class="form-group">
              <p>{{ activeCloudProvider.freeTier || '无免费额度' }}</p>
              <p>{{ activeCloudProvider.costNote }}</p>
              <p>{{ activeCloudProvider.licenseNote }}</p>
              <p v-if="activeCloudProvider.note">{{ activeCloudProvider.note }}</p>
            </div>
            <details class="key-config">
              <summary>
                密钥（BYOK）——{{ activeCloudProvider.name }}
                {{ providerConfigured ? '已托管 ✓' : '未托管' }}
              </summary>
              <div class="form-group" v-if="generateProvider === 'hunyuan3d'">
                <label for="hunyuanSecretId">SecretId</label>
                <input
                  type="text"
                  id="hunyuanSecretId"
                  v-model="keyForm.secretId"
                  placeholder="云 API 密钥控制台创建"
                  autocomplete="off"
                >
                <label for="hunyuanSecretKey">SecretKey</label>
                <input
                  type="password"
                  id="hunyuanSecretKey"
                  v-model="keyForm.secretKey"
                  placeholder="与 SecretId 同一对密钥"
                  autocomplete="new-password"
                >
              </div>
              <div class="form-group" v-else>
                <label for="bailianApiKey">百炼 API Key（sk- 开头）</label>
                <input
                  type="password"
                  id="bailianApiKey"
                  v-model="keyForm.apiKey"
                  placeholder="百炼控制台创建"
                  autocomplete="new-password"
                >
                <label for="bailianWorkspaceId">WorkspaceId（可选）</label>
                <input
                  type="text"
                  id="bailianWorkspaceId"
                  v-model="keyForm.workspaceId"
                  placeholder="留空走通用网关"
                  autocomplete="off"
                >
              </div>
              <div class="form-group">
                <label for="cloudPassphrase">托管口令（后端未配 master key 时必填）</label>
                <input
                  type="password"
                  id="cloudPassphrase"
                  v-model="keyForm.passphrase"
                  placeholder="服务端加密密钥用的口令，不落盘"
                  autocomplete="new-password"
                >
              </div>
              <p>key 只交给后端加密保存（库里只有密文）；生成请求由后端出网调用，明文不回传浏览器。</p>
              <AppNotice
                v-if="keyNotice"
                :type="keyNotice.type"
                :message="keyNotice.message"
                dismissible
                class="modal-notice"
                @dismiss="keyNotice = null"
              />
              <div class="form-actions">
                <button
                  type="button"
                  class="secondary-btn"
                  :disabled="keyBusy"
                  @click="saveCloudKey"
                >
                  <span v-if="keyBusy"><i class="fas fa-spinner fa-spin"></i> 保存中…</span>
                  <span v-else>托管密钥</span>
                </button>
                <button
                  type="button"
                  class="cancel-btn"
                  :disabled="keyBusy"
                  @click="deleteCloudKey"
                >
                  删除密钥
                </button>
              </div>
            </details>
          </template>
          <AppNotice
            v-if="generateNotice"
            :type="generateNotice.type"
            :message="generateNotice.message"
            dismissible
            class="modal-notice"
            @dismiss="generateNotice = null"
          />
          <form @submit.prevent="handleGenerate" v-if="!isGenerating">
            <div class="form-group">
              <label for="tripoName">模型名称</label>
              <input
                type="text"
                id="tripoName"
                v-model="tripoForm.name"
                placeholder="留空则用图片文件名"
              >
            </div>
            <div class="form-group">
              <label for="tripoCategory">模型类别</label>
              <select id="tripoCategory" v-model="tripoForm.category" required>
                <option value="props">道具</option>
                <option value="characters">角色</option>
                <option value="environments">环境</option>
              </select>
            </div>
            <div class="form-group" v-if="generateProvider === 'local' || providerSupportsUpload">
              <label for="tripoImage">{{
                generateProvider === 'local'
                  ? '输入图片'
                  : '输入图片（可选，与提示词 / URL 二选一）'
              }}</label>
              <div class="file-upload-area">
                <input
                  type="file"
                  id="tripoImage"
                  accept=".png,.jpg,.jpeg,.webp"
                  @change="handleGenerateFileSelect"
                >
                <div class="upload-placeholder" v-if="!tripoFileName">
                  <i class="fas fa-image"></i>
                  <p>选一张主体清晰的图片（物品居中、背景干净效果最好）</p>
                  <p class="file-formats">支持 .png, .jpg, .jpeg, .webp</p>
                </div>
                <div class="file-selected" v-if="tripoFileName">
                  <i class="fas fa-file-image"></i>
                  <span>{{ tripoFileName }}</span>
                  <button type="button" class="remove-file" @click="clearGenerateFileSelection">
                    <i class="fas fa-times"></i>
                  </button>
                </div>
              </div>
            </div>
            <div class="form-group" v-if="providerSupportsPrompt">
              <label for="cloudPrompt">提示词（文生 3D，与图片二选一）</label>
              <textarea
                id="cloudPrompt"
                v-model="cloudForm.prompt"
                rows="3"
                maxlength="1024"
                placeholder="描述想要的 3D 物体，例如：一只陶瓷小猫摆件"
              ></textarea>
            </div>
            <div class="form-group" v-if="isCloudProvider">
              <label for="cloudImageUrl">图片公网 URL（可选）</label>
              <input
                type="url"
                id="cloudImageUrl"
                v-model="cloudForm.imageUrl"
                placeholder="https://…（百炼图生 3D 只收公网 URL）"
              >
            </div>
            <div class="form-actions">
              <button type="button" class="cancel-btn" @click="closeGenerateModal">取消</button>
              <button type="submit" class="primary-btn" :disabled="!isGenerateFormValid">
                开始生成
              </button>
            </div>
          </form>
          <div v-else class="generate-progress">
            <i class="fas fa-spinner fa-spin"></i>
            <p>{{ generateStageText }}</p>
            <p class="generate-hint">生成在后台进行，可以先关掉这个窗口去做别的；完成后模型会自动出现在库里。</p>
          </div>
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
                <tr>
                  <th>许可证</th>
                  <td>{{ selectedModel.license || '许可证未记录' }}</td>
                </tr>
                <tr>
                  <th>来源</th>
                  <td>
                    <a
                      v-if="selectedModel.sourceUrl"
                      :href="selectedModel.sourceUrl"
                      class="source-link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >{{ selectedModel.sourceUrl }}</a>
                    <span v-else>来源未记录</span>
                  </td>
                </tr>
                <tr>
                  <th>作者</th>
                  <td>{{ selectedModel.author || '作者未记录' }}</td>
                </tr>
                <tr>
                  <th>AI 生成</th>
                  <td>
                    <span v-if="selectedModel.aiGenerated" class="ai-badge ai-badge--inline">AI 生成</span>
                    <span v-else>否</span>
                  </td>
                </tr>
                </tbody>
              </table>

              <div class="detail-actions">
                <button
                  v-if="!isPlaceholder(selectedModel)"
                  class="secondary-btn full-width"
                  @click="openPreview(selectedModel)"
                >
                  <i class="fas fa-cube"></i> 3D 预览
                </button>
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

    <!-- 真 3D 预览：叠在详情弹窗之上，关闭后回到详情 -->
    <ModelPreviewModal
      v-if="previewModel"
      :model="previewModel"
      @close="previewModel = null"
    />
  </div>
</template>

<script lang="ts" setup name="ModelLibrary">
import { ref, computed, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import { useModelStore } from '@/stores/modelStore';
import { isPlaceholderModel } from '@/data/modelLibrary';
import { resolveModelUrl } from '@/utils/modelLoader';
import { reportError } from '@/services/api/telemetry';
import { ApiError, isApiUnavailable } from '@/services/api/client';
import { createTripoJob, getTripoJob, tripoModelUrl } from '@/services/api/triposr';
import {
  createModel3dCloudJob,
  deleteModel3dKey,
  fetchModel3dGlb,
  getModel3dCloudJob,
  listModel3dKeys,
  listModel3dProviders,
  saveModel3dKey,
  type Model3dKeyInput,
  type Model3dProviderInfo,
} from '@/services/api/model3dCloud';
import { useLlmStore } from '@/stores/llmStore';
import { formatFileSize, formatDate } from '@/utils/formatHelpers';
import PageHeader from '@/components/common/PageHeader.vue';
import EmptyState from '@/components/common/EmptyState.vue';
import AppNotice from '@/components/common/AppNotice.vue';
import InfoTip from '@/components/common/InfoTip.vue';
import ModelPreviewModal from '@/components/models/ModelPreviewModal.vue';

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
  /** 资产许可证（SPDX 标识）；缺失表示未记录 */
  license?: string;
  /** 资产官方来源页；缺失表示来源未记录 */
  sourceUrl?: string;
  /** 资产作者 / 维护方；缺失表示未记录 */
  author?: string;
  /** 是否由 AI 生成通道入库 */
  aiGenerated?: boolean;
  /** 本次会话上传的模型（对象 URL，刷新即失效） */
  sessionOnly?: boolean;
  /** 服务端已持久化的模型（落盘 + DB，刷新后仍在） */
  persisted?: boolean;
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
const llmStore = useLlmStore();
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
/** 当前打开的 3D 预览模型；null 表示预览弹窗关闭 */
const previewModel = ref<Model | null>(null);
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

// ===================== AI 生成（TripoSR 本地推理） =====================
// 与上传同一套 modelStore 链路：生成的 GLB 包成 File 走 uploadModel，
// 会话有效性与「仅当前会话」标注由 modelStore 统一负责。
const TRIPO_POLL_INTERVAL_MS = 3000;

const showGenerateModal = ref<boolean>(false);
const isGenerating = ref<boolean>(false);
const generateStage = ref<'idle' | 'submitting' | 'queued' | 'running' | 'importing'>('idle');
const generateNotice = ref<{ type: 'success' | 'danger' | 'warning'; message: string } | null>(null);
const tripoForm = ref<{
  name: string;
  category: 'characters' | 'environments' | 'props';
  file: File | null;
}>({ name: '', category: 'props', file: null });
const tripoFileName = ref<string>('');
let tripoPollTimer: number | undefined;

// ===================== AI 生成（云端供应商：混元 / 百炼） =====================
// 与本地 TripoSR 共用同一条弹窗：换生成通道后，输入形态与密钥配置跟着变。
// 目录里的计费 / 授权说明原样展示——不替供应商说好话。
type GenerateProviderId = 'local' | 'hunyuan3d' | 'bailian-tripo';

const generateProvider = ref<GenerateProviderId>('local');
const cloudProviders = ref<Model3dProviderInfo[]>([]);
/** null = 还没加载；false = 后端不在（云端入口如实提示，本地推理不受影响） */
const cloudReady = ref<boolean | null>(null);
const cloudError = ref('');
const cloudForm = ref<{ prompt: string; imageUrl: string }>({ prompt: '', imageUrl: '' });
const keyForm = ref<{
  secretId: string;
  secretKey: string;
  apiKey: string;
  workspaceId: string;
  passphrase: string;
}>({
  secretId: '',
  secretKey: '',
  apiKey: '',
  workspaceId: '',
  passphrase: '',
});
const keyBusy = ref(false);
const keyNotice = ref<{ type: 'success' | 'danger'; message: string } | null>(null);

const activeCloudProvider = computed<Model3dProviderInfo | null>(
  () => cloudProviders.value.find((p) => p.providerId === generateProvider.value) ?? null,
);
const providerConfigured = computed<boolean>(() => activeCloudProvider.value?.configured ?? false);
const isCloudProvider = computed<boolean>(() => generateProvider.value !== 'local');
const providerSupportsUpload = computed<boolean>(
  () => activeCloudProvider.value?.supportsImageUpload ?? false,
);
const providerSupportsPrompt = computed<boolean>(
  () => activeCloudProvider.value?.supportsPrompt ?? false,
);
const providerLabel = computed<string>(() => {
  switch (generateProvider.value) {
    case 'hunyuan3d':
      return '腾讯混元生 3D';
    case 'bailian-tripo':
      return '百炼 Tripo';
    default:
      return 'TripoSR 本地推理';
  }
});

const isCloudFormValid = computed<boolean>(() => {
  const provider = activeCloudProvider.value;
  if (!provider || !providerConfigured.value) return false;
  // 输入三选一且互斥：多给、少给都不提交（后端还会再兜一层）
  const given = [
    cloudForm.value.prompt.trim() ? 'prompt' : '',
    cloudForm.value.imageUrl.trim() ? 'url' : '',
    tripoForm.value.file ? 'file' : '',
  ].filter(Boolean);
  if (given.length !== 1) return false;
  if (given[0] === 'prompt' && !provider.supportsPrompt) return false;
  if (given[0] === 'file' && !provider.supportsImageUpload) return false;
  return true;
});

const isGenerateFormValid = computed<boolean>(() => {
  if (generateProvider.value === 'local') return tripoForm.value.file !== null;
  return isCloudFormValid.value;
});

const generateStageText = computed<string>(() => {
  switch (generateStage.value) {
    case 'submitting':
      return '正在提交…';
    case 'queued':
      return '排队中…';
    case 'running':
      return generateProvider.value === 'local'
        ? '本机推理中…（CPU 分钟级）'
        : `云端生成中…（${providerLabel.value}）`;
    case 'importing':
      return '生成完成，正在导入模型库…';
    default:
      return '';
  }
});

const handleGenerateFileSelect = (e: Event): void => {
  const target = e.target as HTMLInputElement;
  const file = target.files?.[0] || null;
  if (file) {
    tripoForm.value.file = file;
    tripoFileName.value = file.name;
    // 自动填充模型名称（如果未填写）
    if (!tripoForm.value.name) {
      tripoForm.value.name = file.name.replace(/\.[^/.]+$/, '');
    }
  }
};

const clearGenerateFileSelection = (): void => {
  tripoForm.value.file = null;
  tripoFileName.value = '';
  const input = document.getElementById('tripoImage') as HTMLInputElement | null;
  if (input) input.value = '';
};

const resetTripoForm = (): void => {
  tripoForm.value = { name: '', category: 'props', file: null };
  tripoFileName.value = '';
  clearGenerateFileSelection();
};

const stopTripoPolling = (): void => {
  if (tripoPollTimer !== undefined) {
    window.clearTimeout(tripoPollTimer);
    tripoPollTimer = undefined;
  }
};

const openGenerateModal = (): void => {
  showGenerateModal.value = true;
  generateNotice.value = null;
  // 目录与密钥状态懒加载：本地推理不需要后端在场也能用
  void loadCloudCatalog();
};

const closeGenerateModal = (): void => {
  // 推理继续在后台跑：关掉只是不看进度，完成后模型照样进库
  showGenerateModal.value = false;
  if (!isGenerating.value) resetTripoForm();
};

const loadCloudCatalog = async (): Promise<void> => {
  if (cloudReady.value === true) return;
  try {
    cloudProviders.value = await listModel3dProviders(llmStore.ownerToken);
    cloudReady.value = true;
    cloudError.value = '';
  } catch (error) {
    // 后端缺席是正常状态：云端入口如实提示，本地推理照常
    cloudReady.value = false;
    cloudError.value = isApiUnavailable(error)
      ? '后端不可达——云端生成暂不可用，本地推理不受影响'
      : error instanceof Error
        ? error.message
        : '云端目录读取失败';
    reportError(error, '/model-library');
  }
};

const saveCloudKey = async (): Promise<void> => {
  const provider = activeCloudProvider.value;
  if (!provider || keyBusy.value) return;
  keyBusy.value = true;
  keyNotice.value = null;
  try {
    let input: Model3dKeyInput = { providerId: provider.providerId };
    if (provider.providerId === 'hunyuan3d') {
      if (!keyForm.value.secretId.trim() || !keyForm.value.secretKey.trim()) {
        keyNotice.value = {
          type: 'danger',
          message: 'SecretId 与 SecretKey 都要填（云 API 密钥控制台创建的一对）',
        };
        return;
      }
      input.secretId = keyForm.value.secretId.trim();
      input.secretKey = keyForm.value.secretKey.trim();
    } else {
      if (!keyForm.value.apiKey.trim()) {
        keyNotice.value = { type: 'danger', message: 'API Key 不能为空' };
        return;
      }
      // 赋值链压短：密钥扫描闸门拦「apiKey = 长表达式」的形态，这里只传值
      const apiKeyValue = keyForm.value.apiKey.trim();
      input = { ...input, apiKey: apiKeyValue };
      if (keyForm.value.workspaceId.trim()) {
        input = { ...input, workspaceId: keyForm.value.workspaceId.trim() };
      }
    }
    // 口令只在 argon2id 模式（后端没配 master key）才需要；不填不发
    if (keyForm.value.passphrase.trim()) {
      input.passphrase = keyForm.value.passphrase.trim();
    }
    await saveModel3dKey(llmStore.ownerToken, input);
    cloudProviders.value = await listModel3dProviders(llmStore.ownerToken);
    keyNotice.value = { type: 'success', message: '密钥已托管（服务端只存密文）' };
  } catch (error) {
    keyNotice.value = {
      type: 'danger',
      message: isApiUnavailable(error)
        ? '后端不可达，key 没能存进去'
        : error instanceof ApiError
          ? error.message
          : '密钥保存失败',
    };
    reportError(error, '/model-library');
  } finally {
    keyBusy.value = false;
  }
};

const deleteCloudKey = async (): Promise<void> => {
  const provider = activeCloudProvider.value;
  if (!provider || keyBusy.value) return;
  keyBusy.value = true;
  try {
    await deleteModel3dKey(llmStore.ownerToken, provider.providerId);
    cloudProviders.value = await listModel3dProviders(llmStore.ownerToken);
    keyNotice.value = { type: 'success', message: '已删除托管密钥' };
  } catch (error) {
    keyNotice.value = {
      type: 'danger',
      message: error instanceof ApiError ? error.message : '密钥删除失败',
    };
  } finally {
    keyBusy.value = false;
  }
};

/** 把生成的 GLB 拉回来包成 File，走既有上传链路 */
const importGeneratedModel = async (jobId: string): Promise<void> => {
  const response = await fetch(tripoModelUrl(jobId));
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }
  const blob = await response.blob();
  const baseName = tripoForm.value.name.trim() || 'TripoSR 生成';
  const file = new File([blob], `${baseName}.glb`, { type: 'model/gltf-binary' });
  await modelStore.uploadModel({
    name: `${baseName}（TripoSR 本地生成）`,
    category: tripoForm.value.category,
    file,
    aiGenerated: true,
  });
};

const pollTripoJob = (jobId: string): void => {
  stopTripoPolling();
  tripoPollTimer = window.setTimeout(async () => {
    try {
      const job = await getTripoJob(jobId);
      if (job.status === 'succeeded') {
        generateStage.value = 'importing';
        await importGeneratedModel(jobId);
        showGenerateModal.value = false;
        isGenerating.value = false;
        generateStage.value = 'idle';
        resetTripoForm();
        downloadNotice.value = { type: 'success', message: '模型生成完成，已导入模型库（仅当前会话有效）' };
        if (downloadNoticeTimer !== undefined) window.clearTimeout(downloadNoticeTimer);
        downloadNoticeTimer = window.setTimeout(() => { downloadNotice.value = null; }, 6000);
        return;
      }
      if (job.status === 'failed') {
        generateNotice.value = { type: 'danger', message: job.error || '推理失败，换一张主体清晰的图片试试' };
        isGenerating.value = false;
        generateStage.value = 'idle';
        return;
      }
      generateStage.value = job.status === 'running' ? 'running' : 'queued';
      pollTripoJob(jobId);
    } catch (error) {
      // 后端抖动 ≠ 任务失败：任务在后台继续跑，下个周期再问
      if (isGenerating.value && isApiUnavailable(error)) {
        pollTripoJob(jobId);
        return;
      }
      generateNotice.value = {
        type: 'danger',
        message: error instanceof Error ? error.message : '状态查询失败',
      };
      isGenerating.value = false;
      generateStage.value = 'idle';
      reportError(error, '/model-library');
    }
  }, TRIPO_POLL_INTERVAL_MS);
};

const handleGenerate = async (): Promise<void> => {
  if (generateProvider.value !== 'local') return handleGenerateCloud();
  if (!tripoForm.value.file) return;
  isGenerating.value = true;
  generateStage.value = 'submitting';
  generateNotice.value = null;
  try {
    const created = await createTripoJob(
      tripoForm.value.file,
      tripoForm.value.name.trim() || undefined,
    );
    generateStage.value = 'queued';
    pollTripoJob(created.jobId);
  } catch (error) {
    isGenerating.value = false;
    generateStage.value = 'idle';
    if (error instanceof ApiError && error.code === 'triposr_env_missing') {
      // 环境问题后端已经说清楚缺什么——原样转告，不吞提示
      generateNotice.value = { type: 'danger', message: `TripoSR 环境没就绪：${error.message}` };
    } else if (error instanceof ApiError) {
      generateNotice.value = { type: 'danger', message: error.message };
    } else {
      generateNotice.value = { type: 'danger', message: '后端不可达——确认 backend 已启动后再试' };
    }
    reportError(error, '/model-library');
  }
};

const importGeneratedCloudModel = async (jobId: string): Promise<void> => {
  // 产物按 owner 分区：下载要带软身份头，匿名请求会 404
  const blob = await fetchModel3dGlb(llmStore.ownerToken, jobId);
  const baseName = tripoForm.value.name.trim() || '云端生成';
  const file = new File([blob], `${baseName}.glb`, { type: 'model/gltf-binary' });
  await modelStore.uploadModel({
    name: `${baseName}（${providerLabel.value} 云端生成）`,
    category: tripoForm.value.category,
    file,
    aiGenerated: true,
  });
};

const CLOUD_POLL_INTERVAL_MS = 5000;

const pollCloudJob = (jobId: string): void => {
  stopTripoPolling();
  tripoPollTimer = window.setTimeout(async () => {
    try {
      const job = await getModel3dCloudJob(llmStore.ownerToken, jobId);
      if (job.status === 'succeeded') {
        generateStage.value = 'importing';
        await importGeneratedCloudModel(jobId);
        showGenerateModal.value = false;
        isGenerating.value = false;
        generateStage.value = 'idle';
        resetTripoForm();
        cloudForm.value = { prompt: '', imageUrl: '' };
        downloadNotice.value = { type: 'success', message: '模型生成完成，已导入模型库（仅当前会话有效）' };
        if (downloadNoticeTimer !== undefined) window.clearTimeout(downloadNoticeTimer);
        downloadNoticeTimer = window.setTimeout(() => { downloadNotice.value = null; }, 6000);
        return;
      }
      if (job.status === 'failed') {
        generateNotice.value = { type: 'danger', message: job.error || '云端生成失败' };
        isGenerating.value = false;
        generateStage.value = 'idle';
        return;
      }
      generateStage.value = job.status === 'running' ? 'running' : 'queued';
      pollCloudJob(jobId);
    } catch (error) {
      // 后端抖动 ≠ 任务失败：任务在厂商侧继续跑，下个周期再问
      if (isGenerating.value && isApiUnavailable(error)) {
        pollCloudJob(jobId);
        return;
      }
      generateNotice.value = {
        type: 'danger',
        message: error instanceof Error ? error.message : '状态查询失败',
      };
      isGenerating.value = false;
      generateStage.value = 'idle';
      reportError(error, '/model-library');
    }
  }, CLOUD_POLL_INTERVAL_MS);
};

const handleGenerateCloud = async (): Promise<void> => {
  const provider = activeCloudProvider.value;
  if (!provider) {
    generateNotice.value = { type: 'danger', message: cloudError.value || '云端目录还没加载' };
    return;
  }
  if (!providerConfigured.value) {
    generateNotice.value = {
      type: 'danger',
      message: `先在下方托管 ${provider.name} 的密钥（BYOK），再开始生成`,
    };
    return;
  }
  isGenerating.value = true;
  generateStage.value = 'submitting';
  generateNotice.value = null;
  try {
    const created = await createModel3dCloudJob(llmStore.ownerToken, {
      providerId: provider.providerId,
      prompt: cloudForm.value.prompt.trim() || undefined,
      imageUrl: cloudForm.value.imageUrl.trim() || undefined,
      image: provider.supportsImageUpload ? tripoForm.value.file : null,
      label: tripoForm.value.name.trim() || undefined,
    });
    generateStage.value = 'queued';
    pollCloudJob(created.jobId);
  } catch (error) {
    isGenerating.value = false;
    generateStage.value = 'idle';
    if (error instanceof ApiError) {
      generateNotice.value = { type: 'danger', message: error.message };
    } else {
      generateNotice.value = { type: 'danger', message: '后端不可达——确认 backend 已启动后再试' };
    }
    reportError(error, '/model-library');
  }
};

onUnmounted(() => {
  stopTripoPolling();
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

const openPreview = (model: Model) => {
  previewModel.value = model;
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
    showUploadNotice('模型上传失败，请重试');
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
  if (uploadNoticeTimer !== undefined) {
    window.clearTimeout(uploadNoticeTimer);
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
  modelStore.deleteModel(model.id);
  pendingDeleteId.value = null;
};

/*
 * 删除走两段式行内确认：第一次点击只把卡片置入「确认删除？」态，
 * 再点对勾才真删——替代原生 confirm()，与全站反馈体系同轨。
 */
const pendingDeleteId = ref<string | null>(null);
const handleDeleteClick = (model: Model) => {
  pendingDeleteId.value = model.id;
};
const confirmDeleteModel = (model: Model) => {
  handleDeleteModel(model);
};

/*
 * 上传失败反馈：与下载共用 AppNotice 通道（替代原生 alert）。
 * 4 秒自清，也可手动关。
 */
const uploadNotice = ref<string | null>(null);
let uploadNoticeTimer: number | undefined;
const showUploadNotice = (message: string): void => {
  uploadNotice.value = message;
  if (uploadNoticeTimer !== undefined) {
    window.clearTimeout(uploadNoticeTimer);
  }
  uploadNoticeTimer = window.setTimeout(() => {
    uploadNotice.value = null;
    uploadNoticeTimer = undefined;
  }, 4000);
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

/** 会话上传与持久化条目都没做几何分析，面数/材质/动画是未知的 */
const statsPending = (model: Model): boolean => model.sessionOnly === true || model.persisted === true;

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

/* 反馈条与下方区块的统一间距（AppNotice 由共享组件管外观） */
.library-notice {
  margin-bottom: 18px;
}

.modal-notice {
  margin-bottom: 14px;
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
  margin-bottom: 20px;
  flex-wrap: wrap;
  gap: 14px;
}

.toolbar-actions {
  display: flex;
  align-items: center;
  gap: 10px;
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

/* 已持久化：与「仅本次会话有效」同一形状，用强调色而非警告色 */
.persisted-badge {
  color: var(--accent);
  background-color: var(--accent-soft);
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
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min), 1fr));
  gap: var(--grid-gap);
  margin-bottom: 40px;
}

/* 占位条目整卡降饱和：能看见、但一眼知道它不是可用资产 */
.model-card--placeholder {
  opacity: 0.55;
}

.model-card--placeholder .model-thumbnail {
  filter: grayscale(0.6);
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

/*
 * 卡片动作行：常驻在信息区底部（不再藏在缩略图上的 hover 浮层里）——
 * hover-only 的 opacity:0 让触屏与键盘用户够不到主操作。
 */
.model-actions {
  display: flex;
  gap: 6px;
  align-items: center;
}

.model-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 10px;
  min-height: 28px;
}

.model-foot .session-badge {
  margin: 0;
}

.model-name-row {
  display: flex;
  align-items: center;
  gap: 6px;
  min-width: 0;
}

.model-name-row .model-name {
  flex: 1;
}

.placeholder-badge {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--text-3);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  white-space: nowrap;
}

/* AI 生成标记：与占位徽章同一形状，用强调色区分 */
.ai-badge {
  flex-shrink: 0;
  font-size: 0.7rem;
  color: var(--accent);
  background-color: var(--accent-soft);
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  border-radius: var(--radius-sm);
  padding: 1px 6px;
  white-space: nowrap;
}

.ai-badge--inline {
  display: inline-block;
}

.source-link {
  color: var(--accent);
  word-break: break-all;
}

.source-link:hover {
  text-decoration: underline;
}

/* 两段式删除确认态：动作行整行换成确认对 */
.model-confirm {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
}

.confirm-text {
  font-size: var(--text-xs);
  color: var(--danger);
}

.action-btn {
  width: 28px;
  height: 28px;
  border-radius: var(--radius-sm);
  background-color: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  font-size: 0.8rem;
  transition: all 0.2s ease;
}

.action-btn:hover {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-1);
}

.action-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 1px;
}

.action-btn--danger:hover {
  background-color: rgba(240, 97, 106, 0.12);
  border-color: var(--danger);
  color: var(--danger);
}

.action-btn--confirm {
  background-color: var(--danger-strong);
  border-color: var(--danger-strong);
  color: #ffffff;
}

.action-btn--confirm:hover {
  background-color: var(--danger);
  border-color: var(--danger);
  color: #ffffff;
}

.model-info {
  padding: 12px 14px 14px;
}

.model-name {
  font-size: 1.05rem;
  margin-bottom: 5px;
  color: var(--text-1);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.model-meta {
  font-size: 0.85rem;
  color: var(--text-3);
}

/* 统一空态（EmptyState 组件管内部结构，这里只给外围卡感） */
.models-empty {
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}

/* 按钮样式 */
.primary-btn {
  padding: 10px 20px;
  background-color: var(--accent-strong);
  /* 主色实底上的深字：项目约定写法（见 simulation-panel-kit.css 的 .sim-t-on-accent） */
  color: var(--accent-on);
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

/* 模型详情样式：预览略收、属性与动作略放——右半不再空旷 */
.model-detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr);
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

/* AI 生成（TripoSR）：后台进度态 */
.generate-progress {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 24px 0;
  text-align: center;
}

.generate-progress i {
  font-size: 28px;
}

.generate-hint {
  font-size: 12px;
  opacity: 0.7;
  max-width: 320px;
}
</style>
