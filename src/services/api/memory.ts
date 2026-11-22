/**
 * 智能体记忆 · 后端接口客户端。
 *
 * 契约来源：`backend/app/routers/memory.py` + `backend/app/schemas.py`（2026-11-23
 * 实查，全部端点用 curl 过了一遍真实响应）。端点、字段名与后端 schema
 * 一一对应，别另造一套形状。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 所以失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import { apiRequest } from './client'

/** 记忆的三种类型：情节（发生过什么）/ 语义（是什么）/ 程序（怎么做的） */
export type MemoryKind = 'episodic' | 'semantic' | 'procedural'

/** 记忆的来源：手动写入 / 审计提炼 */
export type MemorySource = 'manual' | 'audit_distilled'

/** 一条记忆（列表条目与写入成功（201）的应答同一形状） */
export interface MemoryItem {
  id: number
  kind: MemoryKind | string
  content: string
  source: MemorySource | string
  /** 0.0 ~ 1.0，检索打分用 */
  importance: number
  /** 只在审计提炼的记忆上有值，手动写入为 null */
  dedupeKey: string | null
  createdAt: string
  lastAccessedAt: string
}

/** 写一条记忆的入参；importance 缺省走后端默认 0.5 */
export interface MemoryCreateInput {
  kind: MemoryKind | string
  content: string
  importance?: number
}

/** 列表/检索的应答信封 */
export interface MemoryList {
  items: MemoryItem[]
}

/** 列表与检索共用的查询参数（归属过滤由 X-Owner-Token 承担） */
export interface MemoryQuery {
  /** 关键词（后端会先 trim）；不传 = 最近优先列表 */
  query?: string
  /** 最多取多少条（后端默认 50，上限 200） */
  limit?: number
}

/** 提炼出的一条失败模式（同一会话内重复出现的失败） */
export interface ConsolidatePattern {
  sessionId: string
  errorCode: string
  occurrences: number
  memoryId: number
  /** "created"（新提炼）/ "updated"（已有同源记忆被更新） */
  action: 'created' | 'updated' | string
}

/** 一次审计提炼的结果 */
export interface ConsolidateResult {
  /** 本次扫过的审计行数 */
  scannedLogs: number
  created: number
  updated: number
  patterns: ConsolidatePattern[]
}

/** 基础路径（router prefix 是 /memory，全局前缀 /api） */
const basePath = '/api/memory'

/** 所有端点都要带的软身份头（与 LLM 托管同一套约定） */
const ownerHeaders = (ownerToken: string): Record<string, string> => ({
  'X-Owner-Token': ownerToken,
})

/** 列出当前 owner 的记忆：无 query 按最近访问倒序 */
export const listMemories = (
  ownerToken: string,
  query?: MemoryQuery,
): Promise<MemoryList> => {
  const search = new URLSearchParams()
  if (query?.query) search.set('query', query.query)
  if (query?.limit !== undefined) search.set('limit', String(query.limit))
  const qs = search.toString()
  return apiRequest<MemoryList>(`${basePath}${qs ? `?${qs}` : ''}`, {
    headers: ownerHeaders(ownerToken),
  })
}

/** 关键词检索：命中按 importance / 时间衰减打分降序，命中行刷新 lastAccessedAt */
export const searchMemories = (
  ownerToken: string,
  keyword: string,
  limit?: number,
): Promise<MemoryList> => listMemories(ownerToken, { query: keyword, limit })

/** 写一条记忆；后端回 201 与完整条目（形状与列表条目一致） */
export const createMemory = (
  ownerToken: string,
  input: MemoryCreateInput,
): Promise<MemoryItem> =>
  apiRequest<MemoryItem>(basePath, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({
      kind: input.kind,
      content: input.content,
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
    }),
  })

/** 删除一条记忆；后端回 204（无响应体）。不存在/越权统一 404 memory_not_found */
export const deleteMemory = (ownerToken: string, id: number): Promise<void> =>
  apiRequest<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: ownerHeaders(ownerToken),
  })

/**
 * 从当前 owner 的 gym 审计里提炼重复出现的失败模式，写成程序性记忆。
 * 幂等：同一 (owner, 错误码, 会话) 组合重跑是更新，不会重复插入。
 */
export const consolidateMemory = (ownerToken: string): Promise<ConsolidateResult> =>
  apiRequest<ConsolidateResult>(`${basePath}/consolidate`, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
  })
