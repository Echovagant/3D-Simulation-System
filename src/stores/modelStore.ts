/**
 * 模型库与上传模型的中枢：内置清单、服务端持久化上传、会话内上传、按 id 加载成 three 对象。
 *
 * 内置模型的元数据来自 `@/data/modelLibrary.ts`（构建期与 GLB 实测核对过）；
 * 上传模型优先走**服务端持久化**（落盘 + DB，刷新后仍在），
 * 后端不可达时回退 blob: 对象 URL（只活在当前会话，刷新即失效）——
 * 两种结果都如实标注（`persisted` / `sessionOnly`），不伪装成功。
 */
import { defineStore } from 'pinia'
import { ref, computed, onScopeDispose } from 'vue'
import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js'
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js'
import { createModelLibrary } from '@/data/modelLibrary'
import { useSceneEditorStore } from './sceneEditorStore'
import { useLlmStore } from './llmStore'
import { loadModel } from '@/utils/modelLoader'
import { createThumbnail } from '@/utils/thumbnail'
import { API_BASE } from '@/services/api/client'
import {
  deleteUploadedModel,
  listUploadedModels,
  uploadModelFile,
  type ModelUploadItem,
} from '@/services/api/models'
import { reportError } from '@/services/api/telemetry'

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
  /** 资产许可证（SPDX 标识，如 Apache-2.0 / CC0-1.0）；缺失表示未记录 */
  license?: string
  /** 资产官方来源页；缺失表示来源未记录，界面不得编造 */
  sourceUrl?: string
  /** 资产作者 / 维护方；缺失表示未记录 */
  author?: string
  /** 是否由 AI 生成（TripoSR / 混元 / 百炼等生成通道入库） */
  aiGenerated?: boolean
  /**
   * 是否是「本次会话上传」的模型（blob: 对象 URL）。
   *
   * ⚠️ 与 `persisted` 互斥：sessionOnly = 只活在当前页面会话，刷新即失效；
   * 两个都不标 = 内置库条目。界面必须如实区分三者，否则用户会以为
   * 模型已经存下来了（或反过来以为存不住）。
   */
  sessionOnly?: boolean
  /**
   * 是否是「服务端已持久化」的模型（后端落盘 + DB，刷新后仍在）。
   *
   * ⚠️ 与 `sessionOnly` 互斥。modelUrl 指向后端文件端点
   * （/api/models/{id}/file），加载时要带 X-Owner-Token。
   */
  persisted?: boolean
}

// 定义上传模型的参数类型
export interface UploadModelParams {
  name: string
  category: 'characters' | 'environments' | 'props'
  file: File
  /** 该文件是否由 AI 生成通道产出（生成后走同一条上传链路） */
  aiGenerated?: boolean
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

/**
 * 服务端条目 → 模型库条目（上传应答与列表同步共用同一个映射）。
 */
const toModelEntry = (item: ModelUploadItem): Model => ({
  id: item.id,
  name: item.name,
  category: item.category,
  thumbnailUrl: createThumbnail(item.name, item.category),
  modelUrl: item.modelUrl,
  // 与内置条目同口径存大写；加载时再转小写分派 loader
  format: item.format.toUpperCase(),
  size: item.size,
  uploadDate: item.createdAt,
  // 服务端不解析几何：如实存 0 / false，由界面显示「待分析」
  polyCount: item.polyCount,
  materialCount: item.materialCount,
  hasAnimation: item.hasAnimation,
  persisted: true,
})

/**
 * 上传模型的 id 序号。
 *
 * 放在模块作用域：id 必须**全局唯一**且**单调递增**——
 * 同一毫秒内连续上传两个模型时，单纯用 `Date.now()` 会得到两个完全相同的 id，
 * 模型列表的 key 就会重复、选中项会指向错误的那一条。
 * （只给 blob 回退条目用：持久化条目的 id 是服务端 publicId。）
 */
let uploadedModelSeq = 0

export const useModelStore = defineStore('model', () => {
  // 模型列表（复制一份，避免与模块级清单共享同一个数组）
  const models = ref<Model[]>([...createModelLibrary()])
  // 模型库当前选中的模型 id：工具栏的「加入场景」读它定位模型，用完即清空
  const selectedModelId = ref<string | null>(null)

  /**
   * 本次会话上传的模型：文件与对象 URL。
   *
   * 刻意放在**非响应式**的 Map 里：
   * - File 若放进 `models`（深响应式）会被 Vue 代理，`file.arrayBuffer()` 会抛
   *   Illegal invocation；
   * - 对象 URL 的生命周期由我们自己管（删除时 revoke），不需要进状态。
   * 持久化条目不进这两个 Map——文件在服务端，浏览器不留副本。
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
   * 按 id 加载模型。三条路：
   *
   * - 本次会话上传：按内存里的 File 解析（blob: 地址 `modelLoader` 认不出来）；
   * - 服务端持久化：按持久 URL 加载。文件端点按 owner 隔离，请求必须带
   *   X-Owner-Token（three.js loader 自己不发头，走 loadModel 的 headers 选项）；
   *   端点 URL 不带扩展名，格式直接提示给 loader，不靠 URL 后缀猜。
   * - 内置库：按 URL 加载。
   */
  const loadModelById = async (id: string): Promise<THREE.Object3D | null> => {
    const model = getModelById(id)
    if (!model) return null

    const file = uploadedFiles.get(id)
    if (file) {
      return await parseModelFile(file, model.format)
    }

    if (model.persisted) {
      // ownerToken 在 action 内取，避免模块顶层的循环依赖
      const { ownerToken } = useLlmStore()
      return await loadModel(`${API_BASE}${model.modelUrl}`, {
        headers: ownerToken ? { 'X-Owner-Token': ownerToken } : undefined,
        format: model.format,
      })
    }

    return await loadModel(model.modelUrl)
  }

  /**
   * 上传新模型。先尝试服务端持久化（刷新后仍在）；
   * 后端不可达时回退会话内 blob——**如实标注 sessionOnly**，不伪装成功。
   */
  const uploadModel = async (params: UploadModelParams): Promise<Model> => {
    const fileExtension = params.file.name.split('.').pop()?.toLowerCase() || ''
    const supportedFormats = ['glb', 'gltf', 'obj', 'fbx']
    const format = supportedFormats.includes(fileExtension) ? fileExtension : 'unknown'

    // .gltf 常引用外部资源（.bin / 贴图）：服务端只存单个文件，不覆盖外部资源。
    // 只提示不拦截——自包含的 .gltf 照常走持久化。
    if (format === 'gltf') {
      console.warn(
        '[modelStore] .gltf 若引用外部资源（.bin / 贴图），服务端持久化不覆盖这些外部文件，' +
          '刷新后加载可能失败；需要自包含时优先用 .glb。',
      )
    }

    try {
      // ownerToken 在 action 内取，避免模块顶层的循环依赖
      const { ownerToken } = useLlmStore()
      const created = await uploadModelFile(ownerToken, params.file, params.name, params.category)
      const entry = toModelEntry(created)
      // 服务端不记录 AI 生成标记：本次上传的元信息只在当前条目上带一份。
      if (params.aiGenerated) entry.aiGenerated = true
      // 去重：同 id 已在列表（如初始化同步刚拉到同一条）就不插第二份
      models.value = [entry, ...models.value.filter((model) => model.id !== entry.id)]
      return entry
    } catch (error) {
      // 网络失败 / 后端不在：回退 blob。代价是不持久，界面按 sessionOnly 如实标注。
      console.warn('[modelStore] 服务端上传不可用，回退为会话内对象 URL（刷新即失效）', error)
      const newModel = createSessionModel(params, format)
      models.value = [newModel, ...models.value]
      return newModel
    }
  }

  /**
   * 会话内回退上传：浏览器对象 URL **只在当前页面会话内有效**，刷新即失效。
   * 这是在「没有后端」的前提下唯一能让模型真正被加载的办法，
   * 代价是它不持久——界面必须如实标注这一点。
   */
  const createSessionModel = (params: UploadModelParams, format: string): Model => {
    const objectUrl = URL.createObjectURL(params.file)
    const id = `model-${Date.now()}-${uploadedModelSeq++}`

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
      ...(params.aiGenerated ? { aiGenerated: true } : {}),
      sessionOnly: true,
    }

    uploadedFiles.set(id, params.file)
    uploadedUrls.set(id, objectUrl)
    return newModel
  }

  /**
   * 初始化时拉一次服务端列表合并进 models（去重按 id，内置条目不受影响）。
   *
   * 拉取失败安静降级：只保留内置 + 会话条目，不打断页面。
   */
  const syncFromServer = async (): Promise<void> => {
    try {
      const { ownerToken } = useLlmStore()
      if (!ownerToken) return
      const list = await listUploadedModels(ownerToken)
      const knownIds = new Set(models.value.map((model) => model.id))
      const serverEntries = list.items
        .filter((item) => !knownIds.has(item.id))
        .map(toModelEntry)
      if (serverEntries.length > 0) {
        // 服务端按 created_at 倒序返回，插到头部保持「最新在上」
        models.value = [...serverEntries, ...models.value]
      }
    } catch {
      // 后端缺席 / 网络失败：安静降级，不打扰用户
    }
  }
  void syncFromServer()

  // 删除模型
  const deleteModel = (id: string) => {
    const model = getModelById(id)
    if (model?.persisted) {
      // 持久化条目：调服务端 DELETE（文件与记录一起删）。
      // 服务端删除失败不拦住本地移除——本地列表永远以删除操作为准，失败只留痕。
      const { ownerToken } = useLlmStore()
      deleteUploadedModel(ownerToken, id).catch((error: unknown) => {
        console.warn('[modelStore] 服务端删除失败，仅移除了本地条目', error)
      })
    } else {
      // 会话条目：对象 URL 必须回收，否则文件会一直被浏览器攥在内存里，
      // 直到页面关闭才释放。
      const url = uploadedUrls.get(id)
      if (url) {
        URL.revokeObjectURL(url)
        uploadedUrls.delete(id)
      }
      uploadedFiles.delete(id)
    }

    models.value = models.value.filter((model) => model.id !== id)
  }

  /**
   * 把模型添加到场景（**不建刚体**）。
   *
   * ⚠️ 这里只往 store 里塞一个 mesh：没有 Rapier 刚体，也没有碰撞体，
   * 模型既不会下落也不会与地面碰撞。
   * 场景编辑器里的导入走 `useSceneEditor` 的 `importModel`——它会建刚体与包围盒碰撞体。
   * 保留本方法是为了「不经过编辑器、只把模型放进场景」这种用法（如单元测试）。
   */
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
      console.warn('[modelStore] 模型加载失败，无法添加到场景', error)
      reportError(error, '/scene-editor')
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
    selectedModelId,
    getAllModels,
    getModelById,
    getModelsByCategory,
    loadModelById,
    uploadModel,
    deleteModel,
    addModelToScene,
  }
})
