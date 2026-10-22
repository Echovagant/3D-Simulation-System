/**
 * 把 OpenAPI 规格渲染成契约 markdown。
 *
 * 生成脚本与校验脚本**共用**这一份渲染逻辑——
 * 两边各写一份必然漂移，漂移了就等于没有校验。
 */

/** 取说明文字：优先 summary，没有就退回描述的第一行。 */
const describe = (op) => {
  if (typeof op.summary === 'string' && op.summary.trim()) return op.summary.trim()
  const description = typeof op.description === 'string' ? op.description : ''
  const firstLine = description.split('\n')[0].trim()
  return firstLine
}

/** 规格里有几个端点（路径 × 方法）。路径数与端点数不是一回事，别混用。 */
export const countEndpoints = (spec) => {
  let count = 0
  for (const methods of Object.values(spec.paths ?? {})) {
    count += Object.keys(methods).length
  }
  return count
}

/** 统一错误形状——前端只需要认这一种结构。 */
const ERROR_SHAPE = `\`\`\`json
{ "error": { "code": "scene_not_found", "message": "场景不存在：s1", "detail": null } }
\`\`\``

export const renderContract = (spec) => {
  const rows = []
  for (const [path, methods] of Object.entries(spec.paths ?? {})) {
    for (const [method, op] of Object.entries(methods)) {
      rows.push({
        method: method.toUpperCase(),
        path,
        operation: op.operationId ?? '',
        summary: describe(op),
      })
    }
  }
  rows.sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method))

  return [
    '# 后端 API 契约',
    '',
    '> **本文档是生成物，不要手改。**',
    '> 由 `npm run gen:api-contract` 从 FastAPI 应用生成；',
    '> CI 用 `npm run verify:api-contract` 校验它与代码一致。',
    '',
    `后端版本：${spec.info?.version ?? 'unknown'}　端点总数：${rows.length}`,
    '',
    '## 端点',
    '',
    '| 方法 | 路径 | 操作 id | 说明 |',
    '| --- | --- | --- | --- |',
    ...rows.map((r) => `| \`${r.method}\` | \`${r.path}\` | \`${r.operation}\` | ${r.summary} |`),
    '',
    '## 统一错误形状',
    '',
    '所有非 2xx 响应的 body 都是这个形状：',
    '',
    ERROR_SHAPE,
    '',
    '`code` 由抛出点自己定（见 `backend/app/errors.py`），前端只需要认这一种结构。',
    '',
  ].join('\n')
}
