<template>
  <div class="ai-playground-container">
    <!-- 使用您提供的SVG背景 -->
    <svg
      class="svg-bg"
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
    <div class="page-header">
      <div class="header-glow"></div>
      <h1 class="ai-title">
        <span class="title-text">
          <span class="ai-title-emoji">🧠</span>AI演武场
        </span>
      </h1>
      <p
        class="ai-lead"
      >
        在<span class="ai-lead-accent">真实渲染的3D场地</span
        >里运行规则式智能体：它们读取场景里的真实感知、绕开障碍物并自主移动。
        <span class="ai-lead-muted"
          >碰撞与运动由 Rapier 刚体物理引擎求解：有质量、摩擦、弹性，
          撞上障碍物会被挡下并沿着箱体滑开。默认不调用任何外部模型；
          若自行填入 API Key，右侧面板还可开启 LLM 决策与旁路解释。</span
        >
      </p>
      <div class="header-divider"></div>
    </div>

    <!-- 主内容区域 -->
    <div
      class="ai-layout"
    >
      <!-- 左侧面板 -->
      <div class="ai-col-3">
        <div class="panel left-panel animate-fade-in-right">
          <div class="panel-glow"></div>
          <div class="panel-header">
            <span class="ai-panel-title">
              <svg class="ai-icon-amber" fill="currentColor" viewBox="0 0 20 20">
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
            <span class="ai-panel-title">
              <svg class="ai-icon-amber" fill="currentColor" viewBox="0 0 20 20">
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
      <!--
        注意：本仓库没有接 Tailwind，模板里 h-[...] / flex-1 / lg:col-span-* 这些工具类
        都不生效。视口高度由 scoped CSS 的 .ai-viewport 给出（否则视口高度会被画布内容顶起来，
        画布尺寸又反过来影响视口高度，形成反馈）。
      -->
      <div class="ai-col-6 panel center-panel animate-fade-in-up">
        <div class="panel-glow"></div>
        <div class="panel-header">
          <span class="ai-panel-title">
            <svg class="ai-icon-amber" fill="currentColor" viewBox="0 0 20 20">
              <path
                fill-rule="evenodd"
                d="M12.395 2.553a1 1 0 00-1.45-.385c-.345.23-.614.558-.822.88-.214.33-.403.713-.57 1.116-.334.804-.614 1.768-.84 2.734a31.365 31.365 0 00-.613 3.58 2.64 2.64 0 01-.945-1.067c-.328-.68-.398-1.534-.398-2.654A1 1 0 005.05 6.05 6.981 6.981 0 003 11a7 7 0 1011.95-4.95c-.592-.591-.98-.985-1.348-1.467-.363-.476-.724-1.063-1.207-2.03zM12.12 15.12A3 3 0 017 13s.879.5 2.5.5c0-1 .5-4 1.25-4.5.5 1 .786 1.293 1.371 1.879A2.99 2.99 0 0113 13a2.99 2.99 0 01-.879 2.121z"
                clip-rule="evenodd"
              />
            </svg>
            3D环境视图
          </span>
          <div class="ai-dots">
            <span class="ai-dot ai-dot-red"></span>
            <span
              class="ai-dot ai-dot-amber"
              style="animation-delay: 0.2s"
            ></span>
            <span
              class="ai-dot ai-dot-green"
              style="animation-delay: 0.4s"
            ></span>
          </div>
        </div>

        <div ref="viewportRef" class="ai-viewport">
          <!-- 加载状态优化 -->
          <div
            v-if="isLoading"
            class="ai-loading"
          >
            <div class="ai-loading-inner">
              <div
                class="ai-spinner"
              ></div>
              <p class="ai-loading-title">加载3D环境...</p>
              <p class="ai-loading-sub">正在初始化3D场景与智能体</p>
              <div class="ai-progress">
                <div class="ai-progress-bar"></div>
              </div>
            </div>
          </div>

          <!-- 操作提示卡片 -->
          <div
            class="ai-hint"
          >
            <p class="ai-hint-row">
              <span class="control-key">🖱️</span> 鼠标拖动: 旋转视角
            </p>
            <p class="ai-hint-row">
              <span class="control-key">↕️</span> 滚轮: 缩放
            </p>
            <p class="ai-panel-title">
              <span class="control-key">⇧</span> Shift+拖动: 平移
            </p>
          </div>

          <!-- 视角指示器 -->
          <div
            class="ai-camera-panel"
          >
            <div class="ai-camera-title">
              <svg class="ai-icon" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V7z"
                  clip-rule="evenodd"
                />
              </svg>
              视角控制
            </div>
            <div class="ai-keygrid">
              <div class="ai-key">W</div>
              <div class="ai-key ai-key-active">↑</div>
              <div class="ai-key">R</div>
              <div class="ai-key ai-key-active">←</div>
              <div class="ai-key ai-key-active">↓</div>
              <div class="ai-key ai-key-active">→</div>
              <div class="ai-key">Q</div>
              <div class="ai-key">S</div>
              <div class="ai-key">E</div>
            </div>
            <p class="ai-camera-hint">
              W/S 前后 · A/D 左右 · Q/E 升降 · R 复位
            </p>
          </div>
        </div>

        <!-- 物理现状的页面可见说明：碰撞由 Rapier 刚体引擎求解 -->
        <p class="physics-note">
          物理由 Rapier 刚体引擎求解：智能体与障碍物都是真实刚体，有质量、摩擦与弹性；
          感知（视野内障碍物数量、最近距离）直接来自引擎的形状查询，碰撞判定来自接触流形。
        </p>
      </div>

      <!-- 右侧面板 -->
      <div class="ai-col-3 ai-col-right">
        <div class="panel right-panel animate-fade-in-left">
          <div class="panel-glow"></div>
          <div class="panel-header">
            <span class="ai-panel-title">
              <svg class="ai-icon-amber" fill="currentColor" viewBox="0 0 20 20">
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

        <div class="panel right-panel animate-fade-in-left delay-100">
          <div class="panel-glow"></div>
          <div class="panel-header">
            <span class="ai-panel-title">
              <svg class="ai-icon-amber" fill="currentColor" viewBox="0 0 20 20">
                <path
                  fill-rule="evenodd"
                  d="M10 3a3 3 0 00-3 3v1a3 3 0 00-2 5.2A3 3 0 007 17h1a1 1 0 001-1v-2h2v2a1 1 0 001 1h1a3 3 0 004-4.8A3 3 0 0015 7V6a3 3 0 00-3-3H10zm0 2h2a1 1 0 011 1v1a1 1 0 001 1 1 1 1 0 011 1 1 1 0 00-1 1v1a1 1 0 01-1 1h-1a1 1 0 01-1-1v-2H9v2a1 1 0 01-1 1H7a1 1 0 01-1-1 1 1 0 00-1-1 1 1 0 010-2 1 1 0 001-1V6a1 1 0 011-1z"
                  clip-rule="evenodd"
                />
              </svg>
              LLM 增强
            </span>
          </div>
          <LlmPanel :agent-id="explainTargetId" :get-snapshot="getSnapshot" />
        </div>
      </div>
    </div>

    <!-- 页脚 -->
    <div class="ai-footer">
      <div class="footer-divider"></div>
      <p class="ai-footer-row">
        <span class="ai-panel-title">
          <span
            class="ai-dot ai-dot-amber ai-dot-inline"
          ></span>
          AI演武场 v1.0
        </span>
        <span class="ai-dot-sep"></span>
        <span class="ai-panel-title"> 使用Three.js和Vue构建 </span>
        <span class="ai-dot-sep"></span>
        <span class="ai-panel-title">
          <span
            class="ai-dot ai-dot-green ai-dot-inline"
            style="animation-delay: 0.4s"
          ></span>
          系统运行中
        </span>
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { useThree } from '@/composables/useThree'
import { useCamera } from '@/composables/useCamera'
import { useScene } from '@/composables/useScene'
import { useRenderer } from '@/composables/useRenderer'
import { useControls } from '@/composables/useControls'
import { useAI } from '@/composables/useAI'
import { useAiStore } from '@/stores/aiStore'
import AiController from '@/components/three/ai/AiController.vue'
import AiDebugPanel from '@/components/three/ai/AiDebugPanel.vue'
import AiEnvironmentPanel from '@/components/three/ai/AiEnvironmentPanel.vue'
import LlmPanel from '@/components/three/ai/LlmPanel.vue'

// DOM引用
const viewportRef = ref<HTMLDivElement | null>(null)
const isLoading = ref(true)

// 组合式函数实例（useThree 是模块级单例，这几个实例共享同一套 three 上下文）
const three = useThree()
const camera = useCamera()
const scene = useScene()
const renderer = useRenderer()
const controls = useControls()
const ai = useAI()
const aiStore = useAiStore()

/** 旁路解释针对哪个智能体：优先选中的，否则第一个 */
const explainTargetId = computed<string | null>(
  () => aiStore.selectedAgentId ?? aiStore.agents[0]?.id ?? null,
)

/** 取智能体当前状态快照（LLM 面板要用） */
const getSnapshot = (agentId: string) => ai.buildSnapshot(agentId)

let animationId: number | null = null
const clock = new THREE.Clock()

/** 相机初始机位（也是 R 键的复位目标） */
const DEFAULT_CAMERA_POSITION = { x: 14, y: 11, z: 14 }
/** 键盘移动相机的速度（米/秒） */
const CAMERA_KEY_SPEED = 14

const pressedKeys = new Set<string>()

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement

const handleKeyDown = (event: KeyboardEvent) => {
  if (isTypingTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'r') {
    camera.setCameraPosition(
      DEFAULT_CAMERA_POSITION.x,
      DEFAULT_CAMERA_POSITION.y,
      DEFAULT_CAMERA_POSITION.z,
    )
    return
  }
  if ('wasdqe'.includes(key)) pressedKeys.add(key)
}

const handleKeyUp = (event: KeyboardEvent) => {
  pressedKeys.delete(event.key.toLowerCase())
}

/** 键盘平移相机（与右侧按键指示器一致） */
const updateCameraFromKeys = (delta: number) => {
  const activeCamera = three.camera.value
  if (!activeCamera || pressedKeys.size === 0) return

  const forward = new THREE.Vector3()
  activeCamera.getWorldDirection(forward)
  forward.y = 0
  if (forward.lengthSq() < 1e-6) return
  forward.normalize()
  const right = new THREE.Vector3(-forward.z, 0, forward.x)

  const move = new THREE.Vector3()
  if (pressedKeys.has('w')) move.add(forward)
  if (pressedKeys.has('s')) move.sub(forward)
  if (pressedKeys.has('d')) move.add(right)
  if (pressedKeys.has('a')) move.sub(right)
  if (pressedKeys.has('e')) move.y += 1
  if (pressedKeys.has('q')) move.y -= 1
  if (move.lengthSq() === 0) return

  move.normalize().multiplyScalar(CAMERA_KEY_SPEED * delta)
  activeCamera.position.add(move)
}

const initializeScene = async () => {
  if (!viewportRef.value) return
  isLoading.value = true

  try {
    three.initThree()
    camera.setCameraPosition(
      DEFAULT_CAMERA_POSITION.x,
      DEFAULT_CAMERA_POSITION.y,
      DEFAULT_CAMERA_POSITION.z,
    )
    scene.initScene()
    renderer.initRenderer(viewportRef.value)
    controls.initControls()
    // 建出智能体与障碍物（场景对象由 useAI 持有）
    ai.syncScene()
    // 建物理世界：地面、围墙、智能体与障碍物的刚体。
    // ⚠️ 必须 await——Rapier 是按需加载的 WASM，没就绪之前刚体还不存在。
    await ai.initPhysics()

    startAnimationLoop()
  } catch (error) {
    console.error('[AIPlayground] 3D 场景初始化失败', error)
  } finally {
    setTimeout(() => {
      isLoading.value = false
    }, 600)
  }
}

const startAnimationLoop = () => {
  const animate = () => {
    animationId = requestAnimationFrame(animate)
    const delta = Math.min(clock.getDelta(), 0.05)

    controls.updateControls()
    updateCameraFromKeys(delta)
    // 推进智能体运动：内部按固定步长（1/60 秒）切分，逐步施加转向冲量并步进物理引擎
    ai.updateAgents(delta)

    // 渲染场景
    if (three.renderer.value && three.scene.value && three.camera.value) {
      three.renderer.value.render(three.scene.value, three.camera.value)
    }
  }
  animate()
}

const cleanup = () => {
  if (animationId) window.cancelAnimationFrame(animationId)
  animationId = null
  pressedKeys.clear()
  ai.cleanup()
  three.disposeThree()
}

onMounted(() => {
  // 初始化是异步的（Rapier 要先加载 WASM），失败会在内部记日志
  void initializeScene()
  // 窗口resize监听
  const handleResize = () => renderer.handleResize()
  window.addEventListener('resize', handleResize)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('keyup', handleKeyUp)
  onUnmounted(() => window.removeEventListener('resize', handleResize))
  onUnmounted(() => window.removeEventListener('keydown', handleKeyDown))
  onUnmounted(() => window.removeEventListener('keyup', handleKeyUp))
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

/* 3D 视口：确定的高度（本仓库没有 Tailwind，工具类不生效） */
.ai-viewport {
  position: relative;
  width: 100%;
  height: 560px;
  overflow: hidden;
}

/* 物理现状说明：告诉用户碰撞是解析式的，不是有摩擦/反弹/质量的刚体物理 */
.physics-note {
  margin: 0;
  padding: 0.5rem 0.9rem;
  font-size: 0.75rem;
  line-height: 1.5;
  color: #9ca3af;
  background: rgba(10, 12, 18, 0.6);
  border-top: 1px solid rgba(255, 215, 0, 0.15);
}

@media (max-width: 768px) {
  .ai-viewport {
    height: 420px;
  }
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

  .ai-col-6 {
    order: -1;
  }

  .ai-col-3 {
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

/* ==========================================================================
   页面骨架与语义色
   --------------------------------------------------------------------------
   本仓库**没有**接 Tailwind（无依赖、无 postcss、无 tailwind.config），
   模板里 `grid-cols-12` / `lg:col-span-*` / `text-white` 这类工具类
   **全是死类名、不生效**。这一段把页面真正需要的布局与配色用真实 CSS 写出来。

   配色沿用项目令牌层（见仓库根目录 DESIGN.md）：
   演武场是**深色驾驶舱**（与场景编辑器、仿真实验室的 3D 视口一致），
   浅色靛紫主色属于界面层，所以这里用的是"深底上的琥珀"=#FFA117
   （9.65:1 on #0A0C12），而不是浅底上的 #96560A。
   ========================================================================== */

.ai-playground-container {
  position: relative;
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  overflow: hidden;
  /* 深色底：SVG 顶部是透明的，必须由容器兜底，否则页头白字会浮在浅色应用底上 */
  background: #0a0c12;
}

/* 深色底纹：必须盖住整个视口，否则会露出应用的浅色页面底 */
.svg-bg {
  position: fixed;
  inset: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
  pointer-events: none;
}

.page-header {
  position: relative;
  z-index: 10;
  padding-top: 2.5rem;
  margin-bottom: 2rem;
  text-align: center;
}

/* 12 栏主栅格 */
.ai-layout {
  position: relative;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(12, 1fr);
  gap: 1.5rem;
  width: 100%;
  max-width: 80rem;
  margin: 0 auto;
  padding: 0 2rem 2.5rem;
  flex: 1;
}

.ai-col-3 {
  grid-column: span 3;
  display: flex;
  flex-direction: column;
  gap: 1.5rem;
}

.ai-col-6 {
  grid-column: span 6;
}

.ai-col-right {
  display: block;
}

/* 页头文字 */
.ai-title {
  position: relative;
  margin: 0;
  color: #ffffff;
  font-size: clamp(2rem, 5vw, 3.5rem);
  font-weight: 700;
  letter-spacing: 0.05em;
  line-height: 1.15;
}

.ai-title-emoji {
  display: inline-block;
  margin-right: 0.75rem;
  animation: pulse 2s ease-in-out infinite;
}

.ai-lead {
  max-width: 42rem;
  margin: 1rem auto 0;
  padding: 0 1rem;
  color: #e5e7eb;
  font-size: 1.0625rem;
  font-weight: 300;
  line-height: 1.75;
}

.ai-lead-accent {
  color: #ffa117;
  font-weight: 500;
}

.ai-lead-muted {
  color: #9ca3af;
}

/* 面板标题与图标 */
.ai-panel-title {
  display: flex;
  align-items: center;
}

.ai-icon-amber {
  width: 1.25rem;
  height: 1.25rem;
  margin-right: 0.5rem;
  color: #ffa117;
  flex-shrink: 0;
}

.ai-icon {
  width: 1.25rem;
  height: 1.25rem;
  margin-right: 0.5rem;
  flex-shrink: 0;
}

/* 状态点 */
.ai-dots {
  display: flex;
  gap: 0.5rem;
}

.ai-dot {
  width: 0.75rem;
  height: 0.75rem;
  border-radius: 9999px;
  animation: pulse 2s ease-in-out infinite;
}

.ai-dot-red {
  background: #ef4444;
}

.ai-dot-amber {
  background: #ffa117;
}

.ai-dot-green {
  background: #22c55e;
}

.ai-dot-inline {
  display: inline-block;
  width: 0.625rem;
  height: 0.625rem;
  margin-right: 0.5rem;
}

.ai-dot-sep {
  display: inline-block;
  width: 0.25rem;
  height: 0.25rem;
  border-radius: 9999px;
  background: #4b5563;
}

/* 加载态 */
.ai-loading {
  position: absolute;
  inset: 0;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
  border-bottom-left-radius: 0.5rem;
  border-bottom-right-radius: 0.5rem;
}

.ai-loading-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  color: #ffa117;
}

.ai-spinner {
  width: 5rem;
  height: 5rem;
  margin-bottom: 1.25rem;
  border: 4px solid #ffa117;
  border-top-color: transparent;
  border-radius: 9999px;
  animation: spin 1s linear infinite;
}

.ai-loading-title {
  margin-bottom: 0.5rem;
  color: #f3f4f6;
  font-size: 1.25rem;
  font-weight: 500;
}

.ai-loading-sub {
  color: rgba(255, 161, 23, 0.7);
  font-size: 0.875rem;
}

.ai-progress {
  width: 18rem;
  height: 0.375rem;
  margin-top: 1.25rem;
  overflow: hidden;
  border-radius: 9999px;
  background: #1f2937;
}

.ai-progress-bar {
  height: 100%;
  border-radius: 9999px;
  background: #ffa117;
}

/* 操作提示卡 */
.ai-hint {
  position: absolute;
  left: 1.25rem;
  bottom: 1.25rem;
  padding: 0.75rem 1rem;
  color: #e5e7eb;
  font-size: 0.875rem;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 161, 23, 0.4);
  border-radius: 0.75rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
  transition:
    background 0.3s ease,
    border-color 0.3s ease;
}

.ai-hint:hover {
  background: rgba(0, 0, 0, 0.9);
  border-color: rgba(255, 161, 23, 0.6);
}

.ai-hint-row {
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
}

.ai-hint-row-last {
  margin-bottom: 0;
}

/* 视角指示器 */
.ai-camera-panel {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  padding: 0.75rem;
  color: #ffa117;
  font-size: 0.875rem;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 161, 23, 0.4);
  border-radius: 0.75rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
}

.ai-camera-title {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.ai-keygrid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 0.5rem;
  text-align: center;
}

.ai-key {
  padding: 0.5rem;
  border-radius: 0.375rem;
  background: #111827;
  color: #e5e7eb;
}

.ai-key-active {
  background: rgba(255, 161, 23, 0.3);
  color: #ffa117;
  font-weight: 600;
}

.ai-camera-hint {
  margin-top: 0.5rem;
  color: #9ca3af;
  font-size: 0.6875rem;
  line-height: 1.6;
}

/* 页脚 */
.ai-footer {
  position: relative;
  z-index: 10;
  margin: 3rem 0 2rem;
  color: #9ca3af;
  font-size: 0.875rem;
  text-align: center;
}

.ai-footer-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  margin-top: 1.25rem;
}

.ai-footer-item {
  display: flex;
  align-items: center;
}

@media (max-width: 1024px) {
  .ai-layout {
    grid-template-columns: repeat(2, 1fr);
  }

  .ai-col-3,
  .ai-col-6 {
    grid-column: span 1;
  }
}

@media (max-width: 768px) {
  .ai-layout {
    grid-template-columns: 1fr;
    padding: 0 1rem 2rem;
  }

  .ai-lead {
    font-size: 0.9375rem;
  }

  .ai-hint {
    display: none;
  }

  .ai-camera-panel {
    display: none;
  }
}
</style>
