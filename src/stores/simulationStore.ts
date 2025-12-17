import { ref } from 'vue';
import { defineStore } from 'pinia';
import { Object3D } from 'three';
import type { SimulationScene, SimulationPreset } from '@/types';

export const useSimulationStore = defineStore('simulation', () => {
  // 状态
  const activeTool = ref('select');
  const simulationSpeed = ref(1);
  const currentScene = ref<SimulationScene | null>(null);
  const simulationStats = ref({
    objects: 0,
    rigidBodies: 0,
    constraints: 0,
    fps: 0
  });
  const simulationPresets = ref<SimulationPreset[]>([]);

  // 方法
  const setActiveTool = (toolId: string) => {
    activeTool.value = toolId;
  };

  const setSpeed = (speed: number) => {
    simulationSpeed.value = speed;
  };

  const loadScene = (sceneData: SimulationScene) => {
    currentScene.value = sceneData;

    // 更新统计信息
    simulationStats.value.objects = countObjects(sceneData);
  };

  const loadPreset = (presetId: string) => {
    const preset = simulationPresets.value.find(p => p.id === presetId);
    if (preset) {
      currentScene.value = preset.scene;
      simulationStats.value.objects = countObjects(preset.scene);
    }
  };

  const updateStats = (stats: Partial<typeof simulationStats.value>) => {
    simulationStats.value = { ...simulationStats.value, ...stats };
  };

  // 辅助函数
  const countObjects = (scene: SimulationScene): number => {
    let count = 0;
    if (!scene) return 0;

    const traverse = (object: Object3D) => {
      count++;
      if (object.children && object.children.length) {
        object.children.forEach((child: Object3D) => traverse(child));
      }
    };

    traverse(scene);
    return count;
  };

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
    updateStats
  };
});
