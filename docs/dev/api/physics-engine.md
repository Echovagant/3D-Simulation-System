# 物理引擎API

系统的物理计算由 Rapier 承担。本章描述两处物理接入点、它们各自导出的方法，以及真实的步进语义。

文中列出的每一个函数名、属性名都直接对应仓库源码，可以逐个检索核对。

## 引擎版本与依赖

物理引擎只有一个包：`@dimforge/rapier3d`（`^0.19.3`）。

- 运行时走 `src/composables/loadRapier.ts`：`await import('@dimforge/rapier3d')`，
  WASM 被 `vite-plugin-wasm` 拆成独立的 `.wasm` 资源，场景编辑器、仿真实验室与
  AI 演武场共用同一份。
- `@dimforge/rapier3d-compat` 只作为**开发依赖**存在：Vitest 的 SSR transform
  解析不了官方包只有 `module` 字段的入口，测试环境把官方包别名到 compat
  （WASM 内联、无独立资源），见 `vitest.config.ts`。

> 早期版本同时依赖两个包，产物里多出一份 base64 内联的 WASM（chunk 约 2.2MB），
> 且 compat 内部会打一条弃用警告。现在已收敛成官方包一条路径。

## 组合式函数 usePhysics

`usePhysics` 位于 `src/composables/usePhysics.ts`，返回一个物理实例对象。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `world` | `Ref<Rapier.World \| null>` | 物理世界实例，未初始化时为 `null` |
| `ready` | `() => Promise<void>` | 等待 Rapier 的 WASM 运行时加载完成。加载是全局一次性的，重复调用复用同一个 Promise |
| `initPhysics` | `(scene?: Object3D, options?: PhysicsInitOptions) => Promise<void>` | 创建物理世界；传入场景时会创建地面并为场景中带物理数据的物体建立刚体。`options.ground` 可自定义地面（尺寸、颜色、摩擦、弹性），传 `null` 则不建地面 |
| `updatePhysics` | `(deltaTime: number) => void` | 按给定步长推进一帧，并把刚体状态写回对应的 Three.js 对象 |
| `stepPhysics` | `(deltaTime: number) => void` | `updatePhysics` 的别名，调用方习惯用这个名字 |
| `addRigidBody` | `(object: Object3D) => void` | 依据 `object.userData.physics` 的描述为单个物体建立刚体与碰撞体。同一个物体重复调用不会建出第二个碰撞体 |
| `removeRigidBody` | `(object: Object3D) => void` | 从物理世界移除刚体，并清空 `userData.physics` 上的 `body` 与 `collider` 引用 |
| `resetPhysics` | `() => void` | 清空全部刚体、重建物理世界，并重新创建地面与物体刚体 |
| `updatePhysicsParameters` | `(params: { gravity?: Vector3; friction?: number; restitution?: number }) => void` | 运行时调整重力、摩擦系数与恢复系数 |
| `getRapierModule` | `() => Rapier \| null` | 已加载的 Rapier 模块；需要 `Ball` 之类的形状做场景查询时用 |

### 地面

调用 `initPhysics(scene)` 时会创建一个名为 `Ground` 的长方体网格：尺寸 20×1×20，位置 `(0, -0.5, 0)`。它携带的物理数据是 `type` 为 `static`、`shape` 为 `box`、半长 `(10, 0.5, 10)`、`friction` 为 0.5、`restitution` 为 0.3，因此会被建成固定刚体。

`initPhysics(scene, { ground })` 可以换掉它：`ground` 支持 `name`、`halfExtents`、`color`、`opacity`、`friction`、`restitution`。
AI 演武场用的就是 60×60 的地面（`name: 'ai-arena-ground'`、顶面在 y = 0）。
传 `ground: null` 则完全不建地面。

地面网格是这个物理世界的一部分：世界被释放时它会一起从场景里撤掉，
否则下一次 `initPhysics` 会在同一位置叠出第二块地面（两块共面的地面既会 z-fighting，
又会各自带一个碰撞体，摩擦冲量翻倍）。

### 场景查询需要先走一步

Rapier 的场景查询（`projectPoint` / `intersectionsWithShape` / `contactPair`）
读的是宽相位的 AABB 树与窄相位的交互图，这两样东西**只在 `world.step()` 里更新**。
世界刚建好、一步都还没走的时候去查询，WASM 内部会直接 panic，
而且 panic 之后整个 WASM 实例都被污染——后面每一次调用都会报同一个错。

因此 `initPhysics` 建完世界后会先预热一步，让世界处于"可查询"状态。

### 全局投影查询在"过滤器全拒"时也会 panic

`world.projectPoint` 带过滤回调时，如果回调**拒绝了所有碰撞体**（典型场景：
场地里一个障碍物都没有），Rapier 0.19.3 会在 WASM 内部 panic——同样会污染整个实例。

AI 演武场因此没有用全局投影查询，而是**逐碰撞体**调用 `collider.projectPoint`：
障碍物最多十几个，逐个算反而更快，也彻底绕开这个雷。
只有"是否撞上"用 `world.contactPair`（窄相位接触流形），它不需要过滤器。

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
| AI 演武场 | 同一个固定步长累加器，每步先施加转向冲量再 `updatePhysics(fixedTimeStep)` | `src/composables/useAI.ts` 的 `updateAgents` |

累加器把「这一帧过去的真实时间」切成若干个固定步，因此**仿真速度与显示刷新率无关**：60Hz 屏每秒推进 60 个物理步，30Hz 屏同样是 60 个。`speed` 的语义是“每秒执行多少个固定步”，调大速度不会放大步长。单帧最多推进 `maxSubSteps`（5）步，剩余积压会被丢弃。

## 配置常量

`src/config/simulation.ts` 导出一个 `simulationConfig` 对象，包含 `physics`（`defaultGravity`、`defaultFriction` 为 0.5、`defaultRestitution` 为 0.2、`maxSubSteps` 为 5、`fixedTimeStep` 为 1/60、`maxFrameDelta` 为 0.25）、`controls`（速度区间 0.1 到 5、步长候选值等）、`visualization` 与 `objects` 等分组。

其中 `fixedTimeStep`、`maxSubSteps` 与 `maxFrameDelta` **已经被接线**：固定步长累加器（`src/utils/fixedStepAccumulator.ts`）读取它们，场景编辑器与仿真实验室共用同一套定义。改动这几个值会直接改变仿真行为。

## 当前限制

- `usePhysics` 中 `initPhysics` 的异常被静默吞掉，初始化失败时 `world.value` 保持为 `null`，调用方需要自行判断。
- `useSceneEditor` 没有导出按 uuid 移除刚体的方法，`rigidBodies` 映射也不对外暴露。
- `useSceneEditor` 仍自行维护一套 Rapier 接入，没有复用 `usePhysics`（两套的刚体账本与同步时机不同，强行合并的收益不抵改动风险）。
