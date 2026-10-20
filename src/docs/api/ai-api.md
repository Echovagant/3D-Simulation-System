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

`src/stores/aiStore.ts` 另有两个类型：`AiAgentType`（`'basic'` / `'advanced'` / `'custom'`）与 `AiEnvironmentSettings`（`scenario`、`difficulty`、`timeLimit`、`winCondition`、`obstaclesDensity`），它们通过 `src/types/index.ts` 末尾的再导出对外提供。

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
| `activeAgents` | 计算属性，`active` 为真的智能体 |
| `selectedAgent` | 计算属性，当前选中的智能体 |
| `scenarioOptions` | 计算属性，场景类型选项：`navigation`（导航挑战）、`interaction`（物体交互）、`combat`（对抗模拟）、`custom`（自定义场景） |

### 方法

| 方法 | 签名 | 说明 |
| --- | --- | --- |
| `createAgent` | `(name: string, type?: AiAgentType) => AiAgent` | 新建智能体，ID 形如 `agent-<时间戳>`，默认类型 `basic`，`active` 为真、`status` 为 `idle`。它是列表中第一个智能体时会被自动选中 |
| `removeAgent` | `(id: string) => void` | 删除智能体；若删掉的正是当前选中项，则自动改选列表第一项，列表为空时清空选中 |
| `startSimulation` | `() => void` | 置 `simulationActive` 为真，仿真时间归零，把所有智能体状态改为 `running` 并写入一条“仿真开始”日志 |
| `pauseSimulation` | `() => void` | 置 `simulationActive` 为假，把处于 `running` 的智能体改为 `paused` 并写入“仿真暂停”日志 |
| `resetSimulation` | `() => void` | 停止仿真、时间归零、所有智能体状态改为 `idle` 并写入“仿真重置”日志 |
| `updateAgentParameters` | `(id: string, parameters: Record<string, number \| string \| boolean>) => void` | 合并式更新参数，并写入“参数已更新”日志 |
| `addAgentLog` | `(id: string, message: string, type?: 'info' \| 'warning' \| 'error') => void` | 追加一条日志。单个智能体的日志上限为 100 条，超出后丢弃最早一条 |
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
| `decisionQueue` | `Ref<AiDecision[]>` | 决策队列。仿真运行时每 100 毫秒为每个运行中的智能体生成一条决策并入队；队列长度超过 100 时只保留最后 50 条 |
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

### 状态快照的来源

`getAgentCurrentState` 读的是**真实场景对象**：位置、旋转来自智能体网格本身，
速度来自上一帧的实际位移；`sensors` 里的 `proximity` 是对场景里每个障碍物的
`THREE.Box3` 做 `distanceToPoint` 算出来的——视野内的障碍物数量与最近距离都是真数出来的。
上一帧被障碍物挡住时，`status` 会是 `collided`。

### 执行入口

`executeAgentDecision` 把决策写成智能体的**期望速度**（不是直接改坐标）：
`move` 按方向与速度设定速度矢量，`rotate` 累加朝向并按新朝向给出速度，
`wait` 把速度清零，`interact` 写一条 warning 日志（交互尚未实现）。
真正的位移由渲染循环每帧调用 `updateAgents(deltaSeconds)` 完成，
途中会做**解析式碰撞**：位移按智能体半径拆成子步逐段判定，撞上障碍物就沿单轴滑动。

> 这不是刚体物理：演武场没有接 Rapier，没有摩擦、反弹与质量。
> 需要真物理的场景请用场景编辑器的 `useSceneEditor`。

## 界面层如何使用这些接口

- `src/components/three/ai/AiEnvironmentPanel.vue`：环境配置面板。场景类型、难度、障碍物密度、时间限制、胜利条件都绑定在一份本地副本上，只有点击“应用设置”才会通过 `updateEnvironmentSettings` 写回仓库；其余输入框的即时更新回调目前是空函数。
- `src/components/three/ai/AiController.vue`：智能体面板。“添加代理”会创建一个名为“AI代理 N”、类型为 `basic` 的智能体；选中智能体后可调移动速度、反应时间、感知范围、避障（`basic` 适用）以及启用学习、记忆保留（`advanced` 适用）。
- `src/components/three/ai/AiDebugPanel.vue`：调试面板。提供“开始 / 暂停”“重置”“清空日志”三个按钮，并按时间顺序汇总所有智能体的日志，可按类型过滤。

## 当前限制

- 智能体行为由**规则式决策**推导（读取真实场景感知 → 避障 → 朝目标点移动），**没有接入任何外部模型，也没有任何训练模型导入入口**。
- 唯一的随机性是**障碍物布局**：它使用固定种子（`ARENA_SEED = 20260101`）的线性同余伪随机，因此同一密度下布局可复现，刷新页面不会换一副场地。
- `decisionQueue` 虽然在持续填充，但当前界面并没有展示这个队列；能看到的是写入智能体日志的“决定: …”条目。
- `AiDecision.action` 中的 `'interact'` 分支从未被生成。
- `AiSimulationState` 与 `SimulatedObjectState` 两个类型在 `src/types/index.ts` 中定义，但目前没有在运行时被实际使用。
- `AiAgentState.status` 的取值集合（`'normal'` / `'collided'` / `'goal_reached'` / `'failed'`）与仓库中智能体实际使用的状态（`'idle'` / `'running'` / `'paused'` / `'error'`）并不是同一套：快照里的 `status` 由**真实碰撞情况**推导（上一帧被挡住就是 `'collided'`，否则 `'normal'`），`'goal_reached'` 与 `'failed'` 从未被产生，仓库状态与快照状态之间也没有映射。
