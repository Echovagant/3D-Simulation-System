import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { createModelLibrary } from '@/data/modelLibrary'
import { useSceneEditorStore } from './sceneEditorStore'
import { loadModel } from '@/utils/modelLoader'
import { createThumbnail } from '@/utils/thumbnail'

// 定义模型类型
export interface Model {
  id: string
  name: string
  description?: string
  category: 'characters' | 'environments' | 'props'
  thumbnailUrl: string
  modelUrl: string
  format: string
  size: number // 文件大小（字节）
  uploadDate: string
  polyCount: number // 多边形数量
  materialCount: number // 材质数量
  hasAnimation: boolean // 是否包含动画
  /**
   * 是否是「本次会话上传」的模型。
   *
   * 这类模型用的是浏览器对象 URL（blob:），**刷新页面即失效**——
   * 界面必须如实告诉用户，否则会以为模型已经存下来了。
   */
  sessionOnly?: boolean
}

// 定义上传模型的参数类型
export interface UploadModelParams {
  name: string
  category: 'characters' | 'environments' | 'props'
  file: File
}

/**
 * 从内存里的 File 解析模型。
 *
 * 对象 URL 本身不带扩展名，`modelLoader` 按 URL 后缀判断格式的逻辑对它无效；
 * 这里直接用上传时的格式走对应 loader 的 parse 接口。
 */
const parseModelFile = async (file: File, format: string): Promise<THREE.Object3D> => {
  const buffer = await file.arrayBuffer()

  switch (format.toLowerCase()) {
    case 'glb':
    case 'gltf':
      return new Promise<THREE.Object3D>((resolve, reject) => {
        new GLTFLoader().parse(buffer, '', (gltf) => {
          if (gltf.scene) resolve(gltf.scene)
          else reject(new Error('GLTF文件不包含场景'))
        }, reject)
      })
    case 'obj':
      // OBJLoader.parse 是同步的，而且要的是文本而不是二进制
      return new OBJLoader().parse(new TextDecoder().decode(buffer))
    case 'fbx':
      return new FBXLoader().parse(buffer, '')
    default:
      throw new Error(`不支持的模型格式: ${format}`)
  }
}

export const useModelStore = defineStore('model', () => {
  // 模型列表（复制一份，避免与模块级清单共享同一个数组）
  const models = ref<Model[]>([...createModelLibrary()])
  // 添加选中模型ID的状态管理
  const selectedModelId = ref<string | null>(null) // 新增：存储当前选中的模型ID

  /**
   * 本次会话上传的模型：文件与对象 URL。
   *
   * 刻意放在**非响应式**的 Map 里：
   * - File 若放进 `models`（深响应式）会被 Vue 代理，`file.arrayBuffer()` 会抛
   *   Illegal invocation；
   * - 对象 URL 的生命周期由我们自己管（删除时 revoke），不需要进状态。
   */
  const uploadedFiles = new Map<string, File>()
  const uploadedUrls = new Map<string, string>()

  // 获取所有模型
  const getAllModels = computed(() => models.value)

  // 根据ID获取模型
  const getModelById = (id: string) => {
    return models.value.find((model) => model.id === id)
  }

  // 根据类别获取模型
  const getModelsByCategory = (category: string) => {
    if (category === 'all') return models.value
    return models.value.filter((model) => model.category === category)
  }

  /**
   * 按 id 加载模型。
   *
   * 库里的模型按 URL 加载；本次会话上传的模型按内存里的 File 解析
   * （它的 modelUrl 是 blob: 地址，`modelLoader` 认不出来）。
   */
  const loadModelById = async (id: string): Promise<THREE.Object3D | null> => {
    const model = getModelById(id)
    if (!model) return null

    const file = uploadedFiles.get(id)
    if (file) {
      return await parseModelFile(file, model.format)
    }

    return await loadModel(model.modelUrl)
  }

  // 上传新模型
  const uploadModel = async (params: UploadModelParams): Promise<Model> => {
    const fileExtension = params.file.name.split('.').pop()?.toLowerCase() || ''
    const supportedFormats = ['glb', 'gltf', 'obj', 'fbx']
    const format = supportedFormats.includes(fileExtension) ? fileExtension : 'unknown'

    // 客户端对象 URL：**只在当前页面会话内有效**，刷新即失效。
    // 这是在「没有后端」的前提下唯一能让模型真正被加载的办法，
    // 代价是它不持久——界面必须如实标注这一点。
    const objectUrl = URL.createObjectURL(params.file)
    const id = `model-${Date.now()}`

    const newModel: Model = {
      id,
      name: params.name,
      category: params.category,
      thumbnailUrl: createThumbnail(params.name, params.category),
      modelUrl: objectUrl,
      format: format.toUpperCase(),
      size: params.file.size,
      uploadDate: new Date().toISOString(),
      // 不编造数据：多面体数 / 材质数 / 是否含动画都要真正解析文件才知道，
      // 这里如实留 0，由界面显示「待分析」。
      polyCount: 0,
      materialCount: 0,
      hasAnimation: false,
      sessionOnly: true,
    }

    uploadedFiles.set(id, params.file)
    uploadedUrls.set(id, objectUrl)

    models.value = [newModel, ...models.value]
    return newModel
  }

  // 删除模型
  const deleteModel = (id: string) => {
    // 对象 URL 必须回收：否则文件会一直被浏览器攥在内存里，
    // 直到页面关闭才释放。
    const url = uploadedUrls.get(id)
    if (url) {
      URL.revokeObjectURL(url)
      uploadedUrls.delete(id)
    }
    uploadedFiles.delete(id)

    models.value = models.value.filter((model) => model.id !== id)
  }

  // 将模型添加到场景
  const addModelToScene = async (id: string) => {
    const model = getModelById(id)
    if (!model) return

    try {
      const threeObject = await loadModelById(id)
      if (!threeObject) throw new Error('模型加载失败')

      const sceneEditorStore = useSceneEditorStore()
      sceneEditorStore.addObject({
        uuid: `scene-${model.id}-${Date.now()}`,
        name: model.name,
        type: 'model',
        modelId: model.id,
        position: { x: 0, y: 0, z: 0 },
        rotation: { x: 0, y: 0, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        threeObject: threeObject,
      })
    } catch (error) {
      alert('模型加载失败，无法添加到场景')
    }
  }

  // store 卸载（页面刷新 / 应用销毁）时回收所有对象 URL
  onScopeDispose(() => {
    uploadedUrls.forEach((url) => URL.revokeObjectURL(url))
    uploadedUrls.clear()
    uploadedFiles.clear()
  })

  return {
    models,
    selectedModelId, // 导出新增的选中模型ID
    getAllModels,
    getModelById,
    getModelsByCategory,
    loadModelById,
    uploadModel,
    deleteModel,
    addModelToScene,
  }
})
