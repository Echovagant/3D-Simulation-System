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
            <button
              class="toolbar-btn"
              @click="deleteSelectedObject"
              :disabled="!selectedObject"
              title="删除选中物体"
            >
              <i class="fas fa-trash"></i>
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
            <div class="preset-selector">
              <select v-model="selectedSceneId" title="选择场景编辑器里保存过的场景">
                <option value="">选择已保存场景...</option>
                <option v-for="scene in savedScenes" :key="scene.id" :value="scene.id">
                  {{ scene.name }}（{{ scene.objectCount }} 个物体）
                </option>
              </select>
            </div>
            <button
              class="toolbar-btn"
              @click="loadSceneFromEditor"
              title="从场景编辑器加载场景"
              :disabled="savedScenes.length === 0"
            >
              <i class="fas fa-folder-open"></i>
            </button>
            <button class="toolbar-btn" @click="saveExperiment" title="保存实验配置">
              <i class="fas fa-save"></i>
            </button>
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
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import Header from '@/components/layout/Header.vue'
import { usePhysics } from '@/composables/usePhysics'
import { simulationConfig } from '@/config/simulation'
import { createFixedStepAccumulator } from '@/utils/fixedStepAccumulator'
import type { SceneDocumentObject, SceneIndexEntry } from '@/types'

// 引入状态管理
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { useModelStore } from '@/stores/modelStore'
import { useRoute } from 'vue-router'

// 接收路由参数
const props = defineProps<{
  presetId?: string
  sceneId?: string
}>()

const route = useRoute()

const sceneEditorStore = useSceneEditorStore()
const simulationStore = useSimulationStore()
const modelStore = useModelStore()

// Three.js 核心对象
let scene: THREE.Scene
let camera: THREE.PerspectiveCamera
let renderer: THREE.WebGLRenderer
let animationId: number | null = null
let orbitControls: OrbitControls | null = null
let raycaster: THREE.Raycaster
let mouse: THREE.Vector2

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
const originalMaterials = new Map<Object3D, THREE.Material | THREE.Material[]>()

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
const { world, initPhysics, stepPhysics, updatePhysicsParameters, ready } = usePhysics()

/**
 * 固定步长累加器：与场景编辑器共用同一套步长定义。
 *
 * 之前的写法是「每渲染帧推进一步 0.016 秒」——仿真速度因此绑定在显示刷新率上
 * （60Hz 屏 1×，30Hz 屏 0.5×）。现在真实时间先进累加器，再按固定步长切成物理步，
 * 仿真速度与刷新率无关。
 */
const fixedTimeStep = simulationConfig.physics.fixedTimeStep
const physicsAccumulator = createFixedStepAccumulator(
  fixedTimeStep,
  simulationConfig.physics.maxSubSteps,
  simulationConfig.physics.maxFrameDelta,
)
let lastPhysicsTimestamp = 0

// 计算属性
/**
 * 场景里的物体数量。
 *
 * ⚠️ `scene` 是普通变量（不是响应式），computed 一旦算完就不会再算——
 * 所以这里显式依赖一个版本号：场景里的物体增删之后把版本号 +1，
 * 统计才会跟着更新（以前这个数字恒为 0）。
 */
const sceneRevision = ref(0)

const objectCount = computed(() => {
  void sceneRevision.value
  let count = 0
  scene?.traverse((child) => {
    if (child.userData?.isPhysicsObject) {
      count++
    }
  })
  return count
})

// 预设来源：simulationStore 是**唯一**的预设目录（@/data/simulationPresets）。
// 以前这里内联了另一套 id 不同的预设，深链接与预设目录因此永远对不上。
const presets = computed(() => simulationStore.simulationPresets)

// 场景编辑器里保存过的场景（供「从编辑器加载」使用）
const savedScenes = ref<SceneIndexEntry[]>([])
const selectedSceneId = ref('')

// 刷新「已保存场景」列表
const refreshSavedScenes = () => {
  savedScenes.value = sceneEditorStore.listScenes()
  if (!savedScenes.value.some((scene) => scene.id === selectedSceneId.value)) {
    selectedSceneId.value = savedScenes.value[0]?.id ?? ''
  }
}

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

  // 初始化 Raycaster 和鼠标向量
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // 添加轨道控制器
  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.dampingFactor = 0.05
  orbitControls.target.set(0, 2, 0)

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

  // 更新轨道控制器
  if (orbitControls) {
    orbitControls.update()
  }

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

  // 物理更新：固定步长 + 累加器（仿真速度与显示刷新率无关）
  const frameDelta = lastPhysicsTimestamp === 0 ? 0 : (now - lastPhysicsTimestamp) / 1000
  lastPhysicsTimestamp = now

  if (isPlaying.value && world.value) {
    physicsAccumulator.advance(frameDelta, simulationSpeed.value, () => {
      stepPhysics(fixedTimeStep)
      simulationTime.value += fixedTimeStep
    })

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
  } else {
    // 没在跑物理：清掉积压，恢复时不会突然跳一大段
    physicsAccumulator.reset()
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
  rotation?: { x: number; y: number; z: number }
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
    case 'cylinder':
      geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32)
      material = new THREE.MeshStandardMaterial({ color: objData.color || 0x95a5a6 })
      break
    default:
      geometry = new THREE.BoxGeometry(1, 1, 1)
      material = new THREE.MeshStandardMaterial({ color: 0x95a5a6 })
  }

  const mesh = new THREE.Mesh(geometry, material)
  mesh.name = objData.name
  mesh.position.set(objData.position.x, objData.position.y, objData.position.z)
  if (objData.rotation) {
    mesh.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z)
  }
  mesh.scale.set(objData.scale.x, objData.scale.y, objData.scale.z)
  mesh.userData = {
    isPhysicsObject: true,
    physics: {
      ...objData.physics,
      shape: objData.type,
    },
  }

  scene.add(mesh)
  sceneRevision.value += 1
  return mesh
}

/**
 * 把刚体的位置与旋转对齐到 mesh。
 *
 * usePhysics 建刚体时：动态体会带上 mesh 的位置，但**固定体一律建在原点**，
 * 旋转则把欧拉角当成四元数写进去（w 恒为 1）——结果是静态物体的碰撞体
 * 停在原点、斜坡之类的旋转体朝向也是错的。
 *
 * 这里在 initPhysics 之后把刚体对齐回 mesh：位置取 mesh 的位置，
 * 旋转取 mesh 的四元数。只在「刚体重建」之后做一次，不会与物理同步打架。
 */
const alignBodiesToMeshes = () => {
  scene.traverse((child) => {
    const physics = child.userData?.physics
    const body = physics?.body
    if (!body) return

    const isStatic = physics.type === 'static' || physics.mass === 0
    if (isStatic) {
      body.setTranslation(
        { x: child.position.x, y: child.position.y, z: child.position.z },
        true,
      )
    }

    const q = child.quaternion
    body.setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }, true)
  })
}

/** 清掉场景里现有的物理物体 */
const clearPhysicsObjects = () => {
  const objectsToRemove: Object3D[] = []
  scene.traverse((child) => {
    if (child.userData?.isPhysicsObject) {
      objectsToRemove.push(child)
    }
  })
  objectsToRemove.forEach((obj) => scene.remove(obj))
  sceneRevision.value += 1
}

// 处理鼠标点击事件，选择物体
const handleMouseClick = (event: MouseEvent) => {
  if (!renderer || !camera || !scene) return

  // 计算鼠标在归一化设备坐标中的位置
  const rect = renderer.domElement.getBoundingClientRect()
  mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1
  mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1

  // 更新 Raycaster
  raycaster.setFromCamera(mouse, camera)

  // 获取与射线相交的物体
  const intersects = raycaster.intersectObjects(scene.children, true)

  // 查找物理物体
  const physicsIntersects = intersects.filter(
    (intersect) =>
      intersect.object.userData?.isPhysicsObject ||
      (intersect.object.parent && intersect.object.parent.userData?.isPhysicsObject),
  )

  // 清除之前的选中状态
  if (selectedObject.value) {
    // 恢复原始材质
    if (originalMaterials.has(selectedObject.value)) {
      ;(selectedObject.value as THREE.Mesh).material = originalMaterials.get(selectedObject.value)!
      originalMaterials.delete(selectedObject.value)
    }
    selectedObject.value = null
  }

  // 选择新物体
  if (physicsIntersects.length > 0) {
    const intersect = physicsIntersects[0]

    // 找到实际的物理物体（可能是子网格）
    let physicsObject = intersect.object
    while (physicsObject.parent && !physicsObject.userData?.isPhysicsObject) {
      physicsObject = physicsObject.parent
    }

    if (physicsObject.userData?.isPhysicsObject) {
      selectedObject.value = physicsObject as THREE.Object3D

      // 保存原始材质
      if (physicsObject instanceof THREE.Mesh) {
        originalMaterials.set(physicsObject, physicsObject.material)
        // 应用高亮材质
        physicsObject.material = new THREE.MeshStandardMaterial({ color: 0xffff00 })
      }
    }
  }
}

// 方法
const togglePlayPause = () => {
  isPlaying.value = !isPlaying.value
}

const stepSimulation = () => {
  if (world.value) {
    stepPhysics(fixedTimeStep)
    simulationTime.value += fixedTimeStep
  }
}

const resetSimulation = async () => {
  isPlaying.value = false
  simulationTime.value = 0

  // 清除选中状态
  if (selectedObject.value) {
    if (originalMaterials.has(selectedObject.value)) {
      ;(selectedObject.value as THREE.Mesh).material = originalMaterials.get(selectedObject.value)!
      originalMaterials.delete(selectedObject.value)
    }
    selectedObject.value = null
  }

  // 移除所有物理物体
  clearPhysicsObjects()

  // 重新初始化物理世界
  await initPhysics(scene)
  alignBodiesToMeshes()

  // 重新加载当前场景
  if (selectedPreset.value) {
    await loadPreset(selectedPreset.value)
  } else {
    createDemoScene()
    await initPhysics(scene)
    alignBodiesToMeshes()
  }
}

// 删除选中物体
const deleteSelectedObject = () => {
  if (selectedObject.value) {
    // 恢复原始材质
    if (originalMaterials.has(selectedObject.value)) {
      ;(selectedObject.value as THREE.Mesh).material = originalMaterials.get(selectedObject.value)!
      originalMaterials.delete(selectedObject.value)
    }

    // 移除物体
    scene.remove(selectedObject.value)
    selectedObject.value = null
    displayMessage('物体已删除')
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

const loadPreset = async (presetId: string) => {
  // 预设的唯一来源是 store（目录来自 @/data/simulationPresets）
  const preset = simulationStore.loadPreset(presetId)
  if (!preset) {
    displayMessage(`未找到预设场景: ${presetId}`)
    return
  }

  // 移除现有物体
  clearPhysicsObjects()

  // 创建新物体
  preset.scene.objects.forEach((objData) => {
    createPhysicsObject({
      type: objData.type,
      name: objData.name,
      position: objData.position,
      rotation: objData.rotation,
      scale: objData.scale,
      physics: objData.physics,
      color: objData.color,
    })
  })

  // 初始化物理
  await initPhysics(scene)
  alignBodiesToMeshes()

  simulationTime.value = 0
  selectedPreset.value = presetId
  displayMessage(`已加载预设: ${preset.name}`)
}

/**
 * 把场景文档里的模型物体放进实验室场景。
 *
 * 模型用包围盒近似成盒状碰撞体，这样它也会落下、也会撞到别的东西。
 */
const addModelToLab = async (objData: SceneDocumentObject): Promise<boolean> => {
  if (!objData.modelId) return false

  const model = await modelStore.loadModelById(objData.modelId)
  if (!model) return false

  model.position.set(objData.position.x, objData.position.y, objData.position.z)
  model.rotation.set(objData.rotation.x, objData.rotation.y, objData.rotation.z)
  model.scale.set(objData.scale.x, objData.scale.y, objData.scale.z)
  model.visible = objData.visible !== false

  const box = new THREE.Box3().setFromObject(model)
  const size = box.getSize(new THREE.Vector3())
  model.userData = {
    isPhysicsObject: true,
    physics: {
      type: 'dynamic',
      shape: 'box',
      halfExtents: { x: size.x * 0.5, y: size.y * 0.5, z: size.z * 0.5 },
      mass: 1,
      friction: 0.5,
      restitution: 0.2,
    },
  }

  scene.add(model)
  return true
}

/**
 * 从场景编辑器加载已保存的场景。
 *
 * 以前这个按钮只会硬编码两个演示物体，跟编辑器毫无关系；
 * 现在它读的是场景编辑器真正存下来的场景文档（localStorage）。
 */
const loadSceneFromEditor = async () => {
  const sceneId = selectedSceneId.value
  if (!sceneId) {
    displayMessage('请先在工具栏里选择一个已保存的场景')
    return
  }

  const doc = sceneEditorStore.getSceneDocument(sceneId)
  if (!doc) {
    displayMessage(`未找到场景: ${sceneId}`)
    refreshSavedScenes()
    return
  }

  try {
    // 移除现有物体
    clearPhysicsObjects()

    for (const objData of doc.objects) {
      if (objData.type === 'model') {
        await addModelToLab(objData)
        continue
      }

      // 场景编辑器用 cube / sphere 命名基本体，实验室用 box / sphere
      createPhysicsObject({
        type: objData.type === 'sphere' ? 'sphere' : 'box',
        name: objData.name,
        position: objData.position,
        rotation: objData.rotation,
        scale: objData.scale,
        physics: {
          type: objData.physics?.type ?? 'dynamic',
          mass: objData.physics?.mass ?? 1,
          friction: 0.5,
          restitution: 0.2,
        },
      })
    }

    // 初始化物理
    await initPhysics(scene)
    alignBodiesToMeshes()

    simulationTime.value = 0
    displayMessage(`已从场景编辑器加载: ${doc.name}`)
  } catch (error) {
    displayMessage('加载场景失败')
  }
}

/** 默认演示场景（进入实验室时的初始内容） */
const createDemoScene = () => {
  const demoObjects = [
    {
      type: 'box' as const,
      name: '演示立方体',
      position: { x: 0, y: 3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      physics: { type: 'dynamic' as const, mass: 1, friction: 0.3, restitution: 0.5 },
      color: 0x3498db,
    },
    {
      type: 'sphere' as const,
      name: '演示球体',
      position: { x: 2, y: 3, z: 0 },
      rotation: { x: 0, y: 0, z: 0 },
      scale: { x: 1, y: 1, z: 1 },
      physics: { type: 'dynamic' as const, mass: 1, friction: 0.3, restitution: 0.7 },
      color: 0xe74c3c,
    },
  ]

  demoObjects.forEach((objData) => {
    createPhysicsObject(objData)
  })
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
onMounted(async () => {
  // 初始化 Three.js
  initThree()

  // 添加鼠标点击事件监听
  if (renderer) {
    renderer.domElement.addEventListener('click', handleMouseClick)
  }

  // 等待物理引擎初始化
  await ready()

  // 初始化物理
  await initPhysics(scene)

  // 加载默认场景
  createDemoScene()
  await initPhysics(scene)
  alignBodiesToMeshes()

  // 场景编辑器里保存过的场景（「从编辑器加载」用）
  refreshSavedScenes()

  // 启动渲染循环
  render()

  // 监听路由参数变化：预设 / 已保存场景
  watch(
    () => props.presetId || route.params.presetId,
    (newPresetId) => {
      if (newPresetId) {
        loadPreset(newPresetId as string)
      }
    },
    { immediate: true },
  )

  watch(
    () => props.sceneId,
    (newSceneId) => {
      if (!newSceneId) return
      selectedSceneId.value = newSceneId as string
      loadSceneFromEditor()
    },
    { immediate: true },
  )
})

onUnmounted(() => {
  // 移除鼠标点击事件监听
  if (renderer) {
    renderer.domElement.removeEventListener('click', handleMouseClick)
  }

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
