<template>
  <div class="app">
    <!-- 背景三层：深空底色 + 星云漂移（纯 CSS 合成层动画）+ 视差网格 -->
    <div class="app-background">
      <div class="nebula nebula-1"></div>
      <div class="nebula nebula-2"></div>
      <div class="nebula nebula-3"></div>
      <div class="parallax-grid" :style="gridStyle"></div>
    </div>
    <div class="app-container">
      <!-- 侧边导航 -->
      <aside class="shell" v-show="showNavigate()" :class="{ show: sidebarShow }">
        <div class="sidebar-content">
          <!-- 导航Logo区域 -->
          <ul class="nav-list">
            <li class="nav-item active" id="nav-logo">
              <a href="#" class="nav-link" @click.prevent>
                <div class="icon">
                  <div class="imageBox">
                    <img src="./assets/images/logo.svg" alt="3D仿真系统" class="logo-img" />
                  </div>
                </div>
                <div class="text">3D仿真系统</div>
              </a>
            </li>

            <!-- 导航链接列表 -->
            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'overview' }"
              @click="setActiveNav('overview')"
            >
              <RouterLink to="/overview" class="nav-link" title="返回主门户">
                <div class="icon"><i class="fa-solid fa-house"></i></div>
                <div class="text">总览</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'scene-editor' }"
              @click="setActiveNav('scene-editor')"
            >
              <RouterLink to="/scene-editor" class="nav-link" title="构建和编辑3D场景">
                <div class="icon"><i class="fa-solid fa-cubes"></i></div>
                <div class="text">场景编辑器</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'simulation-lab' }"
              @click="setActiveNav('simulation-lab')"
            >
              <RouterLink to="/simulation-lab" class="nav-link" title="运行和观察物理仿真">
                <div class="icon"><i class="fa-solid fa-flask"></i></div>
                <div class="text">仿真实验室</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'model-library' }"
              @click="setActiveNav('model-library')"
            >
              <RouterLink to="/model-library" class="nav-link" title="管理3D资产">
                <div class="icon"><i class="fa-solid fa-box-open"></i></div>
                <div class="text">模型库</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'ai-playground' }"
              @click="setActiveNav('ai-playground')"
            >
              <RouterLink to="/ai-playground" class="nav-link" title="AI与3D环境交互">
                <div class="icon"><i class="fa-solid fa-robot"></i></div>
                <div class="text">AI演武场</div>
              </RouterLink>
            </li>
          </ul>
        </div>
      </aside>

      <main class="main-container">
        <div class="page-content" :class="{ 'page-content--full': isFullBleed }">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- 移动端菜单按钮 -->
    <div class="mobile-menu-btn" @click="toggleSidebar" v-show="showNavigate()">
      <i class="fa-solid fa-bars"></i>
    </div>
  </div>
</template>

<script lang="ts" setup name="App">
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import '@/assets/styles/app-global.css'

/*
 * 星云视差：pointermove 给目标偏移，rAF 里 lerp 阻尼追过去——
 * 「平时安静，动鼠标才回应你」。prefers-reduced-motion 时整段不装，
 * 星云动画也会被 media 查询关掉，背景退回纯静态。
 * 当前值不走 Vue 响应式（每帧 set ref 会触发无谓重渲染），直接写 style。
 */
const gridStyle = ref({ transform: 'translate3d(0px, 0px, 0px)' })
let parallaxRaf = 0
let reducedMotion = false
let targetX = 0
let targetY = 0
let curX = 0
let curY = 0

const onPointerMove = (event: PointerEvent) => {
  targetX = (event.clientX / window.innerWidth - 0.5) * 16 // ±8px
  targetY = (event.clientY / window.innerHeight - 0.5) * 12 // ±6px
}

const startParallax = () => {
  const tick = () => {
    curX += (targetX - curX) * 0.06
    curY += (targetY - curY) * 0.06
    gridStyle.value = {
      transform: `translate3d(${curX.toFixed(2)}px, ${curY.toFixed(2)}px, 0)`,
    }
    parallaxRaf = requestAnimationFrame(tick)
  }
  parallaxRaf = requestAnimationFrame(tick)
}

const isMobile = ref(false)
// 监听窗口大小变化，更新设备类型
const checkIsMobile = () => {
  isMobile.value = window.innerWidth < 768
}
// 原有路由逻辑保留
const $route = useRoute()
// 新增：控制侧边栏激活状态（解决路由切换时active样式同步）
const activeNavKey = ref('overview')
// 新增：移动端侧边栏显示控制
const sidebarShow = ref(false)

// 原有导航显示逻辑保留。注意：'/home'、'/ai_star'、'/ai-2' 是历史遗留路径，
// 当前路由表里已经没有对应页面——这个判断实际恒为真，导航始终显示。
const showNavigate = () => {
  return !['/home', '/ai_star', '/ai-2'].includes($route.path)
}

/**
 * 3D 场景要铺满，不受页面容器限制。
 *
 * 页面容器默认有 `max-width: 1400px` + 居中留白 + 30px 内边距，
 * 在 1600px 的屏上，演武场的 3D 视口被压到 754px 宽、上下还各空一截。
 * 这些页面要让 3D 场景占满可用区域——**不论父容器怎么限制**。
 */
const FULL_BLEED_ROUTES = ['/ai-playground', '/simulation-lab', '/scene-editor']
const isFullBleed = computed(() => FULL_BLEED_ROUTES.includes($route.path))

// 设置导航激活状态
const setActiveNav = (key: string) => {
  activeNavKey.value = key
}

// 移动端侧边栏切换
const toggleSidebar = () => {
  sidebarShow.value = !sidebarShow.value
}

// 点击侧边栏外部区域关闭侧边栏
const handleOutsideClick = (event: MouseEvent) => {
  // 确保在移动端且侧边栏可见
  if (isMobile.value && sidebarShow.value) {
    // 使用更健壮的方式获取元素
    const sidebar = document.querySelector('.shell.show') || document.querySelector('.shell')
    const menuBtn = document.querySelector('.mobile-menu-btn')

    // 检查元素是否存在
    if (sidebar && menuBtn) {
      const target = event.target as HTMLElement

      // 检查点击目标是否不是侧边栏及其子元素，也不是菜单按钮
      if (!sidebar.contains(target) && !menuBtn.contains(target)) {
        // 防止点击事件被其他元素阻止
        event.stopPropagation()
        sidebarShow.value = false
      }
    }
  }
}

// 监听路由变化，确保路由跳转后样式正确且侧边栏关闭
watch(
  () => $route.path, // 监听路由路径变化
  (newPath) => {
    // 根据新路由路径设置激活状态
    const keyMap: Record<string, string> = {
      '/': 'overview',
      '/overview': 'overview',
      '/scene-editor': 'scene-editor',
      '/simulation-lab': 'simulation-lab',
      '/model-library': 'model-library',
      '/ai-playground': 'ai-playground',
    }
    activeNavKey.value = keyMap[newPath] || 'overview' // 默认值避免空值

    // 路由跳转后关闭侧边栏
    if (sidebarShow.value) {
      sidebarShow.value = false
    }
  },
  { immediate: true }, // 组件初始化时立即执行一次（替代顶层执行）
)
// 初始化时判断一次，后续窗口变化时更新
onMounted(() => {
  checkIsMobile()
  window.addEventListener('resize', checkIsMobile)
  // 添加点击事件监听，用于关闭侧边栏
  document.addEventListener('click', handleOutsideClick)
  // 星云视差：reduced-motion 用户不装，保持纯静态
  reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (!reducedMotion) {
    window.addEventListener('pointermove', onPointerMove, { passive: true })
    startParallax()
  }
})

// 组件卸载时移除监听，避免内存泄漏
onUnmounted(() => {
  window.removeEventListener('resize', checkIsMobile)
  // 移除点击事件监听
  document.removeEventListener('click', handleOutsideClick)
  window.removeEventListener('pointermove', onPointerMove)
  cancelAnimationFrame(parallaxRaf)
})
</script>

<style scoped>
/*
 * 背景：深空底色 + 三片星云漂移 + 视差网格。
 *
 * 分层（自底向上）：
 *   .app-background —— 纯 --bg-canvas 底，overflow 裁掉光斑溢出；
 *   .nebula-1/2/3   —— 大尺寸橙/琥珀 radial-gradient 光斑，transform
 *                      关键帧异周期漂移（24/32/40s，肉眼可感知的缓漂），
 *                      纯合成层动画，主线程零占用；
 *                      异周期避免「同步循环」的机械感；
 *   .parallax-grid  —— 48px 网格纹理层，跟随鼠标 ±8px 阻尼偏移（JS 侧
 *                      lerp）。平时安静，动鼠标才回应你。
 *
 * 颜色全部走 --accent-rgb 令牌族：换主题（过渡态的当前主题不是终点）
 * 只改 tokens.css 基础层，星云跟着换色。
 */
.app-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  background-color: var(--bg-canvas);
  overflow: hidden;
}

.nebula {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
}

/* 主星云：左上，主橙——透明度要让人一眼看出它存在，但只是氛围不是主角 */
.nebula-1 {
  width: 900px;
  height: 700px;
  left: -180px;
  top: -160px;
  background: radial-gradient(ellipse at center, rgba(var(--accent-rgb), 0.30), rgba(var(--accent-rgb), 0) 70%);
  animation: nebula-drift-1 24s ease-in-out infinite alternate;
}

/* 副星云：右下，主橙偏暗 */
.nebula-2 {
  width: 760px;
  height: 620px;
  right: -200px;
  bottom: -180px;
  background: radial-gradient(ellipse at center, rgba(var(--accent-rgb), 0.22), rgba(var(--accent-rgb), 0) 70%);
  animation: nebula-drift-2 32s ease-in-out infinite alternate;
}

/* 琥珀微光：中部偏右，AI 域色呼应，量压低——只给深空一点暖意分层 */
.nebula-3 {
  width: 520px;
  height: 420px;
  left: 56%;
  top: 30%;
  background: radial-gradient(ellipse at center, rgba(var(--accent-2-rgb), 0.10), rgba(var(--accent-2-rgb), 0) 70%);
  animation: nebula-drift-3 40s ease-in-out infinite alternate;
}

@keyframes nebula-drift-1 {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(120px, 70px, 0); }
}

@keyframes nebula-drift-2 {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-100px, -60px, 0); }
}

@keyframes nebula-drift-3 {
  from { transform: translate3d(0, 0, 0); }
  to { transform: translate3d(-70px, 90px, 0); }
}

/* 网格纹理层：独立一层才能跟星云做差速视差 */
.parallax-grid {
  position: absolute;
  inset: -24px; /* 四周多留 24px，视差偏移时不露边 */
  background-image:
    linear-gradient(rgba(var(--accent-rgb), 0.05) 1px, transparent 1px),
    linear-gradient(90deg, rgba(var(--accent-rgb), 0.05) 1px, transparent 1px);
  background-size: 48px 48px;
  will-change: transform;
}

/* 动画偏好：星云静止、视差不装（JS 侧），背景退回纯静态 */
@media (prefers-reduced-motion: reduce) {
  .nebula-1,
  .nebula-2,
  .nebula-3 {
    animation: none;
  }
}
</style>
