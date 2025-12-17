<template>
  <div class="simulation-lab">
    <!-- 顶部应用标题栏 -->
    <Header />

    <div class="simulation-container">
      <!-- 主视图区域 - 占据最大空间 -->
      <div class="main-content">
        <!-- 仿真控制工具栏：放在主视图区域顶部 -->
        <div class="simulation-toolbar">
          <div class="toolbar-group">
            <button
              class="toolbar-btn"
              @click="togglePlayPause"
              :title="simulation.isPlaying.value ? '暂停仿真' : '开始仿真'"
            >
              <i class="fas" :class="simulation.isPlaying.value ? 'fa-pause' : 'fa-play'"></i>
            </button>
            <button class="toolbar-btn" @click="simulation.stepSimulation" title="单步仿真">
              <i class="fas fa-step-forward"></i>
            </button>
            <button class="toolbar-btn" @click="simulation.resetSimulation" title="重置仿真">
              <i class="fas fa-redo"></i>
            </button>
          </div>

          <div class="toolbar-group">
            <div class="speed-control">
              <label>仿真速度:</label>
              <input
                type="range"
                min="0.1"
                max="5"
                step="0.1"
                v-model="simulationSpeed"
                @change="setSimulationSpeed"
              />
              <span>{{ simulationSpeed }}x</span>
            </div>
          </div>

          <div class="toolbar-group">
            <button class="toolbar-btn" @click="loadSceneFromEditor" title="从场景编辑器加载场景">
              <i class="fas fa-folder-open"></i>
            </button>
            div
            <button class="toolbar-btn" @click="saveExperiment" title="保存实验配置">
              <i class="fas fa-save"></i>
            </button>
          </div>
        </div>

        <!-- 3D视口：核心内容区域 -->
        <Viewport
          :scene="simulation.simulationScene.value"
          :camera="activeCamera"
          :renderer="renderer"
          :update-physics="updatePhysics"
          @viewport-click="handleViewportClick"
        />

        <!-- 仿真状态信息面板 -->
        <div class="simulation-status-panel">
          <div class="status-item">
            <span class="label">仿真状态:</span>
            <span class="value" :class="{ running: simulation.isPlaying.value }">
              {{ simulation.isPlaying.value ? '运行中' : '已暂停' }}
            </span>
          </div>
          <div class="status-item">
            <span class="label">仿真时间:</span>
            <span class="value">{{ simulationTime }}s</span>
          </div>
          <div class="status-item">
            <span class="label">物体数量:</span>
            <span class="value">{{ objectCount }}</span>
          </div>
        </div>
      </div>

      <!-- 实验参数面板：固定宽度侧边栏 -->
      <div class="experiment-panel">
        <h3>实验参数</h3>

        <!-- 环境参数设置 -->
        <div class="parameter-group">
          <h4>环境设置</h4>
          <div class="parameter-item">
            <label>重力:</label>
            <input type="number" v-model="gravity" step="0.1" @change="updateGravity" />
          </div>
          <div class="parameter-item">
            <label>摩擦力:</label>
            <input
              type="number"
              v-model="friction"
              step="0.01"
              min="0"
              max="1"
              @change="updateFriction"
            />
          </div>
          <div class="parameter-item">
            <label>弹性系数:</label>
            <input
              type="number"
              v-model="restitution"
              step="0.01"
              min="0"
              max="1"
              @change="updateRestitution"
            />
          </div>
        </div>

        <!-- 数据记录设置 -->
        <div class="parameter-group">
          <h4>数据记录</h4>
          <div class="parameter-item">
            <label> <input type="checkbox" v-model="recordData" /> 记录仿真数据 </label>
          </div>
          <div class="parameter-item" v-if="recordData">
            <label>采样间隔:</label>
            <input type="number" v-model="samplingInterval" min="0.01" step="0.01" />s
          </div>
        </div>

        <!-- 选中物体信息 -->
        <div class="selected-object-info" v-if="selectedObject">
          <h4>选中物体信息</h4>
          <div class="object-property">
            <span>名称:</span>
            <span>{{ selectedObject.name || '未命名' }}</span>
          </div>
          <div class="object-property">
            <span>位置:</span>
            <span
              >({{ selectedObject.position?.x?.toFixed(2) }},
              {{ selectedObject.position?.y?.toFixed(2) }},
              {{ selectedObject.position?.z?.toFixed(2) }})</span
            >
          </div>
          <div class="object-property">
            <span>旋转:</span>
            <span
              >({{ selectedObject.rotation?.x?.toFixed(2) }},
              {{ selectedObject.rotation?.y?.toFixed(2) }},
              {{ selectedObject.rotation?.z?.toFixed(2) }})</span
            >
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { Vector3, Object3D } from 'three'
import Header from '@/components/layout/Header.vue'
import Viewport from '@/components/three/panels/Viewport.vue'

// 引入组合式API
import { useThree } from '@/composables/useThree'
import { useSimulation } from '@/composables/useSimulation'
import { usePhysics } from '@/composables/usePhysics'
import { useCamera } from '@/composables/useCamera'

// 引入状态管理
import { useSimulationStore } from '@/stores/simulationStore'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

// 初始化状态
const simulationStore = useSimulationStore()
const sceneEditorStore = useSceneEditorStore()
const { renderer } = useThree()

// 获取仿真对象
const simulation = useSimulation()
const { activeCamera } = useCamera()
const { initPhysics, updatePhysicsParameters } = usePhysics()

// 状态变量
const selectedObject = ref<Object3D | null>(null)
const simulationSpeed = ref(1.0)
const simulationTime = ref(0)
const gravity = ref(-9.8)
const friction = ref(0.1)
const restitution = ref(0.5)
const recordData = ref(false)
const samplingInterval = ref(0.1)

// 计算属性
const objectCount = computed(() => {
  return (
    simulation.simulationScene.value?.children.filter(
      (child: Object3D) => child.userData?.isPhysicsObject,
    ).length || 0
  )
})

// 生命周期
onMounted(() => {
  // 从场景编辑器加载场景
  loadSceneFromEditor()

  // 初始化物理引擎
  if (simulation.simulationScene.value) {
    initPhysics(simulation.simulationScene.value)
  }

  // 开始仿真
  simulation.startSimulation()

  // 启动仿真时间计时器
  setInterval(() => {
    if (simulation.isPlaying.value) {
      simulationTime.value += simulation.stepSize.value * simulationSpeed.value
    }
  }, 100)
})

// 方法：从场景编辑器加载场景
const loadSceneFromEditor = () => {
  const sceneData = sceneEditorStore.getCurrentScene()
  simulationStore.loadScene(sceneData)
  simulationTime.value = 0
  showMessage('场景已加载')
}

// 方法：切换仿真播放/暂停
const togglePlayPause = () => {
  if (simulation.isPlaying.value) {
    simulation.pauseSimulation()
  } else {
    simulation.startSimulation()
  }
}

// 方法：设置仿真速度
const setSimulationSpeed = () => {
  simulationStore.setSpeed(simulationSpeed.value)
  simulation.simulationSpeed.value = simulationSpeed.value
}

// 方法：更新物理参数
const updatePhysics = () => {
  if (simulation.isPlaying.value) {
    simulation.stepSimulation()
  }
}

const updateGravity = () => {
  updatePhysicsParameters({ gravity: new Vector3(0, gravity.value, 0) })
}

const updateFriction = () => {
  updatePhysicsParameters({ friction: friction.value })
}

const updateRestitution = () => {
  updatePhysicsParameters({ restitution: restitution.value })
}

// 方法：保存实验配置
const saveExperiment = () => {
  const experimentConfig = {
    gravity: gravity.value,
    friction: friction.value,
    restitution: restitution.value,
    simulationSpeed: simulationSpeed.value,
    recordData: recordData.value,
    samplingInterval: samplingInterval.value,
  }

  localStorage.setItem('experimentConfig', JSON.stringify(experimentConfig))
  showMessage('实验配置已保存')
}

// 方法：处理视图点击（选择物体）
const handleViewportClick = (object: Object3D | null) => {
  selectedObject.value = object
}

// 方法：显示消息
const showMessage = (message: string) => {
  // 可以在这里实现消息提示功能
  console.log(message)
}
</script>

<style scoped>
.simulation-lab {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

/* 主要容器布局 */
.simulation-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 1px;
  background-color: #e0e0e0;
}

/* 主视图区域 - 占据最大空间 */
.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0; /* 防止内容溢出 */
}

/* 仿真工具栏样式 */
.simulation-toolbar {
  display: flex;
  align-items: center;
  padding: 10px 15px;
  background-color: #2c3e50;
  color: white;
  border-bottom: 1px solid #34495e;
  gap: 15px;
}

.toolbar-group {
  display: flex;
  gap: 5px;
  align-items: center;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 4px;
  background-color: #34495e;
  color: white;
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background-color: #3d5a7c;
}

.speed-control {
  display: flex;
  align-items: center;
  gap: 8px;
  color: white;
  font-size: 14px;
}

.speed-control input {
  width: 80px;
}

/* Viewport 样式优化 */
::v-deep .viewport-container {
  flex: 1;
  background-color: #1a1a1a;
  position: relative;
  min-height: 0;
}

/* 仿真状态面板 */
.simulation-status-panel {
  display: flex;
  padding: 10px;
  background-color: white;
  border-top: 1px solid #e0e0e0;
  gap: 20px;
}

.status-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.status-item .label {
  font-size: 12px;
  color: #666;
}

.status-item .value {
  font-size: 14px;
  font-weight: bold;
}

.status-item .value.running {
  color: #27ae60;
}

/* 实验参数面板 */
.experiment-panel {
  width: 320px;
  flex-shrink: 0;
  background-color: white;
  border-left: 1px solid #e0e0e0;
  overflow-y: auto;
  padding: 20px;
}

.experiment-panel h3 {
  margin: 0 0 20px 0;
  color: #2c3e50;
  border-bottom: 2px solid #3498db;
  padding-bottom: 8px;
}

.parameter-group {
  margin-bottom: 25px;
}

.parameter-group h4 {
  margin: 0 0 12px 0;
  color: #34495e;
  font-size: 14px;
}

.parameter-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
  gap: 8px;
}

.parameter-item label {
  min-width: 80px;
  font-size: 13px;
  color: #555;
}

.parameter-item input[type='number'] {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid #ddd;
  border-radius: 3px;
}

.parameter-item input[type='checkbox'] {
  margin-right: 5px;
}

/* 选中物体信息 */
.selected-object-info {
  margin-top: 20px;
  padding-top: 15px;
  border-top: 1px solid #eee;
}

.selected-object-info h4 {
  margin: 0 0 12px 0;
  color: #34495e;
  font-size: 14px;
}

.object-property {
  display: flex;
  justify-content: space-between;
  margin-bottom: 6px;
  font-size: 13px;
}

.object-property span:first-child {
  color: #666;
}

.object-property span:last-child {
  color: #2c3e50;
  font-weight: 500;
}

/* 响应式设计 */
@media (max-width: 768px) {
  .simulation-container {
    flex-direction: column;
  }

  .experiment-panel {
    width: 100%;
    height: 300px;
    border-left: none;
    border-top: 1px solid #e0e0e0;
  }

  .simulation-toolbar {
    flex-wrap: wrap;
    gap: 10px;
  }
}
</style>
