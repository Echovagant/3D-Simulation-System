/**
 * 场景文档的运行时校验。
 *
 * 导出只是 `JSON.stringify`，导入必须把外部文件当成不可信输入：
 * 缺字段、类型不对、坐标是 NaN、物体类型不认识，都要变成**可读的导入失败**，
 * 不能默默丢物体——「导入成功但少了几个」比直接报错更难排查。
 */
import type { SceneDocument, SceneDocumentObject } from '@/types'
import { DEFAULT_SCENE_WORLD_SIZE, normalizeWorldSize } from '@/config/sceneEditor'
import { normalizeSceneCamera } from '@/utils/sceneCamera'

const SUPPORTED_TYPES = new Set(['cube', 'sphere', 'ramp', 'model'])
const PHYSICS_TYPES = new Set(['static', 'dynamic', 'kinematic'])
const PHYSICS_SHAPES = new Set(['box', 'sphere', 'cylinder', 'capsule', 'mesh'])
const MAX_OBJECTS = 500

export type SceneDocumentParseResult =
  | { ok: true; document: SceneDocument }
  | { ok: false; error: string }

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const readVec3 = (
  raw: unknown,
  fallback: { x: number; y: number; z: number },
  field: string,
  index: number,
): { x: number; y: number; z: number } => {
  if (raw === undefined) return { ...fallback }
  if (!isRecord(raw)) {
    throw new Error(`第 ${index + 1} 个物体的 ${field} 必须是 {x,y,z} 对象`)
  }
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.z)) {
    throw new Error(`第 ${index + 1} 个物体的 ${field}.x/y/z 必须是有限数字`)
  }
  return { x: raw.x, y: raw.y, z: raw.z }
}

const createUuid = (): string => {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === 'function') return cryptoApi.randomUUID()
  return `import-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

const normalizeObject = (raw: unknown, index: number): SceneDocumentObject => {
  if (!isRecord(raw)) throw new Error(`第 ${index + 1} 个物体必须是对象`)

  const type = raw.type
  if (typeof type !== 'string' || !SUPPORTED_TYPES.has(type)) {
    throw new Error(
      `第 ${index + 1} 个物体的类型不支持：${String(type ?? '缺 type')}（只支持 cube / sphere / ramp / model）`,
    )
  }

  if (!raw.position) throw new Error(`第 ${index + 1} 个物体缺少 position`)
  const position = readVec3(raw.position, { x: 0, y: 0, z: 0 }, 'position', index)
  const rotation = readVec3(raw.rotation, { x: 0, y: 0, z: 0 }, 'rotation', index)
  const scale = readVec3(raw.scale, { x: 1, y: 1, z: 1 }, 'scale', index)
  for (const axis of ['x', 'y', 'z'] as const) {
    if (scale[axis] === 0) scale[axis] = 1
  }

  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim().slice(0, 80) : type
  const uuid =
    typeof raw.uuid === 'string' && raw.uuid.trim() ? raw.uuid.trim() : createUuid()

  let modelId: string | undefined
  if (type === 'model') {
    if (typeof raw.modelId !== 'string' || !raw.modelId.trim()) {
      throw new Error(`第 ${index + 1} 个物体是模型，但缺少 modelId`)
    }
    modelId = raw.modelId.trim()
  }

  let color: number | undefined
  if (isFiniteNumber(raw.color)) {
    const value = Math.round(raw.color)
    if (value >= 0 && value <= 0xffffff) color = value
  }

  let physics: SceneDocumentObject['physics']
  if (isRecord(raw.physics)) {
    const physicsType = raw.physics.type
    const shape = raw.physics.shape
    if (typeof physicsType === 'string' && PHYSICS_TYPES.has(physicsType)) {
      if (typeof shape === 'string' && PHYSICS_SHAPES.has(shape)) {
        physics = {
          type: physicsType as NonNullable<SceneDocumentObject['physics']>['type'],
          shape: shape as NonNullable<SceneDocumentObject['physics']>['shape'],
          mass: isFiniteNumber(raw.physics.mass) && raw.physics.mass > 0 ? raw.physics.mass : 1,
        }
      }
    }
  }

  return {
    uuid,
    type,
    name,
    ...(modelId ? { modelId } : {}),
    position,
    rotation,
    scale,
    visible: raw.visible !== false,
    ...(color !== undefined ? { color } : {}),
    ...(physics ? { physics } : {}),
  }
}

/**
 * 把任意输入收敛成合法的 SceneDocument。
 *
 * 失败时返回结构化错误，绝不抛异常——调用方直接把 `error` 显示给用户。
 */
export const normalizeSceneDocument = (raw: unknown): SceneDocumentParseResult => {
  try {
    if (!isRecord(raw)) return { ok: false, error: '文件内容必须是一个 JSON 对象' }

    const objects = raw.objects
    if (!Array.isArray(objects)) return { ok: false, error: '场景缺少 objects 数组' }
    if (objects.length > MAX_OBJECTS) {
      return { ok: false, error: `场景物体过多（${objects.length} 个，上限 ${MAX_OBJECTS} 个）` }
    }

    const id =
      typeof raw.id === 'string' && raw.id.trim()
        ? raw.id.trim()
        : `import-${Date.now().toString(36)}`
    const name =
      typeof raw.name === 'string' && raw.name.trim()
        ? raw.name.trim().slice(0, 200)
        : '导入场景'
    const now = new Date().toISOString()
    const createdAt =
      typeof raw.createdAt === 'string' && raw.createdAt.trim() ? raw.createdAt : now
    const updatedAt =
      typeof raw.updatedAt === 'string' && raw.updatedAt.trim() ? raw.updatedAt : createdAt

    const camera = normalizeSceneCamera(raw.camera)

    return {
      ok: true,
      document: {
        id,
        name,
        createdAt,
        updatedAt,
        version: 1,
        worldSize: normalizeWorldSize(raw.worldSize ?? DEFAULT_SCENE_WORLD_SIZE),
        ...(camera ? { camera } : {}),
        ...(isRecord(raw.gravity) &&
        isFiniteNumber(raw.gravity.x) &&
        isFiniteNumber(raw.gravity.y) &&
        isFiniteNumber(raw.gravity.z)
          ? { gravity: { x: raw.gravity.x, y: raw.gravity.y, z: raw.gravity.z } }
          : {}),
        objects: objects.map((entry, index) => normalizeObject(entry, index)),
      },
    }
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : '场景文件解析失败',
    }
  }
}

/** 从文件文本解析场景文档 */
export const parseSceneDocumentJson = (text: string): SceneDocumentParseResult => {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return { ok: false, error: '不是合法的 JSON 文件' }
  }
  return normalizeSceneDocument(raw)
}
