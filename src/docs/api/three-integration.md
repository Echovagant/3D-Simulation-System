# Three.js集成API

本章说明系统内部对 Three.js 的封装方式：场景编辑器使用的组合式函数 `useSceneEditor`、负责绘制的 `Viewport` 组件，以及承载场景对象的 Pinia 仓库 `useSceneEditorStore`。

文中列出的每一个函数名、属性名都直接对应仓库源码，可以逐个检索核对。

## 核心组合式函数 useSceneEditor

`useSceneEditor` 位于 `src/composables/useSceneEditor.ts`，接收一个可选的容器 DOM 引用，返回一组场景创建、编辑与物理推进的方法。

| 成员 | 签名 | 说明 |
| --- | --- | --- |
| `initEditor` | `() => Promise<boolean>` | 异步创建 Three.js 场景、相机、渲染器、轨道控制器与 Rapier 物理世界，成功返回 `true`，失败返回 `false` 并写入 `onInitError` |
| `reinit` | `() => Promise<boolean>` | 重新执行一次 `initEditor` |
| `cleanupEditor` | `(callStoreCleanup?: boolean) => void` | 解除事件、销毁刚体与渲染器；默认同时调用仓库的 `cleanup()` |
| `addCube` | `() => boolean` | 创建一个 1×1×1 的立方体网格并附加动态刚体 |
| `addSphere` | `() => boolean` | 创建一个半径 0.5 的球体网格并附加动态刚体 |
| `importModel` | `(modelId: string) => Promise<boolean>` | 按模型 ID 从模型库取记录、加载模型，并用包围盒近似生成碰撞体 |
| `updatePhysics` | `() => void` | 推进一帧物理并把刚体状态同步回 Three.js 对象 |
| `getIsSceneInitialized` | `() => boolean` | 返回场景是否已完成初始化 |
| `onInitSuccess` | `Ref<() => void>` | 初始化成功回调，可直接赋值覆盖 |
| `onInitError` | `Ref<(err: string) => void>` | 初始化失败回调，可直接赋值覆盖 |
| `getScene` / `getCamera` / `getRenderer` | `() => ...` | 读取内部的场景、相机、渲染器实例 |

### 初始化时创建的默认对象

`initEditor` 会一次性准备下列内容：

- 场景背景色 `0x222222`；透视相机 FOV 为 75，初始位置 `(5, 5, 5)`
- 渲染器开启抗锯齿与阴影贴图，像素比上限为 2
- 一盏强度 0.5 的环境光，以及一盏强度 1、开启阴影的平行光（位于 `(5, 10, 7.5)`）
- `GridHelper(10, 10)` 网格辅助线，外加两个 `AxesHelper`（一个不透明、一个半透明）
- `OrbitControls` 轨道控制器，开启阻尼，`dampingFactor` 为 0.05
- Rapier 物理世界，重力为 `(0, -9.81, 0)`
- 地面：10×10 的平面网格，配一个 `fixed` 刚体与 `cuboid(5, 0.1, 5)` 碰撞体

### 新增物体的落点与碰撞体

`addCube` 与 `addSphere` 走同一个内部创建流程。新物体的位置是随机的：X 与 Z 取 `(-2.5, 2.5)` 区间，Y 固定为 2；网格颜色也由 `Math.random()` 决定。碰撞体方面，立方体使用 `ColliderDesc.cuboid` 且半长均为 0.5，球体使用 `ColliderDesc.ball` 且半径为 0.5。

### 物理推进的节流方式

`updatePhysics` 只在“正在播放且未暂停”时真正推进物理。它接收渲染循环传来的 `requestAnimationFrame` 时间戳，用「当前时间戳 − 上一帧时间戳」算出这一帧过去的真实时间，再交给固定步长累加器（`src/utils/fixedStepAccumulator.ts`）按固定步长 `simulationConfig.physics.fixedTimeStep`（1/60 秒）切成若干个物理步：每一步都把 `physicsWorld.integrationParameters.dt` 设为这个固定步长，调用一次 `physicsWorld.step(eventQueue)`，最后由 `syncPhysicsToObjects` 把每个刚体的位移与四元数写回对应的 `threeObject`。

因此仿真速度与显示刷新率**无关**：60Hz 屏每秒推进 60 个物理步，30Hz 屏同样是 60 个（低帧率时一帧多推几步）。单帧最多推进 `maxSubSteps`（5）步，剩余积压会被丢弃，避免低帧率机器陷入“追帧→更卡→更少帧”的死循环。

`store.simulationState.speed` 的语义是“每秒执行多少个固定步”：1× 就是每秒 60 步，速度调大不会改变步长的大小。

### 刚体映射表

组合式函数内部维护一个 `rigidBodies` 映射，键是 Three.js 对象的 `uuid`，值是 Rapier 刚体。删除物体时，仓库会派发 `remove-rigidbody` 自定义事件，`useSceneEditor` 监听该事件，把刚体从物理世界和映射表中一并移除。

## Viewport 渲染组件

`src/components/three/panels/Viewport.vue` 负责把渲染器的 canvas 挂进 DOM 容器，并驱动渲染循环。

### 属性

| 属性 | 类型 | 说明 |
| --- | --- | --- |
| `scene` | `Scene \| null` | 要渲染的场景对象 |
| `camera` | `Camera \| null` | 相机对象 |
| `renderer` | `WebGLRenderer \| null` | 渲染器实例 |
| `updatePhysics` | `(timestamp?: number) => void` | 每帧被调用一次的物理推进函数；参数是 `requestAnimationFrame` 的时间戳 |

### 事件

| 事件 | 载荷 | 说明 |
| --- | --- | --- |
| `viewport-click` | `Object3D \| null` | 鼠标点击命中场景物体时抛出，未命中时为 `null` |
| `update-camera` | `{ type: 'perspective' \| 'orthographic', aspect?, left?, right?, top?, bottom? }` | 容器尺寸变化时抛出，由父组件决定如何更新相机 |
| `performance-warning` | `{ message: string, timestamp: number, details? }` | 预留的性能告警通道 |

### 生命周期行为

- 组件挂载后把 `renderer.domElement` 追加进容器。容器尺寸小于 10 像素时最多重试 10 次，每次间隔 200 毫秒；超过上限则退回 800×600。
- 使用 `ResizeObserver` 监听容器尺寸变化，变化时同步渲染器尺寸并抛出 `update-camera`，组件本身不直接改写相机。
- 渲染循环中调用 `updatePhysics`；若它抛出异常，则调用仓库的 `addPhysicsError('Viewport物理更新失败', error as Error)` 记录问题，渲染循环不会因此中断。

## 场景状态仓库 useSceneEditorStore

`src/stores/sceneEditorStore.ts` 持有场景对象列表、模拟状态与渲染状态。

### 状态字段

| 字段 | 说明 |
| --- | --- |
| `objects` | 场景中所有物体的数组，元素为 `SceneObject` |
| `selectedObjectUuid` / `selectedObject` | 当前选中物体的 uuid 与对象本身 |
| `simulationState` | `isPlaying`、`isTransitioning`、`isPaused`、`speed`、`currentTime`、`frameCount`；后两者由固定步长累加器按物理步推进 |
| `renderState` | `isRendering`、`needsUpdate`、`fps`、`lastFrameTime`、`performanceWarnings`、`physicsErrors` |

### 主要方法

| 方法 | 作用 |
| --- | --- |
| `addObject` | 把一个物体加入场景并初始化其物理属性 |
| `setSelectedObject` / `removeSelectedObject` / `removeObject` | 选中与删除物体；删除时会派发 `remove-rigidbody` 事件通知物理层 |
| `updateObject` | 更新位置、旋转、缩放与可见性，并同步到 `threeObject` |
| `saveScene` / `loadScene` | 以 JSON 形式写入 / 读取浏览器 `localStorage` |
| `startSimulation` / `stopSimulation` | 启停内部的物理更新循环 |
| `togglePlayState` / `togglePlayStateWithTransition` | 切换播放状态，后者在切换期间会短暂锁定重复点击 |
| `togglePause` | 切换暂停标记 |
| `setSimulationSpeed` | 设置速度，并把取值夹在 0.1 到 5.0 之间 |
| `updateRendererSize` | 同步渲染器尺寸与相机宽高比 |
| `getScreenshot` | 渲染一帧并返回 PNG 的 data URL |
| `addPerformanceWarning` / `addPhysicsError` | 追加带时间戳的告警与错误记录 |
| `cleanup` | 停止模拟、移除全部物体并清空列表 |

## 场景编辑器与模型库的联动

场景编辑器的工具栏通过 `provide` / `inject` 取得 `addCube`、`addSphere`、`importModel`、`getIsSceneInitialized` 四个方法。这批方法由 `src/components/three/core/ThreeScene.vue` 在初始化完成后经 `expose-methods` 事件上抛，再由场景编辑器页面转交。

“导入模型”按钮并不直接加载文件，而是跳转到 `/model-library` 并带上 `returnUrl` 查询参数；在模型库中选定模型后返回，工具栏监听路由变化并调用 `importModel(modelId)` 完成导入。

模型文件由 `src/utils/modelLoader.ts` 的 `loadModel` 加载：按扩展名选择 GLTFLoader、FBXLoader 或 OBJLoader；URL 为 `#` 或空字符串时直接抛出“无效的模型URL”，扩展名不受支持时抛出“不支持的模型格式”。站内绝对路径会拼上 `import.meta.env.BASE_URL`，以支持子路径部署。

## 当前限制

- 仓库中**没有** `src/config/three.ts` 这样的集中配置文件——该路径在版本库里只是一个 0 字节的空文件，工作区中已不存在。Three.js 的初始化参数分散在 `useSceneEditor` 与各个 `use*` 组合式函数内部。
- `src/config/simulation.ts` 导出的 `simulationConfig` 常量**已经被接线**：`physics.fixedTimeStep`（1/60 秒）与 `physics.maxSubSteps`（5）由固定步长累加器消费，场景编辑器与仿真实验室共用同一套步长定义。改动这两个值会直接改变仿真行为。
- `getScreenshot` 与 `togglePause` 已在仓库中实现，但当前没有任何界面元素调用它们。
- `loadScene` 只会重建类型为 `model` 且带 `modelId` 的物体，其余类型在源码中留有“处理其他类型物体”的占位注释，实际不会被还原。
