// 导入 THREE.js 类型
import { Object3D } from 'three'

type Vector3 = { x: number; y: number; z: number }

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

// ─────────────────────────────────────────────────────────────
// 场景文档（计划 018）
//
// 这是本产品**唯一**的场景格式：保存、加载、导出、预设、深链接全部用它。
// 不要再新增第二套场景格式。
// ─────────────────────────────────────────────────────────────

/**
 * 场景文档里的单个物体。
 *
 * `type` 必须是**可重建的类型**：目前只有 'cube' / 'sphere' / 'model'
 * 能被 loadScene 真正还原。新增可重建类型时，loadScene 的分支必须同步更新，
 * 否则会出现「存得进、读不出」。
 */
export interface SceneDocumentObject {
  uuid: string
  type: string
  name: string
  modelId?: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  visible: boolean
  /** 静态物理描述（没有刚体的物体不写这一项） */
  physics?: {
    type: 'static' | 'dynamic' | 'kinematic'
    shape: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'mesh'
    mass: number
  }
}

/** 场景文档：可持久化、可分享的场景表示 */
export interface SceneDocument {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  version: 1
  gravity?: { x: number; y: number; z: number }
  objects: SceneDocumentObject[]
}

/** 场景索引里的一条（localStorage 的 `scene-index`） */
export interface SceneIndexEntry {
  id: string
  name: string
  createdAt: string
  objectCount: number
}

// ─────────────────────────────────────────────────────────────
// 预设目录（计划 018）
//
// 目录里的预设用的是**纯数据**（不是 Object3D），字段直接对应
// 仿真实验室渲染时需要的东西：形状、位置、缩放、物理参数。
// ─────────────────────────────────────────────────────────────

export interface PresetPhysicsConfig {
  type: 'static' | 'dynamic' | 'kinematic'
  mass: number
  friction: number
  restitution: number
}

export interface PresetSceneObject {
  id: string
  /** 几何形状：立方体 / 球体 / 圆柱体 */
  type: 'box' | 'sphere' | 'cylinder'
  name: string
  position: { x: number; y: number; z: number }
  rotation: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  physics: PresetPhysicsConfig
  /** 十六进制颜色，缺省时由渲染层给默认色 */
  color?: number
}

export interface PresetScene {
  name: string
  gravity: { x: number; y: number; z: number }
  objects: PresetSceneObject[]
}

/** 预设目录条目 */
export interface PresetCatalogEntry {
  id: string
  name: string
  description: string
  thumbnail: string
  scene: PresetScene
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

// 跨组件共享状态一律用 Pinia 的 useXxxStore()，其类型由 store 自动推导。
// 不要在此手写 store 的类型接口——手写签名必然与真实 store 漂移。

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
