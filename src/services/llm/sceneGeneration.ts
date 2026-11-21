import type { ScenePrimitiveSpec } from '@/types'

/**
 * LLM 程序化场景生成：用户一句话描述 → 模型输出场景文档 JSON →
 * 校验收敛成可摆放的基础体清单。
 *
 * 约束：
 * - 只允许基础体（cube/sphere/ramp）——模型走导入链路，不在生成范围
 * - 位置/缩放全部钳制在地面场景的合理区间（地面 y=0，物体出生后自由落体）
 * - 解析器永不抛异常：模型输出不可信，一切畸形都转成可读的跳过原因
 */

/** 生成结果的单个基础体 = 程序化摆放规格 */
type GeneratedPrimitive = ScenePrimitiveSpec

export interface SceneGenerationResult {
  ok: true
  objects: GeneratedPrimitive[]
  /** 被丢弃的畸形项原因（如实呈现给用户，不静默） */
  skipped: string[]
}

const ALLOWED_TYPES = new Set(['cube', 'sphere', 'ramp'])

const SYSTEM_PROMPT = `你是 3D 场景生成器。根据用户的描述，输出一个 JSON 对象：{"objects": [...]}。
每个 object 的字段：
- name: 中文名（不超过 10 个字）
- type: 只能是 "cube"、"sphere"、"ramp" 之一
- position: {"x":数字,"y":数字,"z":数字}，y 必须在 0.3~4 之间（地面在 y=0），x/z 在 -3~3
- rotation: {"x":数字,"y":数字,"z":数字}（弧度，可选）
- scale: {"x":数字,"y":数字,"z":数字}（可选，每轴 0.2~3）

规则：
- 最多 10 个物体；物体之间保持合理间距，不要重叠
- ramp（楔形斜面）的斜面从低处(+x)升到高处(-x)，配合 rotation.z 可以调整朝向
- 只输出 JSON 本身，不要 markdown 代码块，不要任何解释文字
- 场景要符合用户描述的主题与空间布局`

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
    x: clampNumber(obj.x, fallback.x, -4, 4),
    y: clampNumber(obj.y, fallback.y, 0.3, 4),
    z: clampNumber(obj.z, fallback.z, -4, 4),
  }
}

/**
 * 把模型输出收敛成可摆放的基础体清单。
 *
 * 非法项不炸、不静默——逐条记进 skipped 让界面如实呈现；
 * 全部非法才算失败。
 */
export const parseGeneratedScene = (
  content: string,
  maxObjects = 12,
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
    const type = typeof e.type === 'string' && ALLOWED_TYPES.has(e.type) ? (e.type as GeneratedPrimitive['type']) : null
    if (!type) {
      skipped.push(`第 ${i + 1} 项类型不支持（${String(e.type ?? '缺 type')}，只支持 cube/sphere/ramp）`)
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
        x: clampNumber(scl.x, 1, 0.2, 3),
        y: clampNumber(scl.y, 1, 0.2, 3),
        z: clampNumber(scl.z, 1, 0.2, 3),
      },
    })
  }

  if (out.length === 0) {
    return {
      ok: false,
      error: skipped.length ? `全部物体无效（${skipped[0]}）` : '返回的 objects 为空',
    }
  }
  return { ok: true, objects: out, skipped }
}
