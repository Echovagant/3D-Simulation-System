<!-- eslint-disable vue/multi-word-component-names -->

<template>
  <div class="overview-container">
    <!-- 页面标题区域 -->
    <div class="header-section">
      <h1 class="title">3D仿真系统</h1>
      <p class="subtitle">高效·精准·可视化的仿真解决方案</p>
    </div>
    <div style="text-align: center; margin-bottom: 20px !important;">
      <button class="quick-know-btn" @click="handleScrollDown">快速了解</button>
    </div>


    <!-- 3D旋转标签云 - 展示核心技术和特性 -->
    <div class="tag-cloud-container">
      <div class="tag-cloud">
        <div
          class="tag"
          :style="{ transform: `rotateY(${i * (360 / tags.length)}deg) translateZ(200px)` }"
          v-for="(tag, i) in tags"
          :key="i"
        >
          {{ tag }}
        </div>
      </div>
    </div>

    <!-- 核心特性 -->
    <div class="features-section">
      <h2 class="section-title">核心特性</h2>
      <div class="features-grid">
        <div class="feature-item">
          <span class="icon">🌐</span>
          <div class="feature-content">
            <h3>三维场景实时渲染</h3>
            <p>高性能渲染引擎，支持复杂场景实时绘制与交互</p>
          </div>
        </div>
        <div class="feature-item">
          <span class="icon">⚛️</span>
          <div class="feature-content">
            <h3>物理引擎精准模拟</h3>
            <p>真实的物理碰撞、重力和动力学效果模拟</p>
          </div>
        </div>
        <div class="feature-item">
          <span class="icon">🤖</span>
          <div class="feature-content">
            <h3>AI智能交互控制</h3>
            <p>人工智能驱动的场景元素行为与决策系统</p>
          </div>
        </div>
        <div class="feature-item">
          <span class="icon">📱</span>
          <div class="feature-content">
            <h3>多终端适配兼容</h3>
            <p>完美支持桌面端、平板和移动设备的交互体验</p>
          </div>
        </div>
      </div>
    </div>

    <!-- 功能快捷入口 -->
    <div class="quick-access-section">
      <h2 class="section-title">快速导航</h2>
      <div class="access-grid">
        <RouterLink to="/scene-editor" class="access-card">
          <div class="access-icon">🛠️</div>
          <h3>场景编辑器</h3>
          <p>创建和定制3D虚拟环境</p>
        </RouterLink>
        <RouterLink to="/simulation-lab" class="access-card">
          <div class="access-icon">🔬</div>
          <h3>仿真实验室</h3>
          <p>运行和分析物理模拟</p>
        </RouterLink>
        <RouterLink to="/model-library" class="access-card">
          <div class="access-icon">📦</div>
          <h3>模型库</h3>
          <p>浏览和管理3D模型资源</p>
        </RouterLink>
        <RouterLink to="/ai-playground" class="access-card">
          <div class="access-icon">🧠</div>
          <h3>AI演武场</h3>
          <p>体验AI与3D环境交互</p>
        </RouterLink>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup name="Overview">
import { onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router' // 引入RouterLink类型

// 标签云数据 - 展示系统相关技术和特性
const tags = ref([
  'Three.js',
  '物理引擎',
  'WebGL',
  '实时渲染',
  '3D建模',
  '碰撞检测',
  '人工智能',
  '机器学习',
  '粒子系统',
  '光影追踪',
  'VR支持',
  '材质系统',
  '动画曲线',
  '流体模拟',
  '刚体动力学',
  '场景优化',
])

const handleScrollDown = () => {
  // 1. ：这里定义下滑目标定位到“核心特性区域”
  const targetSection = document.querySelector('.features-section') as HTMLElement;
  if (!targetSection) return; // 若目标区域不存在，避免报错
  if (targetSection) {
    // 使用scrollIntoView实现平滑滚动到目标区域
    targetSection.scrollIntoView({ behavior: 'smooth' });
  }
}

// 实现3D标签云旋转效果
onMounted(() => {
  // 明确指定为HTMLElement类型
  const tagCloud = document.querySelector('.tag-cloud') as HTMLElement | null
  if (!tagCloud) return

  let startX = 0
  let startY = 0
  let isDragging = false
  let currentRotationX = -10
  let currentRotationY = 0

  // 自动旋转效果
  const autoRotate = () => {
    if (!isDragging) {
      currentRotationY += 0.3// 这行控制旋转速度
      tagCloud.style.transform = `rotateX(${currentRotationX}deg) rotateY(${currentRotationY}deg)`
    }
    requestAnimationFrame(autoRotate)
  }

  // 鼠标交互 - 指定为MouseEvent类型
  tagCloud.addEventListener('mousedown', (e: MouseEvent) => {
    isDragging = true
    startX = e.clientX
    startY = e.clientY
  })

  document.addEventListener('mousemove', (e: MouseEvent) => {
    if (!isDragging) return

    const deltaX = e.clientX - startX
    const deltaY = e.clientY - startY

    currentRotationY += deltaX * 0.5
    currentRotationX -= deltaY * 0.5

    // 限制X轴旋转角度，避免过度翻转
    currentRotationX = Math.max(-30, Math.min(30, currentRotationX))

    tagCloud.style.transform = `rotateX(${currentRotationX}deg) rotateY(${currentRotationY}deg)`

    startX = e.clientX
    startY = e.clientY
  })

  document.addEventListener('mouseup', () => {
    isDragging = false
  })

  document.addEventListener('mouseleave', () => {
    isDragging = false
  })

  // 触摸设备支持 - 指定为TouchEvent类型
  tagCloud.addEventListener('touchstart', (e: TouchEvent) => {
    if (e.touches.length === 1) {
      isDragging = true
      startX = e.touches[0].clientX
      startY = e.touches[0].clientY
    }
  })

  document.addEventListener('touchmove', (e: TouchEvent) => {
    if (!isDragging || e.touches.length !== 1) return

    const deltaX = e.touches[0].clientX - startX
    const deltaY = e.touches[0].clientY - startY

    currentRotationY += deltaX * 0.5
    currentRotationX -= deltaY * 0.5

    currentRotationX = Math.max(-30, Math.min(30, currentRotationX))

    tagCloud.style.transform = `rotateX(${currentRotationX}deg) rotateY(${currentRotationY}deg)`

    startX = e.touches[0].clientX
    startY = e.touches[0].clientY
  })

  document.addEventListener('touchend', () => {
    isDragging = false
  })

  autoRotate()
})
</script>

<style scoped>
/* 样式部分保持不变 */
.overview-container {
  max-width: 1200px;
  margin: 0 auto;
  padding: 40px 20px;
  background-color: transparent;
  border-radius: 12px;
  backdrop-filter: none;
}

/* 标题区域样式 */
.header-section {
  text-align: center;
  margin-bottom: 60px;
  padding: 10px 20px;
  margin-top: 10px;
}

.title {
  font-size: 48px;
  color: #ffd700;
  margin-bottom: 15px;
  letter-spacing: 5px;
  text-shadow: 0 0 15px rgba(255, 215, 0, 0.7);
  animation: fadeIn 1.5s ease-out;
}

.subtitle {
  font-size: 20px;
  color: #f0f0f0;
  opacity: 0.9;
  max-width: 700px;
  margin: 0 auto;
}

/* 3D标签云样式 */
.tag-cloud-container {
  width: 100%;
  height: 400px;
  display: flex;
  justify-content: center;
  align-items: center;
  margin: 20px 0 80px;
  perspective: 1000px;
}

.tag-cloud {
  position: relative;
  width: 100%;
  height: 100%;
  transform-style: preserve-3d;
  transition: transform 0.5s ease;
}

.tag {
  position: absolute;
  top: 50%;
  left: 50%;
  padding: 8px 16px;
  background-color: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 215, 0, 0.3);
  border-radius: 20px;
  color: #fff;
  font-size: 14px;
  transform-origin: 0 0;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  backface-visibility: hidden;
}

.tag:hover {
  background-color: rgba(255, 215, 0, 0.8);
  color: #000;
  transform: rotateY(var(--rotation)) translateZ(220px) scale(1.2);
  z-index: 10;
}

/* 特性区域样式 */
.features-section {
  margin-bottom: 80px;
}

.section-title {
  text-align: center;
  color: #ffd700;
  font-size: 28px;
  margin-bottom: 40px;
  text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
}

.features-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
  gap: 30px;
}

.feature-item {
  background-color: transparent;
  border-radius: 10px;
  padding: 25px;
  display: flex;
  gap: 15px;
  transition:
    transform 0.3s ease,
    box-shadow 0.3s ease;
}

.feature-item:hover {
  transform: translateY(-5px);
  box-shadow: 0 10px 20px rgba(0, 0, 0, 0.3);
}

.feature-item .icon {
  font-size: 32px;
  color: #ffd700;
  min-width: 40px;
  margin-top: 5px;
}

.feature-content h3 {
  color: #fff;
  margin-bottom: 10px;
  font-size: 18px;
}

.feature-content p {
  color: #f0f0f0;
  opacity: 0.8;
  font-size: 14px;
  line-height: 1.6;
}

/* 快捷入口样式 */
.quick-access-section {
  margin-bottom: 40px;
}

.access-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 25px;
}

.access-card {
  background-color: transparent;
  border-radius: 10px;
  padding: 30px 20px;
  text-align: center;
  color: #fff;
  text-decoration: none;
  transition: all 0.3s ease;
  border: 1px solid transparent;
}

.access-card:hover {
  background-color: rgba(255, 215, 0, 0.1);
  border-color: rgba(255, 215, 0, 0.5);
  transform: translateY(-5px) scale(1.02);
}

.access-icon {
  font-size: 40px;
  margin-bottom: 15px;
  color: #ffd700;
}

.access-card h3 {
  margin-bottom: 10px;
  font-size: 18px;
}

.access-card p {
  font-size: 14px;
  opacity: 0.8;
}

/* 动画效果 */
@keyframes fadeIn {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式调整 */
@media (max-width: 768px) {
  .overview-container {
    padding: 20px 15px;
  }

  .title {
    font-size: 32px;
    letter-spacing: 3px;
  }

  .tag-cloud-container {
    height: 300px;
    margin: 20px 0 50px;
  }

  .tag {
    font-size: 12px;
    padding: 5px 10px;
  }

  .section-title {
    font-size: 24px;
  }

  .features-section,
  .quick-access-section {
    margin-bottom: 50px;
  }
}

@media (max-width: 480px) {
  .features-grid,
  .access-grid {
    grid-template-columns: 1fr;
  }

  .tag-cloud-container {
    height: 250px;
  }
}

.quick-know-btn {
  background-color: transparent;
  backdrop-filter: none;

  /* 清除默认按钮样式，避免干扰 */
  border: 1px solid #ffd700; /* 金色边框（呼应页面主题色） */
  color: #ffd700; /* 金色文字（呼应标题/图标色） */
  padding: 10px 24px; /* 按钮内边距，保证点击区域 */
  font-size: 16px; /* 字体大小，保证可读性 */
  border-radius: 30px; /* 圆角，提升美观度 */
  cursor: pointer; /* 鼠标悬浮显示“手”形，提示可点击 */

  /* 交互动效：hover时轻微变化，提升体验 */
  transition: all 0.3s ease;
}
/* 按钮hover效果（可选，增强交互感） */
.quick-know-btn:hover {
  background-color: rgba(255, 215, 0, 0.1); /* 淡金色背景 */
  transform: translateY(-2px); /* 轻微上浮 */
  box-shadow: 0 4px 12px rgba(255, 215, 0, 0.2); /* 金色阴影 */
}
/* 按钮点击反馈（可选，增强手感） */
.quick-know-btn:active {
  transform: translateY(0); /* 点击后复位 */
}

</style>
