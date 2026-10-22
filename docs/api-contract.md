# 后端 API 契约

> **本文档是生成物，不要手改。**
> 由 `npm run gen:api-contract` 从 FastAPI 应用生成；
> CI 用 `npm run verify:api-contract` 校验它与代码一致。

后端版本：0.1.0　端点总数：7

## 端点

| 方法 | 路径 | 操作 id | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/health` | `health_api_health_get` | 存活探针 |
| `GET` | `/api/scenes` | `list_scenes_api_scenes_get` | 列出场景摘要 |
| `POST` | `/api/scenes` | `create_scene_api_scenes_post` | 新建场景 |
| `DELETE` | `/api/scenes/{scene_id}` | `delete_scene_api_scenes__scene_id__delete` | 删除场景 |
| `GET` | `/api/scenes/{scene_id}` | `get_scene_api_scenes__scene_id__get` | 读取场景详情 |
| `PUT` | `/api/scenes/{scene_id}` | `update_scene_api_scenes__scene_id__put` | 更新场景 |
| `POST` | `/api/telemetry` | `ingest_api_telemetry_post` | 上报一批遥测事件 |

## 统一错误形状

所有非 2xx 响应的 body 都是这个形状：

```json
{ "error": { "code": "scene_not_found", "message": "场景不存在：s1", "detail": null } }
```

`code` 由抛出点自己定（见 `backend/app/errors.py`），前端只需要认这一种结构。
