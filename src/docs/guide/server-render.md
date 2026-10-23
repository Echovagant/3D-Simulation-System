# 服务端渲染使用指南

服务端渲染（仿真实验室右栏的「服务端渲染」面板）把**一个场景变成一段 MP4**：提交场景与一段动作脚本，服务端用无头浏览器按脚本逐帧推进物理，抓帧编码成视频。

它是一个**可选增强**：后端不在时，面板只会显示一句「后端不在，服务端渲染暂不可用」，页面里其它功能完全不受影响。

## 前提：三样东西缺一不可

服务端渲染要真的跑起来，需要：

| 需要什么 | 缺了会怎样 |
| --- | --- |
| **生产产物 `dist/`** | 503 `render_build_missing`，文案会提示先跑 `npm run build` |
| **Chrome** | 503 `render_browser_unavailable` |
| **ffmpeg** | 503 `render_ffmpeg_unavailable` |

> 渲染页在**生产产物**里（`dist/render.html`），开发服务器不提供它。所以本地调试要先 `npm run build`。
>
> 浏览器与 ffmpeg 的路径可以用环境变量 `CHROME_PATH` / `FFMPEG_PATH` 覆盖。

## 面板里的字段

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| 场景来源 | 本地场景库 | 可切到「粘贴场景文档」 |
| 帧数 | 180 | 视频总帧数；180 帧 @30fps = 6 秒 |
| 帧率 | 30 | 视频帧率 |
| 宽 / 高 | 1280 × 720 | **必须都是偶数**（H.264 的 yuv420p 要求），奇数会被 422 拒绝 |
| 动作脚本 | 空 | JSON 数组，描述视频里发生什么 |
| 任务名 | 空 | 只用于列表里辨认 |

## 动作脚本

动作脚本是一个 JSON 数组，每条动作形如 `{"atFrame": 30, "type": "setCamera", "params": {...}}`。
`atFrame` 是「第几帧执行」，动作类型**只有四种**：

| 类型 | 参数 | 作用 |
| --- | --- | --- |
| `addCube` | `position`、`size` | 加一个立方体 |
| `addSphere` | `position`、`radius` | 加一个球体 |
| `setCamera` | `position`、`lookAt` | 移动相机并看向某点 |
| `setSpeed` | `value` | 调整物理推进的快慢（倍率） |

示例：

```json
[
  { "atFrame": 0,  "type": "addCube",   "params": { "position": { "x": 0, "y": 3, "z": 0 }, "size": 1 } },
  { "atFrame": 15, "type": "addSphere", "params": { "position": { "x": 2, "y": 4, "z": 0 }, "radius": 0.5 } },
  { "atFrame": 30, "type": "setCamera", "params": { "position": { "x": 6, "y": 4, "z": 6 }, "lookAt": { "x": 0, "y": 1, "z": 0 } } },
  { "atFrame": 45, "type": "setSpeed",  "params": { "value": 0.5 } }
]
```

动作脚本写错 JSON 或用了不认识的类型，服务端会直接拒绝并说明原因。

## 结果

提交后服务端立刻返回 202，渲染在后台任务里继续跑。面板轮询任务状态，完成后在面板里**直接播放**这段视频，并提供下载链接。

产物落在 `backend/backend_data/renders/<jobId>.mp4`。

## 确定性

同一个场景、同一份动作脚本，跑两次产出的**帧数完全一致**——渲染页是「手动推进一物理步、渲染一帧」，不是自由跑动画，所以第 N 帧严格对应第 N 个物理步。

> 换句话说：**同一个场景重跑，画面是可复现的**，不会因为机器快慢而多一帧少一帧。

## 接口

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `POST` | `/api/render` | 提交一次渲染，返回 202 与 `jobId` |
| `GET` | `/api/render` | 最近 50 条任务 |
| `GET` | `/api/render/{jobId}` | 单个任务的状态、进度与产物地址 |
| `GET` | `/api/render/{jobId}/video.mp4` | 下载产物；未完成返回 409 `render_not_ready` |

完整的接口文档见 [`docs/api-contract.md`](../../docs/api-contract.md)（由后端代码生成，CI 校验一致）。

## 限制与边界

| 限制 | 表现 |
| --- | --- |
| 宽高必须是偶数 | 奇数返回 422 `validation_error` |
| 单次最多 3600 帧 | 超出返回 422 `validation_error` |
| 单次最长 600 秒 | 超时按失败处理 |
| 只支持立方体与球体 | 场景里没有这两类物体时返回 422 `render_scene_invalid` |
| 渲染页只在生产产物里 | 开发服务器（`npm run dev`）打不开渲染页 |
| 渲染占用一台机器 | 渲染期间会拉起一个无头浏览器进程 |
| 后端不在时功能不可用 | 面板给出说明，其余页面功能不受影响 |
