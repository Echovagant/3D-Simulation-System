import { ref } from 'vue'
import { defineStore } from 'pinia'
import type { PresetCatalogEntry, PresetScene, PresetSceneObject } from '@/types'
import { simulationPresets as presetCatalog } from '@/data/simulationPresets'

/**
 * 仿真实验室的状态。
 *
 * 预设目录在这里**首次真正接上**：
 * 以前 `simulationPresets` 是个永远为空的 ref，`loadPreset` 永远找不到东西。
 * 现在它是 `@/data/simulationPresets` 的唯一来源，界面层也从这里读预设。
 */
export const useSimulationStore = defineStore('simulation', () => {
  // 状态
  const activeTool = ref('select')
  const simulationSpeed = ref(1)
  const currentScene = ref<PresetScene | null>(null)
  const simulationStats = ref({
    objects: 0,
    rigidBodies: 0,
    constraints: 0,
    fps: 0,
  })
  // 预设目录（复制一份，避免与模块级清单共享同一个数组）
  const simulationPresets = ref<PresetCatalogEntry[]>([...presetCatalog])

  // 方法
  const setActiveTool = (toolId: string) => {
    activeTool.value = toolId
  }

  const setSpeed = (speed: number) => {
    simulationSpeed.value = speed
  }

  const loadScene = (sceneData: PresetScene) => {
    currentScene.value = sceneData

    // 更新统计信息
    simulationStats.value.objects = countObjects(sceneData)
  }

  /**
   * 按 id 加载预设。
   *
   * 返回命中的预设条目（没找到返回 null）——界面层要用它把场景渲染出来，
   * 不能只靠 store 里的状态。
   */
  const loadPreset = (presetId: string): PresetCatalogEntry | null => {
    const preset = simulationPresets.value.find((p) => p.id === presetId)
    if (!preset) return null

    currentScene.value = preset.scene
    simulationStats.value.objects = countObjects(preset.scene)
    return preset
  }

  const updateStats = (stats: Partial<typeof simulationStats.value>) => {
    simulationStats.value = { ...simulationStats.value, ...stats }
  }

  // 辅助函数
  // objects 计数 = 场景里的物体总数（含嵌套子物体）
  const countObjects = (scene: PresetScene): number => {
    if (!scene || !Array.isArray(scene.objects)) return 0

    const traverse = (object: PresetSceneObject): number => {
      const children = (object as { children?: PresetSceneObject[] }).children
      if (!children || children.length === 0) return 1
      return children.reduce((sum, child) => sum + traverse(child), 1)
    }

    return scene.objects.reduce((sum, obj) => sum + traverse(obj), 0)
  }

  return {
    activeTool,
    simulationSpeed,
    currentScene,
    simulationStats,
    simulationPresets,
    setActiveTool,
    setSpeed,
    loadScene,
    loadPreset,
    updateStats,
  }
})
