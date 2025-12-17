<template>
  <div class="ai-playground-container min-h-screen flex flex-col relative overflow-hidden">
    <!-- 使用您提供的SVG背景 -->
    <svg
      class="svg-bg fixed inset-0"
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 1440 1000"
      preserveAspectRatio="xMidYMid slice"
    >
      <path
        fill="url(#yellowBlackGradient)"
        fill-opacity="0.9"
        d="M0,320L48,320C96,320,192,320,288,309.3C384,299,480,277,576,250.7C672,224,768,192,864,181.3C960,171,1056,181,1152,197.3C1248,213,1344,235,1392,245.3L1440,256L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z"
      >
        <animate
          attributeName="d"
          values="
            M0,320L48,320C96,320,192,320,288,309.3C384,299,480,277,576,250.7C672,224,768,192,864,181.3C960,171,1056,181,1152,197.3C1248,213,1344,235,1392,245.3L1440,256L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z;
            M0,288L48,304C96,320,192,352,288,341.3C384,331,480,277,576,250.7C672,224,768,224,864,240C960,256,1056,288,1152,282.7C1248,277,1344,235,1392,213.3L1440,192L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z;
            M0,320L48,320C96,320,192,320,288,309.3C384,299,480,277,576,250.7C672,224,768,192,864,181.3C960,171,1056,181,1152,197.3C1248,213,1344,235,1392,245.3L1440,256L1440,1000L1392,1000C1344,1000,1248,1000,1152,1000C1056,1000,960,1000,864,1000C768,1000,672,1000,576,1000C480,1000,384,1000,288,1000C192,1000,96,1000,48,1000L0,1000Z
          "
          dur="20s"
          repeatCount="indefinite"
        />
      </path>

      <circle cx="200" cy="150" r="10" fill="#FFD700" opacity="0.8">
        <animate attributeName="cy" values="150;170;150" dur="4s" repeatCount="indefinite" />
        <animate attributeName="opacity" values="0.6;0.9;0.6" dur="6s" repeatCount="indefinite" />
      </circle>
      <circle cx="400" cy="200" r="8" fill="#000000" opacity="0.7">
        <animate attributeName="cy" values="200;220;200" dur="6s" repeatCount="indefinite" />
      </circle>
      <circle cx="1000" cy="100" r="12" fill="#FFD700" opacity="0.9">
        <animate attributeName="cy" values="100;130;100" dur="5s" repeatCount="indefinite" />
        <animate attributeName="r" values="12;14;12" dur="8s" repeatCount="indefinite" />
      </circle>
      <circle cx="1200" cy="300" r="6" fill="#000000" opacity="0.6">
        <animate attributeName="cy" values="300;320;300" dur="7s" repeatCount="indefinite" />
      </circle>

      <circle cx="700" cy="400" r="5" fill="#FFD700" opacity="0.5">
        <animate attributeName="cx" values="700;730;700" dur="10s" repeatCount="indefinite" />
      </circle>
      <circle cx="300" cy="600" r="7" fill="#FFD700" opacity="0.6">
        <animate attributeName="cx" values="300;280;300" dur="8s" repeatCount="indefinite" />
      </circle>

      <defs>
        <linearGradient id="yellowBlackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#111111" stop-opacity="0.95" />
          <stop offset="40%" stop-color="#222222" stop-opacity="0.9" />
          <stop offset="50%" stop-color="#FFD700" stop-opacity="0.15" />
          <stop offset="60%" stop-color="#222222" stop-opacity="0.9" />
          <stop offset="100%" stop-color="#111111" stop-opacity="0.95" />
        </linearGradient>

        <radialGradient id="yellowSpot" cx="50%" cy="50%" r="50%" fx="50%" fy="50%">
          <stop offset="0%" stop-color="#FFD700" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#FFD700" stop-opacity="0" />
        </radialGradient>

        <circle cx="800" cy="200" r="200" fill="url(#yellowSpot)">
          <animate
            attributeName="opacity"
            values="0.3;0.5;0.3"
            dur="15s"
            repeatCount="indefinite"
          />
        </circle>
      </defs>
    </svg>

    <!-- 顶部标题区域 -->
    <div class="page-header mb-8 text-center relative z-10 pt-10">
      <div class="header-glow"></div>
      <h1 class="text-[clamp(2rem,5vw,3.5rem)] font-bold text-white tracking-wider relative">
        <span class="title-text">
          <span class="inline-block animate-pulse mr-3">🧠</span>AI演武场
        </span>
      </h1>
      <p
        class="text-white mt-4 max-w-2xl mx-auto text-base md:text-lg px-4 leading-relaxed font-light"
      >
        在<span class="text-yellow-400 font-medium">沉浸式3D环境</span
        >中测试和训练AI代理，观察它们如何与环境交互、学习和适应不同场景
      </p>
      <div class="header-divider"></div>
    </div>

    <!-- 主内容区域 -->
    <div
      class="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-6 w-full px-5 sm:px-8 max-w-7xl mx-auto relative z-10 pb-10"
    >
      <!-- 左侧面板 -->
      <div class="lg:col-span-3 flex flex-col gap-6">
        <div class="panel left-panel animate-fade-in-right">
          <div class="panel-glow"></div>
          <div class="panel-header">
            <span class="flex items-center">
              <svg class="w-5 h-5 mr-2 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4zM3 10a1 1 0 011-1h6a1 1 0 011 1v6a1 1 0 01-1 1H4a1 1 0 01-1-1v-6zM14 9a1 1 0 00-1 1v6a1 1 0 001 1h2a1 1 0 001-1v-6a1 1 0 00-1-1h-2z"
                />
              </svg>
              环境配置
            </span>
          </div>
          <AiEnvironmentPanel />
        </div>

        <div class="panel left-panel animate-fade-in-right delay-100">
          <div class="panel-glow"></div>
          <div class="panel-header">
            <span class="flex items-center">
              <svg class="w-5 h-5 mr-2 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z"
                  clip-rule="evenodd"
                />
              </svg>
              AI控制器
            </span>
          </div>
          <AiController />
        </div>
      </div>

      <!-- 中间3D视图 -->
      <div class="lg:col-span-6 panel center-panel animate-fade-in-up">
        <div class="panel-glow"></div>
        <div class="panel-header">
          <span class="flex items-center">
            <svg class="w-5 h-5 mr-2 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
                clip-rule="evenodd"
              />
            </svg>
            3D环境视图
          </span>
          <div class="flex gap-2">
            <span class="w-3 h-3 rounded-full bg-red-500 animate-pulse"></span>
            <span
              class="w-3 h-3 rounded-full bg-yellow-500 animate-pulse"
              style="animation-delay: 0.2s"
            ></span>
            <span
              class="w-3 h-3 rounded-full bg-green-500 animate-pulse"
              style="animation-delay: 0.4s"
            ></span>
          </div>
        </div>

        <div ref="viewportRef" class="w-full h-[calc(100%-46px)] relative">
          <!-- 加载状态优化 -->
          <div
            v-if="isLoading"
            class="absolute inset-0 flex items-center justify-center bg-black/90 z-10 rounded-b-lg"
          >
            <div class="text-yellow-400 flex flex-col items-center">
              <div
                class="w-20 h-20 border-4 border-yellow-500 border-t-transparent rounded-full animate-spin mb-5"
              ></div>
              <p class="font-medium text-xl mb-2">加载3D环境...</p>
              <p class="text-sm text-yellow-500/70">正在初始化物理引擎和AI系统</p>
              <div class="w-72 h-1.5 bg-gray-800 rounded-full mt-5 overflow-hidden">
                <div class="h-full bg-yellow-500 rounded-full progress-bar"></div>
              </div>
            </div>
          </div>

          <!-- 操作提示卡片 -->
          <div
            class="absolute bottom-5 left-5 text-sm text-gray-200 bg-black/80 backdrop-blur-md px-4 py-3 rounded-xl border border-yellow-500/40 shadow-2xl transition-all duration-300 hover:bg-black/90 hover:border-yellow-500/60"
          >
            <p class="mb-2 flex items-center">
              <span class="control-key mr-2">🖱️</span> 鼠标拖动: 旋转视角
            </p>
            <p class="mb-2 flex items-center">
              <span class="control-key mr-2">↕️</span> 滚轮: 缩放
            </p>
            <p class="flex items-center">
              <span class="control-key mr-2">⇧</span> Shift+拖动: 平移
            </p>
          </div>

          <!-- 视角指示器 -->
          <div
            class="absolute top-5 right-5 bg-black/80 backdrop-blur-md rounded-xl p-3 border border-yellow-500/40 text-yellow-400 text-sm shadow-xl"
          >
            <div class="flex items-center justify-center mb-2 font-medium">
              <svg class="w-5 h-5 mr-2" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                  clip-rule="evenodd"
                />
              </svg>
              视角控制
            </div>
            <div class="grid grid-cols-3 gap-2 text-center">
              <div class="p-2 bg-gray-900 rounded-md">W</div>
              <div class="p-2 bg-yellow-500/30 rounded-md text-yellow-400 font-semibold">↑</div>
              <div class="p-2 bg-gray-900 rounded-md">R</div>
              <div class="p-2 bg-yellow-500/30 rounded-md text-yellow-400 font-semibold">←</div>
              <div class="p-2 bg-yellow-500/30 rounded-md text-yellow-400 font-semibold">↓</div>
              <div class="p-2 bg-yellow-500/30 rounded-md text-yellow-400 font-semibold">→</div>
              <div class="p-2 bg-gray-900 rounded-md">Q</div>
              <div class="p-2 bg-gray-900 rounded-md">S</div>
              <div class="p-2 bg-gray-900 rounded-md">E</div>
            </div>
          </div>
        </div>
      </div>

      <!-- 右侧面板 -->
      <div class="lg:col-span-3">
        <div class="panel right-panel animate-fade-in-left">
          <div class="panel-glow"></div>
          <div class="panel-header">
            <span class="flex items-center">
              <svg class="w-5 h-5 mr-2 text-yellow-400" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                  clip-rule="evenodd"
                />
              </svg>
              调试信息
            </span>
          </div>
          <AiDebugPanel />
        </div>
      </div>
    </div>

    <!-- 页脚 -->
    <div class="mt-12 mb-8 text-center text-sm text-gray-400 relative z-10">
      <div class="footer-divider"></div>
      <p class="flex items-center justify-center gap-4 mt-5">
        <span class="flex items-center">
          <span
            class="inline-block w-2.5 h-2.5 rounded-full bg-yellow-500 mr-2 animate-pulse"
          ></span>
          AI演武场 v1.0
        </span>
        <span class="w-1 h-1 rounded-full bg-gray-600"></span>
        <span class="flex items-center"> 使用Three.js和Vue构建 </span>
        <span class="w-1 h-1 rounded-full bg-gray-600"></span>
        <span class="flex items-center">
          <span
            class="inline-block w-2.5 h-2.5 rounded-full bg-green-500 mr-2 animate-pulse"
            style="animation-delay: 0.4s"
          ></span>
          系统运行中
        </span>
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useThree } from '@/composables/useThree'
import { useCamera } from '@/composables/useCamera'
import { useScene } from '@/composables/useScene'
import { useRenderer } from '@/composables/useRenderer'
import { useControls } from '@/composables/useControls'
import { useAI } from '@/composables/useAI'
import { usePhysics } from '@/composables/usePhysics'
import AiController from '@/components/three/ai/AiController.vue'
import AiDebugPanel from '@/components/three/ai/AiDebugPanel.vue'
import AiEnvironmentPanel from '@/components/three/ai/AiEnvironmentPanel.vue'

// DOM引用
const viewportRef = ref<HTMLDivElement | null>(null)
const isLoading = ref(true)

// 组合式函数实例
const three = useThree()
const camera = useCamera()
const scene = useScene()
const renderer = useRenderer()
const controls = useControls()
const physics = usePhysics()
const { cleanup: cleanupAI } = useAI()

let animationId: number | null = null

const initializeScene = async () => {
  if (!viewportRef.value) return
  isLoading.value = true

  try {
    three.initThree()
    camera.setCameraPosition(10, 10, 10)
    scene.initScene()
    renderer.initRenderer(viewportRef.value)
    controls.initControls()
    physics.initPhysics(three.scene.value!)

    startAnimationLoop()
    console.log('AI演武场场景初始化完成')
  } catch (error) {
    console.error('场景初始化失败:', error)
  } finally {
    // 模拟加载时间
    setTimeout(() => {
      isLoading.value = false
    }, 2000)
  }
}

const startAnimationLoop = () => {
  const animate = () => {
    animationId = requestAnimationFrame(animate)
    controls.updateControls()
    physics.updatePhysics(0.016)

    // 渲染场景
    if (three.renderer.value && three.scene.value && camera.activeCamera.value) {
      three.renderer.value.render(three.scene.value, camera.activeCamera.value)
    }
  }
  animate()
}

const cleanup = () => {
  if (animationId) window.cancelAnimationFrame(animationId)
  cleanupAI()
}

onMounted(() => {
  initializeScene()
  // 窗口resize监听
  const handleResize = () => renderer.handleResize()
  window.addEventListener('resize', handleResize)
  onUnmounted(() => window.removeEventListener('resize', handleResize))
})

onUnmounted(() => cleanup())
</script>

<style scoped>
.ai-playground-container {
  min-height: 100vh;
  height: 100%;
  padding-bottom: 1rem;
}

.svg-bg {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  filter: blur(0.5px);
}

/* 标题样式 */
.title-text {
  text-shadow: 0 0 15px rgba(255, 215, 0, 0.7);
  animation: title-glow 3s ease-in-out infinite alternate;
}

@keyframes title-glow {
  from {
    text-shadow: 0 0 10px rgba(255, 215, 0, 0.5);
  }
  to {
    text-shadow:
      0 0 25px rgba(255, 215, 0, 0.9),
      0 0 40px rgba(255, 215, 0, 0.7);
  }
}

.header-glow {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 400px;
  height: 150px;
  background: radial-gradient(rgba(255, 215, 0, 0.25), transparent 70%);
  filter: blur(25px);
  z-index: -1;
}

.header-divider {
  width: 250px;
  height: 2px;
  background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.6), transparent);
  margin: 1.5rem auto;
}

.footer-divider {
  width: 100%;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(255, 215, 0, 0.4), transparent);
  margin: 0 auto;
}

/* 面板通用样式 */
.panel {
  background: rgba(10, 12, 18, 0.75);
  backdrop-filter: blur(12px);
  border-radius: 16px;
  border: 1px solid rgba(255, 215, 0, 0.25);
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1);
  overflow: hidden;
  position: relative;
  transition: all 0.3s ease;
}

.panel:hover {
  border-color: rgba(255, 215, 0, 0.4);
  box-shadow:
    0 12px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.15);
  transform: translateY(-3px);
}

.panel-glow {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background: radial-gradient(circle at 50% 0%, rgba(255, 215, 0, 0.15), transparent 70%);
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.panel:hover .panel-glow {
  opacity: 1;
}

.panel-header {
  background: linear-gradient(90deg, rgba(30, 30, 40, 0.8) 0%, rgba(40, 40, 50, 0.8) 100%);
  padding: 1rem 1.2rem;
  border-bottom: 1px solid rgba(255, 215, 0, 0.25);
  font-weight: 600;
  color: #e0e0e0;
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 1.1rem;
}

/* 左右面板特定样式 */
.left-panel {
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    -8px 0 20px rgba(255, 215, 0, 0.15);
}

.right-panel {
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.4),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    8px 0 20px rgba(255, 215, 0, 0.15);
}

.center-panel {
  box-shadow:
    0 10px 40px rgba(0, 0, 0, 0.5),
    inset 0 1px 0 rgba(255, 255, 255, 0.1),
    0 0 30px rgba(255, 215, 0, 0.2);
}

/* 控制键样式 */
.control-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: rgba(255, 215, 0, 0.2);
  border: 1px solid rgba(255, 215, 0, 0.4);
  border-radius: 6px;
  font-size: 14px;
}

/* 进度条动画 */
.progress-bar {
  animation: progress-loading 2s ease-in-out infinite;
  width: 60%;
}

@keyframes progress-loading {
  0% {
    width: 30%;
  }
  50% {
    width: 70%;
  }
  100% {
    width: 30%;
  }
}

/* 入场动画 */
.animate-fade-in-right {
  animation: fade-in-right 0.7s ease-out forwards;
}

.animate-fade-in-left {
  animation: fade-in-left 0.7s ease-out forwards;
}

.animate-fade-in-up {
  animation: fade-in-up 0.7s ease-out forwards;
}

.delay-100 {
  animation-delay: 0.15s;
}

@keyframes fade-in-right {
  from {
    opacity: 0;
    transform: translateX(-30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes fade-in-left {
  from {
    opacity: 0;
    transform: translateX(30px);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

@keyframes fade-in-up {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

/* 响应式调整 */
@media (max-width: 1024px) {
  .ai-playground-container {
    grid-template-rows: auto 1fr auto;
  }

  .lg\\:col-span-6 {
    order: -1;
  }

  .lg\\:col-span-3 {
    margin-bottom: 1rem;
  }
}

@media (max-width: 768px) {
  .svg-bg {
    filter: blur(0.3px);
  }

  .panel-header {
    padding: 0.8rem 1rem;
    font-size: 1rem;
  }

  .control-key {
    width: 24px;
    height: 24px;
    font-size: 12px;
  }
}

/* 为面板内容添加内边距 */
:deep(.panel-content) {
  padding: 1.5rem;
}
</style>
