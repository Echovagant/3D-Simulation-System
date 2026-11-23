/**
 * 领域资料索引 · 后端接口客户端。
 *
 * 契约来源：`backend/app/routers/knowledge.py` + `backend/app/schemas.py`
 * （2026-11-23 实查）。端点、字段名与后端 schema 一一对应，别另造一套形状。
 *
 * 后端是**可选增强**：后端缺席时前端必须照常工作，
 * 失败一律以异常抛给调用方，由界面层判断是「后端不在」还是业务错误。
 */
import { apiRequest } from './client'

/** 一条资料（列表条目与写入成功（201）的应答同一形状） */
export interface KnowledgeItem {
  id: number
  title: string
  content: string
  /** 归一化后的逗号分隔标签（如 "gym, 力控"） */
  tags: string
  /** 0.0 ~ 1.0，检索打分用 */
  importance: number
  createdAt: string
  updatedAt: string
  lastAccessedAt: string
}

/** 写一条资料的入参；tags / importance 缺省走后端默认 */
export interface KnowledgeCreateInput {
  title: string
  content: string
  tags?: string
  importance?: number
}

/** 列表/检索的应答信封 */
export interface KnowledgeList {
  items: KnowledgeItem[]
}

/** 列表与检索共用的查询参数（归属过滤由 X-Owner-Token 承担） */
export interface KnowledgeQuery {
  /** 关键词（空格/逗号分隔，多词 OR）；不传 = 按权重+更新时间列表 */
  query?: string
  /** 最多取多少条（后端默认 50，上限 200） */
  limit?: number
}

/** 基础路径（router prefix 是 /knowledge，全局前缀 /api） */
const basePath = '/api/knowledge/entries'

/** 所有端点都要带的软身份头（与记忆同一套约定） */
const ownerHeaders = (ownerToken: string): Record<string, string> => ({
  'X-Owner-Token': ownerToken,
})

/** 列出当前 owner 的资料：无 query 按权重+更新时间倒序 */
export const listKnowledge = (
  ownerToken: string,
  query?: KnowledgeQuery,
): Promise<KnowledgeList> => {
  const search = new URLSearchParams()
  if (query?.query) search.set('query', query.query)
  if (query?.limit !== undefined) search.set('limit', String(query.limit))
  const qs = search.toString()
  return apiRequest<KnowledgeList>(`${basePath}${qs ? `?${qs}` : ''}`, {
    headers: ownerHeaders(ownerToken),
  })
}

/** 关键词检索：命中按 权重 / 时间衰减 打分降序，命中行刷新 lastAccessedAt */
export const searchKnowledge = (
  ownerToken: string,
  keyword: string,
  limit?: number,
): Promise<KnowledgeList> => listKnowledge(ownerToken, { query: keyword, limit })

/** 写一条资料；后端回 201 与完整条目 */
export const createKnowledge = (
  ownerToken: string,
  input: KnowledgeCreateInput,
): Promise<KnowledgeItem> =>
  apiRequest<KnowledgeItem>(basePath, {
    method: 'POST',
    headers: ownerHeaders(ownerToken),
    body: JSON.stringify({
      title: input.title,
      content: input.content,
      ...(input.tags !== undefined ? { tags: input.tags } : {}),
      ...(input.importance !== undefined ? { importance: input.importance } : {}),
    }),
  })

/** 删除一条资料；后端回 204。不存在/越权统一 404 knowledge_not_found */
export const deleteKnowledge = (ownerToken: string, id: number): Promise<void> =>
  apiRequest<void>(`${basePath}/${encodeURIComponent(String(id))}`, {
    method: 'DELETE',
    headers: ownerHeaders(ownerToken),
  })
