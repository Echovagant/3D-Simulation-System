import type { SceneDocument } from '@/types'
import { apiRequest } from './client'

/** 场景摘要：列表与写操作都只回这一层 */
export interface SceneSummary {
  id: string
  name: string
  objectCount: number
  createdAt: string
  updatedAt: string
}

/** 场景详情：摘要 + 完整场景文档 */
export interface SceneDetail extends SceneSummary {
  document: SceneDocument
}

/** 写入请求体：`document.id` 即场景主键 */
export interface SceneUpsert {
  name: string
  document: SceneDocument
}

/** 场景路径；id 要编码，避免 id 里的特殊字符把路径拆坏 */
const scenePath = (id: string): string => `/api/scenes/${encodeURIComponent(id)}`

/** 场景列表 */
export const listScenes = (): Promise<SceneSummary[]> => apiRequest<SceneSummary[]>('/api/scenes')

/** 读取单个场景 */
export const getScene = (id: string): Promise<SceneDetail> => apiRequest<SceneDetail>(scenePath(id))

/** 新建场景；id 重复时后端回 409 */
export const createScene = (payload: SceneUpsert): Promise<SceneSummary> =>
  apiRequest<SceneSummary>('/api/scenes', {
    method: 'POST',
    body: JSON.stringify(payload),
  })

/** 更新场景；路径里的 id 是被改的那一个 */
export const updateScene = (id: string, payload: SceneUpsert): Promise<SceneSummary> =>
  apiRequest<SceneSummary>(scenePath(id), {
    method: 'PUT',
    body: JSON.stringify(payload),
  })

/** 删除场景；后端回 204（无响应体） */
export const deleteScene = (id: string): Promise<void> =>
  apiRequest<void>(scenePath(id), { method: 'DELETE' })
