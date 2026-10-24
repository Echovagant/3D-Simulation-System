# AI接口API

本章描述系统的智能体数据模型、状态仓库与决策接口。需要特别强调的是：**当前的“AI”行为由规则式决策产生**——它读取真实场景感知（视野内障碍物的数量与最近距离），有障碍就朝“离障碍物更远”的那一侧转向，否则朝目标点移动；**这不是模型推理，系统也不做训练**。

唯一的随机性出现在**障碍物布局**上：布局由固定种子（`ARENA_SEED = 20260101`）的线性同余伪随机生成，因此同一密度下场地布局稳定可复现。系统没有导入训练模型的功能。

文中列出的每一个函数名、属性名都直接对应仓库源码，可以逐个检索核对。

## 数据类型

以下类型定义在 `src/types/index.ts`。

| 类型 | 字段 |
| --- | --- |
| `AiSimulationState` | `time`、`frame`、`agents`（`Record<string, AiAgentState>`）、`objects`（`Record<string, SimulatedObjectState>`） |
| `AiAgentState` | `id`、`position`（三元组）、`rotation`（三元组）、`velocity`（三元组）、`status`（`'normal'` / `'collided'` / `'goal_reached'` / `'failed'`）、`sensors`（`Record<string, SensorData>`） |
| `SensorData` | `type`（`'vision'` / `'proximity'` / `'audio'`）、`data`（`unknown`）、`timestamp` |
| `SimulatedObjectState` | `id`、`type`、`position`（三元组）、`rotation`（三元组）、`properties`（`Record<string, unknown>`） |
| `AiDecision` | `agentId`、`action`、`parameters`、`confidence`、`timestamp` |

`AiDecision.action` 的取值只有四种：`'move'`、`'rotate'`、`'interact'`、`'wait'`。其中 `'interact'` 在当前实现中**从未被生成过**。

`src/stores/aiStore.ts` 另有两个类型：`AiAgentType`（`'basic'` / `'advanced'` / `'custom'`）与 `AiEnvironmentSettings`（`scenario`、`difficulty`、`timeLimit`、`winCondition`、`obstaclesDensity`），它们通过 `src/types/index.ts` 末尾的再导出对外提供。`winCondition` 的类型是字面量类型 `AiWinCondition`（`'到达目标点'`）——自由文本无法判定，因此不开放。

## 状态仓库 useAiStore

`useAiStore` 是 Pinia 仓库，store ID 为 `ai`。

### 状态

| 成员 | 说明 |
| --- | --- |
| `agents` | 全部智能体数组，元素为 `AiAgent` |
| `environmentSettings` | 环境配置，默认值为场景类型 `navigation`、难度 `medium`、时间限制 0（不限制）、胜利条件“到达目标点”、障碍物密度 0.5 |
| `simulationActive` | 仿真是否处于运行状态 |
| `simulationTime` | 已运行的仿真秒数 |
| `selectedAgentId` | 当前选中的智能体 ID |
| `resetToken` | 重置令牌，每次 `resetSimulation` 自增；物理层靠它把智能体送回出生点 |
| `activeAgents` | 计算属性，`active` 为真的智能体 |
| `selectedAgent` | 计算属性，当前选中的智能体 |
| `scenarioOptions` | 计算属性，场景类型清单：`navigation`（导航挑战）、`interaction`（物体交互）、`combat`（对抗模拟）、`custom`（自定义场景）。每项带 `available` 字段，标出系统**真的实现了**这个场景吗 |
| `selectableScenarioOptions` | 计算属性，`scenarioOptions` 里 `available` 为真的那些项。目前只有 `navigation` |

### 环境设置字段

| 字段 | 取值 | 作用在哪里 |
| --- | --- | --- |
| `scenario` | `'navigation'` / `'interaction'` / `'combat'` / `'custom'` | 只有 `navigation` 被实现了，界面上也只列它 |
| `difficulty` | `'easy'` / `'medium'` / `'hard'` | 智能体速度与感知范围的系数：easy 0.7 / 0.8，medium 1 / 1，hard 1.3 / 1.2 |
| `timeLimit` | 秒数，0 表示不限制 | 超过后停止决策，智能体置为 `paused` 并记一条“时间到”的日志 |
| `winCondition` | `'到达目标点'` | 智能体抵达当前目标点时记一条“胜利条件达成”的日志，快照状态标为 `goal_reached` |
| `obstaclesDensity` | 0~1 | 按新密度重建场地里的障碍物 |

### 方法

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `createAgent` | `(name: string, type?: AiAgentType) => AiAgent` | 新建智能体，ID 形如 `agent-<时间戳>-<序号>`（序号单调递增，同一毫秒内创建也不会撞 ID），默认类型 `basic`，`active` 为真。`status` 继承当前运行态：仿真进行中建的就是 `running`，否则 `idle`。它是列表中第一个智能体时会被自动选中 |
| `removeAgent` | `(id: string) => void` | 删除智能体；若删掉的正是当前选中项，则自动改选列表第一项，列表为空时清空选中 |
| `startSimulation` | `() => void` | 置 `simulationActive` 为真，仿真时间归零，把所有智能体状态改为 `running` 并写入一条“仿真开始”日志 |
| `pauseSimulation` | `() => void` | 置 `simulationActive` 为假，把处于 `running` 的智能体改为 `paused` 并写入“仿真暂停”日志 |
| `resetSimulation` | `() => void` | 停止仿真、时间归零、所有智能体状态改为 `idle` 并写入“仿真重置”日志，同时递增 `resetToken`——物理层据此把刚体送回出生点、清零速度、复位目标点与期望速度 |
| `updateAgentParameters` | `(id: string, parameters: Record<string, number \| string \| boolean>) => void` | 合并式更新参数，并写入“参数已更新”日志 |
| `addAgentLog` | `(id: string, message: string, type?: 'info' \| 'warning' \| 'error') => void` | 追加一条日志。单个智能体的日志上限为 100 条，超出后丢弃最早一条。每条日志带一个单调递增的 `seq`——面板渲染时拿它当 key：日志列表按时间排序，时间戳会重复，按下标做的 key 会整片错位，Vue 就得把每一行都重建一遍 |
| `updateEnvironmentSettings` | `(settings: Partial<AiEnvironmentSettings>) => void` | 合并式更新环境配置 |
| `initializeDefaultAgents` | `() => void` | 仅当列表为空时创建一个名为“导航机器人”的 `basic` 智能体 |

### 各类型的默认参数

| 类型 | 默认参数 |
| --- | --- |
| `basic` | `speed` 为 5、`reactionTime` 为 0.5、`awarenessRange` 为 10、`avoidObstacles` 为真 |
| `advanced` | `speed` 为 7、`reactionTime` 为 0.2、`awarenessRange` 为 15、`avoidObstacles` 为真、`learningEnabled` 为真、`memoryRetention` 为 60、`teamwork` 为假 |
| `custom` | 无默认参数 |

## 组合式函数 useAI

`useAI` 位于 `src/composables/useAI.ts`，在组件挂载时自动初始化默认智能体并监听仿真开关，返回七个成员。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `decisionQueue` | `Ref<AiDecision[]>` | 决策队列。仿真运行时决策回路每 100 毫秒检查一次，**每个智能体按自己的 `reactionTime` 决定多久重新决策一次**（首次决策立即发生）；队列长度超过 100 时只保留最后 50 条 |
| `generateAgentDecision` | `(agentId: string) => AiDecision \| null` | 为指定智能体生成一条决策，同时向该智能体写一条“决定: …”日志 |
| `executeAgentDecision` | `(decision: AiDecision) => void` | **执行决策**：把 `move` / `rotate` 的结果写成该智能体的期望速度 |
| `getAgentCurrentState` | `(agentId: string) => AiAgentState` | 返回该智能体在**场景里的真实状态**快照 |
| `updateAgents` | `(deltaSeconds: number) => void` | 每帧推进智能体运动。由渲染循环调用；只有状态为 `running` 的智能体会移动 |
| `syncScene` | `() => void` | 把仓库里的智能体列表与场景对象对齐（新增建网格、删除拆网格），并按当前障碍物密度重建障碍物 |
| `cleanup` | `() => void` | 清除决策循环的定时器，并移除场景里的智能体与障碍物 |

### 智能体与场景对象的映射

`useAI` 在模块作用域维护一张 `agentId → THREE.Object3D` 的表（外加一张运行时状态表）。
**这份映射刻意不放进 `aiStore`**——仓库的状态结构是与页面和文档共用的契约，而“场景对象”只属于运行时。
智能体网格的名字是 `ai-agent-<agentId>`，障碍物网格的名字是 `ai-obstacle-<序号>`。

### 决策生成规则

决策是**规则式**的，由真实感知驱动，而不是随机数：

| 条件 | 动作与参数 |
| --- | --- |
| 最近障碍物距离小于 `min(awarenessRange, 3.5)` 且开启了避障 | `rotate`，角度为 ±π/3，方向取“离障碍物更远”的那一侧 |
| 其余情况 | `move`，方向指向当前目标点（黄金角分布在半径 13 的环上，到达后换一个），速度取 `parameters.speed`，缺省为 5 |

置信度 `confidence` 落在 0.5 到 1.0 之间，由“前方有多空”算出（前方越空越接近 1）。

### 环境设置如何作用在决策上

| 设置 | 作用点 |
| --- | --- |
| `difficulty` | 读取参数时给速度与感知范围乘一个系数（easy 0.7 / 0.8，medium 1 / 1，hard 1.3 / 1.2）。规则式决策、`getAgentCurrentState` 与 `buildSnapshot` 读到的都是缩放后的值；LLM 给出的速度同样乘速度系数（上限 `LLM_MAX_SPEED`） |
| `reactionTime` | 每个智能体按它决定多久重新决策一次：决策回路每 100 毫秒检查一次，未到间隔就沿用上一次的期望速度。首次决策立即发生 |
| `timeLimit` | 仿真时间超过它（且大于 0）就停止决策：智能体置为 `paused`、写入一条“时间到”的日志，仿真开关回到暂停 |
| `winCondition` | 智能体抵达当前目标点时写入一条“胜利条件达成”的日志，并把运行时状态标为 `goal_reached`（会反映在 `getAgentCurrentState` 的 `status` 里）。智能体随后继续前往下一个目标点 |
| `obstaclesDensity` | 变化时按新密度重建场地里的障碍物 |

### 状态快照的来源

`getAgentCurrentState` 读的是**真实场景对象**：位置、旋转来自智能体网格本身
（网格位置由 Rapier 刚体每步回写），速度来自刚体的 `linvel()`；
`sensors` 里的 `proximity` 来自**物理引擎的查询**——
视野内障碍物数量与最近距离都是**逐个碰撞体**算出来的：对每个障碍物调用
`collider.projectPoint(position, true)`，把智能体所在点投影到**那个碰撞体**的表面上量出间距；
间距 ≤ 感知范围就计入「视野内数量」，所有间距里最小的是「最近距离」。
真的撞上障碍物时（窄相位接触流形里接触点数 > 0），`status` 会是 `collided`；
智能体抵达过目标点（胜利条件达成）且当前没有碰撞时，`status` 是 `goal_reached`。

> 之所以不用 `world.intersectionsWithShape` / `world.projectPoint` 这类全局查询：
> 它们的过滤回调一旦把所有碰撞体都拒掉（空场地就是这种情形），Rapier 0.19.3 会在 WASM 内部
> 直接 panic 并污染整个实例。逐碰撞体查询没有这个风险。

### 执行入口

`executeAgentDecision` 把决策写成智能体的**期望速度**（不是直接改坐标）：
`move` 按方向与速度设定速度矢量，`rotate` 累加朝向并按新朝向给出速度，
`wait` 把速度清零，`interact` 写一条 warning 日志（交互尚未实现）。
真正的位移由渲染循环每帧调用 `updateAgents(deltaSeconds)` 完成：
它按固定步长（1/60 秒）把真实时间切成整步，每一步先把期望速度与实际速度的差
换算成冲量施加到刚体上，再让 Rapier 推进一步。

> 碰撞是**刚体物理**：撞上障碍物会被接触求解器挡下并沿障碍物滑开，
> 摩擦与弹性都是碰撞体上的真实参数。需要更复杂的物理交互请用场景编辑器
> （`useSceneEditor` + Rapier）。

## 界面层如何使用这些接口

- `src/components/three/ai/AiEnvironmentPanel.vue`：环境配置面板。场景类型、难度、障碍物密度、时间限制、胜利条件都绑定在一份本地副本上；改动会**立即**通过 `updateEnvironmentSettings` 写回仓库（障碍物密度按 150 毫秒防抖，因为它会重建场地），点“应用设置”则一次性提交全部字段。场景类型下拉只列 `selectableScenarioOptions`（当前只有“导航挑战”），胜利条件是固定选项“到达目标点”。
- `src/components/three/ai/AiController.vue`：智能体面板。“添加代理”会创建一个名为“AI代理 N”、类型为 `basic` 的智能体；选中智能体后可调移动速度、反应时间、感知范围、避障（`basic` 与 `advanced` 适用）。高级型的“启用学习”“记忆保留”已从界面移除——系统没有学习与记忆机制。
- `src/components/three/ai/AiDebugPanel.vue`：调试面板。提供“开始 / 暂停”“重置”“清空日志”三个按钮，并按时间顺序汇总所有智能体的日志，可按类型过滤。
- `src/components/three/ai/LlmPanel.vue`：LLM 面板。选服务商、填 Key、改模型与端点、切决策来源、触发解释；状态来自 `useLlmStore`。Key 的来源有两种：**自带**（key 只在本页内存里）与**托管**（key 加密存在服务端，请求走后端）。
- `src/views/AIPlayground.vue`：页面外壳。页脚的状态文案绑定 `aiStore.simulationActive` 与 `llmStore.degraded`（运行中 / 已暂停 / LLM 已降级）；右上角的按键指示器画的就是真正响应的键（W/S/A/D/Q/E 平移相机、R 复位），按下时高亮。

## LLM 接入（可选）

### 模块

| 模块 | 职责 |
| --- | --- |
| `src/config/llmProviders.ts` | 服务商清单：id、名称、**协议**、默认 base_url、默认模型、官方文档地址、**凭证类型**。每家的默认值都对着官方文档核过 |
| `src/config/llm.ts` | 与提供商无关的公共配置：超时、输出上限、调用频次与额度 |
| `src/services/llm/secret.ts` | API key 的**唯一**存放点：模块作用域，按服务商分槽，不进响应式、不落盘；另有 `redactSecrets` 负责把密钥样式的片段从错误信息里抹掉 |
| `src/services/llm/client.ts` | `callLlm(options)`：按协议分派请求。**永不抛异常**，失败也返回 `{ ok: false, error }`；另有 `fetchModels(options)` 拉一把 key 实际可用的模型 |
| `src/services/llm/prompts.ts` | 提示词构造（`buildDecisionMessages` / `buildExplainMessages`）与动作解析（`parseLlmAction`） |
| `src/stores/llmStore.ts` | 对外的状态与动作：服务商选择、模型与端点覆盖、`configured` / `mode` / `explanation` / `degraded` / `callCount`；另有 `hostingMode` 决定 Key 来自浏览器还是服务端 |
| `src/services/api/llm.ts` | 托管模式的六个端点（密钥库、提交、删除、完成、配额、审计）。复用 `src/services/api/client.ts` 的 `apiRequest`，**不再按协议拼请求**——归一化的形状发给后端，协议差别由后端处理 |

### 三种协议

客户端按 `provider.protocol` 分派，三族的差别都在请求与响应的形状上：

| 协议 | 端点 | 鉴权 | 请求体 | 响应 |
| --- | --- | --- | --- | --- |
| `openai` | `POST {base}/chat/completions` | `Authorization: Bearer` | `messages` / `max_completion_tokens`（+ 可选 `reasoning_effort`） | `choices[0].message.content` |
| `anthropic` | `POST {base}/messages` | `x-api-key` + `anthropic-version` | `system` 顶层字段 / `max_tokens` | `content[].text` |
| `gemini` | `POST {base}/interactions` | `x-goog-api-key` | `system_instruction` / `input` / `generation_config.thinking_level` | `output_text` |

`reasoning_effort` **只发给官方文档明确写了它的服务商**（清单里的 `reasoningEffort` 字段）——
往不认识的接口上乱发会被判成非法参数。

⚠️ 对**推理型模型**它还是**必需项**，不只是优化：输出上限同时管着推理与正文，
不传它时推理 token 会把正文挤空，返回的半截 JSON 必然过不了闸门。

### 接入线：端点 × 凭证

清单里**每个条目就是一条接入线**，不是一家厂商。接入线 = 端点 × 凭证类型：

| 维度 | 取值 | 区别 |
| --- | --- | --- |
| 端点 | `api.minimax.io` / `api.minimaxi.com` / `open.bigmodel.cn` / `dashscope.aliyuncs.com` / `coding.dashscope.aliyuncs.com` / `ark.cn-beijing.volces.com` / `api.deepseek.com` | 不同域名可能是不同账号体系，key 不通用 |
| 凭证 | `sk-api-` / `sk-cp-` / `sk-sp-` / 无固定前缀 | 按量计费与订阅消耗不同的计费资源 |

当前 **11 条接入线、5 个厂商**，其中 5 条是订阅制。

三个字段让界面能认出用户贴的是哪一种：

| 字段 | 作用 |
| --- | --- |
| `keyKind` | `'standard'`（按量计费）或 `'subscription'`（订阅） |
| `keyPrefix` | 凭证前缀，用于自动识别。**认不出就留空**（智谱、方舟两类 key 格式一样） |
| `keyFamily` | 厂商标识——同厂商的接入线共用它，识别只在同厂商内比对 |

⚠️ **每条线必须单独占一个条目**：key 是按 providerId 分槽存的，
一个槽位装不下两种互斥的凭证与端点组合。它们在故障转移时也**不互相顶替**。

⚠️ **识别必须按前缀长度从长到短**：百炼的按量 key 是 `sk-`、套餐 key 是 `sk-sp-`——
短的 `sk-` 正是长的 `sk-sp-` 的前缀，先匹配短的会把套餐 key 误判成按量 key。

⚠️ **贴了别家厂商的 key 是另一类错误**，提示语要分开；而且**不该在托管入口就拦**——
用户可能正打算换厂商。托管入口只拦**同厂商内**凭证类型不匹配的情况。

模型能调哪些跟凭证绑定，所以 `fetchModels` 用这把 key 调 `GET {base_url}/models`，
直接列出它实际能用的模型——这比让用户凭记忆手填模型名再撞 404 划算。

⚠️ **不是每家都开放这个接口**：百炼的 Coding Plan 就没有。清单里用 `models: false` 标出来，
界面不显示按钮、`loadModels()` 直接返回、`verify-llm-live` 跳过——不发一个必然失败的请求。

### `useLlmStore`

| 成员 | 说明 |
| --- | --- |
| `providerId` / `provider` | 当前选中的服务商 id 与它的定义 |
| `model` / `baseUrl` | 当前实际使用的模型与端点（默认值取自清单，可被覆盖） |
| `modelOverrides` / `baseUrlOverrides` | 按提供商分别记的覆盖值 |
| `configured` | 当前提供商是否已配置 API key（**store 里没有 key 字段**，只有这个布尔值） |
| `mode` | `'rule'`（默认，规则式）或 `'llm'` |
| `explanation` / `explaining` | 最近一次解释与"模型思考中"标记 |
| `degraded` | LLM 控制器是否已降级回规则式 |
| `callCount` | 本次会话已发出的调用次数（上限见 `llmConfig.maxCallsPerSession`） |
| `lastError` | 最近一次错误（已脱敏） |
| `availableModels` / `loadingModels` / `modelsError` / `modelsLoaded` | 这把 key 实际可用的模型、查询状态与失败原因 |
| `selectProvider(id)` | 换服务商：换 key 槽位，载入它自己的默认模型与端点 |
| `setModel(value)` / `setBaseUrl(value)` | 覆盖当前提供商的模型 / 端点 |
| `applyKey(value)` / `clearKey()` | 写入 / 清除 key（只在内存里，按提供商分槽） |
| `loadModels()` | 用当前 key 调 `GET {base_url}/models`，列出它实际能用的模型 |
| `applyModel(value)` | 从拉到的列表里选一个模型 |
| `detectKeyKind(value)` / `keyKindMismatch` | 认出用户贴的是哪种凭证；与当前条目期望的不一致时给出提示 |
| `keyFamilyMismatch` | 贴了别家厂商的 key 时给出提示（与「凭证类型不对」是两类错误） |
| `testConnection()` | 发一个极短请求做连通性测试 |
| `requestExplanation(snapshot)` | 请求一次解释，成功后写进 `explanation` |
| `requestAction(snapshot)` | 请求一个动作；返回 `null` 表示"这次没有可用动作"，调用方必须回落规则式 |
| `markDegraded(reason)` / `clearDegraded()` / `setError(msg)` / `resetSession()` | 状态维护 |

### `useAI` 里的 LLM 分支

- `buildSnapshot(agentId)`：把智能体此刻的**真实状态**整理成 `AgentSnapshot`（位置、速度、目标点方向、最近障碍物距离、视野内障碍物数量、感知范围、是否碰撞、上一次动作）。
- 决策回路在 `mode === 'llm' && configured` 时改走 LLM：
  有到货的决策就执行它；请求还在飞就沿用上一次的期望速度；上一次失败就这一拍回落规则式并点亮降级标记。
- 两条路最终都走同一个 `executeAgentDecision`，所以**物理层的行为完全一致**——LLM 换掉的只是"往哪走"。

### 动作校验

`parseLlmAction` 是 LLM 与物理之间**唯一**的闸门：

- 从回复里抠出第一个完整 JSON 对象（容忍 Markdown 代码块与前后闲话）；
- 动作只能是 `move` / `rotate` / `wait`；
- `move` 的方向必须是非零向量且会被归一化，速度夹在 0.5~8；
- `rotate` 的角度夹在 ±π；
- 任何一项不通过就返回 `null` → 回落规则式。

## 当前限制

- 智能体行为**默认**由规则式决策推导（读取真实场景感知 → 避障 → 朝目标点移动）；接入外部模型是**可选**的，需要使用者自己填 API Key，且没有训练模型导入入口、没有训练回路。
- 唯一的随机性是**障碍物布局**：它使用固定种子（`ARENA_SEED = 20260101`）的线性同余伪随机，因此同一密度下布局可复现，刷新页面不会换一副场地。
- `decisionQueue` 虽然在持续填充，但当前界面并没有展示这个队列；能看到的是写入智能体日志的“决定: …”条目。
- `AiDecision.action` 中的 `'interact'` 分支从未被生成。
- `AiSimulationState` 与 `SimulatedObjectState` 两个类型在 `src/types/index.ts` 中定义，但目前没有在运行时被实际使用。
- `AiAgentState.status` 的取值集合（`'normal'` / `'collided'` / `'goal_reached'` / `'failed'`）与仓库中智能体实际使用的状态（`'idle'` / `'running'` / `'paused'` / `'error'`）并不是同一套：快照里的 `status` 由**真实碰撞情况**推导（上一帧被挡住就是 `'collided'`），智能体抵达过目标点（胜利条件达成）时是 `'goal_reached'`，`'failed'` 从未被产生，仓库状态与快照状态之间也没有映射。
- 场景类型只实现了 `'navigation'`；`'interaction'` / `'combat'` / `'custom'` 需要的机制不存在，因此不出现在界面可选项里。
