// 导入 THREE.js 类型
import { Object3D } from 'three'
import type { AiEnvironmentSettings } from '@/stores/aiStore'

type Vector3 = { x: number; y: number; z: number }

/**
 * 场景物体的材质参数。
 *
 * 只描述 MeshStandardMaterial 的金属度 / 粗糙度：颜色仍在 `color` 字段里，
 * 贴图随模型文件自带，透明与发光不在本版本的场景格式内。
 */
export interface SceneMaterialSettings {
  metalness: number
  roughness: number
}

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

/** 程序化摆放的基础体规格（LLM 场景生成、精选场景等路径共用） */
export interface ScenePrimitiveSpec {
  name: string
  type: 'cube' | 'sphere' | 'ramp'
  position: { x: number; y: number; z: number }
  rotation?: { x: number; y: number; z: number }
  scale?: { x: number; y: number; z: number }
  /** 十六进制颜色；不传则从编辑器调色板轮换 */
  color?: number
  /** 刚体类型：默认 dynamic；static 用于搭建固定地形/道具 */
  bodyType?: 'dynamic' | 'static' | 'kinematic'
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
  /** 基础体颜色（十六进制）；模型不写这一项 */
  color?: number
  /** 材质参数（金属度 / 粗糙度）；不写表示沿用默认材质 */
  material?: SceneMaterialSettings
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
 * `type` 必须是**可重建的类型**：目前 'cube' / 'sphere' / 'ramp' / 'model'
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
  /** 基础体颜色（十六进制） */
  color?: number
  /** 材质参数（金属度 / 粗糙度）；旧文档没有这一项时按编辑器默认材质处理 */
  material?: SceneMaterialSettings
  /** 静态物理描述（没有刚体的物体不写这一项） */
  physics?: {
    type: 'static' | 'dynamic' | 'kinematic'
    shape: 'box' | 'sphere' | 'cylinder' | 'capsule' | 'mesh'
    mass: number
    /** 摩擦系数，0~1；旧文档缺省 0.5 */
    friction?: number
    /** 弹性（恢复系数），0~1；旧文档缺省 0.2 */
    restitution?: number
  }
}

/**
 * 场景的初始镜头。
 *
 * 作品级场景的构图有一半在镜头上：同一个场景，俯角、视距、目标点不同，
 * 观感差一个档。文档带上镜头后，编辑器加载、后端场景打开、渲染页导出
 * 都会落在同一个机位，截图不再「每次都要手动转半天」。
 *
 * `target` 必须与轨道控制器的 target 是同一个点，否则第一次 update()
 * 会把画面整体压偏（仿真实验室踩过的坑，见 config/sceneFraming.ts）。
 */
export interface SceneCamera {
  position: Vector3
  target: Vector3
  /** 垂直视野角（度）。缺省用 50，允许 25~90 */
  fov?: number
}

/** 场景文档：可持久化、可分享的场景表示 */
export interface SceneDocument {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  version: 1
  gravity?: { x: number; y: number; z: number }
  /** 场地边长（米）。旧文档没有这一项时按编辑器默认场地处理 */
  worldSize?: number
  /** 初始镜头；旧文档没有这一项时保持编辑器当前机位 */
  camera?: SceneCamera
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
  /** 实验说明卡：实验目的、观察点与作业题（实验室右栏展示；缺省则不显示该卡） */
  experiment?: {
    purpose: string
    observations: string[]
    /** 作业题：实现边界也写成可动手的题目（如钟摆的摆线约束） */
    assignments?: string[]
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
