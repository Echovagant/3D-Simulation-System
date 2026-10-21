# Design System: 3D-Simulation-System

> 本文件是本项目**唯一的设计令牌真源**。新增界面元素时，请引用这里的令牌名，不要写死颜色与尺寸。
> 约定与门禁见 [Super Design skill](https://github.com/Eldergenix/SUPER-DESIGN)（MIT，本地安装于 `~/.minimax/skills/super-design`）。

## 0. Meta

```yaml
version: 1.0.0
framework: vue-3.5 + vite-6 + hand-written-css
css_framework: plain-css (css-variables, NO Tailwind)
component_library: none
theme_modes: light
dark_mode_strategy: not-implemented (本项目当前只有浅色主题)
tokens_source: src/assets/styles/app-global.css
```

**关于 Tailwind**：本仓库**没有**接 Tailwind（无依赖、无 postcss、无 tailwind.config）。
模板里任何 `flex-1` / `lg:col-span-6` / `h-[calc(100%-46px)]` 之类的类名都是**死类名**、不生效。
`scripts/check-tailwind-classes.mjs` 闸门盯着死类名数量不得超过 757。
**新增样式一律走 CSS 变量，不要写 Tailwind 工具类。**

## 1. Brand Narrative & Philosophy

**品牌关键词：靛紫 · 浅色科技网络 · 克制**

本项目是一个**工程化**的 3D 场景编辑与仿真平台，不是玩具 demo。它的视觉语言建立在三个约束上：

1. **浅色优先**：3D 视口本身是深色的（需要对比），界面层一律浅色，避免深浅打架。
2. **靛紫单主色**：全站只有一个品牌色 `#6E5AF0`，它同时是导航图标、强调边框、标签底色。
   琥珀 `#ffa117` 只用于"目标/高亮"语义，且已因对比度不足（白底 2.03:1）改为深琥珀 `#96560a`。
3. **网络即背景**：背景是浅色靛紫科技网络（Canvas 2D 绘制），透明度极低（0.035–0.55），
   只提供纵深，不与内容争夺注意力。

**反面清单**（这些在浅色底上都是错色，已被 `scripts/check-overview-contrast.mjs` 列为禁用色）：

- `#ffd700` 金色 —— 不属于本项目色系，且浅底上几乎不可读
- 纯白 `#fff` 作为浅底上的前景色 —— 不可见
- 浅灰 `#f0f0f0` 作为浅底上的前景色 —— 不可见

## 2. Color System

### 2.1 Primitive palette（原始值）

| 名称 | 值 | 用途 |
|---|---|---|
| Indigo 500 | `#6E5AF0` | 品牌主色（`rgb(110, 90, 240)`） |
| Indigo 700 | `#4B37C9` | 靛紫加深，浅底上仍达 AA |
| Indigo 050 | `#E9E8FB` | 靛紫浅底（标签、徽章底） |
| Indigo 100 | `#E1DFFA` | 靛紫 hover 浅底 |
| Slate 900 | `#333333` | 正文 |
| Slate 600 | `#666666` | 次级文字 |
| Cloud 050 | `#F7F8FC` | 页面底色 |
| Cloud 100 | `#FFFFFF` | 卡片 / 面板 |
| Cloud 200 | `#E4E9F5` | 导航 active 底 / 边框 |
| Amber 700 | `#96560A` | 目标色（深琥珀，AA 合规） |
| Neutral 200 | `#DDDDDD` | 分隔线 |
| Neutral 100 | `#F5F5F5` | 轨道 / 占位底 |

### 2.2 Semantic layer（组件只引用这一层）

> 本项目**只有浅色主题**，所以 Light / Dark 两列同值。深色模式尚未实现（见 §0）。

| Token | Light | Dark | Role | 实测对比度 |
|---|---|---|---|---|
| `--color-bg` | `#F7F8FC` | `#F7F8FC` | 页面底 | — |
| `--color-surface` | `#FFFFFF` | `#FFFFFF` | 卡片 / 面板 | — |
| `--color-surface-raised` | `#FFFFFF` | `#FFFFFF` | 浮层（弹窗 / 下拉） | — |
| `--color-fg` | `#333333` | `#333333` | 正文 | 11.91:1 on bg |
| `--color-fg-muted` | `#666666` | `#666666` | 次级正文 | 5.41:1 on bg |
| `--color-fg-subtle` | `#8A8A99` | `#8A8A99` | 弱化说明 | 3.40:1 on surface |
| `--color-fg-on-accent` | `#FFFFFF` | `#FFFFFF` | 主色底上的文字 | 4.79:1 on accent |
| `--color-border` | `#E4E9F5` | `#E4E9F5` | 装饰性分隔 | 1.16:1 on surface（装饰用途） |
| `--color-border-strong` | `#8A8A99` | `#8A8A99` | **作为唯一指示的 UI 边界** | 3.40:1 on surface |
| `--color-border-subtle` | `#F5F5F5` | `#F5F5F5` | 极弱分隔 / 骨架屏 | — |
| `--color-accent` | `#6E5AF0` | `#6E5AF0` | 品牌主色 | 4.51:1 on bg |
| `--color-accent-hover` | `#4B37C9` | `#4B37C9` | 靛紫加深 | 6.47:1 on accent-subtle |
| `--color-accent-subtle` | `#E9E8FB` | `#E9E8FB` | 靛紫浅底 | — |
| `--color-focus-ring` | `#6E5AF0` | `#6E5AF0` | 焦点环 | 4.79:1 on surface |
| `--color-target` | `#96560A` | `#96560A` | 目标 / 高亮（深琥珀） | 5.78:1 on surface |
| `--color-target-subtle` | `#FFF3E0` | `#FFF3E0` | 目标浅底 | — |
| `--color-danger` | `#C62828` | `#C62828` | 危险（新增语义） | 5.62:1 on surface |
| `--color-danger-subtle` | `#F5C6CB` | `#F5C6CB` | 危险浅底 | — |
| `--color-success` | `#2E7D32` | `#2E7D32` | 成功（新增语义） | 5.13:1 on surface |
| `--color-success-subtle` | `#E8F5E9` | `#E8F5E9` | 成功浅底 | — |
| `--color-warning` | `#B26A00` | `#B26A00` | 警告（新增语义） | 4.62:1 on surface |
| `--color-warning-subtle` | `#FFF4E5` | `#FFF4E5` | 警告浅底 | — |
| `--color-info` | `#3498DB` | `#3498DB` | 信息（新增语义） | 2.79:1 on surface ⚠️ |
| `--color-info-subtle` | `#E1F0FA` | `#E1F0FA` | 信息浅底 | — |

> ⚠️ `--color-info` `#3498DB` 在白底上只有 **2.79:1**，**不可用于正文**（需 ≥4.5:1）。
> 要么只用于图标/边框这类 UI 元素，要么换成 `#2166AC`（5.10:1）。本项目当前还没用到信息态，**先按 UI 元素用**。

### 2.2.1 使用方式

```css
:root {
  --color-bg: #F7F8FC;
  --color-surface: #FFFFFF;
  --color-fg: #333333;
  --color-fg-muted: #666666;
  --color-border: #E4E9F5;
  --color-border-strong: #8A8A99;
  --color-accent: #6E5AF0;
  --color-accent-hover: #4B37C9;
  --color-accent-subtle: #E9E8FB;
  --color-focus-ring: #6E5AF0;
  --color-target: #96560A;
  --color-danger: #C62828;
  --color-success: #2E7D32;
  --color-warning: #B26A00;
  --color-info: #3498DB;
}
```

### 2.3 语义色对照表（WCAG 2.2 AA 实测值）

| 前景 | 背景 | 对比度 | 判定 |
|---|---|---|---|
| `--color-fg` `#333333` | `--color-bg` `#F7F8FC` | **11.91:1** | AA（正文） |
| `--color-fg-muted` `#666666` | `--color-bg` `#F7F8FC` | **5.41:1** | AA（正文） |
| `--color-accent` `#6E5AF0` | `--color-bg` `#F7F8FC` | **4.51:1** | AA（正文/图标） |
| `--color-accent-hover` `#4B37C9` | `--color-accent-subtle` `#E9E8FB` | **6.47:1** | AA |
| `--color-accent` `#6E5AF0` | `--color-accent-subtle` `#E1DFFA` | **6.16:1** | AA |
| `--color-target` `#96560A` | `#FFFFFF` | **5.78:1** | AA |
| `--color-target` `#96560A` | `#E4E9F5` | **4.76:1** | AA |
| `--color-focus-ring` `#6E5AF0` | `#FFFFFF` | **4.79:1** | ≥3:1 ✅ |

> 表格由 `scripts/check-overview-contrast.mjs` 在构建时校验，改色值会让构建失败。

### 2.4 Forced-colors mode（Windows 高对比度）

在 `forced-colors: active` 下，浏览器会丢弃作者颜色、只保留系统色。此时**必须**让结构仍然可辨：

```css
@media (forced-colors: active) {
  .nav-item.active .icon::before { border: 2px solid ButtonText; }
  .btn-primary { border: 2px solid ButtonText; }
}
```

**不要**在 `forced-colors` 下用 `forced-color-adjust: none` 强行保留品牌色——那会破坏用户的系统设置。

### 2.5 已知缺口

**① 状态色尚未落地。** `--color-danger` / `--color-success` / `--color-warning` / `--color-info` 是**新增语义**。
当前代码里还没有成体系的成功/警告/错误状态色（只有模板遗留的 `#f5c6cb`、`#3498db` 等零散值）。
**新增交互时优先用这四个语义名**，并同步把散落的遗留色替换掉。

**② 遗留边框色达不到 UI 边界阈值。** 代码里 `#DDDDDD`（8 处）、`#E0E0E0`（7 处）作为边框使用时，
与白底的对比度只有 1.4–1.5:1，**不足以作为"唯一的边界指示"**。它们应归为装饰性 `--color-border`；
凡是边界本身就是唯一可交互线索的地方（输入框边框、选中态描边），改用 `--color-border-strong` `#8A8A99`（3.40:1）。

**③ 模板遗留色需要一次清理。** 早期模板的扁平化配色仍在代码里：
`#2c3e50`（9 处）、`#34495e`（7 处）、`#3d5a7c`（3 处）、`#3498db`（6 处）、`#ffd700`（12 处）。
其中 `#ffd700` 已被总览页对比度闸门列为禁用色。清理时按语义映射到上表的令牌名。


## 3. Typography

### 3.1 Font families

```css
--font-sans: 'Microsoft YaHei', 'Arial', sans-serif;
--font-mono: 'Consolas', 'SFMono-Regular', monospace;
```

中文优先字体栈（`Microsoft YaHei` 先行），西文回退 `Arial`。
**不引入 webfont**：外链字体是渲染阻塞源，且本项目到海外 CDN 的链路不稳定。

### 3.2 实际使用的字号阶梯

从代码统计出的真实阶梯（不是理想值，是现状）：

| 令牌 | 值 | 实际用途 |
|---|---|---|
| `--text-2xs` | 11px | 极小标签 |
| `--text-xs` | 12px | 徽章 / 次要说明 |
| `--text-sm` | 13px | 紧凑正文 |
| `--text-base` | 14px | **正文默认**（导航、面板） |
| `--text-md` | 16px | 卡片标题 |
| `--text-lg` | 18px | 区块标题 |
| `--text-xl` | 20px | 面板标题 |
| `--text-2xl` | 24px | 页面副标题 |
| `--text-3xl` | 28px | 区块主标题 |
| `--text-4xl` | 32px | 页面主标题（总览页） |
| `--text-5xl` | 48px | 展示级标题（总览页） |

> 缺口：`--text-2xl`–`--text-4xl` 在 token 层尚未定义（只有 11/12/13/14/16/18/20/24/28/32/40/48 的实际值），
> 补齐后本页表格即成为真源。

### 3.3 字重

`400`（正文）/ `500`（强调）/ `600`（标题）/ `700`（强强调）。中文场景下 400 与 500 差别很小，
**不要**用 300 以下（中文细体在小字号下会糊）。

## 4. Spacing

### 4.1 Base scale（4px 网格）

`--space-1: 4px` · `--space-2: 8px` · `--space-3: 12px` · `--space-4: 16px` · `--space-5: 20px` · `--space-6: 24px` · `--space-8: 32px` · `--space-10: 40px` · `--space-12: 48px`

### 4.2 逻辑属性（i18n / RTL）

间距一律用 `margin-inline` / `padding-inline` / `inset-inline`，
**不要**写 `margin-left` / `padding-right`。本项目目前只有中文，但这是零成本的未来兼容。

## 5. Radius & Shape

```css
--radius-sm: 4px;    /* 标签、内联元素（代码里最常用，14 处） */
--radius-md: 8px;    /* 按钮、输入框 */
--radius-lg: 12px;   /* 卡片 */
--radius-xl: 20px;   /* 大面板 */
--radius-full: 9999px; /* 头像 / 药丸 */
```

实际使用：4px(14) · 6px(3) · 8px(11) · 10px(5) · 12px(5) · 16px(1) · 20px(1) · 30px(1) · 50px(1)。
**新代码只允许 4 / 8 / 12 / 20 / 9999 这五档**，其余视为遗留。

## 6. Elevation & Shadow

```css
--shadow-sm: 0 1px 2px rgba(17, 24, 39, 0.06);
--shadow-md: 0 4px 12px rgba(17, 24, 39, 0.08);
--shadow-lg: 0 12px 32px rgba(17, 24, 39, 0.10);
```

### Focus ring（双层，保证任意底色上 ≥3:1）

```css
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-surface), 0 0 0 5px var(--color-focus-ring);
}
```

内层用 `--color-surface` 把焦点环与元素本身隔开，外层用 `--color-focus-ring`。
这样焦点环在**任何底色**上都保持 3:1 对比（内层造出一圈表面色）。

## 7. Motion

### 7.1 Duration & easing

```css
--duration-fast: 120ms;
--duration-base: 200ms;
--duration-slow: 400ms;
--ease-out: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in: cubic-bezier(0.4, 0, 1, 1);
```

### 7.2 规则

- 只动 `transform` 和 `opacity`。**不要**动 `width` / `height` / `top` / `left`（会触发布局）。
- 时长 ≤ 300ms（`--duration-slow` 仅用于页面级淡入）。
- 必须挂在 `prefers-reduced-motion` 之下：

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

## 8. Component State Matrix

每个交互元素必须覆盖这些状态，缺一个就是缺陷。

### 8.1 Button

| 状态 | 表现 | 令牌 |
|---|---|---|
| `hover` | 靛紫加深 | `--color-accent-hover` |
| `focus-visible` | 双层焦点环 | `--color-focus-ring` + `--color-surface` |
| `active` | 轻微缩放 `scale(0.98)` | transform only |
| `disabled` | 降低对比 + 禁止指针事件 | `opacity: 0.5` |
| `loading` | `aria-busy="true"` + 禁止重复提交 | — |

### 8.2 Input

| 状态 | 令牌 |
|---|---|
| `hover` | `--color-border-strong` |
| `focus-visible` | `--color-focus-ring` |
| `error` | `--color-danger` + `--color-danger-subtle` |
| `readonly` | `--color-fg-muted` + `cursor: not-allowed` |
| `disabled` | `--color-border-subtle` + `opacity: 0.6` |

### 8.3 屏幕状态

`loading`（骨架屏用 `--color-border-subtle` 派生，不写死灰）· `empty` · `error` · `success`。
骨架屏颜色必须由 surface 派生，不要硬编码。

## 9. Layout & Responsive

### 9.1 Breakpoints

`320` · `375` · `768` · `1024` · `1440` · `1920`

### 9.2 规则

- 布局在 `320px` 下**不得横向滚动**。
- 侧边导航在 `≤768px` 收成抽屉（`inset-inline-start` 定位）。
- 3D 视口高度必须**有确定值**（当前 560px）——曾因 `h-[calc(100%-46px)]`（无效 CSS）导致高度退化成 `auto`，
  画布与布局互相顶高成 1338×1849px 的反馈循环。**写视口高度时用真实 CSS，不要用无效 calc。**
- 3D 画布尺寸用 `getBoundingClientRect()` 读取，不要读 `window.innerWidth`（视口 ≠ 容器）。

## 10. Agent Prompt Guide

### 10.1 写界面时的正确姿势

```
按 DESIGN.md 的令牌写这个组件：所有颜色引用 --color-* 名，所有间距引用 --space-*，
所有字号引用 --text-*，所有圆角引用 --radius-*。
交互元素补齐 hover / focus-visible / active / disabled（按钮加 loading，输入框加 error 与 readonly）。
焦点环用双层 box-shadow。不要写死任何色值与魔法数字。
```

### 10.2 起步方式

本项目已有锁定的令牌层，**直接从 `DESIGN.md` 开始**，不要从截图反推。

### 10.3 迭代

改完跑一次校验：

```bash
# DESIGN.md 本身
bash ~/.minimax/skills/super-design/scripts/lint-design-md.sh DESIGN.md
node ~/.minimax/skills/super-design/scripts/contrast-check.mjs DESIGN.md

# 本项目自带的门禁（改完 UI 必跑）
npm run verify:overview-contrast   # 总览页对比度
npm run build                      # 含全部闸门
```

## 附：品牌标识

站点标识的**矢量母版**是 `src/assets/images/logo.svg`。它由 `npm run gen:brand`
栅格化成 `src/assets/images/logo.png`（页头用）与 `public/favicon.ico`——
**要改设计就改母版 SVG，然后重跑生成命令**，不要手改那两个产物。

### 设计语义

| 元素 | 含义 |
| --- | --- |
| 等距立方体 | 3D 场景里的一个对象 |
| 引出标注线 + 琥珀节点 | 对这个对象做测量 / 分析 / 仿真——项目的内核 |
| 靛紫三面 | `--color-accent` / `--color-accent-hover` / 浅靛，靠明度差分出三个受光面 |

### 配色

| 用途 | 值 | 对应令牌 |
| --- | --- | --- |
| 顶面 | `#8E80F7` | 浅靛（accent 的高光面） |
| 左面 | `#6E5AF0` | `--color-accent` |
| 右面 | `#4B37C9` | `--color-accent-hover` |
| 引出线 | `#6E5AF0` | `--color-accent` |
| 节点 | `#FFA117` | 琥珀（深底上的强调色） |

琥珀只出现在一枚节点上——**大面积用琥珀会毁掉主色的单一性**。

### 尺寸适配

标识在 16px 仍要成立（favicon 32px、页头 46px、圆形徽标）。构图刻意留出
四周安全边距：方形与圆形裁切下都不切到节点。

## 附：门禁清单

| 脚本 | 守什么 |
|---|---|
| `scripts/check-overview-contrast.mjs` | 总览页 13 个前景的 WCAG AA + 禁用色 |
| `scripts/check-no-babylon.mjs` | Babylon 残留（背景已换成 Canvas 2D） |
| `scripts/check-no-emit-artifacts.mjs` | `src/` 下的编译产物污染 |
| `scripts/check-docs.mjs` | 文档不能是 0 字节 |
| `scripts/check-entry-bundle-size.mjs` | 入口 chunk 体积上限 |
| `scripts/check-dead-deps.mjs` | 零引用依赖不得复活（20 项） |
| `scripts/check-tailwind-classes.mjs` | 死 Tailwind 类名不得增加（基线 757） |
