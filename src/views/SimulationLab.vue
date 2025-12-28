<template>
  <div class="simulation-lab">
    <!-- 顶部应用标题栏 -->
    <Header />

    <!-- 消息提示 -->
    <div v-if="message" class="message-toast">
      {{ message }}
    </div>

    <div class="simulation-container">
      <!-- 主视图区域 - 占据最大空间 -->
      <div class="main-content">
        <!-- 仿真控制工具栏：放在主视图区域顶部 -->
        <div class="simulation-toolbar">
          <div class="toolbar-group">
            <button
              class="toolbar-btn"
              @click="togglePlayPause"
              :title="isPlaying ? '暂停仿真' : '开始仿真'"
            >
              <i class="fas" :class="isPlaying ? 'fa-pause' : 'fa-play'"></i>
            </button>
            <button class="toolbar-btn" @click="stepSimulation" title="单步仿真">
              <i class="fas fa-step-forward"></i>
            </button>
            <button class="toolbar-btn" @click="resetSimulation" title="重置仿真">
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
            <button class="toolbar-btn" @click="saveExperiment" title="保存实验配置">
              <i class="fas fa-save"></i>
            </button>
            <div class="preset-selector">
              <select
                v-model="selectedPreset"
                @change="loadPreset(selectedPreset)"
                title="选择预设场景"
              >
                <option value="">选择预设...</option>
                <option v-for="preset in presets" :key="preset.id" :value="preset.id">
                  {{ preset.name }}
                </option>
              </select>
            </div>
          </div>
        </div>

        <!-- 3D视口：核心内容区域 -->
        <div ref="viewportRef" class="viewport-container">
          <div class="viewport-info">物体数量: {{ objectCount }} | FPS: {{ fps }}</div>
        </div>

        <!-- 仿真状态信息面板 -->
        <div class="simulation-status-panel">
          <div class="status-item">
            <span class="label">仿真状态:</span>
            <span class="value" :class="{ running: isPlaying }">
              {{ isPlaying ? '运行中' : '已暂停' }}
            </span>
          </div>
          <div class="status-item">
            <span class="label">仿真时间:</span>
            <span class="value">{{ simulationTime.toFixed(2) }}s</span>
          </div>
          <div class="status-item">
            <span class="label">物体数量:</span>
            <span class="value">{{ objectCount }}</span>
          </div>
          <div class="status-item">
            <span class="label">FPS:</span>
            <span class="value" :class="{ low: fps < 30 }">{{ fps }}</span>
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
          <div class="parameter-item" v-if="recordedData.length > 0">
            <label>已记录:</label>
            <span>{{ recordedData.length }} 帧</span>
          </div>
          <div class="parameter-item" v-if="recordedData.length > 0">
            <button class="export-btn" @click="exportData">导出数据</button>
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
import { ref, onMounted, computed, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { Vector3, Object3D, Scene } from 'three'
import Header from '@/components/layout/Header.vue'
import { usePhysics } from '@/composables/usePhysics'

// 引入状态管理
import { useSimulationStore } from '@/stores/simulationStore'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useRoute } from 'vue-router'

// 接收路由参数
const props = defineProps<{
  presetId?: string
}>()

const route = useRoute()

// Three.js 核心对象
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let animationId: number | null = null

// DOM 引用
const viewportRef = ref<HTMLDivElement | null>(null)

// 状态
const isPlaying = ref(false)
const simulationSpeed = ref(1.0)
const simulationTime = ref(0)
const gravity = ref(-9.8)
const friction = ref(0.1)
const restitution = ref(0.5)
const recordData = ref(false)
const samplingInterval = ref(0.1)
const message = ref('')
const messageTimeout = ref<number | null>(null)
const selectedObject = ref<Object3D | null>(null)
const fps = ref(0)
const lastFrameTime = ref(0)
const frameCount = ref(0)

// 数据记录
const recordedData = ref<
  Array<{
    time: number
    objects: Array<{ name: string; position: { x: number; y: number; z: number } }>
  }>
>([])
const lastSampleTime = ref(0)
const selectedPreset = ref('')

// 物理世界
const { world, initPhysics, stepPhysics, updatePhysicsParameters } = usePhysics()

// 计算属性
const objectCount = computed(() => {
  let count = 0
  scene?.traverse((child) => {
    if (child.userData?.isPhysicsObject) {
      count++
    }
  })
  return count
})

// 预设场景定义
const presets = [
  {
    id: 'free-fall',
    name: '自由落体',
    objects: [
      {
        type: 'box',
        name: '立方体',
        position: { x: 0, y: 5, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.5 },
      },
      {
        type: 'sphere',
        name: '球体',
        position: { x: 2, y: 5, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.7 },
      },
    ],
  },
  {
    id: 'collision',
    name: '碰撞测试',
    objects: [
      {
        type: 'box',
        name: '立方体1',
        position: { x: -2, y: 1, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.5 },
      },
      {
        type: 'box',
        name: '立方体2',
        position: { x: 2, y: 1, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.5 },
      },
    ],
  },
  {
    id: 'pendulum',
    name: '钟摆',
    objects: [
      {
        type: 'box',
        name: '摆球',
        position: { x: 0, y: 3, z: 0 },
        scale: { x: 0.5, y: 0.5, z: 0.5 },
        physics: { type: 'dynamic', mass: 1, friction: 0.1, restitution: 0.3 },
      },
    ],
  },
]

// 初始化 Three.js
const initThree = () => {
  if (!viewportRef.value) return

  // 创建场景
  scene = new Scene()
  scene.background = new THREE.Color(0x1a1a1a)

  // 创建相机
  camera = new THREE.PerspectiveCamera(
    75,
    viewportRef.value.clientWidth / viewportRef.value.clientHeight,
    0.1,
    1000,
  )
  camera.position.set(5, 5, 10)
  camera.lookAt(0, 0, 0)

  // 创建渲染器
  renderer = new THREE.WebGLRenderer({ antialias: true })
  renderer.setSize(viewportRef.value.clientWidth, viewportRef.value.clientHeight)
  renderer.setPixelRatio(window.devicePixelRatio)
  viewportRef.value.appendChild(renderer.domElement)

  // 添加光源
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
  scene.add(ambientLight)

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8)
  directionalLight.position.set(10, 20, 10)
  scene.add(directionalLight)

  const pointLight = new THREE.PointLight(0xffffff, 0.5)
  pointLight.position.set(-10, 10, -10)
  scene.add(pointLight)

  // 添加网格辅助线
  const gridHelper = new THREE.GridHelper(20, 20, 0x444444, 0x222222)
  scene.add(gridHelper)

  // 添加坐标轴辅助线
  const axesHelper = new THREE.AxesHelper(5)
  scene.add(axesHelper)
}

// 渲染循环
const render = () => {
  if (!renderer || !scene || !camera) return

  // 计算 FPS
  const now = performance.now()
  if (lastFrameTime.value > 0) {
    frameCount.value++
    if (frameCount.value >= 30) {
      fps.value = Math.round(1000 / (now - lastFrameTime.value))
      frameCount.value = 0
    }
  }
  lastFrameTime.value = now

  // 物理更新
  if (isPlaying.value && world.value) {
    stepPhysics(0.016 * simulationSpeed.value)
    simulationTime.value += 0.016 * simulationSpeed.value

    // 数据记录
    if (recordData.value) {
      const currentTime = simulationTime.value
      if (currentTime - lastSampleTime.value >= samplingInterval.value) {
        const frameData = {
          time: currentTime,
          objects: [] as Array<{ name: string; position: { x: number; y: number; z: number } }>,
        }

        scene.traverse((child) => {
          if (child.userData?.isPhysicsObject) {
            frameData.objects.push({
              name: child.name || '未命名',
              position: { x: child.position.x, y: child.position.y, z: child.position.z },
            })
          }
        })

        recordedData.value.push(frameData)
        lastSampleTime.value = currentTime
      }
    }
  }

  // 渲染场景
  renderer.render(scene, camera)

  // 继续循环
  animationId = requestAnimationFrame(render)
}

// 创建物理物体
const createPhysicsObject = (objData: {
  type: string
  name: string
  position: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  physics: { type: string; mass: number; friction: number; restitution: number }
  color?: number
}) => {
  let geometry: THREE.BufferGeometry
  let material: THREE.Material

  switch (objData.type) {
    case 'box':
      geometry = new THREE.BoxGeometry(1, 1, 1)
      material = new THREE.MeshStandardMaterial({ color: objData.color || 0x3498db })
      break
    case 'sphere':
      geometry = new THREE.SphereGeometry(0.5, 32, 32)
      material = new THREE.MeshStandardMaterial({ color: objData.color || 0xe74c3c })
      break
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1)
      material = new THREE.MeshStandardMaterial({ color: 0x95a5a6 })
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = objData.name
  mesh.position.set(objData.position.x, objData.position.y, objData.position.z)
  mesh.scale.set(objData.scale.x, objData.scale.y, objData.scale.z)
  mesh.userData = {
    isPhysicsObject: true,
    physics: {
      ...objData.physics,
      shape: objData.type,
    },
  }

  scene.add(mesh)
  return mesh
}

// 方法
const togglePlayPause = () => {
  isPlaying.value = !isPlaying.value
}

const stepSimulation = () => {
  if (world.value) {
    stepPhysics(0.016)
    simulationTime.value += 0.016
  }
}

const resetSimulation = () => {
  isPlaying.value = false
  simulationTime.value = 0

  // 移除所有物理物体
  const objectsToRemove: Object3D[] = []
  scene.traverse((child) => {
    if (child.userData?.isPhysicsObject) {
      objectsToRemove.push(child)
    }
  })
  objectsToRemove.forEach((obj) => scene.remove(obj))

  // 重新初始化物理世界
  initPhysics(scene)

  // 重新加载当前场景
  if (selectedPreset.value) {
    loadPreset(selectedPreset.value)
  } else {
    loadSceneFromEditor()
  }
}

const setSimulationSpeed = () => {
  displayMessage(`仿真速度已设置为 ${simulationSpeed.value}x`)
}

const updateGravity = () => {
  updatePhysicsParameters({ gravity: new Vector3(0, gravity.value, 0) })
  displayMessage(`重力已设置为 ${gravity.value}`)
}

const updateFriction = () => {
  updatePhysicsParameters({ friction: friction.value })
  displayMessage(`摩擦力已设置为 ${friction.value}`)
}

const updateRestitution = () => {
  updatePhysicsParameters({ restitution: restitution.value })
  displayMessage(`弹性系数已设置为 ${restitution.value}`)
}

const loadPreset = (presetId: string) => {
  const preset = presets.find((p) => p.id === presetId)
  if (!preset) {
    displayMessage(`未找到预设场景: ${presetId}`)
    return
  }

  // 移除现有物体
  const objectsToRemove: Object3D[] = []
  scene.traverse((child) => {
    if (child.userData?.isPhysicsObject) {
      objectsToRemove.push(child)
    }
  })
  objectsToRemove.forEach((obj) => scene.remove(obj))

  // 创建新物体
  preset.objects.forEach((objData) => {
    createPhysicsObject(objData)
  })

  // 初始化物理
  initPhysics(scene)

  simulationTime.value = 0
  selectedPreset.value = presetId
  displayMessage(`已加载预设: ${preset.name}`)
}

const loadSceneFromEditor = () => {
  try {
    // 移除现有物体
    const objectsToRemove: Object3D[] = []
    scene.traverse((child) => {
      if (child.userData?.isPhysicsObject) {
        objectsToRemove.push(child)
      }
    })
    objectsToRemove.forEach((obj) => scene.remove(obj))

    // 创建默认演示场景
    const demoObjects = [
      {
        type: 'box' as const,
        name: '演示立方体',
        position: { x: 0, y: 3, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: { type: 'dynamic' as const, mass: 1, friction: 0.3, restitution: 0.5 },
        color: 0x3498db,
      },
      {
        type: 'sphere' as const,
        name: '演示球体',
        position: { x: 2, y: 3, z: 0 },
        scale: { x: 1, y: 1, z: 1 },
        physics: { type: 'dynamic' as const, mass: 1, friction: 0.3, restitution: 0.7 },
        color: 0xe74c3c,
      },
    ]

    demoObjects.forEach((objData) => {
      createPhysicsObject(objData)
    })

    // 初始化物理
    initPhysics(scene)

    simulationTime.value = 0
    displayMessage('已加载演示场景')
  } catch (error) {
    console.error('加载场景失败:', error)
    displayMessage('加载场景失败')
  }
}

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
  displayMessage('实验配置已保存')
}

const exportData = () => {
  try {
    const dataStr = JSON.stringify(recordedData.value, null, 2)
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simulation-data-${Date.now()}.json`
    a.click()
    URL.revokeObjectURL(url)
    displayMessage('数据已导出')
  } catch (error) {
    console.error('导出数据失败:', error)
    displayMessage('导出数据失败')
  }
}

const displayMessage = (msg: string) => {
  message.value = msg
  if (messageTimeout.value) {
    clearTimeout(messageTimeout.value)
  }
  messageTimeout.value = window.setTimeout(() => {
    message.value = ''
  }, 3000)
}

// 生命周期
onMounted(() => {
  // 初始化 Three.js
  initThree()

  // 初始化物理
  initPhysics(scene)

  // 加载默认场景
  loadSceneFromEditor()

  // 启动渲染循环
  render()

  // 监听路由参数变化
  watch(
    () => props.presetId || route.params.presetId,
    (newPresetId) => {
      if (newPresetId) {
        loadPreset(newPresetId as string)
      }
    },
    { immediate: true },
  )

  // 如果有预设ID，加载预设场景
  if (props.presetId || route.params.presetId) {
    loadPreset((props.presetId || route.params.presetId) as string)
  }
})

onUnmounted(() => {
  // 停止渲染循环
  if (animationId) {
    cancelAnimationFrame(animationId)
  }

  // 清理渲染器
  if (renderer) {
    renderer.dispose()
  }
})

// 处理窗口大小变化
const handleResize = () => {
  if (!viewportRef.value || !camera || !renderer) return
  const width = viewportRef.value.clientWidth
  const height = viewportRef.value.clientHeight
  camera.aspect = width / height
  camera.updateProjectionMatrix()
  renderer.setSize(width, height)
}

window.addEventListener('resize', handleResize)
</script>

<style scoped>
.simulation-lab {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.message-toast {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  background-color: #2c3e50;
  color: white;
  padding: 12px 24px;
  border-radius: 4px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
  z-index: 1000;
  animation: slideDown 0.3s ease-out;
}

@keyframes slideDown {
  from {
    opacity: 0;
    transform: translateX(-50%) translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateX(-50%) translateY(0);
  }
}

.simulation-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 1px;
  background-color: #e0e0e0;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  position: relative;
  min-width: 0;
}

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

.preset-selector {
  display: flex;
  align-items: center;
}

.preset-selector select {
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background-color: #34495e;
  color: white;
  font-size: 13px;
  cursor: pointer;
  outline: none;
}

.preset-selector select:hover {
  background-color: #3d5a7c;
}

.preset-selector select option {
  background-color: #2c3e50;
  color: white;
}

.viewport-container {
  flex: 1;
  background-color: #1a1a1a;
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.viewport-info {
  position: absolute;
  top: 10px;
  left: 10px;
  background: rgba(0, 0, 0, 0.7);
  color: white;
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 100;
}

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

.status-item .value.low {
  color: #e74c3c;
}

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

.export-btn {
  background-color: #3498db;
  color: white;
  border: none;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s;
}

.export-btn:hover {
  background-color: #2980b9;
}

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
