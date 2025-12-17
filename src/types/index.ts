// 导入 THREE.js 类型
import { Object3D, Scene as THREE_Scene, PerspectiveCamera, OrthographicCamera, WebGLRenderer } from 'three'

type Vector3 = { x: number; y: number; z: number }
// 使用重命名避免与接口名冲突
type Scene = THREE_Scene

// RAPIER 导入已移除，因为未使用
import type { AiAgent, AiAgentType, AiEnvironmentSettings } from '@/stores/aiStore'

// 物理配置类型
export interface PhysicsConfig {
  gravity: number
  airResistance: number
  updateRate: number
}

// 原有物理相关类型（保持不变）
export interface PhysicsData {
  type: 'static' | 'dynamic' | 'kinematic'
  shape: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'mesh'
  mass: number
  density?: number
  friction?: number
  restitution?: number
  linearDamping?: number
  angularDamping?: number
  collisionLayer?: number
  halfExtents?: { x: number; y: number; z: number }
  radius?: number
  height?: number
  // 自定义物理系统属性
  velocity?: Vector3
  acceleration?: Vector3
  isFalling?: boolean
}

// 原有仿真对象类型（保持不变）
export interface SimulationObject extends Object3D {
  userData: {
    physics?: PhysicsData
    [key: string]: unknown // 将 any 改为 unknown
  }
}

// 原有仿真预设类型（保持不变）
export interface SimulationPreset {
  id: string
  name: string
  description: string
  thumbnail: string
  scene: SimulationScene
}

// 原有仿真场景类型（保持不变）
export interface SimulationScene {
  name: string
  gravity: { x: number; y: number; z: number }
  objects: SimulationObject[]
  constraints?: SimulationConstraint[]
}

// 原有仿真约束类型（保持不变）
export interface SimulationConstraint {
  id: string
  type: 'distance' | 'hinge' | 'fixed' | 'prismatic' | 'revolute' | 'ball'
  objectA: string // 物体ID
  objectB: string // 物体ID
  positionA: { x: number; y: number; z: number }
  positionB: { x: number; y: number; z: number }
  axisA?: { x: number; y: number; z: number }
  axisB?: { x: number; y: number; z: number }
  limits?: {
    min: number
    max: number
  }
  stiffness?: number
  damping?: number
}

// 原有仿真统计类型（保持不变）
export interface SimulationStats {
  objects: number
  rigidBodies: number
  constraints: number
  fps: number
  simulationTime: number
}

// 原有仿真控制类型（保持不变）
export interface SimulationControls {
  isPlaying: boolean
  speed: number
  stepSize: number
}

// 场景对象类型
export interface SceneObject {
  uuid: string
  name: string
  type: 'model' | 'light' | 'camera' | 'primitive' | string
  modelId?: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  visible: boolean
  threeObject?: Object3D
  physics?: PhysicsData
}

// 模拟状态类型
export interface SimulationState {
  isPlaying: boolean
  isTransitioning: boolean
  isPaused: boolean
  speed: number
  currentTime: number
  frameCount: number
}

// 渲染状态类型
export interface RenderState {
  isRendering: boolean
  needsUpdate: boolean
  fps: number
  lastFrameTime: number
  performanceWarnings: Array<{message: string, timestamp: number, details?: Record<string, unknown>}>
  physicsErrors: Array<{message: string, error: Error, timestamp: number}>
}

// SceneEditorStore 类型定义
export interface SceneEditorStore {
  scene: Scene
  camera: PerspectiveCamera | OrthographicCamera
  renderer: WebGLRenderer
  animationId: number | null
  lastPhysicsUpdate: number
  selectedObjectUuid: string | null
  objects: SceneObject[]
  currentScene: Scene
  simulationState: SimulationState
  renderState: RenderState
  physicsConfig: PhysicsConfig
  selectedObject: SceneObject | null
  getCurrentScene: () => Scene
  setCurrentScene: (scene: Scene) => void
  getScene: () => Scene
  getCamera: () => PerspectiveCamera | OrthographicCamera
  getRenderer: () => WebGLRenderer
  initializePhysics: (object: SceneObject, mass?: number) => void
  updateObjectPhysics: (object: SceneObject, deltaTime: number) => void
  addObject: (object: SceneObject) => SceneObject
  setSelectedObject: (uuid: string | null) => void
  removeObject: (uuid: string) => void
  removeSelectedObject: () => void
  updateObject: (uuid: string, properties: Partial<SceneObject>) => void
  updateRendererSize: (width: number, height: number) => void
  getScreenshot: () => string | null
  cleanup: () => void
  togglePause: () => void
  startSimulation: () => void
  stopSimulation: () => void
  addPerformanceWarning: (message: string, details?: Record<string, unknown>) => void
  addPhysicsError: (message: string, error: Error) => void
}

// 模型库中的模型类型（保持不变）
export interface LibraryModel {
  uuid: string
  name: string
  description?: string
  category: ModelCategory
  thumbnailUrl: string
  modelUrl: string
  format: 'glb' | 'gltf' | 'obj' | 'fbx' | string
  size: number
  uploadDate: string
  polyCount: number
  materialCount: number
  hasAnimation: boolean
  tags?: string[]
}

// 模型类别（保持不变）
export type ModelCategory = 'characters' | 'environments' | 'props' | 'all'

// 排序选项（保持不变）
export type SortOption = 'name' | 'date' | 'size'

// 上传进度（保持不变）
export interface UploadProgress {
  percent: number
  loaded: number
  total: number
}

// 模型上传表单数据（保持不变）
export interface ModelUploadData {
  name: string
  category: ModelCategory
  file: File
}

// ******************************
// AI相关类型（改为模块内类型，非全局）
// ******************************

export interface AiSimulationState {
  time: number
  frame: number
  agents: Record<string, AiAgentState>
  objects: Record<string, SimulatedObjectState>
}

export interface AiAgentState {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  velocity: [number, number, number]
  status: 'normal' | 'collided' | 'goal_reached' | 'failed'
  sensors: Record<string, SensorData>
}

export interface SensorData {
  type: 'vision' | 'proximity' | 'audio'
  data: unknown // 将 any 改为 unknown
  timestamp: number
}

export interface SimulatedObjectState {
  id: string
  type: string
  position: [number, number, number]
  rotation: [number, number, number]
  properties: Record<string, unknown> // 将 any 改为 unknown
}

export interface AiDecision {
  agentId: string
  action: 'move' | 'rotate' | 'interact' | 'wait'
  parameters: Record<string, unknown> // 将 any 改为 unknown
  confidence: number
  timestamp: number
}

// 导出所有类型（统一模块内导出，无冲突）
export type { AiAgent, AiAgentType, AiEnvironmentSettings }
