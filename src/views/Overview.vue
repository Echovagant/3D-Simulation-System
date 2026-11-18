<!-- eslint-disable vue/multi-word-component-names -->

<template>
  <div class="overview-stage">
    <!-- 复现项目早期版本的首页构图：中央面板 + 银条金字 + 黄胶囊入口。
         按设计审查简化（hero 元素 ≤4）：特性星标行与提示行移除，
         面板换深玻璃（白玻璃在白波浪区透白导致副标题看不清）。 -->
    <section class="hero-panel" aria-label="系统总览">
      <div class="title-bar">
        <h1>3D 仿真系统</h1>
      </div>
      <p class="lead">高效 · 精准 · 可视化的仿真解决方案</p>

      <nav class="entry-row" aria-label="功能入口">
        <RouterLink to="/scene-editor" class="pill"><i class="fa-solid fa-cubes" aria-hidden="true"></i>场景编辑器</RouterLink>
        <RouterLink to="/simulation-lab" class="pill"><i class="fa-solid fa-flask" aria-hidden="true"></i>仿真实验室</RouterLink>
        <RouterLink to="/model-library" class="pill"><i class="fa-solid fa-box-open" aria-hidden="true"></i>模型库</RouterLink>
        <RouterLink to="/ai-playground" class="pill"><i class="fa-solid fa-robot" aria-hidden="true"></i>AI 演武场</RouterLink>
      </nav>
    </section>
  </div>
</template>

<script lang="ts" setup name="Overview">
import { RouterLink } from 'vue-router'

/*
 * 复现说明：老版首页的构图（中央面板、银色渐变标题条上金光大字、
 * 黄胶囊导航）保留；特性星标行与「点击上方导航栏」提示按设计审查
 * 移除（hero 只留标题/副题/入口三元素，简化即更好的那部分）。
 * 标题条的金字-on-银条低对比是有意的品牌装饰（老版原样），
 * 不做正文语义使用，故不进对比度对账。
 */
</script>

<style scoped>
.overview-stage {
  min-height: calc(100vh - 60px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  box-sizing: border-box;
}

/* 中央面板：深色玻璃（白玻璃在白波浪区透白，副标题会隐形——这是
   「字看不清」的根因），color-mix 从令牌派生不做硬编码。
   回退值经 --hero-surface 切换：@media 里只动自定义属性，
   颜色声明留在基础规则（对比度闸门规则）。 */
.overview-stage {
  --hero-surface: color-mix(in srgb, var(--ink-950) 62%, transparent);
}

.hero-panel {
  width: min(920px, 100%);
  padding: 36px 44px 34px;
  background: var(--hero-surface);
  backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  -webkit-backdrop-filter: blur(var(--glass-blur)) saturate(1.3);
  border: 1px solid var(--border-subtle);
  border-radius: 18px;
  box-shadow: var(--shadow-panel);
  text-align: center;
}

@supports not ((backdrop-filter: blur(1px)) or (color-mix(in srgb, red, blue))) {
  .hero-panel {
    background: var(--bg-panel-raised);
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

@media (prefers-reduced-transparency: reduce) {
  .overview-stage {
    --hero-surface: var(--bg-panel-raised);
  }

  .hero-panel {
    backdrop-filter: none;
    -webkit-backdrop-filter: none;
  }
}

/* 银色渐变标题条：老版原样；金晕收敛到弱光（强外发光=曝光过高） */
.title-bar {
  max-width: 760px;
  margin: 0 auto 20px;
  padding: 14px 20px;
  border-radius: var(--radius-lg);
  background: linear-gradient(180deg, #fdfdfd 0%, #d9d9d6 55%, #bfbfbc 100%);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.9), 0 4px 14px rgba(0, 0, 0, 0.4);
}

.title-bar h1 {
  font-size: 44px;
  line-height: 1.15;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--accent-strong);
  text-shadow: 0 1px 0 rgba(146, 116, 0, 0.35);
}

.lead {
  font-size: var(--text-lg);
  color: var(--text-1);
  letter-spacing: 0.04em;
  margin-bottom: 28px;
}

/* 黄胶囊入口：老版导航胶囊的黄底黑字，四枚直达 */
.entry-row {
  display: flex;
  justify-content: center;
  flex-wrap: wrap;
  gap: 12px;
}

.pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 11px 24px;
  border-radius: 999px;
  background-color: var(--accent-strong);
  color: var(--accent-on);
  font-size: var(--text-md);
  font-weight: 700;
  letter-spacing: 0.02em;
  box-shadow: 0 4px 14px rgba(255, 212, 0, 0.22);
  transition: transform 0.22s ease, box-shadow 0.22s ease, background-color 0.22s ease;
}

.pill:hover {
  background-color: var(--accent-strong-hover);
  transform: translateY(-2px);
  box-shadow: 0 8px 22px rgba(255, 212, 0, 0.34);
}

.pill:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 3px;
}

.pill i {
  font-size: var(--text-sm);
}

/* 响应式：窄屏标题缩档 */
@media (max-width: 760px) {
  .hero-panel {
    padding: 26px 20px 24px;
  }

  .title-bar h1 {
    font-size: 32px;
  }
}
</style>
