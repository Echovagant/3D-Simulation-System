# Design System: 3D-Simulation-System

> 本文件描述本项目的设计系统。令牌的**唯一真源**是
> [`src/assets/styles/tokens.css`](src/assets/styles/tokens.css)——那里定义什么，
> 全站就长什么样；本文件负责解释语义与约束。改令牌前先读完第 4 节的闸门联动。

## 0. Meta

```yaml
version: 2.0.0
framework: vue-3.5 + vite-6 + hand-written-css
css_framework: plain-css (css-variables, NO Tailwind)
component_library: none
theme_modes: dark (单一深色主题)
tokens_source: src/assets/styles/tokens.css
```

**关于 Tailwind**：本仓库**没有**接 Tailwind（无依赖、无 postcss、无 tailwind.config）。
模板里任何 `flex-1` / `lg:col-span-6` / `text-gray-300` 之类的类名都是**死类名**、不生效。
`scripts/check-tailwind-classes.mjs` 闸门盯着死类名出现次数不得超过 **74**。
**新增样式一律写 scoped CSS + 令牌变量。**

## 1. 调性：power 深底工业风

**关键词：近黑微暖灰阶 · 单橙强调 · 等宽数字 · 克制**

本项目是 3D 场景编辑与仿真平台——工具软件，不是营销页。视觉建立在四条约束上：

1. **全站深色**：近黑微暖灰阶画布（不偏蓝、不发棕）。3D 视口与工具面板不再深浅打架。
2. **单橙主色**：品牌色 `#FF6101` 一族——深底上作文字与实底同值 `--accent`/`--accent-strong`，
   实底上配 `--accent-on` 深字（白字只有 ≈3:1，不达 AA）。琥珀 `--accent-2` 只作次强调（AI 演武场域）。
3. **背景有氛围但不抢戏**：画布是 `--bg-canvas` 纯深底 + 主橙低透明度星云光斑
   （异周期缓漂，`App.vue` 的 `.app-background`，reduced-motion 全静止）+
   alpha 0.05 的 48px 网格纹理。星云只是氛围层——信息主体永远比背景亮一档。
4. **信息层级优先**：面板底、边框、文字三级（`--text-1/2/3`）撑起层次；
   仿真参数、坐标、FPS、统计值走 `--font-mono` 等宽数字体系。

**反面清单**（构建闸门 `scripts/check-light-contrast.mjs` 直接拦）：

- `#ffd700` 金色 / `rgba(255,215,0,*)` —— 不属于项目色系（AI 域琥珀一律 `--accent-2` = #ffa117）
- `#f0f0f0` 浅灰前景 —— 浅色时代遗留
- 深底上的纯黑前景 `#000` —— 不可见（白底面板上则禁纯白前景）
- `@media` 块内出现任何颜色声明 —— 闸门只覆盖基础字号，media 里塞颜色无法对账
- 组件里写硬编码 hex —— 一律引用 `var(--token)`

## 2. 令牌层（真源：`src/assets/styles/tokens.css`）

### 2.1 基础层：近黑微暖灰阶

| Token | 值 | 角色 |
|---|---|---|
| `--ink-950` | `#0e0d0c` | 画布（最深） |
| `--ink-900` | `#131211` | 常规面板 |
| `--ink-850` | `#191715` | 浮起面板 / 卡片 |
| `--ink-800` | `#1f1c1a` | 输入框 / 嵌入区 |
| `--ink-700` | `#292522` | hover 面 / 强边框 |

### 2.2 语义层（组件只引用这一层）

| Token | 值 | 角色 / 对比度 |
|---|---|---|
| `--bg-canvas` / `--bg-panel` / `--bg-panel-raised` / `--bg-inset` | 映射 `--ink-*` | 画布 / 面板 / 浮起面板 / 嵌入区 |
| `--border-subtle` | `rgba(255,255,255,.08)` | 常规分隔 |
| `--border-strong` | `rgba(255,255,255,.16)` | 强分隔 / hover 边 |
| `--text-1` | `#ececeb` | 主文字（on canvas ≈16:1） |
| `--text-2` | `#a9a8a6` | 次级（≈9:1） |
| `--text-3` | `#85827e` | 弱化标注（≈5:1） |
| `--accent` | `#ff6101` | 强调**文字**（on canvas ≈6.3:1） |
| `--accent-strong` | `#ff6101` | 强调**底**（其上文字必须配 `--accent-on`，≈5.9:1） |
| `--accent-on` | `#1f1408` | 橙实底上的文字（深暖近黑，禁纯黑同源纪律） |
| `--accent-strong-hover` | `#ff7c2b` | 按钮悬停（深色下 hover 提亮，不是压暗） |
| `--accent-soft` | `rgba(255,97,1,.16)` | 选中底 / 高亮底 |
| `--accent-2` | `#ffa117` | 琥珀次强调（AI 域） |
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

**CSS 注释陷阱**：注释里写 `--bg-*/--text-*` 这类字符串，其中的 `*/` 会把注释
提前闭合，剩余文本变成非法 token、**毒化整个 :root 块**（tokens.css 曾因此整批
失效）。注释里写通配记号请用顿号或加空格：`--bg-*、--text-*`。

## 5. 常用模板

```css
/* 面板 */
.panel {
  background: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}
/* 主按钮：accent 实底 + 深字（白字只有 ≈3:1 不达 AA） */
.btn-primary { background: var(--accent-strong); color: var(--accent-on); }
.btn-primary:hover { background: var(--accent-strong-hover); }
/* 次按钮：透明底 + 描边 */
.btn-ghost { background: transparent; border: 1px solid var(--border-strong); color: var(--text-1); }
/* 输入框 */
.input { background: var(--bg-inset); border: 1px solid var(--border-subtle); color: var(--text-1); }
```

状态实底（`--danger-strong` / `--success-strong`）上的白字是**唯一允许的裸 `#ffffff` 前景**——
橙主色实底一律配 `var(--accent-on)`；元素自带底色时对比度闸门会按实际底色对账，
不要在无底色的深面上直接写白字。
