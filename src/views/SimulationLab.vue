<template>
  <div class="simulation-lab">
    <!-- 初始化加载态：Rapier 是运行时加载的 WASM，加载与建世界期间盖全屏（对齐 SceneEditor 的 overlay 标准） -->
    <div v-if="initLoading" class="loading-overlay">
      <div class="loading-spinner"></div>
      <p>仿真实验室初始化中...</p>
    </div>

    <!-- 初始化失败：给出错误信息与重试入口，不再静默黑屏 -->
    <div v-if="initError" class="error-overlay">
      <p class="error-message">{{ initError }}</p>
      <button type="button" class="retry-btn" @click="retryInit">重试</button>
    </div>

    <!-- 消息提示 -->
    <div v-if="message" class="message-toast">
      {{ message }}
    </div>

    <!-- 只读分享条：链接即演示 -->
    <div v-if="shareInfo" class="share-banner">
      <span class="share-text">
        只读分享 · {{ shareInfo.name }} —— 物理逐帧确定性，重放与首跑逐位一致
      </span>
      <button class="toolbar-btn share-btn" @click="replayShare" title="从零重建世界并重放">
        重放
      </button>
      <button class="toolbar-btn share-btn" @click="copyShareLink">复制链接</button>
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
                v-model.number="simulationSpeed"
                @change="setSimulationSpeed"
              />
              <span>{{ simulationSpeed }}x</span>
              <InfoTip
                label="关于仿真速度"
                text="速度调到 5× 会不稳吗？不会：物理步长恒为 1/60 秒，倍率只改每秒推进步数；单帧最多补 5 步，多余的积压会被丢弃。"
              />
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
              <span class="preset-desc">{{ presetDescription }}</span>
              <InfoTip
                label="关于预设场景"
                text="「钟摆」预设没有实现摆的约束——它和其它预设一样只是自由落体。"
              />
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
          <!-- 视口 HUD：物体数量与 FPS 只在这里显示（底部状态条不再重复这两项）。
               FPS 项与底部状态条共用 status-item 的「label+value」结构，<30 时标红 -->
          <div class="viewport-info">
            <span>物体数量: {{ objectCount }}</span>
            <span class="status-item">
              <span class="label">FPS:</span>
              <span class="value" :class="{ low: fps < 30 }">{{ fps }}</span>
            </span>
          </div>
        </div>

        <!-- 仿真状态信息面板：只放 HUD 没有的项 -->
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
        </div>
      </div>

      <!-- 实验参数面板：固定宽度侧边栏（选中物体信息置顶，两个重面板收进 tab 组） -->
      <div class="experiment-panel">
        <!-- 栏目头：原生 h3 换成统一的 PanelHeader -->
        <div class="lab-side-head">
          <PanelHeader title="实验参数" />
        </div>

        <!-- 实验说明卡：当前预设的实验目的、观察点与作业题（有 experiment 元数据的预设才显示） -->
        <section v-if="selectedExperiment" class="side-section experiment-card">
          <PanelHeader title="实验说明" />
          <p class="experiment-purpose">{{ selectedExperiment.purpose }}</p>
          <ul class="experiment-observations">
            <li v-for="(item, i) in selectedExperiment.observations" :key="i">{{ item }}</li>
          </ul>
          <ul v-if="selectedExperiment.assignments?.length" class="experiment-assignments">
            <li v-for="(item, i) in selectedExperiment.assignments" :key="i">{{ item }}</li>
          </ul>
        </section>

        <!-- 选中物体信息：上移到右栏第一位 -->
        <section class="side-section">
          <PanelHeader title="选中物体信息" />
          <EmptyState
            v-if="!selectedObject"
            icon="fa-solid fa-arrow-pointer"
            title="未选中物体"
            description="点击视口中的物体查看它的状态"
          />
          <div v-else class="selected-object-info">
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
        </section>

        <!-- 环境参数设置 -->
        <section class="side-section">
          <PanelHeader title="环境设置">
            <!-- 「全局批量生效」从 InfoTip 升级为内联警示标签：小字 --accent-2，悬停看完整语义 -->
            <span
              class="param-global-warning"
              title="摩擦力与弹性系数是全局批量生效的：改动会同时作用于场景里的每一个物体，不能只调某一个。"
            >
              全局批量生效
            </span>
          </PanelHeader>
          <div class="parameter-item">
            <label for="lab-gravity">重力:</label>
            <input
              id="lab-gravity"
              type="range"
              min="-30"
              max="0"
              step="0.1"
              v-model.number="gravity"
              @change="updateGravity"
            />
            <input
              type="number"
              v-model="gravity"
              step="0.1"
              aria-label="重力数值"
              @change="updateGravity"
            />
          </div>
          <div class="parameter-item">
            <label for="lab-friction">摩擦力:</label>
            <input
              id="lab-friction"
              type="range"
              min="0"
              max="1"
              step="0.05"
              v-model.number="friction"
              @change="updateFriction"
            />
            <input
              type="number"
              v-model="friction"
              step="0.01"
              min="0"
              max="1"
              aria-label="摩擦力数值"
              @change="updateFriction"
            />
          </div>
          <div class="parameter-item">
            <label for="lab-restitution">弹性系数:</label>
            <input
              id="lab-restitution"
              type="range"
              min="0"
              max="1"
              step="0.05"
              v-model.number="restitution"
              @change="updateRestitution"
            />
            <input
              type="number"
              v-model="restitution"
              step="0.01"
              min="0"
              max="1"
              aria-label="弹性系数数值"
              @change="updateRestitution"
            />
          </div>
        </section>

        <!-- 数据记录设置 -->
        <section class="side-section">
          <PanelHeader title="数据记录" />
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
          <div class="parameter-item">
            <button
              class="record-btn"
              title="记录本次运行"
              @click="recordCurrentRun"
            >
              记录本次运行
            </button>
          </div>
        </section>

        <!-- 重面板收进 tab 组：本地 ref 三选一，v-show 保挂载（后端探测的轮询与状态不丢） -->
        <section class="side-section">
          <div class="side-tabs" role="tablist" aria-label="后端面板">
            <button
              type="button"
              class="side-tab"
              :class="{ active: backendTab === 'batch' }"
              role="tab"
              :aria-selected="backendTab === 'batch'"
              @click="backendTab = 'batch'"
            >
              批量仿真
            </button>
            <button
              type="button"
              class="side-tab"
              :class="{ active: backendTab === 'render' }"
              role="tab"
              :aria-selected="backendTab === 'render'"
              @click="backendTab = 'render'"
            >
              服务端渲染
            </button>
            <button
              type="button"
              class="side-tab"
              :class="{ active: backendTab === 'history' }"
              role="tab"
              :aria-selected="backendTab === 'history'"
              @click="backendTab = 'history'"
            >
              运行记录
            </button>
          </div>
          <!-- 批量仿真面板：后端缺席时安静降级，不影响本页的实时仿真 -->
          <SimulationBatchPanel v-show="backendTab === 'batch'" />
          <!-- 服务端渲染面板：后端缺席时同样安静降级 -->
          <RenderPanel v-show="backendTab === 'render'" />
          <!-- 运行记录面板：本地 localStorage，不依赖后端 -->
          <ExperimentHistoryPanel v-show="backendTab === 'history'" @replay="replayRun" />
        </section>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, computed, onUnmounted, watch } from 'vue'
import * as THREE from 'three'
import { Vector3, Object3D, Scene } from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import InfoTip from '@/components/common/InfoTip.vue'
import PanelHeader from '@/components/common/PanelHeader.vue'
import EmptyState from '@/components/common/EmptyState.vue'
import SimulationBatchPanel from '@/components/simulations/SimulationBatchPanel.vue'
import RenderPanel from '@/components/simulations/RenderPanel.vue'
import ExperimentHistoryPanel from '@/components/simulations/ExperimentHistoryPanel.vue'
import { usePhysics } from '@/composables/usePhysics'
import { simulationConfig } from '@/config/simulation'
import { RENDER_POWER_PREFERENCE } from '@/config/rendering'
import { labFraming } from '@/config/sceneFraming'
import { createFixedStepAccumulator } from '@/utils/fixedStepAccumulator'
import { normalizeSceneDocument } from '@/utils/sceneDocument'
import type { SceneDocument, SceneDocumentObject, SceneIndexEntry } from '@/types'

// 引入状态管理
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { useSimulationStore } from '@/stores/simulationStore'
import { useModelStore } from '@/stores/modelStore'
import { useExperimentRunStore, type ExperimentRun } from '@/stores/experimentRunStore'
import { useRoute } from 'vue-router'
import { reportError } from '@/services/api/telemetry'
import { getScene } from '@/services/api/scenes'

// 接收路由参数
const props = defineProps<{
  presetId?: string
  sceneId?: string
}>()

const route = useRoute()

const sceneEditorStore = useSceneEditorStore()
const simulationStore = useSimulationStore()
const modelStore = useModelStore()
const experimentRunStore = useExperimentRunStore()

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

/**
 * 物理初始化的 loading / 失败态。
 * Rapier 是运行时加载的 WASM：离线或 CDN 抖动会让初始化失败——
 * 之前这段没有加载态也没有 try/catch，失败时页面只会静默黑屏。
 */
const initLoading = ref(true)
const initError = ref('')

/** 右栏重面板 tab：「批量仿真 | 服务端渲染 | 运行记录」三选一；v-show 保挂载，后端探测与轮询状态不丢 */
const backendTab = ref<'batch' | 'render' | 'history'>('batch')

/**
 * FPS 统计窗口。
 *
 * 用固定帧数的窗口求平均：单帧耗时的倒数在快帧时会飙到 1000+，界面上的 FPS
 * 完全不可信。窗口没攒满之前不更新显示值。
 */
const FPS_WINDOW_FRAMES = 30
let fpsWindowStart = 0
let fpsWindowFrames = 0

/**
 * 选中高亮走物体自己材质的 emissive 通道。
 *
 * ⚠️ 材质不能共享：共用一份材质时改 emissive，会让所有同材质物体一起变黄
 * （约定见 useSceneEditor.ts）。也不为每次选中新建材质——那份材质没人释放，
 * 反复点选会一直漏显存。
 */
const HIGHLIGHT_COLOR = 0xffff00

/**
 * 面板的摩擦力/弹性系数是否已经覆盖了物体自身的设置。
 *
 * 只有用户真的动过这两个输入框、或恢复了已保存的配置时才覆盖——面板的默认值
 * 不该一进页面就把预设里逐个物体的参数抹掉。覆盖一旦生效，物理世界重建后
 * 必须重新下发，否则加载预设时会被物体的默认值盖回去。
 */
let frictionOverride: number | null = null
let restitutionOverride: number | null = null

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
const {
  world,
  initPhysics,
  stepPhysics,
  updatePhysicsParameters,
  removeRigidBody,
  ready,
} = usePhysics()

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

/**
 * 预设下拉旁的一句话描述：直接取预设目录里的 description 字段；
 * 未选择预设时说明当前跑的是演示场景。
 */
const presetDescription = computed(() => {
  const preset = presets.value.find((entry) => entry.id === selectedPreset.value)
  if (!preset) return '未选择预设，当前是演示场景'
  return preset.description
})

// 实验说明卡：选中预设的实验目的、观察点与作业题（预设目录的 experiment 元数据）
const selectedExperiment = computed(() => {
  const preset = presets.value.find((entry) => entry.id === selectedPreset.value)
  return preset?.experiment ?? null
})

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
  // ⚠️ 位置、视野角、目标点都从 labFraming 取——相机 lookAt 的点和
  // 轨道控制器 target 的点**必须是同一个**，两者都取自同一份配置就不会再对不上。
  camera = new THREE.PerspectiveCamera(
    labFraming.fov,
    viewportRef.value.clientWidth / viewportRef.value.clientHeight,
    0.1,
    1000,
  )
  camera.position.set(labFraming.position.x, labFraming.position.y, labFraming.position.z)
  camera.lookAt(labFraming.target.x, labFraming.target.y, labFraming.target.z)

  // 创建渲染器
  renderer = new THREE.WebGLRenderer({
    antialias: true,
    // 双显卡笔记本上不让浏览器默认挑核显（见 src/config/rendering.ts）
    powerPreference: RENDER_POWER_PREFERENCE,
  })
  renderer.setSize(viewportRef.value.clientWidth, viewportRef.value.clientHeight, false)
  renderer.setPixelRatio(window.devicePixelRatio)
  viewportRef.value.appendChild(renderer.domElement)

  // 初始化 Raycaster 和鼠标向量
  raycaster = new THREE.Raycaster()
  mouse = new THREE.Vector2()

  // 添加轨道控制器
  orbitControls = new OrbitControls(camera, renderer.domElement)
  orbitControls.enableDamping = true
  orbitControls.dampingFactor = 0.05
  // 轨道控制器的目标点：与相机的 lookAt 取**同一个** labFraming.target。
  // ⚠️ 之前这里写的是 (0, 2, 0)，而相机 lookAt 的是 (0, 0, 0)：
  // 控制器第一次 update 就会把相机改瞄到 2 米高的原点上方，
  // 于是地面和物体整体被压到画面下半，上半屏空着——就是「场景偏下」的那一下。
  orbitControls.target.set(
    labFraming.target.x,
    labFraming.target.y,
    labFraming.target.z,
  )

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
  // 网格线比物理地面（0x2c3e50）亮一档才读得出「这是地板」；
  // 配色与 AI 演武场保持一致，两个 3D 页面看起来是同一套。
  const gridHelper = new THREE.GridHelper(20, 20, 0x6f7c8c, 0x39414f)
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

  // 计算 FPS：固定帧数窗口的平均值（单帧耗时的倒数在快帧时会飙到 1000+）
  const now = performance.now()
  if (fpsWindowStart === 0) {
    fpsWindowStart = now
  } else {
    fpsWindowFrames++
    if (fpsWindowFrames >= FPS_WINDOW_FRAMES) {
      const elapsed = now - fpsWindowStart
      if (elapsed > 0) {
        fps.value = Math.round((1000 * fpsWindowFrames) / elapsed)
      }
      fpsWindowStart = now
      fpsWindowFrames = 0
    }
  }

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

/**
 * 切换选中高亮。
 *
 * 走物体自己材质的 emissive 通道，不换材质——换材质就得新建一份永不释放的
 * 材质，共享材质又会让同材质物体一起变黄。
 */
const setHighlight = (object: Object3D | null, highlighted: boolean) => {
  if (!object) return
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    materials.forEach((material) => {
      const emissive = (material as THREE.MeshStandardMaterial).emissive
      if (!emissive) return
      emissive.set(highlighted ? HIGHLIGHT_COLOR : 0x000000)
    })
  })
}

/**
 * 释放物体持有的 GPU 资源（几何体与材质）。
 *
 * 物体是逐个 new 出几何体与材质的，只从场景里摘掉不释放，反复加载预设/场景
 * 会把显存吃光。模型是单独 load 出来的实例，材质同样是各自独立的，释放安全。
 */
const disposeObjectResources = (object: Object3D) => {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry?.dispose()
    const material = child.material
    if (Array.isArray(material)) {
      material.forEach((item) => item.dispose())
    } else {
      material?.dispose()
    }
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
  objectsToRemove.forEach((obj) => {
    scene.remove(obj)
    disposeObjectResources(obj)
  })
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
    setHighlight(selectedObject.value, false)
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

      // 高亮选中物体
      setHighlight(selectedObject.value, true)
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
    setHighlight(selectedObject.value, false)
    selectedObject.value = null
  }

  // 移除所有物理物体
  clearPhysicsObjects()

  // 重新初始化物理世界
  await initPhysics(scene)
  alignBodiesToMeshes()
  applyPhysicsParameters()

  // 重新加载当前场景
  if (selectedPreset.value) {
    await loadPreset(selectedPreset.value)
  } else {
    createDemoScene()
    await initPhysics(scene)
    alignBodiesToMeshes()
    applyPhysicsParameters()
  }
}

// 删除选中物体
const deleteSelectedObject = () => {
  const object = selectedObject.value
  if (!object) return

  // 取消高亮
  setHighlight(object, false)

  // 先摘掉刚体：只把网格从场景里移除的话，刚体还在物理世界里参与碰撞，
  // 会变成看不见却挡路的障碍
  removeRigidBody(object)

  // 移除物体
  scene.remove(object)
  disposeObjectResources(object)
  selectedObject.value = null

  // 物体数量是 computed 缓存的，改动场景后必须让版本号 +1 才会重新统计
  sceneRevision.value += 1
  displayMessage('物体已删除')
}

const setSimulationSpeed = () => {
  displayMessage(`仿真速度已设置为 ${simulationSpeed.value}x`)
}

/**
 * 把界面上的物理参数同步给物理世界。
 *
 * ⚠️ initPhysics 会用物理引擎的默认重力重建世界，所以每次重建之后都要再调
 * 一次，否则用户改过的重力会被默认值覆盖回去。
 *
 * 重力是全局量，始终以面板为准；摩擦力/弹性系数只在被覆盖过时才整体下发，
 * 免得把预设里逐个物体的参数抹平。
 */
const applyPhysicsParameters = () => {
  const params: { gravity?: Vector3; friction?: number; restitution?: number } = {
    gravity: new Vector3(0, gravity.value, 0),
  }
  if (frictionOverride !== null) params.friction = frictionOverride
  if (restitutionOverride !== null) params.restitution = restitutionOverride
  updatePhysicsParameters(params)
}

const updateGravity = () => {
  applyPhysicsParameters()
  displayMessage(`重力已设置为 ${gravity.value}`)
}

const updateFriction = () => {
  frictionOverride = friction.value
  applyPhysicsParameters()
  displayMessage(`摩擦力已设置为 ${friction.value}`)
}

const updateRestitution = () => {
  restitutionOverride = restitution.value
  applyPhysicsParameters()
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
  applyPhysicsParameters()

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
 * 把一份场景文档落到实验室：清场 → 逐个建物体 → 初始化物理。
 *
 * 「从编辑器加载」与「只读分享回放」共用这一条路径——
 * 两边必须是同一套加载语义，否则分享出去的演示就不是同一回事。
 */
const applySceneDocument = async (
  doc: { name: string; objects: SceneDocumentObject[] },
): Promise<void> => {
  // 移除现有物体
  clearPhysicsObjects()

  for (const objData of doc.objects) {
    if (objData.type === 'model') {
      await addModelToLab(objData)
      continue
    }

    // 场景编辑器用 cube / sphere / ramp 命名基本体，实验室用 box / sphere。
    // ramp（楔形）在实验室降级为带旋转的 box：斜面碰撞面近似成立，
    // 楔形视觉与 trimesh 精确碰撞待实验室对象系统升级后再补。
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
  applyPhysicsParameters()

  simulationTime.value = 0
}

/**
 * 从场景编辑器加载已保存的场景。
 *
 * 以前这个按钮只会硬编码两个演示物体，跟编辑器毫无关系；
 * 现在它读的是场景编辑器真正存下来的场景文档（localStorage）。
 */
const loadSceneFromEditor = async (): Promise<boolean> => {
  const sceneId = selectedSceneId.value
  if (!sceneId) {
    displayMessage('请先在工具栏里选择一个已保存的场景')
    return false
  }

  const doc = sceneEditorStore.getSceneDocument(sceneId)
  if (!doc) {
    displayMessage(`未找到场景: ${sceneId}`)
    refreshSavedScenes()
    return false
  }

  try {
    await applySceneDocument(doc)
    displayMessage(`已从场景编辑器加载: ${doc.name}`)
    return true
  } catch (error) {
    console.warn('[SimulationLab] 加载场景失败', error)
    reportError(error, '/simulation-lab')
    displayMessage('加载场景失败')
    return false
  }
}

// ===================== 场景编辑器 → 实验室交接 =====================
// 编辑器「送到实验室」把场景文档写进 sessionStorage 后跳到 ?from=editor；
// 实验室在物理世界初始化完成后消费它——一次有效，读完即删。
const LAB_HANDOFF_KEY = 'lab-handoff-scene'

/** 最近一次从编辑器接收的场景文档：记录运行时作为来源，复现时直接重建 */
let handoffDocument: SceneDocument | null = null

const consumeHandoffScene = async (): Promise<void> => {
  const handoffRequested = route.query?.from === 'editor'

  let raw: string | null = null
  try {
    raw = sessionStorage.getItem(LAB_HANDOFF_KEY)
  } catch (error) {
    // 隐私模式等场景下 sessionStorage 可能直接抛错
    console.warn('[SimulationLab] 读取编辑器交接场景失败', error)
    if (handoffRequested) displayMessage('读取编辑器交接场景失败：浏览器会话存储不可用')
    return
  }

  if (!raw) {
    // 只有明确带着 ?from=editor 进来时才提示；普通进入实验室不该被打扰
    if (handoffRequested) {
      displayMessage('没有找到编辑器交接的场景，请回到场景编辑器重新点「送到实验室」')
    }
    return
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    console.warn('[SimulationLab] 编辑器交接场景解析失败', error)
    displayMessage('编辑器交接场景解析失败：不是合法的 JSON')
    return
  }

  const envelope = (parsed ?? null) as { document?: unknown } | null
  if (!envelope || !envelope.document) {
    displayMessage('编辑器交接场景缺少 document 字段，无法加载')
    return
  }

  const result = normalizeSceneDocument(envelope.document)
  if (!result.ok) {
    displayMessage(`编辑器交接场景校验失败：${result.error}`)
    return
  }

  try {
    await applySceneDocument(result.document)
  } catch (error) {
    console.warn('[SimulationLab] 加载编辑器交回的场景失败', error)
    reportError(error, '/simulation-lab')
    displayMessage('加载编辑器交回的场景失败')
    return
  }

  handoffDocument = result.document
  // 加载成功才删 key：失败时保留现场，用户回编辑器重送一次即可
  try {
    sessionStorage.removeItem(LAB_HANDOFF_KEY)
  } catch (error) {
    console.warn('[SimulationLab] 清理编辑器交接 key 失败', error)
  }
  displayMessage(
    `已接收编辑器场景：${result.document.name}（${result.document.objects.length} 个物体）`,
  )
}

// ===================== 运行记录与复现 =====================

/** 当前运行的来源：预设优先，其次场景编辑器里选中的场景，最后是编辑器交接的场景 */
const resolveRunSource = (): ExperimentRun['source'] => {
  const preset = presets.value.find((entry) => entry.id === selectedPreset.value)
  if (preset) return { kind: 'preset', id: preset.id, name: preset.name }

  if (selectedSceneId.value) {
    const sceneEntry = savedScenes.value.find((entry) => entry.id === selectedSceneId.value)
    return {
      kind: 'scene',
      id: selectedSceneId.value,
      name: sceneEntry?.name ?? selectedSceneId.value,
    }
  }

  if (handoffDocument) {
    return { kind: 'handoff', id: handoffDocument.id, name: handoffDocument.name }
  }

  // 没有明确来源时记成演示场景：复现会如实提示「没有可复现的来源」
  return { kind: 'scene', id: '', name: '演示场景' }
}

/** 记录当前运行：参数、物体数、仿真时长与已记录帧数都取当前界面的值 */
const recordCurrentRun = (): void => {
  if (!scene) {
    displayMessage('仿真世界还没初始化完成，暂时不能记录')
    return
  }

  const source = resolveRunSource()
  const run = experimentRunStore.recordRun({
    name: source.name || '未命名运行',
    source,
    config: {
      gravity: gravity.value,
      friction: friction.value,
      restitution: restitution.value,
      simulationSpeed: simulationSpeed.value,
    },
    objectCount: objectCount.value,
    simulationTime: simulationTime.value,
    recordedFrames: recordedData.value.length,
    ...(source.kind === 'handoff' && handoffDocument ? { document: handoffDocument } : {}),
  })

  if (!run) {
    // store 里已经写好了可读原因，面板顶部会展示；这里只补一句即时提示
    displayMessage('运行记录保存失败：浏览器本地存储不可用')
    return
  }

  displayMessage(`已记录本次运行：${run.name}`)
}

/**
 * 回填一条记录里的实验参数。
 *
 * 物理世界重建后参数会被默认值盖回去：摩擦与弹性必须同时建立全局覆盖
 * （frictionOverride / restitutionOverride），否则下一次 initPhysics 又会抹平。
 */
const applyRunConfig = (config: ExperimentRun['config']): void => {
  gravity.value = config.gravity
  friction.value = config.friction
  restitution.value = config.restitution
  simulationSpeed.value = config.simulationSpeed
  frictionOverride = config.friction
  restitutionOverride = config.restitution
  applyPhysicsParameters()
}

/** 复现一条运行记录：先重建来源场景，再回填配置 */
const replayRun = async (run: ExperimentRun): Promise<void> => {
  if (run.source.kind === 'preset') {
    const preset = presets.value.find((entry) => entry.id === run.source.id)
    if (!preset) {
      displayMessage(`预设已不存在，无法复现：${run.source.name}`)
      return
    }
    await loadPreset(preset.id)
  } else if (run.source.kind === 'scene') {
    if (!run.source.id) {
      displayMessage('这条记录没有可复现的场景来源')
      return
    }
    if (!sceneEditorStore.getSceneDocument(run.source.id)) {
      displayMessage(`场景已不存在，无法复现：${run.source.name}`)
      refreshSavedScenes()
      return
    }
    selectedSceneId.value = run.source.id
    // 场景与预设是互斥来源：不清掉预设的话，记录会被误判成预设运行
    selectedPreset.value = ''
    const ok = await loadSceneFromEditor()
    if (!ok) return
  } else {
    if (!run.document) {
      displayMessage('这条记录没有保存场景文档，无法复现')
      return
    }
    try {
      await applySceneDocument(run.document)
    } catch (error) {
      console.warn('[SimulationLab] 复现记录失败', error)
      reportError(error, '/simulation-lab')
      displayMessage('复现失败：场景重建出错')
      return
    }
    selectedPreset.value = ''
    handoffDocument = run.document
  }

  applyRunConfig(run.config)
  displayMessage(`已复现运行：${run.name}`)
}

// ===================== 只读分享回放 =====================
// 链接即演示：/simulation-lab/share/<sceneId> 从后端拉场景（跨设备可达），
// 物理逐帧确定性——重放 = 从零重建世界再跑一遍，结果与首跑逐位一致。
const shareInfo = ref<{ id: string; name: string } | null>(null)
let shareDocument: { name: string; objects: SceneDocumentObject[] } | null = null

const loadShareScene = async (sceneId: string): Promise<void> => {
  try {
    const detail = await getScene(sceneId)
    shareDocument = detail.document
    shareInfo.value = { id: detail.id, name: detail.name }
    await applySceneDocument(detail.document)
    displayMessage(`已加载分享场景（只读）: ${detail.name}`)
  } catch (error) {
    console.warn('[SimulationLab] 分享场景加载失败', error)
    reportError(error, '/simulation-lab/share')
    displayMessage('分享场景加载失败——确认后端在线且场景存在')
  }
}

/** 确定性重放：从零重建世界再跑一遍。帧=物理步，结果与首跑逐位一致。 */
const replayShare = async (): Promise<void> => {
  if (!shareDocument) return
  try {
    await applySceneDocument(shareDocument)
    displayMessage('已重放：同样的场景与初始条件，轨迹逐位一致')
  } catch (error) {
    console.warn('[SimulationLab] 重放失败', error)
    reportError(error, '/simulation-lab/share')
    displayMessage('重放失败')
  }
}

const copyShareLink = async (): Promise<void> => {
  if (!shareInfo.value) return
  const url = `${window.location.origin}/simulation-lab/share/${encodeURIComponent(shareInfo.value.id)}`
  try {
    await navigator.clipboard.writeText(url)
    displayMessage('分享链接已复制到剪贴板')
  } catch {
    displayMessage(`复制失败，手动复制：${url}`)
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

/** 实验配置在 localStorage 里的键名 */
const EXPERIMENT_CONFIG_KEY = 'experimentConfig'

interface ExperimentConfig {
  gravity: number
  friction: number
  restitution: number
  simulationSpeed: number
  recordData: boolean
  samplingInterval: number
}

const saveExperiment = () => {
  const experimentConfig: ExperimentConfig = {
    gravity: gravity.value,
    friction: friction.value,
    restitution: restitution.value,
    simulationSpeed: simulationSpeed.value,
    recordData: recordData.value,
    samplingInterval: samplingInterval.value,
  }
  localStorage.setItem(EXPERIMENT_CONFIG_KEY, JSON.stringify(experimentConfig))
  displayMessage('实验配置已保存')
}

/**
 * 回填上次保存的实验配置。
 *
 * 读回路径必须存在：保存接口把配置写进 localStorage 之后没人读，
 * 「保存实验配置」就只是个安慰剂。数据损坏（坏 JSON / 字段类型不对）时
 * 保持默认值，不让页面崩。
 */
const restoreExperimentConfig = () => {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(EXPERIMENT_CONFIG_KEY)
  } catch (error) {
    // 隐私模式等场景下 localStorage 可能直接抛错
    console.warn('[SimulationLab] 读取实验配置失败，已忽略', error)
    return
  }
  if (!raw) return

  let parsed: Partial<ExperimentConfig>
  try {
    parsed = JSON.parse(raw) as Partial<ExperimentConfig>
  } catch (error) {
    console.warn('[SimulationLab] 实验配置解析失败，已忽略', error)
    return
  }
  if (!parsed || typeof parsed !== 'object') return

  const numberOr = (value: unknown, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback

  gravity.value = numberOr(parsed.gravity, gravity.value)
  simulationSpeed.value = numberOr(parsed.simulationSpeed, simulationSpeed.value)
  recordData.value =
    typeof parsed.recordData === 'boolean' ? parsed.recordData : recordData.value
  samplingInterval.value = numberOr(parsed.samplingInterval, samplingInterval.value)

  // 恢复出来的摩擦力/弹性系数成为全局覆盖：物理世界重建后要重新下发
  if (typeof parsed.friction === 'number' && Number.isFinite(parsed.friction)) {
    friction.value = parsed.friction
    frictionOverride = parsed.friction
  }
  if (typeof parsed.restitution === 'number' && Number.isFinite(parsed.restitution)) {
    restitution.value = parsed.restitution
    restitutionOverride = parsed.restitution
  }
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
    console.warn('[SimulationLab] 导出数据失败', error)
    reportError(error, '/simulation-lab')
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

/**
 * 物理初始化段：等 Rapier 就绪 → 建物理世界 → 放演示场景 → 重建并对齐刚体 → 下发参数。
 * 中途任何一步失败都算初始化失败，整段可重跑（error-overlay 的重试按钮从这里重新执行）。
 */
const initializePhysicsWorld = async () => {
  // 等待物理引擎初始化
  await ready()

  // 初始化物理
  await initPhysics(scene)

  // 加载默认场景
  createDemoScene()
  await initPhysics(scene)
  alignBodiesToMeshes()
  applyPhysicsParameters()
}

/** 初始化成功后的收尾（渲染循环与路由监听只注册一次；重试成功时也走这里） */
const startLabRuntime = () => {
  // 场景编辑器里保存过的场景（「从编辑器加载」用）
  refreshSavedScenes()

  // 接收场景编辑器的交接场景：物理世界已就绪；成功/失败都通过消息条说清楚
  void consumeHandoffScene()

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
      // 分享路由（/simulation-lab/share/<id>）从后端拉场景；
      // 普通 ?scene=<id> 深链接继续走本地（编辑器 localStorage）
      if (route.path.startsWith('/simulation-lab/share/')) {
        void loadShareScene(newSceneId as string)
        return
      }
      selectedSceneId.value = newSceneId as string
      loadSceneFromEditor()
    },
    { immediate: true },
  )
}

/** 物理初始化：失败时给出错误信息并上报遥测，不再静默黑屏 */
const runInitSequence = async () => {
  initLoading.value = true
  initError.value = ''
  try {
    await initializePhysicsWorld()
  } catch (error) {
    console.warn('[SimulationLab] 物理引擎初始化失败', error)
    reportError(error, '/simulation-lab')
    initError.value =
      error instanceof Error && error.message
        ? `物理引擎初始化失败：${error.message}`
        : '物理引擎初始化失败，请检查网络后重试'
    return
  } finally {
    initLoading.value = false
  }
  startLabRuntime()
}

/** 重试入口：error-overlay 的重试按钮，重跑整段初始化 */
const retryInit = async () => {
  await runInitSequence()
}

// 生命周期
onMounted(async () => {
  // 初始化 Three.js
  initThree()

  // 添加鼠标点击事件监听
  if (renderer) {
    renderer.domElement.addEventListener('click', handleMouseClick)
  }

  // 回填上次保存的实验配置（物理参数等物理世界建好后再同步）
  restoreExperimentConfig()

  // 等待物理引擎并建世界：失败时 error-overlay 接管，可重试
  await runInitSequence()
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

  // 移除窗口缩放监听：不解绑的话，页面来回切换会越挂越多份
  window.removeEventListener('resize', handleResize)

  // 摘掉容器观察器（与 onMounted 成对清理）
  viewportResizeObserver?.disconnect()
  viewportResizeObserver = null

  // 释放场景里的几何体与材质
  if (scene) {
    clearPhysicsObjects()
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
  renderer.setSize(width, height, false)
  // 本页渲染循环仅在仿真运行时跑：resize 清空 drawing buffer 后，
  // 静态状态必须立即补一帧渲染，否则画布黑屏直到下次仿真启动。
  sceneEditorStore.renderState.needsUpdate = true
}

// resize 监听注册在 setup 顶层（不是 onMounted 里），卸载时在 onUnmounted 里成对摘除
window.addEventListener('resize', handleResize)

// 容器级尺寸变化同样要重排：导航轨 hover 展开只改容器宽度、不触发 window resize，
// 只听 window 会让画布停在旧尺寸（表现为「画布没占满区域」）。
// ResizeObserver 观察视口容器本身；jsdom 无此 API，守卫跳过。
// ⚠️ 回调防抖：侧边栏 hover 展开是 CSS 过渡，宽度每帧都在变——每帧
// setSize 反复重置 drawing buffer（清空画布）→ 肉眼可见闪烁。防抖到
// 过渡结束后一次性精确对齐；过渡期间 canvas 由 CSS 平滑拉伸显示。
// 且本页渲染循环仅在仿真运行时跑：setSize 清空 buffer 后必须补一帧渲染
// （handleResize 尾部 renderState.needsUpdate = true），否则静态页黑屏。
let viewportResizeObserver: ResizeObserver | null = null
let viewportResizeDebounce: number | null = null
onMounted(() => {
  if (!viewportRef.value || typeof ResizeObserver === 'undefined') return
  viewportResizeObserver = new ResizeObserver(() => {
    if (viewportResizeDebounce !== null) window.clearTimeout(viewportResizeDebounce)
    viewportResizeDebounce = window.setTimeout(() => {
      viewportResizeDebounce = null
      handleResize()
    }, 220)
  })
  viewportResizeObserver.observe(viewportRef.value)
})
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
  /* 本页是 full-bleed 工作台、没有顶栏：80px 的魔数会悬在半空，贴住上缘 */
  top: 20px;
  left: 50%;
  transform: translateX(-50%);
  background-color: var(--bg-panel-raised);
  color: var(--text-1);
  border: 1px solid var(--border-strong);
  padding: 12px 24px;
  border-radius: 4px;
  box-shadow: var(--shadow-pop);
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

/* ---------- 初始化加载 / 失败 overlay（类名与样式对齐 SceneEditor 的标准） ---------- */
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  color: var(--text-1);
}

.loading-spinner {
  width: 50px;
  height: 50px;
  border: 5px solid var(--border-strong);
  border-radius: 50%;
  border-top-color: var(--text-1);
  animation: spin 1s ease-in-out infinite;
}

.error-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.7);
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  z-index: 1000;
  color: var(--text-1);
}

.error-message {
  color: var(--danger);
  font-size: 18px;
  margin-bottom: 20px;
}

.retry-btn {
  padding: 10px 20px;
  background: var(--accent-strong);
  color: var(--accent-on);
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: background 0.2s;
}

.retry-btn:hover {
  background: var(--accent-strong-hover);
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.simulation-container {
  display: flex;
  flex: 1;
  overflow: hidden;
  gap: 1px;
  background-color: var(--border-subtle);
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
  background-color: var(--bg-panel-raised);
  color: var(--text-1);
  border-bottom: 1px solid var(--border-subtle);
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
  background-color: transparent;
  color: var(--text-2);
  cursor: pointer;
  transition: all 0.2s;
}

.toolbar-btn:hover {
  background-color: var(--bg-hover);
}

.toolbar-btn:disabled {
  background-color: transparent;
  color: var(--text-3);
  cursor: not-allowed;
}

.speed-control {
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--text-2);
  font-size: 14px;
}

.speed-control input {
  width: 80px;
  accent-color: var(--accent);
}

.preset-selector {
  display: flex;
  align-items: center;
}

.preset-selector select {
  padding: 6px 10px;
  border: none;
  border-radius: 4px;
  background-color: var(--bg-inset);
  color: var(--text-1);
  color-scheme: dark;
  font-size: 13px;
  cursor: pointer;
  outline: none;
}

.preset-selector select:hover {
  background-color: var(--bg-hover);
}

.preset-selector select option {
  background-color: var(--bg-panel-raised);
  color: var(--text-1);
}

.viewport-container {
  flex: 1;
  background-color: var(--bg-canvas);
  position: relative;
  min-height: 0;
  overflow: hidden;
}

.viewport-info {
  position: absolute;
  top: 10px;
  left: 10px;
  display: flex;
  align-items: center;
  gap: 14px;
  /* HUD 数字走等宽体系；中文落到栈尾 sans 回退 */
  font-family: var(--font-mono);
  background: rgba(0, 0, 0, 0.7);
  color: var(--text-2);
  padding: 5px 10px;
  border-radius: 4px;
  font-size: 12px;
  z-index: 100;
}

/* HUD 里的 FPS 与底部状态条共用 status-item 的「label+value」结构，这里压成横排单行 */
.viewport-info .status-item {
  flex-direction: row;
  align-items: baseline;
  gap: 4px;
}

.simulation-status-panel {
  display: flex;
  padding: 10px;
  background-color: var(--bg-panel);
  border-top: 1px solid var(--border-subtle);
  gap: 20px;
}

.status-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.status-item .label {
  font-size: 12px;
  color: var(--text-3);
}

.status-item .value {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
  font-size: 14px;
  font-weight: bold;
  color: var(--text-1);
}

.status-item .value.running {
  color: var(--success);
}

.status-item .value.low {
  color: var(--danger);
}

.experiment-panel {
  width: 320px;
  flex-shrink: 0;
  background-color: var(--bg-panel);
  border-left: 1px solid var(--border-subtle);
  overflow-y: auto;
  padding: 20px;
}

/* 栏目头：PanelHeader 统一标题，底部分隔线收住右栏边界 */
.lab-side-head {
  padding-bottom: 12px;
  margin-bottom: 20px;
  border-bottom: 1px solid var(--border-subtle);
}

.lab-side-head :deep(.panel-title) {
  font-size: 18px;
}

/* 右栏内容区块：统一的纵向节奏（标题走 PanelHeader） */
.side-section {
  margin-bottom: 25px;
}

/* 「全局批量生效」警示标签：小字 --accent-2，挂在环境设置标题旁（从 InfoTip 升级而来） */
.param-global-warning {
  font-size: var(--text-xs);
  color: var(--accent-2);
  white-space: nowrap;
  cursor: help;
}

/* 预设下拉旁的一句话描述 */
.preset-desc {
  font-size: var(--text-xs);
  color: var(--text-3);
  max-width: 200px;
  line-height: 1.4;
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
  color: var(--text-2);
}

/* 物理参数滑条：与 number 双控件绑定同一个 ref，滑条管手感、number 管精确值 */
.parameter-item input[type='range'] {
  flex: 1 1 auto;
  min-width: 0;
  accent-color: var(--accent-strong);
}

.parameter-item input[type='number'] {
  width: 60px;
  padding: 4px 8px;
  border: 1px solid var(--border-subtle);
  border-radius: 3px;
  background-color: var(--bg-inset);
  color: var(--text-1);
  color-scheme: dark;
  font-family: var(--font-mono);
}

.parameter-item input[type='checkbox'] {
  margin-right: 5px;
  accent-color: var(--accent);
}

.export-btn {
  background-color: var(--accent-strong);
  color: var(--accent-on);
  border: none;
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  transition: background-color 0.2s;
}

.export-btn:hover {
  background-color: var(--accent-strong-hover);
}

/* 「记录本次运行」：与导出按钮同一套观感，但走中性描边，不和导出抢主次 */
.record-btn {
  background-color: transparent;
  color: var(--accent);
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  padding: 6px 12px;
  border-radius: 3px;
  cursor: pointer;
  font-size: 13px;
  transition:
    background-color 0.2s,
    border-color 0.2s;
}

.record-btn:hover {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.6);
}

.record-btn:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 「批量仿真 | 服务端渲染」tab 条：样式对齐 SceneEditor 的 side-tab，两个工作台观感同源 */
.side-tabs {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.side-tab {
  flex: 1 1 0;
  padding: 7px 12px;
  background-color: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  cursor: pointer;
  font-size: 13px;
  transition:
    background-color 0.2s ease,
    border-color 0.2s ease,
    color 0.2s ease;
}

.side-tab.active {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
  font-weight: 600;
}

.side-tab:hover:not(.active) {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-1);
}

/* 选中物体信息卡片：未选中时同区块上方渲染 EmptyState 空态 */
.selected-object-info {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 10px 12px;
  background-color: var(--bg-inset);
  border-radius: var(--radius-sm);
}

.object-property {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 13px;
}

.object-property span:first-child {
  color: var(--text-3);
}

.object-property span:last-child {
  color: var(--text-1);
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
  }

  .simulation-toolbar {
    flex-wrap: wrap;
    gap: 10px;
  }
}
/* 实验说明卡：实验目的、观察点与作业题（预设 experiment 元数据） */.experiment-card {
  background: var(--bg-panel-raised);
}

.experiment-purpose {
  margin: 0 0 8px;
  font-size: 0.8rem;
  line-height: 1.5;
  color: var(--text-1);
}

.experiment-observations {
  margin: 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-2);
}

.experiment-assignments {
  margin: 8px 0 0;
  padding-left: 16px;
  display: grid;
  gap: 4px;
  font-size: 0.75rem;
  line-height: 1.5;
  color: var(--text-3);
}

/* 只读分享条：链接即演示 */
.share-banner {
  position: fixed;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 40;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  background: var(--bg-panel-raised);
  border: 1px solid var(--border-1, rgba(255, 255, 255, 0.12));
  border-radius: 8px;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
}

.share-text {
  font-size: 0.78rem;
  color: var(--text-2);
}

.share-btn {
  font-size: 0.75rem;
}
</style>
