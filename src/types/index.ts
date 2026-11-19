// 导入 THREE.js 类型
import { Object3D } from 'three'

type Vector3 = { x: number; y: number; z: number }

import type { AiEnvironmentSettings } from '@/stores/aiStore'

// 物理描述（SceneObject.physics 用，模块内类型）
interface PhysicsData {
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

interface PresetPhysicsConfig {
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
  /** 课件层：教学目标与课堂观察点（实验室右栏「课件」卡展示；缺省则不显示课件卡） */
  education?: {
    objective: string
    observations: string[]
  }
}

// 跨组件共享状态一律用 Pinia 的 useXxxStore()，其类型由 store 自动推导。
// 不要在此手写 store 的类型接口——手写签名必然与真实 store 漂移。

// AI 快照里的单个智能体状态
export interface AiAgentState {
  id: string
  position: [number, number, number]
  rotation: [number, number, number]
  velocity: [number, number, number]
  status: 'normal' | 'collided' | 'goal_reached' | 'failed'
  sensors: Record<string, SensorData>
}

// AI 快照里的传感器读数（模块内类型）
interface SensorData {
  type: 'vision' | 'proximity' | 'audio'
  data: unknown // 将 any 改为 unknown
  timestamp: number
}

// AI 代理单步决策
export interface AiDecision {
  agentId: string
  action: 'move' | 'rotate' | 'interact' | 'wait'
  parameters: Record<string, unknown> // 将 any 改为 unknown
  confidence: number
  timestamp: number
}

// AI 相关类型（模块内导出，无冲突）
export type { AiEnvironmentSettings }
