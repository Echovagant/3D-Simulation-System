<template>
  <div class="app">
    <!-- 背景：几何空间（函数曲面线框 + 立方体阵列，见 style 段与 geometry-background.ts） -->
    <div class="app-background">
      <canvas ref="bgCanvas" class="bg-webgl" aria-hidden="true"></canvas>
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
import {
  mountGeometryBackground,
  type GeometryBackgroundHandle,
} from '@/background/geometry-background'
import '@/assets/styles/app-global.css'

// 「几何空间」背景：函数曲面线框 + 立方体阵列 + 坐标网格（黑金镜像空间）
const bgCanvas = ref<HTMLCanvasElement | null>(null)
let bgHandle: GeometryBackgroundHandle | null = null

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
  // 「几何空间」背景：函数曲面线框 + 立方体阵列（30fps 节流、隐藏暂停、reduced-motion 静帧）
  if (bgCanvas.value) {
    bgHandle = mountGeometryBackground(bgCanvas.value)
  }
  // 空闲预热 Rapier wasm：仿真实验室/场景编辑器首开免等引擎下载。
  // 动态 import 发生在浏览器空闲时，不占首屏带宽与 LCP。
  const warmRapier = () => {
    void import('./composables/loadRapier')
      .then((m) => m.loadRapier())
      .catch(() => {}) // 预热失败不响应用户：真正进入页面时按需加载会重试
  }
  if ('requestIdleCallback' in window) {
    requestIdleCallback(warmRapier, { timeout: 4000 })
  } else {
    setTimeout(warmRapier, 2500)
  }
})

// 组件卸载时移除监听，避免内存泄漏
onUnmounted(() => {
  window.removeEventListener('resize', checkIsMobile)
  bgHandle?.dispose()
  bgHandle = null
  // 移除点击事件监听
  document.removeEventListener('click', handleOutsideClick)
})
</script>

<style scoped>
/*
 * 背景：「缎面静场」（方案 A）——项目 ink 深灰系的多值缎面渐变
 * （顶部暖金微光 → 中部灰缎 → 底部沉底）+ 4% grain 防条带。
 * 纯 CSS 零 GPU，无 WebGL 依赖；reduced-motion 天然满足（全静态）。
 */
.app-background {
  position: fixed;
  inset: 0;
  z-index: 0;
  /* 缎面渐变（高可见度版）：对齐花瓣版底色的亮度级别——
     低亮度显示器上暗部会输出成黑，所以亮部直接给到 #4a4a55
     （花瓣版白灰波浪的亮度档）、底部也提到 #1a1a1f 不留死黑。
     金光 25%、范围 80% 高度。用户确认可见后再往回收口味。 */
  background:
    radial-gradient(
      1300px 620px at 50% 0%,
      rgba(255, 199, 0, 0.25) 0%,
      rgba(255, 199, 0, 0.08) 48%,
      transparent 80%
    ),
    radial-gradient(120% 90% at 50% 32%, #4a4a55 0%, #35353c 52%, #1a1a1f 100%);
  overflow: hidden;
}

/* 4% grain：防长渐变在 8bit 屏幕上的条带，加一层缎面质感。
   SVG data URI 零请求；soft-light 在近黑表面上双向调制，不压暗阴影层。 */
.app-background::after {
  content: "";
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  opacity: 0.04;
  mix-blend-mode: soft-light;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}

/* 几何空间的 WebGL 层：透明底（让缎面渐变透出），线框元素由 shader 内上色 */
.bg-webgl {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  display: block;
}
</style>
