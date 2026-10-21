/**
 * LLM 提示词与输出解析。
 *
 * ⚠️ 这里的提示词是**纯函数**：输入是结构化状态，输出是消息数组。
 * 好处是可以在单元测试里直接断言"提示词里确实带了感知数据"，
 * 不用真的去调模型。
 */

/** 一个智能体在某一刻的完整快照——喂给模型的全部输入 */
export interface AgentSnapshot {
  /** 智能体 id */
  id: string
  /** 智能体名字 */
  name: string
  /** 智能体类型 */
  type: string
  /** 世界坐标 */
  position: [number, number, number]
  /** 当前速度（米/秒） */
  velocity: [number, number, number]
  /** 指向目标点的单位方向 [dx, dz] */
  goalDirection: [number, number]
  /** 目标点世界坐标 */
  goal: [number, number, number]
  /** 到最近障碍物的距离（米）；视野内没有障碍物时为 999 */
  nearestObstacleDistance: number
  /** 感知范围内的障碍物数量 */
  obstaclesInRange: number
  /** 感知范围（米） */
  awarenessRange: number
  /** 允许的最大速度（米/秒） */
  maxSpeed: number
  /** 是否正与障碍物接触 */
  collided: boolean
  /** 上一次动作（move / rotate / wait） */
  lastAction?: string
  /** 上一次动作的参数 */
  lastParameters?: Record<string, unknown>
}

/** 模型允许输出的动作 */
export type LlmActionName = 'move' | 'rotate' | 'wait'

/** 校验通过的动作 */
export interface LlmAction {
  action: LlmActionName
  /** move：单位方向 [dx, dz] */
  direction?: [number, number]
  /** move：速度（米/秒） */
  speed?: number
  /** rotate：弧度 */
  angle?: number
}

const CONTROLLER_SYSTEM_PROMPT = `你是一个 3D 仿真场地里的无人车控制器。你只能通过动作影响它，不能直接给坐标。

场地是 48×48 米，障碍物是静止的方块，四周有墙。坐标里 x 是东西向、z 是南北向。

你只能使用下面三种动作之一，并且必须原样使用这些字段名：
- {"action":"move","direction":[dx,dz],"speed":5} —— 朝 direction 指定的方向行驶，speed 单位是米/秒
- {"action":"rotate","angle":0.5} —— 绕竖直轴转向，angle 单位是弧度，正数向右
- {"action":"wait"} —— 原地不动

要求：
1. 只输出一个 JSON 对象，不要任何解释文字，不要 Markdown 代码块。
2. direction 必须是长度为 2 的数字数组 [dx, dz]，表示单位方向（不需要你自己归一化，但方向不能是 [0,0]）。
3. speed 取值 0.5 到 8，angle 取值 -3.14 到 3.14。
4. 最近障碍物距离小于 3.5 米时优先 rotate 躲开；否则朝目标方向 move。
5. 已经在撞障碍物时，优先 rotate 脱离，不要继续往障碍物里 move。`

const EXPLAIN_SYSTEM_PROMPT = `你是一个 3D 仿真场地里智能体行为的讲解员。

给定智能体当前的状态和它刚刚做出的决策，用两三句中文说明：
- 它为什么做出这个决策
- 接下来它会怎么走

要求：
1. 只输出说明文字本身，不要 JSON、不要标题、不要 Markdown。
2. 不要复述具体数字，要讲因果（"因为前方有箱子挡路，所以它往右绕"）。
3. 不要编造没有发生的事；状态里没有的信息不要提。`

/** 状态 → 给模型看的 JSON（字段名用英文，语义在系统提示词里讲清楚） */
const snapshotToPayload = (snapshot: AgentSnapshot): Record<string, unknown> => ({
  name: snapshot.name,
  type: snapshot.type,
  position: snapshot.position,
  velocity: snapshot.velocity,
  goal: snapshot.goal,
  goal_direction: snapshot.goalDirection,
  nearest_obstacle_distance: snapshot.nearestObstacleDistance,
  obstacles_in_range: snapshot.obstaclesInRange,
  awareness_range: snapshot.awarenessRange,
  max_speed: snapshot.maxSpeed,
  collided: snapshot.collided,
  last_action: snapshot.lastAction ?? null,
  last_parameters: snapshot.lastParameters ?? null,
})

/** 构造控制器的消息 */
export const buildDecisionMessages = (
  snapshot: AgentSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> => [
  { role: 'system', content: CONTROLLER_SYSTEM_PROMPT },
  { role: 'user', content: JSON.stringify(snapshotToPayload(snapshot)) },
]

/** 构造解释层的消息 */
export const buildExplainMessages = (
  snapshot: AgentSnapshot,
): Array<{ role: 'system' | 'user'; content: string }> => [
  { role: 'system', content: EXPLAIN_SYSTEM_PROMPT },
  { role: 'user', content: JSON.stringify(snapshotToPayload(snapshot)) },
]

/**
 * 从模型回复里抠出第一个完整的 JSON 对象。
 *
 * 模型经常在 JSON 外面裹一段话或 ```json 代码块——直接 `JSON.parse` 会炸。
 */
export const extractJsonObject = (raw: string): string | null => {
  if (!raw) return null
  const text = raw.replace(/```(?:json)?/gi, ' ')
  const start = text.indexOf('{')
  if (start < 0) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') {
      inString = true
      continue
    }
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

const toFiniteNumber = (value: unknown): number | null => {
  const number = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(number) ? number : null
}

/**
 * 解析并校验模型给出的动作。
 *
 * ⚠️ 这是 LLM 与物理之间**唯一**的闸门：模型说什么不算数，
 * 只有通过这里的校验才会被 `executeAgentDecision` 执行。
 * 校验不过就返回 `null`，调用方回落到规则式控制器。
 */
export const parseLlmAction = (raw: string, maxSpeed = 8): LlmAction | null => {
  const json = extractJsonObject(raw)
  if (!json) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(json)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null

  const record = parsed as Record<string, unknown>
  const action = record.action
  if (action !== 'move' && action !== 'rotate' && action !== 'wait') return null

  if (action === 'wait') return { action: 'wait' }

  if (action === 'rotate') {
    const angle = toFiniteNumber(record.angle)
    if (angle === null) return null
    return { action: 'rotate', angle: clamp(angle, -Math.PI, Math.PI) }
  }

  const direction = record.direction
  if (!Array.isArray(direction) || direction.length < 2) return null
  const dx = toFiniteNumber(direction[0])
  const dz = toFiniteNumber(direction[1])
  if (dx === null || dz === null) return null
  const length = Math.hypot(dx, dz)
  // 方向不能是零向量——那会让智能体原地不动却以为自己要移动
  if (length < 1e-6) return null

  const speed = toFiniteNumber(record.speed)
  return {
    action: 'move',
    direction: [dx / length, dz / length],
    speed: speed === null ? maxSpeed : clamp(speed, 0.5, maxSpeed),
  }
}
