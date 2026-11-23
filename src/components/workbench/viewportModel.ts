/**
 * 工作台 3D 视口的数据模型。
 *
 * 把「场景文档（几何类型/尺寸）」与「最新观测（位置/目标/完成状态）」
 * 合并成一份可直接建 Mesh 的渲染清单。纯函数，jsdom 里也能测——
 * WebGL 本身只在组件里创建。
 */
import type { GymObservation } from '@/services/api/gymWorkbench'

export type ViewportKind = 'cube' | 'sphere' | 'cylinder'

export interface ViewportObjectModel {
  uuid: string
  kind: ViewportKind
  position: { x: number; y: number; z: number }
  scale: { x: number; y: number; z: number }
  /** 是否是受控智能体（金色高亮） */
  isAgent: boolean
  /** 已完成（进圈/坠落）的智能体变暗 */
  done: boolean
}

export interface ViewportTargetModel {
  uuid: string
  x: number
  z: number
  done: boolean
}

export interface ViewportModel {
  objects: ViewportObjectModel[]
  targets: ViewportTargetModel[]
}

interface Vec3Like {
  x?: unknown
  y?: unknown
  z?: unknown
}

const vec3 = (value: unknown, fallback: number): { x: number; y: number; z: number } => {
  if (!value || typeof value !== 'object') return { x: fallback, y: fallback, z: fallback }
  const item = value as Vec3Like
  const pick = (part: unknown): number =>
    typeof part === 'number' && Number.isFinite(part) ? part : fallback
  return { x: pick(item.x), y: pick(item.y), z: pick(item.z) }
}

/** 场景物体 → 几何类型（认不出的按立方体画，绝不因为未知类型不渲染） */
const kindOf = (sceneObject: Record<string, unknown> | undefined): ViewportKind => {
  const type = sceneObject?.type
  if (type === 'sphere') return 'sphere'
  if (type === 'cylinder' || type === 'cone') return 'cylinder'
  return 'cube'
}

const sceneObjects = (scene: Record<string, unknown> | null): Record<string, unknown>[] => {
  const objects = scene?.objects
  if (!Array.isArray(objects)) return []
  return objects.filter(
    (item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object',
  )
}

/**
 * 合并场景与观测。
 *
 * 观测是对象**存在性**的真相（后端只回模拟中的物体）；场景只提供
 * 几何类型与视觉尺寸。没有观测时退回场景初始位置，视口仍能显示静态布局。
 */
export const buildViewportModel = (
  scene: Record<string, unknown> | null,
  observation: GymObservation | null,
): ViewportModel => {
  const sceneByUuid = new Map<string, Record<string, unknown>>()
  for (const item of sceneObjects(scene)) {
    if (typeof item.uuid === 'string') sceneByUuid.set(item.uuid, item)
  }

  const agentStates = new Map<string, { done: boolean }>()
  for (const agent of observation?.agents ?? []) {
    agentStates.set(agent.uuid, { done: agent.done })
  }

  const objects: ViewportObjectModel[] = []
  if (observation) {
    for (const item of observation.objects) {
      const meta = sceneByUuid.get(item.uuid)
      const sceneScale = vec3(meta?.scale, 1)
      objects.push({
        uuid: item.uuid,
        kind: kindOf(meta),
        position: vec3(item.position, 0),
        scale: sceneScale,
        isAgent: agentStates.has(item.uuid),
        done: agentStates.get(item.uuid)?.done ?? false,
      })
    }
  } else {
    for (const [uuid, meta] of sceneByUuid) {
      objects.push({
        uuid,
        kind: kindOf(meta),
        position: vec3(meta.position, 0),
        scale: vec3(meta.scale, 1),
        isAgent: false,
        done: false,
      })
    }
  }

  const targets: ViewportTargetModel[] = []
  if (observation?.agents && observation.agents.length > 0) {
    for (const agent of observation.agents) {
      targets.push({ uuid: agent.uuid, x: agent.target.x, z: agent.target.z, done: agent.done })
    }
  } else if (observation) {
    targets.push({ uuid: 'target', x: observation.target.x, z: observation.target.z, done: false })
  }

  return { objects, targets }
}
