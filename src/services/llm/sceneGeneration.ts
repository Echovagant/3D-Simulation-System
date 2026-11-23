import type { SceneCamera, ScenePrimitiveSpec } from '@/types'
import { normalizeSceneCamera } from '@/utils/sceneCamera'

/**
 * LLM 程序化场景生成：用户一句话描述 → 模型输出场景文档 JSON →
 * 校验收敛成可摆放的基础体清单。
 *
 * 约束：
 * - 只允许基础体（cube/sphere/ramp）——模型走导入链路，不在生成范围
 * - 位置/缩放全部钳制在 40×40 场地的合理区间（地面 y=0，物体出生后自由落体）
 * - 解析器永不抛异常：模型输出不可信，一切畸形都转成可读的跳过原因
 *
 * 这一版把创作尺度放大了一档：旧提示词只给 ±3 米、最多 10 个物体，
 * 生成结果必然是一个「小方块堆」，无论怎么摆都撑不起作品感。
 */

/** 生成结果的单个基础体 = 程序化摆放规格 */
type GeneratedPrimitive = ScenePrimitiveSpec

export interface SceneGenerationResult {
  ok: true
  objects: GeneratedPrimitive[]
  /** 被丢弃的畸形项原因（如实呈现给用户，不静默） */
  skipped: string[]
  /** 模型建议的镜头；没有或不可用时为 undefined */
  camera?: SceneCamera
}

const ALLOWED_TYPES = new Set(['cube', 'sphere', 'ramp'])

/** 与编辑器 40×40 场地对齐：留 6 米边距，物体不至于贴着场地边缘 */
const POSITION_LIMIT_XZ = 14
const POSITION_MIN_Y = 0.05
const POSITION_MAX_Y = 12
const SCALE_MIN = 0.15
const SCALE_MAX = 5
const MAX_OBJECTS_DEFAULT = 28

const SYSTEM_PROMPT = `你是 3D 场景生成器。根据用户的描述，输出一个 JSON 对象：{"objects": [...], "camera": {...}}。
每个 object 的字段：
- name: 中文名（不超过 10 个字）
- type: 只能是 "cube"、"sphere"、"ramp" 之一
- position: {"x":数字,"y":数字,"z":数字}，y 在 0.05~12 之间（地面在 y=0；结构件贴地时 y = 高度的一半），x/z 在 -14~14
- rotation: {"x":数字,"y":数字,"z":数字}（弧度，可选）
- scale: {"x":数字,"y":数字,"z":数字}（可选，每轴 0.15~5）
- color: 十六进制颜色字符串，如 "#4F9DFF"（可选）
- physics: "static" 或 "dynamic"（可选，默认 static；结构件用 static，演示球用 dynamic）

camera（可选）: {"position":{"x":数字,"y":数字,"z":数字},"target":{"x":数字,"y":数字,"z":数字},"fov":数字}，机位要能看见整个作品。

规则：
- 最多 24 个物体；先搭结构（平台/墙/坡/塔），再放细节与 2~4 个动态球
- 物体之间不要重叠；结构件贴地放置（y = 高度的一半）
- 配色克制：结构用低饱和冷灰（如 #39424E），只留 1~2 个高饱和强调色
- 构图要有主次：一个主体、一组辅助、少量强调，别把物体平均撒满地面
- ramp（楔形斜面）的斜面从低处(+x)升到高处(-x)，可用 rotation.y 转向
- 只输出 JSON 本身，不要 markdown 代码块，不要任何解释文字
- 场景要符合用户描述的主题与空间布局

示例（结构 + 强调 + 镜头）：
{"objects":[{"name":"石台","type":"cube","position":{"x":0,"y":0.3,"z":0},"scale":{"x":12,"y":0.6,"z":8},"color":"#39424E","physics":"static"},{"name":"主塔","type":"cube","position":{"x":-3,"y":3.5,"z":-1},"scale":{"x":2,"y":7,"z":2},"color":"#6E9FBF","physics":"static"},{"name":"小球","type":"sphere","position":{"x":2,"y":1.2,"z":1},"scale":{"x":1,"y":1,"z":1},"color":"#FF8A5C","physics":"dynamic"}],"camera":{"position":{"x":14,"y":11,"z":16},"target":{"x":0,"y":2,"z":0},"fov":45}}`

export const buildSceneGenerationMessages = (
  userPrompt: string,
): Array<{ role: 'system' | 'user' | 'assistant'; content: string }> => [
  { role: 'system', content: SYSTEM_PROMPT },
  { role: 'user', content: userPrompt },
]

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const clampNumber = (value: unknown, fallback: number, lo: number, hi: number): number => {
  const n = isFiniteNumber(value) ? value : fallback
  return Math.min(hi, Math.max(lo, n))
}

const readVec3 = (
  raw: unknown,
  fallback: { x: number; y: number; z: number },
): { x: number; y: number; z: number } => {
  const obj = (raw ?? {}) as Record<string, unknown>
  return {
    x: clampNumber(obj.x, fallback.x, -POSITION_LIMIT_XZ, POSITION_LIMIT_XZ),
    y: clampNumber(obj.y, fallback.y, POSITION_MIN_Y, POSITION_MAX_Y),
    z: clampNumber(obj.z, fallback.z, -POSITION_LIMIT_XZ, POSITION_LIMIT_XZ),
  }
}

/**
 * 读颜色：接受 "#RRGGBB" / "RRGGBB" / 0xRRGGBB 数字。
 * 读不出来返回 undefined（走编辑器调色板轮换），不算错误项。
 */
const readColor = (raw: unknown): number | undefined => {
  if (isFiniteNumber(raw)) {
    const value = Math.round(raw)
    return value >= 0 && value <= 0xffffff ? value : undefined
  }
  if (typeof raw !== 'string') return undefined
  const match = /^#?([0-9a-f]{6})$/i.exec(raw.trim())
  if (!match) return undefined
  return Number.parseInt(match[1], 16)
}

/** 读刚体类型：支持 "static" / "dynamic" 字符串，也兼容 {"type": ...} 对象写法 */
const readBodyType = (raw: unknown): 'static' | 'dynamic' | 'kinematic' | undefined => {
  const value =
    typeof raw === 'string'
      ? raw
      : raw && typeof raw === 'object'
        ? (raw as Record<string, unknown>).type
        : undefined
  if (value === 'static' || value === 'dynamic' || value === 'kinematic') return value
  return undefined
}

/**
 * 把模型输出收敛成可摆放的基础体清单。
 *
 * 非法项不炸、不静默——逐条记进 skipped 让界面如实呈现；
 * 全部非法才算失败。
 */
export const parseGeneratedScene = (
  content: string,
  maxObjects = MAX_OBJECTS_DEFAULT,
): SceneGenerationResult | { ok: false; error: string } => {
  // 剥掉 markdown 围栏，取第一个 { 到最后一个 } 之间的内容
  const text = content.replace(/```(?:json)?/g, '')
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) {
    return { ok: false, error: '模型没有返回 JSON（找不到对象）' }
  }

  let raw: unknown
  try {
    raw = JSON.parse(text.slice(start, end + 1))
  } catch {
    return { ok: false, error: '模型返回的 JSON 无法解析' }
  }

  const objects = (raw as { objects?: unknown }).objects
  if (!Array.isArray(objects)) {
    return { ok: false, error: '返回内容缺少 objects 数组' }
  }

  const out: GeneratedPrimitive[] = []
  const skipped: string[] = []

  for (const [i, entry] of objects.entries()) {
    if (out.length >= maxObjects) {
      skipped.push(`超出 ${maxObjects} 个上限，已忽略第 ${i + 1} 项及之后`)
      break
    }
    if (!entry || typeof entry !== 'object') {
      skipped.push(`第 ${i + 1} 项不是对象`)
      continue
    }
    const e = entry as Record<string, unknown>
    const type =
      typeof e.type === 'string' && ALLOWED_TYPES.has(e.type)
        ? (e.type as GeneratedPrimitive['type'])
        : null
    if (!type) {
      skipped.push(
        `第 ${i + 1} 项类型不支持（${String(e.type ?? '缺 type')}，只支持 cube/sphere/ramp）`,
      )
      continue
    }
    const pos = (e.position ?? {}) as Record<string, unknown>
    if (!isFiniteNumber(pos.x) || !isFiniteNumber(pos.z)) {
      skipped.push(`第 ${i + 1} 项 position 缺失或非法`)
      continue
    }
    const rot = (e.rotation ?? {}) as Record<string, unknown>
    const scl = (e.scale ?? {}) as Record<string, unknown>
    const name =
      typeof e.name === 'string' && e.name.trim() ? e.name.trim().slice(0, 20) : `物体 ${i + 1}`
    const color = readColor(e.color)
    // 没写 physics 时按形状给一个合理默认：结构块静止，球体可动。
    // 全默认 static 会让模型漏写的演示球悬在半空，比「掉下来」更像 bug。
    const bodyType = readBodyType(e.physics) ?? (type === 'sphere' ? 'dynamic' : 'static')

    out.push({
      name,
      type,
      position: readVec3(pos, { x: 0, y: 1, z: 0 }),
      rotation: {
        x: clampNumber(rot.x, 0, -Math.PI * 4, Math.PI * 4),
        y: clampNumber(rot.y, 0, -Math.PI * 4, Math.PI * 4),
        z: clampNumber(rot.z, 0, -Math.PI * 4, Math.PI * 4),
      },
      scale: {
        x: clampNumber(scl.x, 1, SCALE_MIN, SCALE_MAX),
        y: clampNumber(scl.y, 1, SCALE_MIN, SCALE_MAX),
        z: clampNumber(scl.z, 1, SCALE_MIN, SCALE_MAX),
      },
      ...(color !== undefined ? { color } : {}),
      bodyType,
    })
  }

  if (out.length === 0) {
    return {
      ok: false,
      error: skipped.length ? `全部物体无效（${skipped[0]}）` : '返回的 objects 为空',
    }
  }

  const camera = normalizeSceneCamera((raw as { camera?: unknown }).camera) ?? undefined
  return { ok: true, objects: out, skipped, ...(camera ? { camera } : {}) }
}
