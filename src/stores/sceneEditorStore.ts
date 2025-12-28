import { defineStore } from 'pinia'
import { ref, computed, watch, reactive, markRaw } from 'vue'
import * as THREE from 'three'
import type { SceneObject, PhysicsConfig } from '@/types'
import { useModelStore } from './modelStore'
import { loadModel } from '@/utils/modelLoader'

// 物理时钟
const physicsClock = new THREE.Clock()

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
  isRendering: boolean
  needsUpdate: boolean
  fps: number
  lastFrameTime: number
  performanceWarnings: Array<{ message: string; timestamp: number; details?: WarningDetails }>
  physicsErrors: Array<{ message: string; error: Error; timestamp: number }>
}

export const useSceneEditorStore = defineStore('useSceneEditorStore', () => {
  // Three.js核心对象使用ref进行管理，移至store内部
  const scene = ref<THREE.Scene | null>(null)
  const camera = ref<THREE.Camera | null>(null)
  const renderer = ref<THREE.WebGLRenderer | null>(null)
  const animationId = ref<number | null>(null)
  const lastPhysicsUpdate = ref<number>(0)

  // 分离状态：场景状态
  const selectedObjectUuid = ref<string | null>(null)
  const objects = reactive<SceneObject[]>([])
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
    isRendering: false,
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

  // 物理配置
  const physicsConfig = reactive<PhysicsConfig>({
    gravity: 9.8,
    airResistance: 0.98,
    updateRate: 16, // ~60fps
  })

  // 计算属性
  const selectedObject = computed(() => {
    return objects.find((item) => item.uuid === selectedObjectUuid.value) || null
  })

  // Getter方法
  const getCurrentScene = () => currentScene.value

  const setCurrentScene = (newScene: THREE.Scene) => {
    currentScene.value = newScene
  }

  const getScene = (): THREE.Scene | null => scene.value
  const getCamera = (): THREE.Camera | null => camera.value
  const getRenderer = (): THREE.WebGLRenderer | null => renderer.value

  // 初始化物理属性（保持原有）
  const initializePhysics = (object: SceneObject, mass: number = 1) => {
    object.physics = {
      type: 'dynamic',
      shape: 'mesh',
      velocity: new THREE.Vector3(0, 0, 0),
      acceleration: new THREE.Vector3(0, -physicsConfig.gravity, 0),
      mass,
      isFalling: true,
    }
  }

  // 更新单个物体的物理状态 - 添加错误处理和安全检查
  const updateObjectPhysics = (object: SceneObject, deltaTime: number) => {
    try {
      // 安全检查
      if (!object || !object.physics || !object.physics.isFalling || !object.threeObject) return

      const { velocity, acceleration } = object.physics

      // 检查必要属性是否存在
      if (
        !velocity ||
        !acceleration ||
        typeof velocity.x !== 'number' ||
        typeof acceleration.x !== 'number'
      ) {
        console.warn('物理属性不完整，跳过对象物理更新:', object.name)
        return
      }

      // 应用模拟速度因子
      const adjustedDeltaTime = deltaTime * simulationState.speed

      // 手动计算新速度 (v = u + at)
      const newVelocityX = velocity.x + acceleration.x * adjustedDeltaTime
      const newVelocityY = velocity.y + acceleration.y * adjustedDeltaTime
      const newVelocityZ = velocity.z + acceleration.z * adjustedDeltaTime

      // 应用空气阻力
      velocity.x = newVelocityX * physicsConfig.airResistance
      velocity.y = newVelocityY * physicsConfig.airResistance
      velocity.z = newVelocityZ * physicsConfig.airResistance

      // 计算位置变化 (s = vt)
      const positionDelta = new THREE.Vector3(
        velocity.x * adjustedDeltaTime,
        velocity.y * adjustedDeltaTime,
        velocity.z * adjustedDeltaTime,
      )

      // 更新位置
      object.threeObject.position.add(positionDelta)

      // 简单地面碰撞检测
      if (object.threeObject.position.y < 0) {
        object.threeObject.position.y = 0
        velocity.y = -velocity.y * 0.8 // 能量损失

        // 如果速度很小，停止下落
        if (Math.abs(velocity.y) < 0.1) {
          velocity.y = 0
          if (object.physics) {
            object.physics.isFalling = false
          }
        }
      }
    } catch (error) {
      console.error('更新对象物理状态时出错:', error)
    }
  }

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
    console.error(`[Physics] ${message}:`, error)
  }

  // 物理世界更新循环 - 改进性能和错误处理
  const physicsUpdateLoop = () => {
    try {
      if (!simulationState.isPlaying || simulationState.isPaused) return

      // 计算时间差，确保物理计算稳定
      const deltaTime = physicsClock.getDelta()
      const currentTime = performance.now()

      // 更新渲染状态
      renderState.lastFrameTime = currentTime
      renderState.needsUpdate = true

      // 控制物理更新频率
      if (currentTime - lastPhysicsUpdate.value > physicsConfig.updateRate) {
        objects.forEach((obj) => updateObjectPhysics(obj, deltaTime))
        lastPhysicsUpdate.value = currentTime
      }

      // 继续循环
      animationId.value = requestAnimationFrame(physicsUpdateLoop)
    } catch (error) {
      addPhysicsError('物理更新循环出错', error as Error)
      // 发生错误时停止循环
      if (animationId.value) {
        cancelAnimationFrame(animationId.value)
        animationId.value = null
      }
    }
  }

  // 开始物理模拟 - 改进错误处理和状态管理
  const startSimulation = () => {
    try {
      if (simulationState.isPlaying || animationId.value) {
        console.warn('模拟已经在运行中')
        return
      }

      physicsClock.start()
      lastPhysicsUpdate.value = performance.now()
      renderState.isRendering = true
      animationId.value = requestAnimationFrame(physicsUpdateLoop)
    } catch (error) {
      console.error('启动物理模拟时出错:', error)
    }
  }

  // 停止物理模拟 - 改进错误处理和状态管理
  const stopSimulation = () => {
    try {
      if (animationId.value) {
        cancelAnimationFrame(animationId.value)
        animationId.value = null
      }
      physicsClock.stop()
      renderState.isRendering = false
    } catch (error) {
      console.error('停止物理模拟时出错:', error)
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
      console.error('切换播放状态时出错:', error)
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
      console.log('[SceneEditorStore] 场景初始化完成')
    } catch (error) {
      console.error('初始化场景时出错:', error)
    }
  }

  // 新增：场景保存与加载
  const saveScene = async (sceneName: string): Promise<string> => {
    const sceneData = {
      name: sceneName,
      objects: objects.map((obj) => ({
        uuid: obj.uuid,
        type: obj.type,
        name: obj.name,
        modelId: obj.modelId,
        position: obj.position,
        rotation: obj.rotation,
        scale: obj.scale,
        visible: obj.visible,
      })),
      timestamp: new Date().toISOString(),
    }

    // 实际项目中可能会调用API保存到后端
    const sceneId = `scene-${Date.now()}`
    localStorage.setItem(`scene-${sceneId}`, JSON.stringify(sceneData))
    return sceneId
  }

  // 新增：加载场景
  const loadScene = async (sceneId: string): Promise<boolean> => {
    // 清空现有场景
    cleanup()

    // 实际项目中可能会调用API从后端加载
    const sceneDataStr = localStorage.getItem(`scene-${sceneId}`)
    if (!sceneDataStr) return false

    const sceneData = JSON.parse(sceneDataStr)

    // 重新创建物体（简化处理，实际需根据类型重新加载）
    for (const objData of sceneData.objects) {
      if (objData.type === 'model' && objData.modelId) {
        // 通知模型库加载模型（通过事件或直接调用）
        const modelStore = useModelStore()
        const modelInfo = modelStore.models.find((m) => m.id === objData.modelId)
        if (modelInfo) {
          const model = await loadModel(modelInfo.modelUrl)
          if (model) {
            // 设置模型属性
            if (objData.position)
              model.position.set(objData.position.x, objData.position.y, objData.position.z)
            if (objData.rotation)
              model.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z)
            if (objData.scale) model.scale.set(objData.scale.x, objData.scale.y, objData.scale.z)
            model.visible = objData.visible !== false

            addObject({
              uuid: objData.uuid,
              type: 'model',
              name: objData.name,
              threeObject: model,
              modelId: objData.modelId,
              ...objData,
            })
          }
        }
      }
      // 处理其他类型物体...
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
      threeObject: objectData.threeObject,
      modelId: objectData.modelId,
    }

    // 初始化物理属性
    initializePhysics(object, mass)

    objects.push(object)

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
    console.log(`[DEBUG] removeObject调用: 开始删除对象 UUID=${uuid}`)

    const targetIndex = objects.findIndex((item) => item.uuid === uuid)
    console.log(`[DEBUG] removeObject: 查找对象结果 index=${targetIndex}`)

    if (targetIndex === -1) {
      console.log(`[DEBUG] removeObject: 未找到UUID=${uuid}的对象`)
      return
    }

    const target = objects[targetIndex]
    console.log(`[DEBUG] removeObject: 找到对象 ${target.name} (UUID: ${target.uuid})`)

    // 从场景中移除
    if (scene.value && target.threeObject) {
      console.log(`[DEBUG] removeObject: 从场景中移除threeObject`)
      scene.value.remove(target.threeObject)

      // 新增：从物理引擎中移除刚体（如果存在）
      if (target.threeObject.userData?.physics?.body) {
        console.log(`[DEBUG] removeObject: 从物理引擎中移除刚体`)
        // 通过事件通知物理引擎移除刚体
        const removeEvent = new CustomEvent('remove-rigidbody', {
          detail: { object: target.threeObject },
        })
        window.dispatchEvent(removeEvent)
      } else {
        console.log(`[DEBUG] removeObject: 对象没有物理刚体`)
      }
    } else {
      console.log(`[DEBUG] removeObject: 场景或threeObject不存在`)
    }

    // 从数组中移除
    console.log(`[DEBUG] removeObject: 从objects数组中移除对象`)
    objects.splice(targetIndex, 1)

    // 如果删除的是选中对象，重置选中状态
    if (selectedObjectUuid.value === uuid) {
      console.log(`[DEBUG] removeObject: 重置选中状态`)
      selectedObjectUuid.value = null
    }

    console.log(`[DEBUG] removeObject: 删除完成`)
  }

  // 移除选中对象（保持原有，基于removeObject实现）
  const removeSelectedObject = () => {
    if (selectedObjectUuid.value) {
      removeObject(selectedObjectUuid.value)
    }
  }

  // 更新对象属性（新增：支持更新位置、旋转等属性）
  const updateObject = (uuid: string, properties: Partial<SceneObject>) => {
    const index = objects.findIndex((obj) => obj.uuid === uuid)
    if (index !== -1) {
      // 更新基础属性
      objects[index] = { ...objects[index], ...properties }

      // 如果更新了位置/旋转/缩放，同步到threeObject
      const { position, rotation, scale, visible } = properties
      if (position && objects[index].threeObject) {
        objects[index].threeObject.position.set(position.x, position.y, position.z)
      }
      if (rotation && objects[index].threeObject) {
        objects[index].threeObject.rotation.set(rotation.x, rotation.y, rotation.z)
      }
      if (scale && objects[index].threeObject) {
        objects[index].threeObject.scale.set(scale.x, scale.y, scale.z)
      }
      if (visible !== undefined && objects[index].threeObject) {
        objects[index].threeObject.visible = visible
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
      objects.forEach((obj) => {
        if (obj.threeObject) {
          scene.value?.remove(obj.threeObject)
        }
      })
    }
    objects.length = 0
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
    physicsConfig,
    selectedObject,

    // 分离的状态对象
    simulationState,
    renderState,

    // 方法
    saveScene,
    loadScene,
    getCurrentScene,
    setCurrentScene,
    getSelectedThreeObject,
    getScene,
    getCamera,
    getRenderer,
    initializeScene,
    addObject,
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
    cleanup,

    // 错误和警告处理
    addPerformanceWarning,
    addPhysicsError,
  }
})
