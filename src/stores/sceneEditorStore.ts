import { defineStore } from 'pinia'
import { ref, computed, watch, reactive, shallowRef, markRaw } from 'vue'
import * as THREE from 'three'
import type { SceneDocument, SceneDocumentObject, SceneIndexEntry, SceneObject } from '@/types'
import { useModelStore } from './modelStore'
import { useSceneSyncStore } from './sceneSyncStore'
import { createPrimitiveMesh, isPrimitiveType } from '@/utils/primitiveFactory'

// 类型定义补充
export type SimulationState = {
  isPlaying: boolean
  isTransitioning: boolean
  isPaused: boolean
  speed: number
  currentTime: number
  frameCount: number
}

export type WarningDetails = Record<string, unknown>

export type RenderState = {
  /**
   * store 的物理记账循环是否在跑。
   *
   * ⚠️ 它**不是**渲染器的开关：视口的渲染循环由 Viewport 组件自己管
   * （挂载时启动、卸载时停止），「暂停模拟」不该停掉它——否则画面会冻住。
   */
  isSimulationRunning: boolean
  /**
   * 视口的渲染循环是否在跑（由 Viewport 组件写）。
   *
   * 与 isSimulationRunning 分开记：两者曾经共用一个 isRendering，
   * 渲染循环每帧写一次，会把「已暂停」的状态下一帧就盖掉。
   */
  isRenderLoopActive: boolean
  needsUpdate: boolean
  fps: number
  lastFrameTime: number
  performanceWarnings: Array<{ message: string; timestamp: number; details?: WarningDetails }>
  physicsErrors: Array<{ message: string; error: Error; timestamp: number }>
}

/**
 * 物体的**初始变换**：创建时记下的基准值。
 *
 * 「重置模拟」要回到的是**创建时**的变换，而不是 `SceneObject.position`：
 * 后者只是「用户最后一次通过属性面板设定的位置」——物理同步从不写它，
 * 用它复位会退回到一个既不是初始、也不是物理真值的地方。
 */
type InitialTransform = {
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
}

/**
 * 场景文档的存储键约定（计划 018）：
 *
 * - `scene-<id>` 存场景文档
 * - `scene-index` 存索引数组
 *
 * **两个都要维护**：只写文档不写索引 = 场景列不出来。
 */
const SCENE_KEY_PREFIX = 'scene-'
const SCENE_INDEX_KEY = 'scene-index'

/** 场景 id → 存储键 */
const sceneKey = (sceneId: string): string => `${SCENE_KEY_PREFIX}${sceneId}`

/**
 * 基本体工厂：由界面层注册进来。
 *
 * 刚体与碰撞体归 `useSceneEditor` 所有（它是物理世界的唯一所有者），
 * store 不能自己造刚体。因此「加载场景」时通过这个工厂把基本体交给
 * useSceneEditor 去创建——它会连同刚体、碰撞体一起建好。
 *
 * 没有注册工厂时（例如在测试里、或在没有编辑器界面的地方调用），
 * loadScene 会退回到「只有 mesh、没有物理」的基本体，并在返回值里如实反映。
 */
export type PrimitiveFactory = {
  createCube: () => boolean
  createSphere: () => boolean
}

export const useSceneEditorStore = defineStore('useSceneEditorStore', () => {
  // Three.js核心对象使用ref进行管理，移至store内部
  const scene = ref<THREE.Scene | null>(null)
  const camera = ref<THREE.Camera | null>(null)
  const renderer = ref<THREE.WebGLRenderer | null>(null)
  const animationId = ref<number | null>(null)
  // 物理循环是否应当继续排期。stopSimulation 会把它置为 false，
  // 保证即使有一个已排期的回调在停止之后才被触发，也不会让循环复活。
  let isLoopActive = false

  // 分离状态：场景状态
  const selectedObjectUuid = ref<string | null>(null)
  /**
   * 场景物体列表。
   *
   * 用 `shallowRef` 而不是 `reactive`：数组里的 `threeObject` 是完整的 three.js 对象图
   * （position / quaternion / matrix / children / geometry / material …），
   * `reactive` 会把它整棵递归代理，每读一个属性都走一遍 Proxy 拦截；
   * 属性面板的深度 watcher 还会因此每帧把整棵图遍历一遍。
   *
   * 代价：**只能「替换数组」来触发更新**，原地 mutate（push / splice / 下标赋值）不会被追踪。
   * 下面的所有写操作都遵守这条规则。
   */
  const objects = shallowRef<SceneObject[]>([])
  const currentScene = ref<THREE.Scene | null>(null)

  // 分离状态：模拟状态
  const simulationState = reactive<SimulationState>({
    isPlaying: false,
    isTransitioning: false,
    isPaused: false,
    speed: 1.0,
    currentTime: 0,
    frameCount: 0,
  })

  // 分离状态：渲染状态
  const renderState = reactive<RenderState>({
    isSimulationRunning: false,
    isRenderLoopActive: false,
    needsUpdate: true,
    fps: 60,
    lastFrameTime: 0,
    performanceWarnings: [] as Array<{
      message: string
      timestamp: number
      details?: WarningDetails
    }>,
    physicsErrors: [] as Array<{ message: string; error: Error; timestamp: number }>,
  })

  /**
   * 初始变换账本：与 `objects` 同生共死（谁创建谁登记，谁删除谁销账）。
   *
   * 用途只有一个——「重置模拟」的复位基准。
   */
  const initialTransforms = new Map<string, InitialTransform>()

  /**
   * 显式改写「重置模拟」的复位基线。
   *
   * 只有「从存档恢复」的两条路径可以调用它：基本体是通过工厂在**随机出生点**建出来的，
   * 基线必须改写成存档里的位置，否则「重置模拟」会把物体送回随机出生点。
   *
   * ⚠️ 日常的 `updateObject` 路径**不能**调用它：属性面板改位置表示
   * 「用户最后设定的位置」，那不是初始位置，不该污染复位基线。
   */
  const setInitialTransform = (uuid: string, transform: Partial<InitialTransform>) => {
    const current = initialTransforms.get(uuid)
    if (!current) return

    initialTransforms.set(uuid, {
      position: { ...(transform.position ?? current.position) },
      rotation: { ...(transform.rotation ?? current.rotation) },
      scale: { ...(transform.scale ?? current.scale) },
    })
  }

  // 计算属性
  const selectedObject = computed(() => {
    return objects.value.find((item) => item.uuid === selectedObjectUuid.value) || null
  })

  // Getter方法
  const getCurrentScene = () => currentScene.value

  const setCurrentScene = (newScene: THREE.Scene) => {
    currentScene.value = newScene
  }

  const getScene = (): THREE.Scene | null => scene.value
  const getCamera = (): THREE.Camera | null => camera.value
  const getRenderer = (): THREE.WebGLRenderer | null => renderer.value

  // 添加性能警告
  const addPerformanceWarning = (message: string, details?: WarningDetails) => {
    renderState.performanceWarnings.push({
      message,
      timestamp: Date.now(),
      details,
    })
    // 限制警告数量，避免内存占用过多
    if (renderState.performanceWarnings.length > 100) {
      renderState.performanceWarnings.shift()
    }
  }

  // 添加物理错误
  const addPhysicsError = (message: string, error: Error) => {
    renderState.physicsErrors.push({
      message,
      error,
      timestamp: Date.now(),
    })
    // 限制错误数量，避免内存占用过多
    if (renderState.physicsErrors.length > 50) {
      renderState.physicsErrors.shift()
    }
    // 记录到控制台
  }

  // 渲染循环骨架。
  //
  // 物理推进**不在**这里：唯一的物理权威是 Rapier，步进由 useSceneEditor 的
  // 固定步长累加器驱动（见 src/utils/fixedStepAccumulator.ts）。
  // 这条循环只负责渲染侧的记账（最后一帧时间、是否需要重绘），
  // 并维持 startSimulation / stopSimulation 的启停语义。
  const physicsUpdateLoop = () => {
    try {
      // 已经被 stopSimulation 终止：不再推进物理，也不再排期下一帧。
      // 这里必须把 animationId 清空：若 stopSimulation 恰好在本回调执行期间被调用，
      // 回调末尾会用非空的 animationId 重新排期，下一帧早退却留下非空 animationId，
      // 之后每次 startSimulation 都被守卫挡住——仿真再也起不来。
      if (!isLoopActive) {
        animationId.value = null
        return
      }

      // 只有「用户想让它跑」且「没有暂停」时才记账。
      // 循环本身始终重新排期，暂停只是不记账——否则链条会断掉，
      // 之后 startSimulation 的 animationId 守卫会把重启挡在门外。
      if (simulationState.isPlaying && !simulationState.isPaused) {
        renderState.lastFrameTime = performance.now()
        renderState.needsUpdate = true
      }

      // 继续循环
      animationId.value = requestAnimationFrame(physicsUpdateLoop)
    } catch (error) {
      addPhysicsError('物理更新循环出错', error as Error)
      // 发生错误时停止循环
      isLoopActive = false
      if (animationId.value) {
        cancelAnimationFrame(animationId.value)
        animationId.value = null
      }
    }
  }

  // 开始物理模拟 - 改进错误处理和状态管理
  //
  // ⚠️ `renderState.isSimulationRunning` 在这里表示「store 的记账循环是否在跑」。
  // 它**不是**渲染器的开关：视口的渲染循环由 Viewport 组件自己管
  // （挂载时启动、卸载时停止），「暂停模拟」不该停掉它——否则画面会冻住。
  const startSimulation = () => {
    try {
      // 「是否已经在跑」只看 animationId：
      // simulationState.isPlaying 是用户的意图（想不想让它跑），
      // animationId 才是实际状态（跑没跑）。用 isPlaying 判断会把启动挡在门外。
      if (animationId.value) {
        return
      }

      renderState.isSimulationRunning = true
      isLoopActive = true
      animationId.value = requestAnimationFrame(physicsUpdateLoop)
    } catch (error) {
      isLoopActive = false
      addPhysicsError('物理模拟启动失败', error as Error)
    }
  }

  // 停止物理模拟 - 改进错误处理和状态管理
  //
  // 这里停的是**物理与记账**，不是渲染：渲染循环归 Viewport 组件所有，
  // 「暂停模拟」之后画面必须还能刷新、能转视角。
  const stopSimulation = () => {
    try {
      isLoopActive = false
      if (animationId.value) {
        cancelAnimationFrame(animationId.value)
        animationId.value = null
      }
      renderState.isSimulationRunning = false
    } catch (error) {
      addPhysicsError('物理模拟停止失败', error as Error)
    }
  }

  // 重置物理模拟 - 停掉循环、把每个物体复位到创建时的初始变换、再按需重新启动
  const resetSimulation = () => {
    stopSimulation()

    // 把每个物体复位到**创建时**的初始变换。
    //
    // 走 007 建立的 update-transform 事件桥接：useSceneEditor 是刚体与碰撞体的
    // 唯一所有者，由它把 setTranslation / setLinvel(0) / setAngvel(0) 与碰撞体形状
    // 一起复位。store 这里**不**直接写 threeObject —— mesh 是刚体的镜像，
    // 写了也会被物理同步覆盖（而且那会变成「第二个物理权威」）。
    objects.value.forEach((obj) => {
      const initial = initialTransforms.get(obj.uuid)
      if (!initial) return

      const transformEvent = new CustomEvent('update-transform', {
        detail: {
          uuid: obj.uuid,
          transform: {
            position: { ...initial.position },
            rotation: { ...initial.rotation },
            scale: { ...initial.scale },
          },
        },
      })
      window.dispatchEvent(transformEvent)
    })

    // 仿真时钟归零：currentTime / frameCount 记的是「模拟了多久」，
    // 由固定步长累加器推进，重置后从 0 重新计。
    simulationState.currentTime = 0
    simulationState.frameCount = 0
    renderState.lastFrameTime = 0

    // 之前在跑就继续跑
    if (simulationState.isPlaying) {
      startSimulation()
    }
  }

  // 带过渡的播放状态切换 - 改进状态管理
  const togglePlayStateWithTransition = async () => {
    if (simulationState.isTransitioning) return

    simulationState.isTransitioning = true

    try {
      if (simulationState.isPlaying) {
        // 停止模拟
        stopSimulation()
        simulationState.isPlaying = false
      } else {
        // 开始模拟
        simulationState.isPlaying = true
        startSimulation()
      }

      // 短暂延迟确保状态切换完成
      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error) {
      // 状态切换失败不中断流程，但现场必须留下来：否则界面上只会看到「没反应」
      console.warn('[sceneEditorStore] 播放状态切换失败', error)
    } finally {
      simulationState.isTransitioning = false
    }
  }

  // 获取选中的Three.js对象（保持原有）
  const getSelectedThreeObject = (): THREE.Object3D | null => {
    return selectedObject.value?.threeObject || null
  }

  // 初始化Three.js核心对象
  const initializeScene = (
    newScene: THREE.Scene,
    newCamera: THREE.PerspectiveCamera,
    newRenderer: THREE.WebGLRenderer,
  ): void => {
    try {
      scene.value = markRaw(newScene)
      camera.value = markRaw(newCamera)
      renderer.value = markRaw(newRenderer)
    } catch (error) {
      // 初始化失败不能把异常抛给界面（界面会显示成白屏），但必须留下现场
      console.warn('[sceneEditorStore] 场景核心对象初始化失败', error)
    }
  }

  // 新增：场景保存与加载

  /**
   * 场景索引的版本号。
   *
   * 索引本身存在 localStorage 里（不是响应式数据），界面层靠监听这个版本号
   * 来刷新「我的场景」列表——保存 / 删除之后列表能立刻更新。
   */
  const sceneIndexVersion = ref(0)

  /** 基本体工厂（由界面层注册，见 PrimitiveFactory 的说明） */
  const primitiveFactory = shallowRef<PrimitiveFactory | null>(null)

  /**
   * 注册基本体工厂。
   *
   * 传入 null 表示注销（例如编辑器界面卸载时）。
   */
  const registerPrimitiveFactory = (factory: PrimitiveFactory | null) => {
    primitiveFactory.value = factory
  }

  /** 读取场景索引；索引损坏时返回空数组而不是抛错 */
  const readSceneIndex = (): SceneIndexEntry[] => {
    try {
      const raw = localStorage.getItem(SCENE_INDEX_KEY)
      if (!raw) return []
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as SceneIndexEntry[]) : []
    } catch (error) {
      console.error('[sceneEditorStore] 读取场景索引失败', error)
      return []
    }
  }

  /** 写入场景索引并通知界面刷新 */
  const writeSceneIndex = (index: SceneIndexEntry[]) => {
    localStorage.setItem(SCENE_INDEX_KEY, JSON.stringify(index))
    sceneIndexVersion.value += 1
  }

  /**
   * 列出已保存的场景（按保存时间倒序）。
   */
  const listScenes = (): SceneIndexEntry[] => readSceneIndex()

  /**
   * 生成一个不与已有场景冲突的 id。
   *
   * 同一毫秒内连续保存会撞 id，因此冲突时追加序号。
   */
  const createSceneId = (): string => {
    const base = `${Date.now()}`
    const taken = new Set(readSceneIndex().map((entry) => entry.id))
    if (!taken.has(base)) return base

    let suffix = 1
    while (taken.has(`${base}-${suffix}`)) suffix += 1
    return `${base}-${suffix}`
  }

  /**
   * 把 store 里的物体转成场景文档里的物体。
   *
   * 位置取的是 **mesh 的当前真实变换**，不是 `SceneObject.position`：
   * 后者的语义是「用户最后一次通过属性面板设定的位置」，
   * 物理同步（Rapier → mesh）从不回写它；跑过仿真的物体，
   * 它的真实位置已经在 mesh 上，而 `SceneObject.position` 还停在旧值。
   * 存「用户以为的位置」会让「存一个掉到地上的方块」还原回半空。
   */
  const toDocumentObject = (obj: SceneObject): SceneDocumentObject => {
    const three = obj.threeObject

    const position = three
      ? { x: three.position.x, y: three.position.y, z: three.position.z }
      : { x: obj.position.x, y: obj.position.y, z: obj.position.z }
    const rotation = three
      ? { x: three.rotation.x, y: three.rotation.y, z: three.rotation.z }
      : { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z }
    const scale = three
      ? { x: three.scale.x, y: three.scale.y, z: three.scale.z }
      : { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z }

    return {
      uuid: obj.uuid,
      type: obj.type,
      name: obj.name ?? '',
      modelId: obj.modelId,
      position,
      rotation,
      scale,
      visible: obj.visible !== false,
      physics: obj.physics
        ? {
            type: obj.physics.type,
            shape: obj.physics.shape,
            mass: obj.physics.mass,
          }
        : undefined,
    }
  }

  /**
   * 构造场景文档（保存与导出共用同一份构造逻辑）。
   */
  const buildSceneDocument = (sceneName: string, sceneId?: string): SceneDocument => {
    const now = new Date().toISOString()
    return {
      id: sceneId ?? createSceneId(),
      name: sceneName,
      createdAt: now,
      updatedAt: now,
      version: 1,
      objects: objects.value.map((obj) => toDocumentObject(obj)),
    }
  }

  /**
   * 把一份场景文档收进本地库。
   *
   * 云端拉来的场景先落到本地再打开：这样它会出现在「我的场景」里，
   * 之后后端不在了也照样打得开——本地是缓存，不是副本。
   */
  const importSceneDocument = (doc: SceneDocument): string => {
    localStorage.setItem(sceneKey(doc.id), JSON.stringify(doc))

    const index = readSceneIndex().filter((entry) => entry.id !== doc.id)
    index.unshift({
      id: doc.id,
      name: doc.name,
      createdAt: doc.createdAt,
      objectCount: doc.objects.length,
    })
    writeSceneIndex(index)

    return doc.id
  }

  /**
   * 保存场景。
   *
   * 写两处：`scene-<id>` 存文档、`scene-index` 存索引。
   * 返回场景 id——界面层要拿它把场景找回来（列表、深链接都靠它）。
   */
  const saveScene = async (sceneName: string): Promise<string> => {
    const doc = buildSceneDocument(sceneName)
    importSceneDocument(doc)

    // 本地写完之后**顺手**推一份到后端。
    // 推送失败不打扰用户：后端缺席时场景照样存在本地。
    const sync = useSceneSyncStore()
    void sync.pushScene(doc).then((ok) => {
      if (!ok && sync.state === 'error') {
        // 只有「真错误」才记日志；「后端不在」是正常状态，不打扰
        console.warn('[sceneSync] 场景同步到后端失败', sync.lastError)
      }
    })

    return doc.id
  }

  /**
   * 读取场景文档。
   *
   * 兼容两种历史键名：
   * - `scene-<id>`：当前约定
   * - `<id>`：早期把 id 直接当键用的写法
   * - `scene-scene-<id>`：更早的双前缀写法
   */
  const getSceneDocument = (sceneId: string): SceneDocument | null => {
    const candidates = [sceneKey(sceneId), sceneId, `${SCENE_KEY_PREFIX}${sceneKey(sceneId)}`]

    for (const key of candidates) {
      const raw = localStorage.getItem(key)
      if (!raw) continue

      try {
        const parsed = JSON.parse(raw) as SceneDocument
        if (!parsed || !Array.isArray(parsed.objects)) return null
        return parsed
      } catch (error) {
        console.error('[sceneEditorStore] 场景解析失败', error)
        return null
      }
    }

    return null
  }

  /**
   * 删除一个已保存的场景（文档 + 索引项）。
   */
  const deleteScene = (sceneId: string): boolean => {
    const doc = getSceneDocument(sceneId)
    if (!doc) return false

    for (const key of [sceneKey(sceneId), sceneId, `${SCENE_KEY_PREFIX}${sceneKey(sceneId)}`]) {
      localStorage.removeItem(key)
    }

    writeSceneIndex(readSceneIndex().filter((entry) => entry.id !== sceneId))
    return true
  }

  /**
   * 重建一个基本体。
   *
   * 优先走界面层注册进来的工厂（有刚体）；没有工厂时退回「只有 mesh」。
   */
  const restorePrimitive = (objData: SceneDocumentObject): boolean => {
    if (!isPrimitiveType(objData.type)) return false

    const factory = primitiveFactory.value
    if (factory) {
      const before = objects.value.length
      const created = objData.type === 'sphere' ? factory.createSphere() : factory.createCube()

      const restored = created ? objects.value[before] : undefined
      if (restored) {
        if (restored.threeObject) {
          restored.threeObject.name = objData.name
        }
        // updateObject 会把变换写进 mesh，并派发 update-transform 让刚体跟上
        updateObject(restored.uuid, {
          name: objData.name,
          position: objData.position,
          rotation: objData.rotation,
          scale: objData.scale,
          visible: objData.visible !== false,
        })
        // 工厂是在随机出生点建体的：复位基线必须改写成存档里的位置，
        // 否则「重置模拟」会把物体送回随机出生点。
        setInitialTransform(restored.uuid, {
          position: objData.position,
          rotation: objData.rotation,
          scale: objData.scale,
        })
        return true
      }
    }

    // 兜底：没有物理桥（没有编辑器界面 / 物理还没起来）时，只还原 mesh
    const mesh = createPrimitiveMesh(objData.type)
    mesh.name = objData.name
    mesh.position.set(objData.position.x, objData.position.y, objData.position.z)
    mesh.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z)
    mesh.scale.set(objData.scale.x, objData.scale.y, objData.scale.z)
    mesh.visible = objData.visible !== false

    addObject({
      uuid: objData.uuid,
      type: objData.type,
      name: objData.name,
      threeObject: mesh,
      position: objData.position,
      rotation: objData.rotation,
      scale: objData.scale,
      visible: objData.visible !== false,
    })
    return true
  }

  /**
   * 重建一个模型物体。
   *
   * 走 modelStore 的统一入口：库里的模型按 URL 加载，
   * 本次会话上传的模型按内存里的 File 加载。
   */
  const restoreModel = async (objData: SceneDocumentObject): Promise<boolean> => {
    if (!objData.modelId) return false

    const modelStore = useModelStore()
    const model = await modelStore.loadModelById(objData.modelId)
    if (!model) return false

    model.position.set(objData.position.x, objData.position.y, objData.position.z)
    model.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z)
    model.scale.set(objData.scale.x, objData.scale.y, objData.scale.z)
    model.visible = objData.visible !== false

    addObject({
      uuid: objData.uuid,
      type: 'model',
      name: objData.name,
      threeObject: model,
      modelId: objData.modelId,
      position: objData.position,
      rotation: objData.rotation,
      scale: objData.scale,
      visible: objData.visible !== false,
    })
    // 复位基线就是存档里的位置：模型没有「随机出生点」这一步，
    // 但基线必须显式对齐，否则以后改动建体流程时基线会悄悄跑偏。
    setInitialTransform(objData.uuid, {
      position: objData.position,
      rotation: objData.rotation,
      scale: objData.scale,
    })
    return true
  }

  // 新增：加载场景
  const loadScene = async (sceneId: string): Promise<boolean> => {
    const doc = getSceneDocument(sceneId)
    if (!doc) return false

    // 清空现有场景（连带通知物理引擎销掉旧刚体）
    cleanup()

    for (const objData of doc.objects ?? []) {
      if (objData.type === 'model') {
        await restoreModel(objData)
        continue
      }

      restorePrimitive(objData)
    }

    return true
  }

  // 添加物体（保留原有并扩展，支持模型库对象）
  const addObject = (
    objectData: {
      uuid: string
      name: string
      type: string
      position: { x: number; y: number; z: number }
      rotation: { x: number; y: number; z: number }
      scale: { x: number; y: number; z: number }
      visible?: boolean
      threeObject?: THREE.Object3D
      modelId?: string
    },
    mass: number = 1,
  ) => {
    // 补全默认属性
    const object: SceneObject = {
      uuid: objectData.uuid,
      name: objectData.name,
      type: objectData.type,
      position: objectData.position,
      rotation: objectData.rotation,
      scale: objectData.scale,
      visible: objectData.visible ?? true,
      // three 对象必须在**写入 store 的那一刻**就 markRaw：
      // 只在读取处包一层 toRaw() 能修症状，但对象仍会被深度代理，性能问题还在。
      // 只标记 threeObject 本身，不标记整条 SceneObject（其余字段仍需可追踪）。
      threeObject: objectData.threeObject ? markRaw(objectData.threeObject) : undefined,
      modelId: objectData.modelId,
    }

    // 物理记录：只保留「这是动力学刚体、质量多少」这类**静态**信息。
    // 速度、加速度、是否下落这些动态状态已随手写积分器一起删除——
    // 动态状态的真值只有 Rapier 刚体（body.linvel() / body.translation()），
    // 这里再存一份镜像只会变成「第二个权威」。
    // 碰撞体的实际形状同样以 Rapier 里那个碰撞体为准。
    const shape: 'box' | 'sphere' | 'mesh' =
      objectData.type === 'cube' ? 'box' : objectData.type === 'sphere' ? 'sphere' : 'mesh'
    object.physics = {
      type: 'dynamic',
      shape,
      mass,
    }

    // 记录创建时的初始变换：这是「重置模拟」的复位基准。
    // 之后用户在属性面板里改位置不会影响它——那是「用户最后设定的位置」，不是初始位置。
    initialTransforms.set(object.uuid, {
      position: { ...object.position },
      rotation: { ...object.rotation },
      scale: { ...object.scale },
    })

    // shallowRef 只能通过「替换数组」触发更新，不能原地 push
    objects.value = [...objects.value, object]

    // 添加到场景
    if (scene.value && object.threeObject) {
      scene.value.add(object.threeObject)
    }

    // 如果正在播放，确保新物体也会受到物理影响
    if (simulationState.isPlaying && !animationId.value) {
      startSimulation()
    }

    return object // 返回添加的对象，方便后续处理
  }

  // 设置选中对象（保持原有）
  const setSelectedObject = (uuid: string | null) => {
    selectedObjectUuid.value = uuid
  }

  // 从场景中移除对象（扩展原有removeSelectedObject，支持按ID删除）
  const removeObject = (uuid: string) => {
    const targetIndex = objects.value.findIndex((item) => item.uuid === uuid)

    if (targetIndex === -1) {
      return
    }

    const target = objects.value[targetIndex]

    // 从场景中移除。
    // threeObject 是 markRaw 过的原始对象，与 scene.children 里的是同一个引用，
    // Object3D.remove() 内部的 children.indexOf() 才能命中——用响应式代理会静默失败，
    // 表现为「物体从 store 里删掉了，视口里却还留着」。
    if (scene.value && target.threeObject) {
      scene.value.remove(target.threeObject)
    }

    // 通知物理引擎移除刚体（由 useSceneEditor 负责实际移除）。
    // 必须无条件派发：刚体是删除物体的一部分，不是可选项。
    // 载荷以 uuid 为准，object 只是向后兼容的附带信息。
    const removeEvent = new CustomEvent('remove-rigidbody', {
      detail: { uuid: target.uuid, object: target.threeObject },
    })
    window.dispatchEvent(removeEvent)

    // 从数组中移除（shallowRef：替换数组而不是 splice）
    objects.value = objects.value.filter((_, i) => i !== targetIndex)

    // 初始变换账本与 objects 同生共死
    initialTransforms.delete(target.uuid)

    // 如果删除的是选中对象，重置选中状态
    if (selectedObjectUuid.value === uuid) {
      selectedObjectUuid.value = null
    }
  }

  // 移除选中对象（保持原有，基于removeObject实现）
  const removeSelectedObject = () => {
    if (selectedObjectUuid.value) {
      removeObject(selectedObjectUuid.value)
    }
  }

  /**
   * 更新对象属性（用户编辑路径）。
   *
   * `SceneObject.position` / `rotation` / `scale` 的语义是
   * **「用户设定的变换值」**：创建时写入，用户在属性面板里改动时更新，
   * 仿真中的物理位移**不会**回写它们（物理真值在 Rapier 刚体上）。
   * 「重置模拟」的复位基准不在这里，而在 `initialTransforms` 账本里。
   *
   * 这是 `threeObject.position` 的两个合法写入点之一（另一个是物理同步
   * `syncPhysicsToObjects`）——位置的真值始终是 Rapier 刚体。
   */
  const updateObject = (uuid: string, properties: Partial<SceneObject>) => {
    const index = objects.value.findIndex((obj) => obj.uuid === uuid)
    if (index !== -1) {
      // 更新基础属性。
      // shallowRef 不追踪原地修改，只能替换数组；这里用 map 换掉目标元素，
      // 元素身份变化与改造前 `objects[index] = {...}` 的行为一致。
      const updated: SceneObject = { ...objects.value[index], ...properties }
      objects.value = objects.value.map((obj, i) => (i === index ? updated : obj))

      // 如果更新了位置/旋转/缩放，同步到threeObject
      const { position, rotation, scale, visible } = properties
      const threeObject = updated.threeObject
      if (position && threeObject) {
        threeObject.position.set(position.x, position.y, position.z)
      }
      if (rotation && threeObject) {
        threeObject.rotation.set(rotation.x, rotation.y, rotation.z)
      }
      if (scale && threeObject) {
        threeObject.scale.set(scale.x, scale.y, scale.z)
      }
      if (visible !== undefined && threeObject) {
        threeObject.visible = visible
      }

      // 通知物理引擎：刚体与碰撞体必须跟着变。
      // 物理同步是「刚体 → mesh」的绝对覆盖，只改 mesh 的话下一帧就被弹回原位，
      // 缩放更是压根到不了碰撞体。物理引擎没起来时没人监听，这里是安全的空操作。
      if (position || rotation || scale) {
        const transformEvent = new CustomEvent('update-transform', {
          detail: { uuid, transform: { position, rotation, scale } },
        })
        window.dispatchEvent(transformEvent)
      }
    }
  }
  const updateRendererSize = (width: number, height: number): void => {
    if (renderer.value && camera.value) {
      renderer.value.setSize(width, height)

      if (camera.value instanceof THREE.PerspectiveCamera) {
        camera.value.aspect = width / height
        camera.value.updateProjectionMatrix()
      }
    }
  }

  // 获取场景截图（保持原有）
  const getScreenshot = (): string | null => {
    if (!renderer.value || !scene.value || !camera.value) return null
    renderer.value.render(scene.value, camera.value)
    return renderer.value.domElement.toDataURL('image/png')
  }

  // 清理函数（保持原有）
  const cleanup = () => {
    stopSimulation()
    if (scene.value) {
      objects.value.forEach((obj) => {
        if (obj.threeObject) {
          scene.value?.remove(obj.threeObject)
        }
      })
    }

    // 通知物理引擎销掉刚体：刚体是删除物体的一部分，不是可选项。
    // 不销账的话，旧刚体会留在物理世界里继续参与碰撞——
    // 「加载另一个场景」之后，旧场景的方块还在暗中撞新场景的东西。
    objects.value.forEach((obj) => {
      window.dispatchEvent(
        new CustomEvent('remove-rigidbody', {
          detail: { uuid: obj.uuid, object: obj.threeObject },
        }),
      )
    })

    objects.value = []
    initialTransforms.clear()
    selectedObjectUuid.value = null
    simulationState.isPlaying = false
  }

  // 监听模拟状态变化
  watch(
    () => simulationState.isPlaying,
    (newValue) => {
      if (newValue && !animationId.value) {
        startSimulation()
      } else if (!newValue && animationId.value) {
        stopSimulation()
      }
    },
  )

  // 新增：暂停/恢复模拟功能
  const togglePause = () => {
    simulationState.isPaused = !simulationState.isPaused
    renderState.needsUpdate = true
  }

  // 新增：设置模拟速度
  const setSimulationSpeed = (speed: number) => {
    simulationState.speed = Math.max(0.1, Math.min(5.0, speed)) // 限制速度范围
  }

  return {
    // 状态
    selectedObjectUuid,
    objects,
    currentScene,
    selectedObject,

    // 分离的状态对象
    simulationState,
    renderState,

    // 方法
    saveScene,
    loadScene,
    listScenes,
    getSceneDocument,
    deleteScene,
    importSceneDocument,
    buildSceneDocument,
    registerPrimitiveFactory,
    sceneIndexVersion,
    getCurrentScene,
    setCurrentScene,
    getSelectedThreeObject,
    getScene,
    getCamera,
    getRenderer,
    initializeScene,
    addObject,
    setInitialTransform,
    setSelectedObject,
    removeObject,
    removeSelectedObject,
    updateObject,
    updateRendererSize,
    getScreenshot,

    // 模拟控制方法
    togglePlayState: () => {
      simulationState.isPlaying = !simulationState.isPlaying
    },
    togglePlayStateWithTransition,
    togglePause,
    setSimulationSpeed,
    startSimulation,
    stopSimulation,
    resetSimulation,
    cleanup,

    // 错误和警告处理
    addPerformanceWarning,
    addPhysicsError,
  }
})
