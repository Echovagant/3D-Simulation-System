<template>
  <div class="app">
    <!-- 替换为iframe背景（保留原有particles-background代码以备恢复） -->
    <!-- <particles-background /> -->
    <iframe
      src="/sakura.html"
      style="
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100vh;
        z-index: -1;
        border: none;
      "
      frameborder="0"
      scrolling="no"
    ></iframe>

    <!-- 页面容器：侧边导航 + 主内容 -->
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
                    <img src="./assets/images/logo  (1).png" alt="3D仿真系统" class="logo-img" />
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
                <div class="icon">🏠</div>
                <div class="text">总览</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'scene-editor' }"
              @click="setActiveNav('scene-editor')"
            >
              <RouterLink to="/scene-editor" class="nav-link" title="构建和编辑3D场景">
                <div class="icon">🛠️</div>
                <div class="text">场景编辑器</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'simulation-lab' }"
              @click="setActiveNav('simulation-lab')"
            >
              <RouterLink to="/simulation-lab" class="nav-link" title="运行和观察物理仿真">
                <div class="icon">🔬</div>
                <div class="text">仿真实验室</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'model-library' }"
              @click="setActiveNav('model-library')"
            >
              <RouterLink to="/model-library" class="nav-link" title="管理3D资产">
                <div class="icon">📦</div>
                <div class="text">模型库</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'ai-playground' }"
              @click="setActiveNav('ai-playground')"
            >
              <RouterLink to="/ai-playground" class="nav-link" title="AI与3D环境交互">
                <div class="icon">🧠</div>
                <div class="text">AI演武场</div>
              </RouterLink>
            </li>

            <li
              class="nav-item"
              :class="{ active: activeNavKey === 'docs' }"
              @click="setActiveNav('docs')"
            >
              <RouterLink to="/docs" class="nav-link" title="系统使用指南">
                <div class="icon">❓</div>
                <div class="text">文档</div>
              </RouterLink>
            </li>
          </ul>
        </div>
      </aside>

      <main class="main-container">
        <Header />
        <div class="page-content">
          <RouterView />
        </div>
      </main>
    </div>

    <!-- 移动端菜单按钮 -->
    <div class="mobile-menu-btn" @click="toggleSidebar" v-show="showNavigate()">☰</div>
  </div>
</template>

<script lang="ts" setup name="App">
import Header from './components/layout/Header.vue'
import { RouterLink, RouterView, useRoute } from 'vue-router'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import '@/assets/styles/app-global.css'

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

// 原有导航显示逻辑保留
const showNavigate = () => {
  return !['/home', '/ai_star', '/ai-2'].includes($route.path)
}

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
      '/docs': 'docs',
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
})

// 组件卸载时移除监听，避免内存泄漏
onUnmounted(() => {
  window.removeEventListener('resize', checkIsMobile)
  // 移除点击事件监听
  document.removeEventListener('click', handleOutsideClick)
})
</script>
