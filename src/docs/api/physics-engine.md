# 物理引擎API

系统的物理计算由 Rapier 承担。本章描述两处物理接入点、它们各自导出的方法，以及真实的步进语义。

文中列出的每一个函数名、属性名都直接对应仓库源码，可以逐个检索核对。

## 引擎版本与依赖

`package.json` 中同时存在两个 Rapier 包，版本均为 `^0.19.0`：

- `@dimforge/rapier3d`：被 `src/composables/useSceneEditor.ts` 使用，场景编辑器走这一条路径。
- `@dimforge/rapier3d-compat`：被 `src/composables/usePhysics.ts` 使用，仿真实验室与 AI 演武场走这一条路径。

两者目前并未收敛成同一个包，导入路径不同意味着代码里存在两套 Rapier 初始化流程。

## 组合式函数 usePhysics

`usePhysics` 位于 `src/composables/usePhysics.ts`，返回一个物理实例对象。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `world` | `Ref<RAPIER.World \| null>` | 物理世界实例，未初始化时为 `null` |
| `ready` | `() => Promise<void>` | 等待 Rapier 的 WASM 运行时初始化完成。初始化是全局一次性的，重复调用复用同一个 Promise |
| `initPhysics` | `(scene?: Object3D) => Promise<void>` | 创建物理世界；传入场景时会创建地面并为场景中带物理数据的物体建立刚体 |
| `updatePhysics` | `(deltaTime: number) => void` | 按给定步长推进一帧，并把刚体状态写回对应的 Three.js 对象 |
| `stepPhysics` | `(deltaTime: number) => void` | `updatePhysics` 的别名，调用方习惯用这个名字 |
| `addRigidBody` | `(object: Object3D) => void` | 依据 `object.userData.physics` 的描述为单个物体建立刚体与碰撞体 |
| `removeRigidBody` | `(object: Object3D) => void` | 从物理世界移除刚体，并清空 `userData.physics` 上的 `body` 与 `collider` 引用 |
| `resetPhysics` | `() => void` | 清空全部刚体、重建物理世界，并重新创建地面与物体刚体 |
| `updatePhysicsParameters` | `(params: { gravity?: Vector3; friction?: number; restitution?: number }) => void` | 运行时调整重力、摩擦系数与恢复系数 |

### 地面

调用 `initPhysics(scene)` 时会创建一个名为 `Ground` 的长方体网格：尺寸 20×1×20，位置 `(0, -0.5, 0)`。它携带的物理数据是 `type` 为 `static`、`shape` 为 `box`、半长 `(10, 0.5, 10)`、`friction` 为 0.5、`restitution` 为 0.3，因此会被建成固定刚体。

### 刚体与碰撞体的建立规则

`addRigidBody` 只处理带有 `userData.physics` 的物体，并按其中的 `shape` 字段选择碰撞体：

| `shape` | 碰撞体 | 尺寸来源 |
| --- | --- | --- |
| `box` | `ColliderDesc.cuboid` | `halfExtents`，缺省时用物体缩放的一半 |
| `sphere` | `ColliderDesc.ball` | `radius`，缺省时用 `scale.x` 的一半 |
| `cylinder` | `ColliderDesc.cylinder` | `radius` 与 `height`，缺省时用 `scale.x` 的一半与 `scale.y` |
| 其它 | `ColliderDesc.cuboid(0.5, 0.5, 0.5)` | 固定的最小方块 |

摩擦系数取 `physics.friction`，缺省为 0.5；恢复系数取 `physics.restitution`，缺省为 0.2。当 `type` 为 `static` 或 `mass` 为 0 时建立固定刚体，否则建立动态刚体，并按 `mass` 与体积之比设置碰撞体密度。

### 运行时改参数

`updatePhysicsParameters` 分两条路径处理：

- 传入 `gravity` 时直接替换物理世界的重力向量。
- 传入 `friction` 或 `restitution` 时遍历场景，对所有已带碰撞体的物体调用 `collider.setFriction` 或 `collider.setRestitution`，并同步写回 `userData.physics` 上的同名字段。它不会重建物理世界。

## 场景编辑器中的刚体管理

`src/composables/useSceneEditor.ts` 不使用 `usePhysics`，而是自行维护一套 Rapier 接入：

- 内部有一个 `rigidBodies` 映射，键为 Three.js 对象的 `uuid`，值为 Rapier 刚体。
- `addCube`、`addSphere`、`importModel` 在创建网格后立即建立动态刚体，并把网格写进刚体的 `userData.object` 形成反向引用。
- 删除物体时，仓库派发 `remove-rigidbody` 自定义事件；`useSceneEditor` 监听该事件，调用 `physicsWorld.removeRigidBody` 并把映射表中的条目删除。
- `syncPhysicsToObjects()` 每次推进后遍历仓库的 `objects`，用 `rigidBody.translation()` 与 `rigidBody.rotation()` 更新 `threeObject` 的位置与四元数。

刚体碰撞体的近似方式在导入模型时比较粗略：取模型的包围盒尺寸的一半作为 `cuboid` 的半长。

> 当前没有提供按 `uuid` 直接移除刚体的公开方法；删除只能通过删除场景对象间接触发。

## 步进语义

两个页面现在共用同一套固定步长规则：

| 场景 | 步长计算 | 出处 |
| --- | --- | --- |
| 场景编辑器 | 固定步长累加器按 `fixedTimeStep`（1/60 秒）切步，每步 `physicsWorld.integrationParameters.dt = fixedTimeStep` | `useSceneEditor` 的 `updatePhysics` |
| 仿真实验室 | 同一个固定步长累加器，每步 `stepPhysics(fixedTimeStep)` | `src/views/SimulationLab.vue` |

累加器把「这一帧过去的真实时间」切成若干个固定步，因此**仿真速度与显示刷新率无关**：60Hz 屏每秒推进 60 个物理步，30Hz 屏同样是 60 个。`speed` 的语义是“每秒执行多少个固定步”，调大速度不会放大步长。单帧最多推进 `maxSubSteps`（5）步，剩余积压会被丢弃。

## 配置常量

`src/config/simulation.ts` 导出一个 `simulationConfig` 对象，包含 `physics`（`defaultGravity`、`defaultFriction` 为 0.5、`defaultRestitution` 为 0.2、`maxSubSteps` 为 5、`fixedTimeStep` 为 1/60、`maxFrameDelta` 为 0.25）、`controls`（速度区间 0.1 到 5、步长候选值等）、`visualization` 与 `objects` 等分组。

其中 `fixedTimeStep`、`maxSubSteps` 与 `maxFrameDelta` **已经被接线**：固定步长累加器（`src/utils/fixedStepAccumulator.ts`）读取它们，场景编辑器与仿真实验室共用同一套定义。改动这几个值会直接改变仿真行为。

## 当前限制

- 仓库里同时装着 `rapier3d` 与 `rapier3d-compat` 两个包，`initRapier` 与 `initEditor` 各自初始化一次运行时，尚未收敛。
- `usePhysics` 中 `initPhysics` 的异常被静默吞掉，初始化失败时 `world.value` 保持为 `null`，调用方需要自行判断。
- `useSceneEditor` 没有导出按 uuid 移除刚体的方法，`rigidBodies` 映射也不对外暴露。
