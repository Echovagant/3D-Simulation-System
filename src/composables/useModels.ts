import { ref, computed, onMounted } from 'vue';
import { useModelStore } from '@/stores/modelStore';
import { Model } from '@/stores/modelStore';
import { useRouter } from 'vue-router';

export function useModels() {
  const modelStore = useModelStore();
  const router = useRouter();

  // 状态
  const loading = ref(false);
  const error = ref<string | null>(null);
  const selectedCategory = ref('all');
  const searchQuery = ref('');

  // 获取所有模型
  const models = computed(() => modelStore.getAllModels);

  // 筛选后的模型
  const filteredModels = computed(() => {
    return models.value.filter(model => {
      // 类别筛选
      const categoryMatch = selectedCategory.value === 'all' || model.category === selectedCategory.value;

      // 搜索筛选
      const searchMatch = !searchQuery.value ||
        model.name.toLowerCase().includes(searchQuery.value.toLowerCase()) ||
        (model.description && model.description.toLowerCase().includes(searchQuery.value.toLowerCase()));

      return categoryMatch && searchMatch;
    });
  });

  // 按类别获取模型数量
  const getModelCountByCategory = (category: string) => {
    return models.value.filter(model => model.category === category).length;
  };

  // 加载模型
  const loadModels = async () => {
    loading.value = true;
    error.value = null;

    try {
      // 在实际项目中，这里会调用API加载模型列表
      // 这里使用模拟数据
      await new Promise(resolve => setTimeout(resolve, 500));
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to load models';
    } finally {
      loading.value = false;
    }
  };

  // 上传模型
  const uploadNewModel = async (modelData: { name: string; category: 'characters' | 'environments' | 'props'; file: File }) => {
    loading.value = true;
    error.value = null;

    try {
      await modelStore.uploadModel({
        name: modelData.name,
        category: modelData.category,
        file: modelData.file
      });
      return true;
    } catch (err) {
      error.value = err instanceof Error ? err.message : 'Failed to upload model';
      return false;
    } finally {
      loading.value = false;
    }
  };

  // 将模型添加到场景
  const addModelToScene = (modelId: string) => {
    modelStore.addModelToScene(modelId);
    router.push('/scene-editor');
  };

  // 删除模型
  const removeModel = (modelId: string) => {
    if (confirm('Are you sure you want to delete this model?')) {
      modelStore.deleteModel(modelId);
    }
  };

  // 初始化时加载模型
  onMounted(() => {
    loadModels();
  });

  return {
    models,
    filteredModels,
    loading,
    error,
    selectedCategory,
    searchQuery,
    loadModels,
    uploadNewModel,
    addModelToScene,
    removeModel,
    getModelCountByCategory
  };
}
    