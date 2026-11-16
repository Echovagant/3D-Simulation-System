<!-- eslint-disable vue/multi-word-component-names -->

<template>
  <div class="overview-container">
    <PageHeader title="系统总览" lead="高效 · 精准 · 可视化的仿真解决方案" />

    <!-- 功能入口：动线主角，首屏 C 位。四个入口就是全站的分发枢纽 -->
    <section class="access-section" aria-label="功能入口">
      <div class="access-grid">
        <RouterLink v-for="entry in entries" :key="entry.to" :to="entry.to" class="access-card">
          <div class="access-icon"><i class="fa-solid" :class="entry.icon"></i></div>
          <div class="access-body">
            <h3>{{ entry.name }}</h3>
            <p>{{ entry.desc }}</p>
          </div>
          <i class="fa-solid fa-arrow-right access-arrow" aria-hidden="true"></i>
        </RouterLink>
      </div>
    </section>

    <!-- 核心特性：紧凑摘要，补充「这套工具为什么可信」 -->
    <section class="features-section" aria-label="核心特性">
      <h2 class="section-title">核心特性</h2>
      <div class="features-grid">
        <div v-for="f in features" :key="f.title" class="feature-item">
          <span class="icon"><i class="fa-solid" :class="f.icon"></i></span>
          <div class="feature-content">
            <h3>{{ f.title }}</h3>
            <p>{{ f.desc }}</p>
          </div>
        </div>
      </div>
    </section>
  </div>
</template>

<script lang="ts" setup name="Overview">
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/common/PageHeader.vue'

/*
 * 动线重排说明：
 * 旧版把 3D 标签云放在首屏 C 位（纯装饰、无导航语义、hover 效果引用
 * 未定义变量实际不生效），而真正的功能入口沉在页尾——进页面的人
 * 「看了个热闹，找不到门」。新版把四个入口卡提到首屏，特性摘要压成
 * 一条；标签云整体移除，它的「技术栈」信息由每张入口卡自身承载。
 */
interface Entry {
  to: string
  icon: string
  name: string
  desc: string
}

const entries: Entry[] = [
  { to: '/scene-editor', icon: 'fa-cubes', name: '场景编辑器', desc: '拖拽摆放基本体与模型，属性改完立刻写回刚体' },
  { to: '/simulation-lab', icon: 'fa-flask', name: '仿真实验室', desc: '固定步长物理仿真，批量扫描与服务端渲染' },
  { to: '/model-library', icon: 'fa-box-open', name: '模型资源库', desc: '9 个程序化生成的模型，下载或导入场景' },
  { to: '/ai-playground', icon: 'fa-robot', name: 'AI 演武场', desc: '智能体读感知自主移动，可选接入 LLM 决策' },
]

interface Feature {
  icon: string
  title: string
  desc: string
}

const features: Feature[] = [
  { icon: 'fa-cube', title: '三维场景实时渲染', desc: 'Three.js 高性能渲染，复杂场景实时绘制与交互' },
  { icon: 'fa-atom', title: '物理引擎精准模拟', desc: 'Rapier 刚体物理，前后端同一引擎、结果逐位一致' },
  { icon: 'fa-brain', title: 'AI 智能交互控制', desc: '规则式决策兜底，LLM 只提供意图、物理说了算' },
  { icon: 'fa-display', title: '多终端适配', desc: '桌面、平板与移动端同一套交互体验' },
]
</script>

<style scoped>
.overview-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 20px;
}

/* 入口卡：首屏 C 位。深色卡面 + hover 箭头位移，导航语义一眼可见 */
.access-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: var(--grid-gap);
}

.access-card {
  display: flex;
  align-items: flex-start;
  gap: 14px;
  padding: 20px;
  background: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  transition: border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
}

.access-card:hover {
  border-color: var(--accent);
  transform: translateY(-3px);
  box-shadow: var(--shadow-panel);
}

.access-icon {
  font-size: 22px;
  color: var(--accent);
  min-width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  border-radius: var(--radius-md);
}

.access-body {
  flex: 1;
  min-width: 0;
}

.access-body h3 {
  font-size: var(--text-lg);
  color: var(--text-1);
  margin-bottom: 4px;
}

.access-body p {
  font-size: var(--text-sm);
  color: var(--text-2);
  line-height: 1.55;
}

.access-arrow {
  align-self: center;
  color: var(--text-3);
  font-size: var(--text-sm);
  transition: transform 0.25s ease, color 0.25s ease;
}

.access-card:hover .access-arrow {
  color: var(--accent);
  transform: translateX(4px);
}

/* 焦点可达：入口卡是 RouterLink，键盘 tab 上去要有可见环 */
.access-card:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* 特性摘要：真实卡面（旧版透明底 + hover 阴影是「假卡片」语义） */
.features-section {
  margin-top: 48px;
}

.section-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-1);
  margin-bottom: 18px;
  letter-spacing: 0.02em;
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--grid-gap);
}

.feature-item {
  display: flex;
  gap: 14px;
  padding: 18px;
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
}

.feature-item .icon {
  font-size: 18px;
  color: var(--accent);
  min-width: 34px;
  height: 34px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-soft);
  border-radius: var(--radius-sm);
}

.feature-content h3 {
  font-size: var(--text-md);
  color: var(--text-1);
  margin-bottom: 4px;
}

.feature-content p {
  font-size: var(--text-sm);
  color: var(--text-2);
  line-height: 1.55;
}

/* 窄屏：单列化即可，入口卡自适应网格自动降列 */
@media (max-width: 480px) {
  .overview-container {
    padding: 20px 14px;
  }
}
</style>
