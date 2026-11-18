# Design System: 3D-Simulation-System

> 本文件描述本项目的设计系统。令牌的**唯一真源**是
> [`src/assets/styles/tokens.css`](src/assets/styles/tokens.css)——那里定义什么，
> 全站就长什么样；本文件负责解释语义与约束。改令牌前先读完第 4 节的闸门联动。

## 0. Meta

```yaml
version: 3.0.0
framework: vue-3.5 + vite-6 + hand-written-css
css_framework: plain-css (css-variables, NO Tailwind)
component_library: none
theme_modes: dark (黑金单一深色主题；AI 演武场观感冻结为 teal 玻璃深空快照)
tokens_source: src/assets/styles/tokens.css
```

**关于 Tailwind**：本仓库**没有**接 Tailwind（无依赖、无 postcss、无 tailwind.config）。
模板里任何 `flex-1` / `lg:col-span-6` / `text-gray-300` 之类的类名都是**死类名**、不生效。
`scripts/check-tailwind-classes.mjs` 闸门盯着死类名出现次数不得超过 **74**。
**新增样式一律写 scoped CSS + 令牌变量。**

## 1. 调性：黑金缎面（复现项目早期版本，2026-11-19 定稿）

**关键词：深灰缎面 · 金黄强调 · off-white 文字 · WebGL 花瓣**

本项目是 3D 场景编辑与仿真平台——工具软件，但首页保留老版的黑金气质。
视觉建立在四条约束上：

1. **全站深灰**：近黑深灰阶画布，WebGL 渲染动态背景（金色花瓣飘落，
   `src/background/webgl-background.ts`），CSS 兜底色 `--bg-canvas`。
2. **金黄单强调**：`#FFD400` 正色做实底（其上文字必须配 `--accent-on` 深字），
   提亮档 `#ffce3a` 做文字与金光。文字不用正色（面板上只有 4.3:1，
   这是色卡落地的必要修正）。琥珀 `--accent-2` 只作 AI 演武场面板 kit 的域色。
3. **面板深玻璃**：白基毛玻璃（`--glass-*` 族）在深灰底上透出花瓣场景；
   跨浅色区域（如首页白波浪已移除，现背景全深灰）或白区场景使用
   `color-mix(in srgb, var(--ink-950) N%, transparent)` 派生深玻璃。
   `@supports` 与 `prefers-reduced-transparency` 双回退到实底。
4. **信息层级优先**：面板底、边框、文字三级（`--text-1/2/3`）撑起层次；
   仿真参数、坐标、FPS、统计值走 `--font-mono` 等宽数字体系。
   动画克制：只有 WebGL 背景与交互动效，不加装饰动画。

**AI 演武场观感冻结**（用户裁定）：`app-global.css` 的
`.ai-playground-container` 钉死「teal 玻璃深空」完整令牌快照，
WebGL 背景在该路由切 `frozen` 模式——全局主题再怎么变都不影响此页。

**反面清单**（构建闸门 `scripts/check-light-contrast.mjs` 直接拦）：

- `#f0f0f0` 浅灰前景 —— 浅色时代遗留（金色系随黑金定稿已转正，不再拦）
- 深底上的纯黑前景 `#000` —— 不可见（白底面板上则禁纯白前景）
- `@media` 块内出现任何颜色声明 —— 闸门只覆盖基础字号，media 里塞颜色无法对账；
  回退值经自定义属性切换（在 `@media` 里只动 `--var`，颜色声明留在基础规则）
- 组件里写硬编码 hex —— 一律引用 `var(--token)`；`color-mix` 从令牌派生

## 2. 令牌层（真源：`src/assets/styles/tokens.css`）

### 2.1 基础层：深灰阶

| Token | 值 | 角色 |
|---|---|---|
| `--ink-950` | `#1f1f1f` | 画布（WebGL 兜底底色） |
| `--ink-900` | `#262626` | 常规面板 |
| `--ink-850` | `#2e2e2e` | 浮起面板 / 卡片 |
| `--ink-800` | `#383838` | 输入框 / 嵌入区 |
| `--ink-700` | `#454545` | hover 面 / 强边框 |

### 2.2 语义层（组件只引用这一层）

| Token | 值 | 角色 / 对比度 |
|---|---|---|
| `--bg-canvas` / `--bg-panel` / `--bg-panel-raised` / `--bg-inset` | 映射 `--ink-*` | 画布 / 面板 / 浮起面板 / 嵌入区 |
| `--border-subtle` | `rgba(255,255,255,.09)` | 常规分隔 |
| `--border-strong` | `rgba(255,255,255,.18)` | 强分隔 / hover 边 |
| `--text-1` | `#f2f2ee` | 主文字，off-white（on canvas ≈13.5:1） |
| `--text-2` | `#cfcfcf` | 次级（≈9.5:1） |
| `--text-3` | `#a8a8a8` | 弱化标注（≈6:1） |
| `--accent` | `#ffce3a` | 强调**文字**（on canvas ≈10:1） |
| `--accent-strong` | `#ffd400` | 强调**底**（其上文字必须配 `--accent-on`，≈12:1） |
| `--accent-on` | `#201a02` | 黄实底上的文字（近黑暖调，禁纯黑同源纪律） |
| `--accent-strong-hover` | `#ffe066` | 悬停（深色下 hover 提亮，不是压暗） |
| `--accent-soft` | `rgba(255,212,0,.13)` | 选中底 / 高亮底 |
| `--accent-2` | `#ffa117` | 琥珀次强调（AI 面板 kit 域色） |
| `--glass-bg/-strong/-hover` | `rgba(255,255,255,.05/.08/.12)` | 白基玻璃层 |
| `--glass-border` / `--glass-blur` | `rgba(255,255,255,.14)` / `24px` | 玻璃描边 / 半径 |
| `--danger` / `--success` / `--warning` | `#f0616a` / `#43c07f` / `#ffa117` | 状态**文字** |
| `--danger-strong` / `--success-strong` | `#b91c1c` / `#15803d` | 状态**底**（配白字） |
| `--radius-sm/md/lg` | `4/8/12px`、`--shadow-panel/pop` | 几何 |
| `--text-xs…2xl` | `12…26px`、`--font-mono` | 字号阶 / 等宽数字体系 |

## 3. 两套工具层，各守各的域

| 工具层 | 文件 | 适用域 |
|---|---|---|
| `ai-*` | `src/assets/styles/ai-panel-kit.css` | **AI 演武场**（`AIPlayground.vue` + `components/three/ai/`） |
| `sim-*` | `src/assets/styles/simulation-panel-kit.css` | **仿真实验室**（`SimulationLab.vue` + `components/simulations/`） |

两层的色彩语义完全一致（同一套令牌），只是类名前缀与服务的页面域不同。
**`scripts/check-light-contrast.mjs` 白名单闸门**：`ai-*` 类出现在 AI 域之外、
或 `sim-*` 出现在实验室域之外，构建直接红——工具层串门 = 一个应用装出两套观感。

## 4. 闸门联动（改样式必读）

`npm run build` 会跑 **`check-light-contrast`**：从 `tokens.css` 解析 `--bg-canvas`/
`--bg-panel` 作对账底色，展开组件里的 `var(--token)` 后逐条算 WCAG AA
（正文 4.5:1、大字 3:1）。改令牌值 = 改全站底色 = 闸门标准变——
改之前想清楚三级文字还能不能达标。

- 元素自带实底时写 **`background-color:`**（闸门只认这个属性名做元素底对账，
  shorthand `background:` 会按页面底色对账导致误报）。
- `@media` 块内不许出现颜色声明（闸门规则）；`prefers-reduced-transparency`
  等回退经**自定义属性**切换（media 里只动 `--var`，颜色留在基础规则）。
- 状态实底（`--danger-strong` / `--success-strong`）上的白字是**唯一允许的裸
  `#ffffff` 前景**；黄主色实底一律配 `var(--accent-on)`。

**CSS 注释陷阱**：注释里写 `--bg-*/--text-*` 这类字符串，其中的 `*/` 会把注释
提前闭合，剩余文本变成非法 token、**毒化整个 :root 块**（tokens.css 曾因此整批
失效）。注释里写通配记号请用顿号或加空格：`--bg-*、--text-*`。

## 5. 常用模板

```css
/* 面板：玻璃 */
.panel {
  background: var(--glass-bg-strong);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}
/* 主按钮：金黄实底 + 深字 */
.btn-primary { background-color: var(--accent-strong); color: var(--accent-on); }
.btn-primary:hover { background-color: var(--accent-strong-hover); }
/* 次按钮：透明底 + 描边 */
.btn-ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text-1); }
/* 输入框 */
.input { background: var(--bg-inset); border: 1px solid var(--border-subtle); color: var(--text-1); }
/* 数字与等宽 */
.metric { font-family: var(--font-mono); font-variant-numeric: tabular-nums; }
```

**品牌标识**：`src/assets/images/logo.svg` 等距立方体三面金黄
（顶 `#FFE066` / 主 `#FFD400` / 暗 `#B89400`）+ 琥珀节点 `#FFA117`；
改设计改母版 SVG 后跑 `npm run gen:brand` 重渲染 png/ico。

## 6. 动态背景（`src/background/webgl-background.ts`）

- `blackgold` 模式（默认）：深灰径向渐变底 + 620 片金色花瓣 point sprite
  （双凸轮廓自转、CPU 漂落回绕、近大远小淡出、柔边渐变替代 bloom 链）。
  效果参考 codepen.io/FrankFitzGerald/pen/nrOwPL（结构独立，非逐字复刻）。
- `frozen` 模式：AI 演武场路由（App.vue 按 `$route.path` 切换）。
- reduced-motion 只画一帧；tab 隐藏暂停；DPR 上限 2。
