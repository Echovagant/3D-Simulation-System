import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { modelLibrary } from '@/data/modelLibrary';
import { useSceneEditorStore } from './sceneEditorStore';
import { loadModel } from '@/utils/modelLoader';

// 定义模型类型
export interface Model {
  id: string;
  name: string;
  description?: string;
  category: 'characters' | 'environments' | 'props';
  thumbnailUrl: string;
  modelUrl: string;
  format: string;
  size: number; // 文件大小（字节）
  uploadDate: string;
  polyCount: number; // 多边形数量
  materialCount: number; // 材质数量
  hasAnimation: boolean; // 是否包含动画
}

// 定义上传模型的参数类型
export interface UploadModelParams {
  name: string;
  category: 'characters' | 'environments' | 'props';
  file: File;
}

export const useModelStore = defineStore('model', () => {
  // 模型列表
  const models = ref<Model[]>(modelLibrary);
  // 添加选中模型ID的状态管理
  const selectedModelId = ref<string | null>(null); // 新增：存储当前选中的模型ID

  // 获取所有模型
  const getAllModels = computed(() => models.value);

  // 根据ID获取模型
  const getModelById = (id: string) => {
    return models.value.find(model => model.id === id);
  };

  // 根据类别获取模型
  const getModelsByCategory = (category: string) => {
    if (category === 'all') return models.value;
    return models.value.filter(model => model.category === category);
  };

  // 上传新模型
  const uploadModel = async (params: UploadModelParams) => {
    // 保持原有逻辑不变...
    const fileExtension = params.file.name.split('.').pop()?.toLowerCase() || '';
    const supportedFormats = ['glb', 'gltf', 'obj', 'fbx'];
    const format = supportedFormats.includes(fileExtension) ? fileExtension : 'unknown';

    const newModel: Model = {
      id: `model-${Date.now()}`,
      name: params.name,
      category: params.category,
      thumbnailUrl: `https://picsum.photos/seed/${params.name}/400/300`,
      modelUrl: '#',
      format: format.toUpperCase(),
      size: params.file.size,
      uploadDate: new Date().toISOString(),
      polyCount: Math.floor(Math.random() * 10000) + 1000,
      materialCount: Math.floor(Math.random() * 10) + 1,
      hasAnimation: Math.random() > 0.5
    };

    await new Promise(resolve => setTimeout(resolve, 1500));
    models.value.unshift(newModel);
    return newModel;
  };

  // 删除模型
  const deleteModel = (id: string) => {
    models.value = models.value.filter(model => model.id !== id);
  };

  // 将模型添加到场景
  const addModelToScene = async (id: string) => {
    // 保持原有逻辑不变...
    const model = getModelById(id);
    if (!model) return;

    try {
      const threeObject = await loadModel(model.modelUrl);
      const sceneEditorStore = useSceneEditorStore();
      sceneEditorStore.addObject({
        uuid: `scene-${model.id}-${Date.now()}`,
        name: model.name,
        type: 'model',
        modelId: model.id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        threeObject: threeObject,
      });
    } catch (error) {
      console.error('添加模型到场景失败:', error);
      alert('模型加载失败，无法添加到场景');
    }
  };

  return {
    models,
    selectedModelId, // 导出新增的选中模型ID
    getAllModels,
    getModelById,
    getModelsByCategory,
    uploadModel,
    deleteModel,
    addModelToScene
  };
});
