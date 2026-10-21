<div align="center">
  <img src="docs/assets/cover.png" alt="3D 仿真系统" width="880" />
</div>

<h1 align="center">3D 仿真系统</h1>
<p align="center"><b>基于 Vue 3 + Three.js + Rapier3D 的 Web3D 场景编辑与物理仿真平台</b></p>

<p align="center">
  <a href="https://www.npmjs.com/package/vue"><img alt="Vue 3.5.44" src="https://img.shields.io/badge/Vue-3.5.44-42b883?logo=vuedotjs&logoColor=35495e"></a>
  <a href="https://threejs.org/"><img alt="Three.js 0.180.0" src="https://img.shields.io/badge/Three.js-0.180.0-000000?logo=threedotjs&logoColor=000000"></a>
  <a href="https://rapier.rs/"><img alt="Rapier3D 0.19.0" src="https://img.shields.io/badge/Rapier3D-0.19.0-f47d21?logo=rust&logoColor=000000"></a>
  <a href="https://vite.dev/"><img alt="Vite 6.4.4" src="https://img.shields.io/badge/Vite-6.4.4-646cff?logo=vite&logoColor=646cff"></a>
  <a href="https://www.typescriptlang.org/"><img alt="TypeScript 5.8.3" src="https://img.shields.io/badge/TypeScript-5.8.3-3178c6?logo=typescript&logoColor=3178c6"></a>
  <img alt="Vitest 27 files / 216 cases" src="https://img.shields.io/badge/test-27%20files%20%2F%20216%20cases-16a34a?logo=vitest&logoColor=fd9714">
  <img alt="8 build gates" src="https://img.shields.io/badge/build%20gates-8%20passed-16a34a?logo=githubactions&logoColor=2088ff">
</p>

<p align="center">
  <a href="#核心能力">核心能力</a> ·
  <a href="#界面">界面</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#架构">架构</a> ·
  <a href="#质量保障">质量保障</a> ·
  <a href="#文档">文档</a>
</p>

---

## 这是什么

一个**工程化**的 3D 场景编辑与仿真平台：左边编辑场景，右边跑物理，中间能放规则式智能体。

它不是一个"能跑就行"的 demo。这个仓库做过一次**完整的代码审计**——19 份实施计划、4 轮独立复核，审计报告与实施计划都在仓库外归档。审计前 `npm run build` 跑不过、物理循环启动就死、删个物体刚体还在场上碰撞、模型在生产环境 404。现在这些全部修掉，并且用 **8 道构建闸门**守住不回退。

## 核心能力

<div align="center">

| | | |
|:---:|:---:|:---:|
| 🛠️ <b>场景编辑器</b><br>拖拽式放置基本体 / 模型，<br>属性面板实时改变换，<br>改完立刻写回刚体 | 🔬 <b>仿真实验室</b><br>固定步长刚体物理，<br>速度与帧率解耦，<br>预设场景一键切换 | 🤖 <b>AI 演武场</b><br>规则式智能体读真实感知、<br>绕开障碍物自主移动 |
| 📦 <b>模型资源库</b><br>9 个内置条目，<br>本地渐变缩略图，<br>上传产生可用对象 URL | 📚 <b>系统文档</b><br>11 篇正文，<br>API / 指南 / 示例三类，<br>全部与源码逐词核对 | 🎨 <b>浅色科技网络</b><br>Canvas 2D 自绘背景，<br>零 Babylon 依赖，<br>全站靛紫单主色 |

</div>

**它真正做对的几件事：**

- **一个场景只有一套物理。** 手写积分器和 Rapier 并行驱动同一个物体的历史已经删干净，Rapier 是唯一权威。
- **仿真速度与显示刷新率解耦。** 60Hz / 30Hz / 15Hz 屏上都是 **60.3~60.6 步/秒**——此前同一场景在 30Hz 屏上只跑 44% 速度。
- **Vue 不再代理 three.js 对象。** `objects` 用 `shallowRef`、`threeObject` 打 `markRaw`，属性面板不再每帧遍历整棵场景图：每帧属性访问 **410.7 → 44.4（−89.2%）**，`ScriptDuration` **−92.4%**。
- **改变换真的改到物理上。** 属性面板改位置 / 旋转 / 缩放 → 走 `update-transform` 事件写回刚体与碰撞体，缩放会同步重建碰撞体形状。
- **外部资源零运行时依赖。** 不再从海外 CDN 拉字体与随机图，全部本地化，并落 CSP。

## 界面

<div align="center">

| 总览 | 场景编辑器 | 仿真实验室 |
|:---:|:---:|:---:|
| <img src="docs/screenshots/overview.png" alt="总览页" width="100%"> | <img src="docs/screenshots/scene-editor.png" alt="场景编辑器" width="100%"> | <img src="docs/screenshots/simulation-lab.png" alt="仿真实验室" width="100%"> |

</div>

<div align="center">

| AI 演武场 | 模型资源库 | 系统文档 |
|:---:|:---:|:---:|
| <img src="docs/screenshots/ai-playground.png" alt="AI 演武场" width="100%"> | <img src="docs/screenshots/model-library.png" alt="模型资源库" width="100%"> | <img src="docs/screenshots/docs.png" alt="系统文档" width="100%"> |

</div>

## 快速开始

```bash
# Node 20+
git clone https://github.com/Echovagant/3D-Simulation-System.git
cd 3D-Simulation-System
npm install

npm run dev        # 开发服务器
npm run build      # 类型检查 + 构建 + 测试 + 8 道闸门
npm run preview    # 预览生产产物
```

浏览器打开 `http://localhost:5173`。左侧是导航，依次是：总览 / 场景编辑器 / 仿真实验室 / 模型资源库 / AI 演武场 / 系统文档。

**常用命令**

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 开发服务器 |
| `npm run build` | `type-check` + `vite build` + `npm test` + 8 道闸门 |
| `npm test` | Vitest 全量用例（27 文件 / 216 例） |
| `npm run type-check` | `vue-tsc` 类型检查（零错误） |
| `npm run verify:all` | 单独跑全部校验闸门 |
| `npm run format` | Prettier 格式化 |

## 技术栈

| 领域 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | Vue | 3.5.44 |
| 构建 | Vite + Vue Plugin | 6.4.4 / 6.0.1 |
| 语言 | TypeScript | 5.8.3 |
| 渲染 | Three.js | 0.180.0 |
| 物理 | Rapier3D（WASM） | 0.19.0 |
| 状态 | Pinia | 3.0.3 |
| 路由 | Vue Router | 4.5.1 |
| 文档渲染 | marked + DOMPurify | 16.3.0 / 3.4.17 |
| 测试 | Vitest + jsdom | 5.0.5 / 30.x |
| 图标 | Font Awesome Free | 6.7.2 |

> **本项目没有接 Tailwind。** 样式是手写 CSS + CSS 变量，令牌层见 [`DESIGN.md`](DESIGN.md)。
> 模板里若出现 `flex-1` / `lg:col-span-6` 这类工具类，它们**不生效**——
> 仓库有 `scripts/check-tailwind-classes.mjs` 闸门盯着死类名数量不增长。

## 架构

```
┌──────────────┐   sceneEditorStore（Pinia，单一真源）
│  场景编辑器   │──▶ objects: shallowRef<SceneObject[]>
└──────────────┘    selectedObject / simulationState / renderState
        │                       ▲
        │  update-transform 事件 │  updateObject
        ▼                       │
┌──────────────┐         ┌──────┴───────┐
│ useSceneEditor│────────▶│  刚体（Rapier）│  ← 唯一物理权威
│  刚体账本     │         └──────────────┘
│  碰撞体账本    │              │
└──────────────┘              │ syncPhysicsToObjects（每帧绝对覆盖）
        ▲                      ▼
        │            ┌──────────────┐
        │            │ threeObject   │ ← 裸对象，markRaw，不被 Vue 代理
        └────────────┴──────────────┘
```

**三条硬规则**

1. **Rapier 是唯一权威。** 物体的变换只有一条通路：`用户编辑 → update-transform 事件 → 刚体 → syncPhysicsToObjects → mesh`。没有第二条写入路径。
2. **three.js 对象不进 Vue 响应式。** `objects` 用 `shallowRef` + 整体替换数组；`threeObject` 打 `markRaw`。
3. **仿真按固定步长推进。** 真实时间累加到累加器，按 `fixedTimeStep = 1/60` 切成整步，步数与显示帧率无关。

## 质量保障

`npm run build` 会在构建链上依次跑完这些闸门，**任何一道不过，构建就失败**：

| 闸门 | 守什么 |
| --- | --- |
| `verify:clean` | `src/` 下不能有编译产物泄漏 |
| `verify:no-babylon` | Babylon 残留（背景已换成 Canvas 2D） |
| `verify:overview-contrast` | 总览页 13 个前景的 WCAG AA + 禁用色 |
| `verify:docs` | 文档不能是 0 字节 |
| `verify:bundle-size` | 入口 chunk ≤ 1.5 MB |
| `verify:deps` | 20 个零引用依赖不得复活 |
| `verify:tailwind` | 死 Tailwind 类名不得超过 239 处 |
| `npm test` | 27 个测试文件 / 216 个用例 |

**当前实测**

| 指标 | 数值 |
| --- | --- |
| 入口 chunk | **251.17 KB**（上限 1536 KB） |
| 产物体积 | 25.83 MB |
| 运行时依赖 | 12 个（审计前 34 个） |
| 测试 | 27 文件 / 216 例全绿 |
| 类型检查 | 0 错误 |
| 7 条路由 | 0 console error / 0 page error / 0 网络失败 |
| 死 Tailwind 类名 | 757 → **239** |

**这仓库刚做完一次全面审计**——19 份实施计划、4 轮独立复核，发现的问题全部落地并用闸门守住。审计报告与实施计划归档在仓库外（含逐条处置记录与被驳回的误判）。

## 项目结构

```
src/
├── components/
│   ├── three/            # 3D 场景：core / panels / ai
│   ├── common/Background # Canvas 2D 科技网络背景
│   └── docs/             # 文档渲染
├── composables/          # useSceneEditor（刚体权威）/ usePhysics / useThree / useAI
├── stores/               # Pinia：场景编辑器 / 仿真 / 模型 / AI
├── views/                # 7 个页面
├── docs/                 # 11 篇文档正文（会被渲染进系统文档页）
├── utils/                # 固定步长累加器 / markdown 渲染 / 缩略图 …
└── assets/styles/        # 主题令牌 + AI 面板工具层
scripts/                  # 8 道构建闸门
```

## 文档

系统内置 11 篇文档（`/docs`），也以 Markdown 形式放在 [`src/docs/`](src/docs)：

- **使用指南** — 场景编辑器 / 仿真实验室 / AI 演武场 / 模型资源库 的上手
- **API 参考** — Three.js 集成 / 物理引擎 / AI 接口
- **示例教程** — 基础场景 / 物理仿真 / AI 交互

## 贡献

欢迎提 Issue 与 PR。动手前请先读 [`DESIGN.md`](DESIGN.md)（设计令牌唯一真源）与本 README 的「质量保障」——**改完必须跑 `npm run build`**，8 道闸门全绿才算完成。

## License

⚠️ **本仓库暂未附加 LICENSE 文件。** 代码版权归原作者所有；在补上许可证之前，默认保留所有权利。
（需要开源授权的话，提 Issue 说明期望的协议即可。）

## 致谢

- [Three.js](https://threejs.org/) — 渲染
- [Rapier](https://rapier.rs/) — 刚体物理
- [Vue](https://vuejs.org/) / [Vite](https://vite.dev/) / [Pinia](https://pinia.vuejs.org/) — 框架层
- [Font Awesome Free](https://fontawesome.com/) — 图标
