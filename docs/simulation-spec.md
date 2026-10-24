# 仿真过程规格

这份文档规定「一次仿真到底发生了什么」。

它不是使用说明，也不是设计随笔。**每一条都是可核对的约束**：要么能在源码里指出实现它的那几行，要么能在测试里指出验证它的那条用例。文档里出现的每一个数值都由 [`scripts/check-simulation-spec.mjs`](../scripts/check-simulation-spec.mjs) 自动与源码对账——改了代码没改这份文档，构建会直接失败。

规格覆盖三条执行路径：

| 路径 | 谁在跑 | 用什么推进 |
| --- | --- | --- |
| 交互式 | 场景编辑器、仿真实验室、AI 演武场 | 浏览器里的 Rapier（WASM），固定步长累加器 |
| 批量 | 后端批量仿真接口 | 服务端的 Rapier（原生绑定），同一个固定步长 |
| 渲染 | 服务端渲染接口 | 生产产物里的渲染页 + 无头浏览器 + ffmpeg |

三者的**物理语义必须一致**，否则「同一个场景换个地方跑就不一样」，规格也就没有意义。

## 怎么读这份规格

文档分五层，从底往上：

1. [世界层](#1-世界层)：仿真世界里有什么——重力、地面、物体碰撞体。
2. [时间层](#2-时间层)：时间怎么推进——步长、累加、截断。
3. [状态层](#3-状态层)：怎么判断「跑完了」「落下了」「穿模了」。
4. [一致性层](#4-一致性层)：三条路径凭什么能对上，以及拿什么证明。
5. [意图层](#5-意图层)：AI 在这个过程里扮演什么角色——它**不**参与物理。

最后是[参数与常量表](#6-参数与常量表)（机器对账用）、[条款清单](#7-条款清单)、[已知边界](#8-已知边界)与[变更规则](#9-变更规则)。

---

## 1. 世界层

### 1.1 重力

默认重力 `(0, -9.81, 0)`，单位 m/s²。

三条路径取同一个值：前端 `simulationConfig.physics.defaultGravity`、后端 `simulator.DEFAULT_GRAVITY_Y`、渲染页 `RENDER_PHYSICS.gravity`。批量仿真可以按 `gravityY` 扫描，扫的正是这一项。

### 1.2 地面

地面是**固定刚体 + 一个长方体碰撞体**，顶面落在 `y = 0`——场景里所有东西都以 `y = 0` 为地平面。

碰撞体半长 `(5, 0.1, 5)`，刚体整体下移 `y = -0.1`。这个下移是必须的：若碰撞体建在原点，顶面在 `y = +0.1`，物体就会停在半空中悬着 10 厘米。

| 路径 | 地面碰撞体 | 刚体位置 | 地面摩擦 / 弹性 |
| --- | --- | --- | --- |
| 场景编辑器 | `cuboid(5, 0.1, 5)` | `(0, -0.1, 0)` | 未下发 → Rapier 默认 |
| 后端批量仿真 | `cuboid(5, 0.1, 5)` | `(0, -0.1, 0)` | 未下发 → Rapier 默认 |
| 服务端渲染 | `cuboid(5, 0.1, 5)` | `(0, -0.1, 0)` | 未下发 → Rapier 默认 |
| 仿真实验室 | `cuboid(10, 0.5, 10)` | `(0, -0.5, 0)` | `0.5` / `0.3` |
| AI 演武场 | `cuboid(30, 0.5, 30)` | `(0, -0.5, 0)` | `0.8` / `0.05` |

前三条路径的地面**完全一致**。后两条走的是另一套物理接入（见 [8. 已知边界](#8-已知边界)）：地面更大更厚，顶面同样在 `y = 0`，但横向边界与材料都不同——仿真实验室是 ±10 米，AI 演武场是 ±30 米（场地本身由四面墙圈在 ±24 米内，墙厚 0.5 米）。

### 1.3 物体碰撞体

场景里只有两类物体参与碰撞：**立方体**与**球体**。模型类物体在浏览器里参与碰撞（用包围盒近似），但后端没有模型文件，无法还原——批量仿真会跳过它并写明原因，不猜。

几何基准：

| 类型 | 视觉几何 | 碰撞体基准 | 缩放后的实际尺寸 |
| --- | --- | --- | --- |
| 立方体 | `BoxGeometry(1, 1, 1)` | `cuboid(0.5, 0.5, 0.5)` | 半长 = `0.5 × |scale|`（逐轴） |
| 球体 | `SphereGeometry(0.5)` | `ball(0.5)` | 半径 = `0.5 × 三轴 scale 均值` |

**缩放必须同时作用到碰撞体上**。只缩放网格不缩放碰撞体，视觉与碰撞会永久不一致——看上去三倍宽的箱子仍然按一倍的尺寸参与碰撞。碰撞体用 `setShape` 原地换形状，碰撞体对象本身不变，挂在网格上的引用不会失效。

Rapier 没有椭球碰撞体，所以球体的非等比缩放用三轴均值近似半径。等比缩放时与视觉完全一致。

缩放取绝对值（负缩放不翻转碰撞体），`0` 视为 `1`（不允许把物体压成零体积）。

### 1.4 初始姿态

位置取场景文档里的 `position`。旋转取欧拉角，按 Three.js 默认的 `XYZ` 序转成四元数（`R = Rx · Ry · Rz`）——前端与后端必须用同一套约定，否则旋转过的物体会躺在另一个朝向上。

后端批量仿真只支持「位置 + 旋转」，不读模型文件、不读纹理、不读材质。

### 1.5 材料：摩擦与弹性

**摩擦系数与恢复系数只在被显式覆盖时才下发。** 未覆盖时一律沿用 Rapier 的默认值，不擅自设一个「看起来合理」的值——否则浏览器与后端会各用一个不同的默认，永远对不上。

| 路径 | 物体默认摩擦 | 物体默认弹性 |
| --- | --- | --- |
| 场景编辑器 | `0.5`（Rapier 默认） | `0`（Rapier 默认） |
| 后端批量仿真 | `0.5`（Rapier 默认） | `0`（Rapier 默认） |
| 服务端渲染 | `0.5`（Rapier 默认） | `0`（Rapier 默认） |
| 仿真实验室 | `0.5` | `0.2` |
| AI 演武场 | 智能体 `0.35` / 障碍物 `0.6` / 围墙 `0.4` | 智能体 `0.15` / 障碍物 `0.25` / 围墙 `0.2` |

前三条路径一致，正是[一致性层](#4-一致性层)能成立的前提。

「仿真实验室」这一行的 `0.5` / `0.2` 是它的兜底值——`usePhysics` 建碰撞体时用的是 `friction || 0.5`、`restitution || 0.2`。这带来一个后果：**在这条路径上，摩擦与弹性无法设成 `0`**，因为 `0` 会被当成「没填」而落回兜底值。其余路径没有这个限制。

## 2. 时间层

### 2.1 固定步长

物理**只**用固定步长 `1/60` 秒推进，**与显示刷新率无关**。60Hz 屏每秒推进 60 步，30Hz 屏也是 60 步（只不过一帧多推几步）。

可变步长会把「这一帧过了多久」渗进积分结果：帧率一变，落点就变。固定步长是「同一个场景在任何机器上得到同一套轨迹」的前提。

每一步都显式把 `world.integrationParameters.dt` 设成固定步长，不依赖引擎的默认值，也不允许它随帧率漂移。

### 2.2 固定步长累加器

真实时间先进累加器，再按固定步长切成整数步：

```
accumulated += min(delta, maxFrameDelta) × speed
due = floor(accumulated / fixedTimeStep + 1e-9)
steps = due - stepsDone
```

三条规则，缺一不可：

- **单帧最多采纳 250 毫秒真实时间。** 后台标签页切回来时 delta 可能几十秒，不截断的话一次会补上几百步，物理瞬间炸开。
- **单帧最多推进 5 步。** 步数用尽仍有积压时，**丢弃剩余积压**。不丢的话积压会逐帧累积，形成「越追越慢、越慢越追」的死循环。宁可慢，不可炸。
- **取整带 `1e-9` 步的容差。** 「累计时间 ÷ 步长」在浮点上可能落在整数下方一点点（例如 `59.99999999999999`），少了容差会凭空丢掉一步，而且那一帧的时间再也补不回来。

步数用除法一次算出，而不是「反复减去一个步长」——反复相减会累积浮点误差。

### 2.3 仿真时钟

仿真时钟跟着**物理步**走，不跟屏幕刷新走：

```
currentTime += steps × fixedTimeStep
frameCount  += steps
```

所以 `currentTime` 是「模拟了多久」，不是「屏幕刷了多少帧」。它同样与刷新率无关。

### 2.4 速度倍率的两种语义

「加速播放」在两条路径上机制不同，但最终时间轴等价：

| 路径 | 机制 | 步长 | 每帧步数 |
| --- | --- | --- | --- |
| 交互式（场景编辑器 / 仿真实验室 / AI 演武场） | `speed` 是每秒执行多少个固定步的倍率 | 恒为 `1/60` | 随帧率变化 |
| 服务端渲染 | `speed` 作用在步长上 | `fixedTimeStep × speed` | 恒为 1 |

渲染页必须**一帧一步**（见 [4.3](#43-确定性渲染)），所以它不能靠「一帧多走几步」加速，只能改步长。

### 2.5 暂停与恢复

播放 / 暂停切换时清空累加器与时间基准。停很久之后恢复，第一帧算出来的 delta 会是「停机时长」，不清理的话一次会补上几百个物理步，物体瞬间弹飞。

## 3. 状态层

### 3.1 落地与静止

判定「落定了」要同时满足两个条件：

1. **速度**低于 `0.05` m/s；
2. **与地面有接触**——用 Rapier 的窄相位接触流形判定，不靠位置猜。

只看位置会误判：物体在半空中速度恰好很小，但它没碰地。

### 3.2 `resting` 与 `settledAtFrame`

两者含义不同，不能混用：

- **`resting`** 是**最终状态**：跑完之后，这个物体速度够低**且**仍然贴着地面。中间某一步静止过不算——弹起来的物体最后并没有落地。
- **`settledAtFrame`** 是**第一次**同时满足上面两个条件的帧号。某个物体可能在第 40 步短暂静止、又被撞飞，第 120 步才真正落定，那 `settledAtFrame` 就是 120。

### 3.3 穿透

穿透深度 = `半高 − 当前 y`。Rapier 允许一点点下沉（基准里静止高度是 `0.4987`，比半高 `0.5` 低 1.3 mm），那是求解器的正常误差，不是穿透。

因此**只有深度超过 `0.01` 米才算穿透**，且记录的是全程最大值。基准场景跑完 `penetrationDepth` 必须是 `0`。

### 3.4 采样

- `trace` 打开：每一步都记录位置。
- `trace` 关闭：每 10 步记录一次，并补上最后一步。

## 4. 一致性层

### 4.1 基准是什么

一致性靠一份**浏览器实跑录下的轨迹**当基准：`backend/tests/fixtures/browser_baseline.json`。

这份文件由生产产物（`dist/`）+ 无头浏览器实跑生成，逐物理步采样刚体位置。它不是手写的期望值，是**录下来的事实**。

基准场景：重力 `-9.81`、步长 `1/60`、跑 180 步；地面 `cuboid(5, 0.1, 5)` 于 `y = -0.1`；一个 `0.5` 见方的动态立方体从 `(0, 2, 0)` 落下。采样点在第 `0 / 29 / 60 / 89 / 119 / 148 / 180` 步，共 7 个。

### 4.2 容差

位置容差 `0.02` 米。这个数字不是随便定的：两端同引擎同参数应当几乎一致，末位差异来自 WASM 与原生编译的浮点末位。

但**自由落体段必须逐位一致**（容差 `1e-9`）。落地之前只有重力参与，没有接触求解——那段的每一个采样点都对不上，说明步长或重力错了，不可能是浮点末位。

比对不过**不许**放宽容差来「解决」问题。那说明真的漂了，要回去查参数：步长？重力？地面刚体平移？碰撞体尺寸？摩擦与弹性？

### 4.3 确定性渲染

服务端渲染把一个场景变成一段 MP4，两条硬约束贯穿整个录制流程：

1. **确定性**：物理推进只能由外部显式调用触发，页面自己**不跑** `requestAnimationFrame`。物体颜色、材质、创建顺序全部由输入决定，不掺任何随机数（场景编辑器用随机色是给交互用的；渲染页用固定调色板，否则同一个场景重跑会得到不同画面）。
2. **一帧一步**：`step()` = 推进一个物理步 + 画一帧。「抓到的第 N 帧」严格对应「物理的第 N 步」。

录制器逐帧调用 `step()` 并截图，顺序喂给 ffmpeg 编码成 MP4。三道帧数闸门任一不过就是失败：

- 抓到的帧数 == 请求的帧数；
- 页面自己报告的步数 == 抓到的帧数（否则帧与步错位，这段视频的「第 N 帧」不再对应「第 N 步」）；
- 产出不是空文件。

后端侧再核一次：录制器摘要里的 `capturedFrames` 必须等于任务请求的帧数。拿帧数对不上的视频当成功交出去等于骗人。

### 4.4 三条路径怎么对上

| 环节 | 交互式 | 批量仿真 | 服务端渲染 |
| --- | --- | --- | --- |
| 引擎 | Rapier WASM | Rapier 原生绑定 | Rapier WASM（生产产物内） |
| 步长 | `1/60` | `1/60` | `1/60` |
| 地面 | `cuboid(5,0.1,5)` @ `y=-0.1` | 同左 | 同左 |
| 摩擦 / 弹性 | 未覆盖则用 Rapier 默认 | 同左 | 同左 |
| 推进方式 | 累加器切步 | 固定循环步进 | 外部显式逐步调用 |
| 颜色 | 随机（交互用） | 不渲染 | 固定调色板 |
| 自检 | — | 逐轴对基准 | 帧数三闸门 |

## 5. 意图层

AI 在这个系统里是**意图层**，不是物理层。

**AI 改的是「想往哪走、走多快」，不是「物体在哪」。** 位移永远由物理引擎的接触求解器决定。AI 给的期望速度被换算成一次转向冲量施加到刚体上，剩下的交给 Rapier。这条边界一旦模糊，「仿真结果可复现」这件事就不成立了——因为模型的输出是概率性的。

### 5.1 唯一的闸门

模型说什么不算数。只有通过 `parseLlmAction` 校验的动作才会被执行：

| 动作 | 字段 | 校验规则 |
| --- | --- | --- |
| `move` | `direction: [dx, dz]` | 至少两个元素、都是有限数、不能是零向量；通过后归一化 |
| `move` | `speed` | 缺省取 `maxSpeed`；否则夹到 `[0.5, maxSpeed]` |
| `rotate` | `angle` | 必须是有限数；夹到 `[-π, π]` |
| `wait` | — | 无参数 |

校验不过就返回空，调用方回落到规则式控制器。**模型返回格式不匹配时，系统不会崩，只会退回规则式**——这是刻意的：LLM 不可靠是常态，不是异常。

模型输出外面裹的 Markdown 代码块、说明文字，会被先剥掉再抠 JSON。

### 5.2 一拍的语义

模型是异步且慢的（一次往返几秒），所以它**不阻塞仿真**。一拍里可能发生三种情况：

| 情况 | 这一拍的行为 |
| --- | --- |
| 有到货的决策 | 执行它 |
| 请求还在飞 | **什么都不做**，智能体沿用上一次的期望速度继续走 |
| 上一次失败 | 回落规则式，并把智能体标记为「已降级」 |

「请求在飞时这一拍什么都不做」是有意为之：宁可让智能体按旧意图惯性走，也不冻结仿真等模型。

### 5.3 频率与预算

| 约束 | 值 | 作用 |
| --- | --- | --- |
| 两次调用最小间隔 | 1500 ms | 控制器的思考频率 |
| 单会话调用上限 | 60 次 | 防止意外烧钱 |
| 失败后冷却 | 5000 ms | 这段时间内不再重试 |
| 单次超时 | 15000 ms | 慢响应不至于挂住 |
| 控制器输出上限 | 512 token | 动作 JSON 很小，但要给推理留位置 |
| 解释层输出上限 | 400 token | 两三句中文说明 |

最小间隔是**全局**的（所有智能体共享一个计时器）。60fps 下 1500 毫秒相当于 90 帧——一整秒多的画面里，可能只有 1 帧带着新的决策。这正是意图层的定位：**低频决策 + 高频惯性**。

被限流挡下的请求不计入调用次数（它们根本没出网）。

⚠️ **输出上限同时管着推理与正文。** 推理型模型先花一部分 token 写思考，剩下的才是正文。上限给小了，正文会被挤空——返回的 JSON 变成半截，闸门必然拒收，于是回落规则式，而界面看起来完全正常。

实测（M3.1-Flash，带 `reasoning_effort: 'low'`）：推理稳定在 **0~187 token**，正文需要几十 token。上限给 256 时推理偶尔撞满把正文挤空，给到 **512** 后 12 次连跑零空正文。

⚠️ **`reasoning_effort` 不是可选优化，是必需项。** 不传它时推理涨到 242/256 token 把正文截断（`finish_reason=length`），正文变成 `{"action":"move","direction":[-1,0],`——语法不完整，闸门必然拒收。

### 5.4 空正文的两种原因必须分开

正文为空时，厂商的 `finish_reason` 区分了两种完全不同的情况：

| `finish_reason` | 含义 | 能不能修 |
| --- | --- | --- |
| `length` | 输出预算被用光，正文被截断 | **能**——调大输出上限 |
| 其它 | 模型确实什么都没给 | 不能——调大也没用 |

两者都报「无法解析」的话，用户既不知道怎么修，也无从判断该不该重试。所以客户端把 `finish_reason` 取出来，正文为空时按它给出不同的提示；后端托管通道要把这个字段**透传**给前端，否则前端拿不到这个区分。

### 5.5 接入线：端点 × 凭证

一家厂商可能有**多条互不兼容的接入线**。MiniMax 有两个维度：

- **端点**：`api.minimax.io` 与 `api.minimaxi.com` 是两套账号体系；
- **凭证**：`sk-api-`（按量计费）与 `sk-cp-`（订阅）消耗的是不同的计费资源。

交叉起来就是**四种组合，彼此不通用**。实测：同一把 `sk-cp-` key 在 `api.minimaxi.com` 上列出 9 个模型，在 `api.minimax.io` 上直接 401。

⚠️ **每条接入线要单独占一个条目**，因为 key 是按 providerId 分槽存放的——一个槽位装不下两种互斥的凭证与端点组合。而且它们**不互相顶替**：故障转移时配了哪条线的 key 就用哪条线，换一家只会得到「这一家没配 key」。

模型能调哪些也跟凭证绑定（订阅 Key 与按量计费 Key 的可用模型不是一套），所以界面必须能**列出这把 key 实际能用的模型**，而不是让用户凭记忆手填模型名再撞 404。

### 5.6 可观测

面板必须能回答「LLM 到底有没有在起作用」：

- 已调用次数 / 会话上限；
- 最近一次错误（已脱敏）；
- **是否处于降级状态**——降级时明确显示「当前由规则式接管」；
- **生效拍数 / 总拍数**，以及在飞、被拒收、规则式接管各多少拍。

降级状态是关键的一条：模型返回格式对不上时，**整个 AI 演武场看起来完全正常**，唯一能暴露问题的就是这个标记。

拍数统计是它的另一半：降级标记告诉你「现在正在降级」，拍数告诉你「**它到底降了多久**」。只有后者才能区分「偶尔降级」与「一直在降级但没人发现」。

### 5.7 实测基线

真厂商连通性验证（`scripts/verify-llm-live.mjs`）跑出来的一组基线数字：

| 指标 | 值 |
| --- | --- |
| 闸门通过 | 12/12 |
| 正文为空 | 0/12 |
| 闸门拒收 | 0/12 |
| 推理 token | min 0 / max 187 / avg 73 |
| 端到端延迟 | avg 1702 ms |
| 可用模型 | 9 个 |

⚠️ **单次跑通不等于跑对。** 推理长度有波动，同样的提示词同一把 key，第一次可能被挤空、第二次正常。所以判据是**频率**（正文为空率 = 0），不是「跑通了一次」。

## 6. 参数与常量表

这张表由 `scripts/check-simulation-spec.mjs` 自动与源码对账。改了源码里的数值却没改这里，构建会失败。

| 常量 | 值 | 单位 | 来源 |
| --- | --- | --- | --- |
| `SIM_FIXED_TIME_STEP` | `1/60` | 秒 | `src/config/simulation.ts` |
| `SIM_MAX_SUB_STEPS` | `5` | 步 | `src/config/simulation.ts` |
| `SIM_MAX_FRAME_DELTA` | `0.25` | 秒 | `src/config/simulation.ts` |
| `SIM_DEFAULT_GRAVITY_Y` | `-9.81` | m/s² | `src/config/simulation.ts` |
| `SIM_USEPHYSICS_DEFAULT_FRICTION` | `0.5` | — | `src/config/simulation.ts` |
| `SIM_USEPHYSICS_DEFAULT_RESTITUTION` | `0.2` | — | `src/config/simulation.ts` |
| `SIM_STEP_EPSILON` | `1e-9` | 步 | `src/utils/fixedStepAccumulator.ts` |
| `AI_MIN_INTERVAL_MS` | `1500` | 毫秒 | `src/config/llm.ts` |
| `AI_MAX_CALLS_PER_SESSION` | `60` | 次 | `src/config/llm.ts` |
| `AI_COOLDOWN_MS` | `5000` | 毫秒 | `src/config/llm.ts` |
| `AI_TIMEOUT_MS` | `15000` | 毫秒 | `src/config/llm.ts` |
| `AI_CONTROLLER_MAX_TOKENS` | `512` | token | `src/config/llm.ts` |
| `AI_EXPLAIN_MAX_TOKENS` | `400` | token | `src/config/llm.ts` |
| `AI_MINIMAX_ACCESS_LINES` | `minimax, api.minimax.io, standard, minimax-subscription, api.minimax.io, subscription, minimax-cn, api.minimaxi.com, standard, minimax-cn-subscription, api.minimaxi.com, subscription` | — | `src/config/llmProviders.ts` |
| `AI_MINIMAX_ACCESS_LINE_COUNT` | `4` | 条 | `src/config/llmProviders.ts` |
| `AI_MAX_SPEED` | `8` | m/s | `src/composables/useAI.ts` |
| `AI_AVOID_DISTANCE` | `3.5` | 米 | `src/composables/useAI.ts` |
| `AI_DECISION_INTERVAL_MS` | `100` | 毫秒 | `src/composables/useAI.ts` |
| `AI_ACTION_NAMES` | `move, rotate, wait` | — | `src/services/llm/prompts.ts` |
| `BASE_GRAVITY_Y` | `-9.81` | m/s² | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_DT` | `0.016666666666666666` | 秒 | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_STEPS` | `180` | 步 | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_TOLERANCE` | `0.02` | 米 | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_SAMPLE_COUNT` | `7` | 个 | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_SETTLED_STEP` | `60` | 步 | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_CUBE_HALF` | `0.5` | 米 | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_FRICTION` | `0.5` | — | `backend/tests/fixtures/browser_baseline.json` |
| `BASE_RESTITUTION` | `0.0` | — | `backend/tests/fixtures/browser_baseline.json` |
| `SIM_BACKEND_DT` | `1/60` | 秒 | `backend/app/services/simulator.py` |
| `SIM_BACKEND_GRAVITY_Y` | `-9.81` | m/s² | `backend/app/services/simulator.py` |
| `SIM_GROUND_HALF_X` | `5` | 米 | `backend/app/services/simulator.py` |
| `SIM_GROUND_HALF_Y` | `0.1` | 米 | `backend/app/services/simulator.py` |
| `SIM_GROUND_HALF_Z` | `5` | 米 | `backend/app/services/simulator.py` |
| `SIM_GROUND_OFFSET_Y` | `-0.1` | 米 | `backend/app/services/simulator.py` |
| `SIM_DEFAULT_SIZE` | `1.0` | 米 | `backend/app/services/simulator.py` |
| `SIM_DEFAULT_STEPS` | `240` | 步 | `backend/app/services/simulator.py` |
| `SIM_RESTING_SPEED` | `0.05` | m/s | `backend/app/services/simulator.py` |
| `SIM_PENETRATION_TOLERANCE` | `0.01` | 米 | `backend/app/services/simulator.py` |
| `SIM_SAMPLE_INTERVAL` | `10` | 步 | `backend/app/services/simulator.py` |
| `SIM_SWEEP_PARAMS` | `gravityY, friction, restitution, initialVelocityY` | — | `backend/app/services/simulator.py` |
| `SIM_SUPPORTED_TYPES` | `cube, sphere` | — | `backend/app/services/simulator.py` |
| `SIM_MAX_RUNS_PER_JOB` | `32` | 次 | `backend/app/config.py` |
| `SIM_MAX_STEPS` | `10000` | 步 | `backend/app/config.py` |
| `SIM_MAX_RUNS_PER_DAY` | `2000` | 次 | `backend/app/config.py` |
| `RENDER_MAX_FRAMES` | `3600` | 帧 | `backend/app/config.py` |
| `RENDER_TIMEOUT_SECONDS` | `600` | 秒 | `backend/app/config.py` |
| `RENDER_FIXED_TIME_STEP` | `1/60` | 秒 | `src/render/renderPage.ts` |
| `RENDER_MIN_SPEED` | `0.1` | 倍 | `src/render/renderPage.ts` |
| `RENDER_MAX_SPEED` | `5` | 倍 | `src/render/renderPage.ts` |
| `RENDER_GROUND_HALF_X` | `5` | 米 | `src/render/renderPage.ts` |
| `RENDER_GROUND_HALF_Y` | `0.1` | 米 | `src/render/renderPage.ts` |
| `RENDER_GROUND_HALF_Z` | `5` | 米 | `src/render/renderPage.ts` |
| `RENDER_GROUND_BODY_Y` | `-0.1` | 米 | `src/render/renderPage.ts` |
| `RENDER_ACTION_TYPES` | `addCube, addSphere, setCamera, setSpeed` | — | `src/render/renderPage.ts` |

## 7. 条款清单

每条给出约束、它的验证方式。**验证方式一栏指出的文件必须真实存在**。

### S1 固定步长

物理推进的步长恒为 `1/60` 秒，不随显示刷新率变化。

- 验证：`src/utils/fixedStepAccumulator.test.ts`（累加器切步与截断）、`src/composables/useSceneEditor.physicsAuthority.test.ts`（30 帧 × 1/30 秒 = 60 个物理步）

### S2 单帧截断

单帧最多采纳 250 毫秒真实时间、最多推进 5 步，超出的积压丢弃而不是追帧。

- 验证：`src/composables/useSceneEditor.physicsAuthority.test.ts`（单帧积压超过上限时截断）

### S3 刚体是位置的唯一权威

网格只是刚体的镜像。每一步推进后，网格的位置与旋转被刚体状态**绝对覆盖**。用户改属性面板改的是「用户设定的变换值」，物理位移不回写它。

- 验证：`src/composables/useSceneEditor.physicsAuthority.test.ts`、`src/stores/sceneEditorStore.physicsAuthority.test.ts`

### S4 缩放作用到碰撞体

缩放必须同时改变碰撞体形状，视觉与碰撞不允许脱节。

- 验证：`src/composables/usePhysics.volume.test.ts`

### S5 摩擦与弹性只在被覆盖时下发

未覆盖时沿用 Rapier 默认值，不擅自设值。

- 验证：`backend/tests/test_consistency.py`（基准里的摩擦与弹性与碰撞体实际值相等）

### S6 落地判定用接触而非位置

「落定」= 速度 < `0.05` m/s **且** 与地面有接触（窄相位接触流形）。

- 验证：`backend/tests/test_simulator.py`

### S7 `resting` 说的是最终状态

中途静止过不算，最终仍贴着地面才算。

- 验证：`backend/tests/test_simulator.py`

### S8 穿透容差

深度超过 `0.01` 米才算穿透，记全程最大值。

- 验证：`backend/tests/test_consistency.py`（基准场景 `penetrationDepth` 为 `0`）、`backend/tests/test_simulator.py`

### S9 后端与浏览器基准一致

逐轴偏差不超过 `0.02` 米；自由落体段逐位一致。

- 验证：`backend/tests/test_consistency.py`

### S10 基准参数确实被用上

基准文件里记的参数必须真的被实现用上，防止基准与实现各说各话。

- 验证：`backend/tests/test_consistency.py`

### S11 批量仿真只扫一个维度

只扫 `gravityY` / `friction` / `restitution` / `initialVelocityY` 之一。多维笛卡尔积会让「到底是哪个参数导致的」变得难查。

- 验证：`backend/tests/test_simulator.py`、`backend/tests/test_simulations.py`

### S12 限额生效

单任务最多 32 次、单次最多 10000 步、每天最多 2000 次。超限直接拒绝并说清上限是多少。

- 验证：`backend/tests/test_simulations.py`

### S13 渲染一帧一步

渲染页的物理推进只能由外部显式调用触发，页面自己不跑 `requestAnimationFrame`。

- 验证：`src/render/renderPage.test.ts`

### S14 渲染帧数三闸门

抓到的帧数、页面报告的步数、请求的帧数三者必须一致，否则判失败。

- 验证：`src/render/renderPage.test.ts`、`backend/tests/test_render.py`

### S15 渲染确定性

不掺随机数：固定调色板、输入决定颜色与创建顺序。同一场景重跑两次的帧数必须完全一致。

- 验证：`src/render/renderPage.test.ts`

### S16 AI 动作必须过闸门

只有 `move` / `rotate` / `wait` 三种动作，参数逐项校验；校验不过回落规则式。

- 验证：`src/services/llm/` 下的单元测试、`src/composables/useAI.test.ts`

### S17 AI 不阻塞仿真

请求在飞时这一拍什么都不做，智能体沿用上一次期望速度；失败时回落规则式并标记降级。

- 验证：`src/composables/useAI.test.ts`、`src/stores/aiStore.test.ts`

### S18 LLM 调用有频率与预算约束

1500 毫秒最小间隔、60 次会话上限、5000 毫秒失败冷却、15000 毫秒超时；被限流挡下的不计数。

- 验证：`src/stores/llmStore.test.ts`

### S19 降级状态可见

模型返回格式对不上时系统不崩，但降级状态必须在面板上显式呈现。

- 验证：`src/stores/llmStore.test.ts`

### S20 生效拍数可读

面板要能回答「LLM 到底降了多久」：生效拍数 / 总拍数，以及在飞、被拒收、规则式接管各多少拍。分母为零时显示占位符，不许出现 `NaN`。

- 验证：`src/composables/useAI.test.ts`、`src/stores/aiStore.test.ts`、`src/components/three/ai/LlmPanel.test.ts`

### S21 接入线互不通用

同一家厂商的不同端点、不同凭证类型各自占一个 provider 条目；key 按 providerId 分槽，故障转移时它们不互相顶替。

- 验证：`backend/tests/test_llm_hosting.py`

### S22 凭证类型要能认出来

用户贴的 key 与当前条目期望的不一致时，界面要提示「这两种凭证不通用」，而不是让它在调用时才报一个指不到真正原因上的错。

- 验证：`src/stores/llmStore.test.ts`

### S23 模型列表按 key 拉

用户填完 key 能拉到这把 key 实际可用的模型；拉不到就如实报错。模型名可以手填，但拉一次才知道这个凭证的真正能力边界。

- 验证：`src/stores/llmStore.test.ts`、`scripts/verify-llm-live.mjs`

## 8. 已知边界

这些是**当前确实如此**，不是待办：

- **后端不支持模型类物体。** 批量仿真遇到模型会跳过并写明原因，不拿包围盒猜。
- **交互式与批量仿真的地面横向边界不同。** 场景编辑器与服务端渲染用 ±5 米，仿真实验室 ±10 米，AI 演武场 ±30 米。顶面同在 `y = 0`，但物体滑到边缘时的行为不同。
- **仿真实验室与 AI 演武场的物体默认弹性不是 Rapier 默认值**（分别为 `0.2` 与按角色区分的 `0.15` / `0.25` / `0.2`），其余路径是 `0`。这几条路径在弹性行为上不等价。
- **仿真实验室无法把摩擦或弹性设成 `0`**——那里的兜底写法会把 `0` 当成「没填」。
- **批量仿真只支持位置与旋转**，不还原模型、不还原材质。
- **一致性基准只覆盖立方体自由落体**这一条轨迹。它证明的是「参数没漂」，不是「所有场景都一致」。
- **AI 侧的全部逻辑由替身模型测试**；真实厂商的返回格式只有 `verify:llm-live` 脚本覆盖，它**不在构建链里**，要手动跑。
- **厂商会退役模型。** MiniMax 的 M2.5 / M2.7 已在退役流程中（官方公告 2026-11-18 退役）。清单里的默认模型是当前有效的，但**厂商改版时清单会过期**——面板上的「拉取可用模型」能看出这把 key 实际还能调什么。
- **接入线会变。** 厂商新增端点或新凭证类型时，清单里的条目数会变；[参数表](#6-参数与常量表)里的 `AI_MINIMAX_ACCESS_LINE_COUNT` 会与它对不上，构建失败——这是故意的。

## 9. 变更规则

改动仿真相关的代码时：

1. **改了数值** → 同步改[参数与常量表](#6-参数与常量表)，否则构建失败。
2. **改了语义** → 同步改对应的条款，并指出验证方式。
3. **新增一条约束** → 在条款清单里加一条，验证方式一栏必须指向真实存在的文件。
4. **发现了新的边界** → 写进[已知边界](#8-已知边界)，并说明它影响哪条路径。

规格与代码不一致时，**以代码为准**，然后立刻改规格——规格不是权威，代码才是。规格的价值在于让不一致立刻暴露，而不是让文档说了算。
