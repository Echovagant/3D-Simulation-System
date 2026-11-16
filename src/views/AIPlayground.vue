<template>
  <div class="ai-playground-container">
    <!-- 页头：标题 + 一句话说明；右侧 actions 区放运行状态 chip（原页脚的三态状态上移收敛） -->
    <PageHeader
      title="AI演武场"
      lead="智能体在真实渲染的 3D 场地里读感知、绕障碍、自主移动"
    >
      <template #actions>
        <span class="ai-status-chip">
          <span class="ai-status-dot" :class="footerDotClass"></span>
          {{ footerStatusText }}
        </span>
      </template>
    </PageHeader>

    <!-- 主内容区域：24 栏栅格，左 5 / 中 14 / 右 5 -->
    <div class="ai-layout">
      <!-- 左侧面板 -->
      <div class="ai-col-side ai-col-left">
        <div class="panel">
          <div class="panel-head">
            <PanelHeader title="环境配置" />
          </div>
          <AiEnvironmentPanel />
        </div>

        <div class="panel">
          <div class="panel-head">
            <PanelHeader title="AI控制器" />
          </div>
          <AiController />
        </div>
      </div>

      <!-- 中间3D视图 -->
      <!--
        注意：本仓库没有接 Tailwind，模板里的工具类都不生效。
        视口高度由 scoped CSS 的 .ai-viewport 给出（否则视口高度会被画布内容顶起来，
        画布尺寸又反过来影响视口高度，形成反馈）。
      -->
      <div class="ai-col-center panel">
        <div class="panel-head">
          <PanelHeader title="3D环境视图">
            <!-- 物理现状说明从视口正下方的常驻长文案收敛成 InfoTip -->
            <InfoTip
              text="碰撞与运动由 Rapier 刚体引擎求解：智能体与障碍物都是真实刚体（有质量、摩擦与弹性），撞上障碍会被挡下并沿箱体滑开；感知数据（视野内障碍数、最近距离）直接来自引擎的形状查询。默认不调用任何外部模型；自行填入 API Key 后，右侧 LLM 面板可开启决策与旁路解释。"
              label="物理与感知说明"
            />
          </PanelHeader>
        </div>

        <div ref="viewportRef" class="ai-viewport">
          <!-- 加载状态 -->
          <div v-if="isLoading" class="ai-loading">
            <div class="ai-loading-inner">
              <div class="ai-spinner"></div>
              <p class="ai-loading-title">加载3D环境...</p>
              <p class="ai-loading-sub">正在初始化3D场景与智能体</p>
              <div class="ai-progress">
                <div class="ai-progress-bar"></div>
              </div>
            </div>
          </div>

          <!-- 操作提示卡片：H 键整体显隐（hintVisible，见 script） -->
          <div v-if="hintVisible" class="ai-hint">
            <p class="ai-hint-row">
              <span class="control-key">左键</span>拖动旋转视角
            </p>
            <p class="ai-hint-row">
              <span class="control-key">滚轮</span>缩放视角
            </p>
            <p class="ai-hint-row ai-hint-row-last">
              <span class="control-key">Shift</span>+拖动平移视角
            </p>
          </div>

          <!-- 视角指示器：与左下提示卡一起由 H 键显隐 -->
          <div v-if="hintVisible" class="ai-camera-panel">
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
              <div class="ai-key ai-key-blank"></div>
              <div
                class="ai-key"
                :class="{ 'ai-key-active': isKeyDown('w') }"
              >
                W
              </div>
              <div class="ai-key ai-key-blank"></div>

              <div
                class="ai-key"
                :class="{ 'ai-key-active': isKeyDown('a') }"
              >
                A
              </div>
              <div
                class="ai-key"
                :class="{ 'ai-key-active': isKeyDown('s') }"
              >
                S
              </div>
              <div
                class="ai-key"
                :class="{ 'ai-key-active': isKeyDown('d') }"
              >
                D
              </div>

              <div
                class="ai-key"
                :class="{ 'ai-key-active': isKeyDown('q') }"
              >
                Q
              </div>
              <div
                class="ai-key"
                :class="{ 'ai-key-active': isKeyDown('e') }"
              >
                E
              </div>
              <!-- H 键：切换提示层显隐（操作提示卡 + 本面板一起收起），无按下态 -->
              <div class="ai-key">H</div>

              <div
                class="ai-key ai-key-wide"
                :class="{ 'ai-key-active': isKeyDown('r') }"
              >
                R 复位
              </div>
            </div>
            <p class="ai-camera-hint">
              W/S 前后 · A/D 左右 · Q/E 升降 · R 复位 · H 提示
            </p>
          </div>
        </div>
      </div>

      <!-- 右侧面板 -->
      <div class="ai-col-side ai-col-right">
        <div class="panel">
          <div class="panel-head">
            <PanelHeader title="调试信息" />
          </div>
          <AiDebugPanel />
        </div>

        <div class="panel">
          <div class="panel-head">
            <PanelHeader title="LLM 增强" />
          </div>
          <LlmPanel :agent-id="explainTargetId" :get-snapshot="getSnapshot" />
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, reactive, onMounted, onUnmounted } from 'vue'
import * as THREE from 'three'
import { useThree } from '@/composables/useThree'
import { useCamera } from '@/composables/useCamera'
import { useScene } from '@/composables/useScene'
import { useRenderer } from '@/composables/useRenderer'
import { useControls } from '@/composables/useControls'
import { arenaFraming } from '@/config/sceneFraming'
import { useAI } from '@/composables/useAI'
import { useAiStore } from '@/stores/aiStore'
import { useLlmStore } from '@/stores/llmStore'
import PageHeader from '@/components/common/PageHeader.vue'
import PanelHeader from '@/components/common/PanelHeader.vue'
import InfoTip from '@/components/common/InfoTip.vue'
import AiController from '@/components/three/ai/AiController.vue'
import AiDebugPanel from '@/components/three/ai/AiDebugPanel.vue'
import AiEnvironmentPanel from '@/components/three/ai/AiEnvironmentPanel.vue'
import LlmPanel from '@/components/three/ai/LlmPanel.vue'

// DOM引用
const viewportRef = ref<HTMLDivElement | null>(null)
const isLoading = ref(true)

/** 提示层显隐：H 键切换——左下操作提示与右上键位图一起收起，默认展开 */
const hintVisible = ref(true)

// 组合式函数实例（useThree 是模块级单例，这几个实例共享同一套 three 上下文）
const three = useThree()
const camera = useCamera()
const scene = useScene()
const renderer = useRenderer()
const controls = useControls()
const ai = useAI()
const aiStore = useAiStore()
const llmStore = useLlmStore()

/** 运行状态 chip（原页脚三态，收敛到页头 actions 区）：LLM 降级红 / 运行中绿 / 暂停琥珀 */
const footerStatusText = computed(() => {
  if (llmStore.degraded) return 'LLM 已降级'
  return aiStore.simulationActive ? '系统运行中' : '已暂停'
})
const footerDotClass = computed(() =>
  llmStore.degraded ? 'ai-dot-red' : aiStore.simulationActive ? 'ai-dot-green' : 'ai-dot-amber'
)

/** 旁路解释针对哪个智能体：优先选中的，否则第一个 */
const explainTargetId = computed<string | null>(
  () => aiStore.selectedAgentId ?? aiStore.agents[0]?.id ?? null,
)

/** 取智能体当前状态快照（LLM 面板要用） */
const getSnapshot = (agentId: string) => ai.buildSnapshot(agentId)

let animationId: number | null = null
/** 页面是否已经卸载——异步初始化期间用它挡住"卸载后仍启动动画循环" */
let isUnmounted = false
const clock = new THREE.Clock()

/** 相机初始机位（也是 R 键的复位目标） */
/**
 * 演武场的初始取景。
 *
 * ⚠️ 相机要**正对场地中心**，不能站在一角斜看：站在 +x/+z 那一角时，
 * 网格的两条边在画面里成了对角线，看起来就是「网格斜铺」；
 * 配上 75° 的广角，近处拉变形、远处压扁，斜得更厉害。
 *
 * 参数在 `src/config/sceneFraming.ts` 里，与仿真实验室共用一份口径；
 * 目标点也取自同一份，相机 lookAt 与轨道控制器的 target 不会对不上。
 */
const DEFAULT_CAMERA_POSITION = arenaFraming.position
/** 视野角：75° 太广，收窄到 50° 后透视畸变小得多 */
const DEFAULT_CAMERA_FOV = arenaFraming.fov
/** 键盘平移相机的速度（米/秒） */
const CAMERA_KEY_SPEED = 14

/**
 * 当前按下的键——用 reactive 的 Set，按键指示器靠它高亮。
 *
 * ⚠️ 指示器画的就是这里真正响应的键：W/S/A/D/Q/E 平移相机，R 复位视角。
 * H 键只切换提示层显隐（见 handleKeyDown），没有按下态，不进 pressedKeys、不画；
 * 方向键没有被绑定，所以不画。
 */
const pressedKeys = reactive(new Set<string>())
const isKeyDown = (key: string) => pressedKeys.has(key)

const isTypingTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  target instanceof HTMLSelectElement

const handleKeyDown = (event: KeyboardEvent) => {
  if (isTypingTarget(event.target)) return
  const key = event.key.toLowerCase()
  if (key === 'r') {
    pressedKeys.add(key)
    camera.setCameraPosition(
      DEFAULT_CAMERA_POSITION.x,
      DEFAULT_CAMERA_POSITION.y,
      DEFAULT_CAMERA_POSITION.z,
    )
    return
  }
  if (key === 'h') {
    hintVisible.value = !hintVisible.value
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
    // 相机瞄的点与轨道中心取**同一个** arenaFraming.target
    camera.setCameraPosition(
      DEFAULT_CAMERA_POSITION.x,
      DEFAULT_CAMERA_POSITION.y,
      DEFAULT_CAMERA_POSITION.z,
      arenaFraming.target,
    )
    camera.setCameraFov(DEFAULT_CAMERA_FOV)
    scene.initScene()
    renderer.initRenderer(viewportRef.value)
    controls.initControls()
    controls.setTarget(
      arenaFraming.target.x,
      arenaFraming.target.y,
      arenaFraming.target.z,
    )
    // 建出智能体与障碍物（场景对象由 useAI 持有）
    ai.syncScene()
    // 建物理世界：地面、围墙、智能体与障碍物的刚体。
    // ⚠️ 必须 await——Rapier 是按需加载的 WASM，没就绪之前刚体还不存在。
    await ai.initPhysics()

    // ⚠️ 初始化期间用户可能已经离开了页面：这时启动动画循环就等于开一个
    // 永远停不下来的 rAF（卸载时 animationId 还是 null，取消不掉）。
    if (isUnmounted) {
      cleanup()
      return
    }

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

onUnmounted(() => {
  isUnmounted = true
  cleanup()
})
</script>

<style scoped>
/* ==========================================================================
   AI 演武场：深色驾驶舱（与场景编辑器、仿真实验室的 3D 视口同语言）
   --------------------------------------------------------------------------
   本仓库**没有**接 Tailwind，模板里出现的工具类全是死类名；
   布局与配色全部用这里的真实 CSS + 项目令牌层（见仓库根目录 DESIGN.md）写出。
   演武场用「深底上的琥珀」var(--accent-2)（对深底画布对比度 9.65:1），
   而不是浅底上的暗琥珀。工具卡不 hover 抬升、不入场动画。
   ========================================================================== */

.ai-playground-container {
  position: relative;
  display: flex;
  flex-direction: column;
  /* 一屏占满：高度跟着页面容器走。
     --page-content-block 在普通布局是内容区上下内边距（60px），
     铺满模式（本页走这条）为 0px——3D 场景直接占满整个窗口，
     不出现整页滚动条，高度由下面的栅格分配。 */
  height: calc(100vh - var(--page-content-block, 90px));
  min-height: 520px;
  overflow: hidden;
  /* 深色底：与全站令牌同一画布色 */
  background: var(--bg-canvas);
}

/* 页头右侧的运行状态 chip：原页脚三态状态上移收敛成一枚 */
.ai-status-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.3rem 0.7rem;
  font-size: var(--text-xs);
  line-height: 1.4;
  color: var(--text-2);
  background: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: 9999px;
  white-space: nowrap;
}

/* 状态点形状；颜色类（ai-dot-red / ai-dot-green / ai-dot-amber）见下方语义色段 */
.ai-status-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 9999px;
  flex-shrink: 0;
}

/* 24 栏主栅格：左 5 / 中 14 / 右 5 —— 3D 视图是主角，宽度优先给它。
   行高锁成 minmax(0, 1fr)：单行铺满剩余高度，面板再长也不会把整页撑高，
   侧栏改为各自内部滚动。 */
.ai-layout {
  position: relative;
  z-index: 10;
  display: grid;
  grid-template-columns: repeat(24, minmax(0, 1fr));
  grid-template-rows: minmax(0, 1fr);
  gap: 1rem;
  width: 100%;
  margin: 0 auto;
  padding: 0 1rem 1rem;
  flex: 1;
  min-height: 0;
}

/* 两侧栏共用的形态：竖排、可内部滚动 */
.ai-col-side {
  display: flex;
  flex-direction: column;
  gap: 1rem;
  min-height: 0;
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: rgba(255, 161, 23, 0.45) transparent;
}

/* 左栏：环境配置 + AI 控制器 */
.ai-col-left {
  grid-column: span 5;
}

/* 中间的 3D 视图：拿 14 栏——它是这页的主角 */
.ai-col-center {
  grid-column: span 14;
  display: flex;
  flex-direction: column;
  min-height: 0;
}

/* 右栏：调试信息 + LLM 增强 */
.ai-col-right {
  grid-column: span 5;
}

/* 侧栏里的面板保持自身高度：侧栏滚动，面板不被压扁 */
.ai-col-side > * {
  flex: 0 0 auto;
}

/* 面板：安静的工具卡——不 hover 抬升、不发光、不入场 */
.panel {
  background: var(--bg-panel);
  border-radius: 16px;
  border: 1px solid rgba(255, 161, 23, 0.3);
  box-shadow: var(--shadow-panel);
  overflow: hidden;
  position: relative;
}

/* 面板头：统一 PanelHeader 的留白壳（标题条不再自绘底色与分隔线） */
.panel-head {
  padding: 0.875rem 1.2rem 0;
}

/* 3D 视口：高度不写死，由中间的列分配——面板头之外的空间全是它。
   宽度跟着容器走，Viewport 组件用 ResizeObserver 盯着真实尺寸，
   相机的宽高比会跟着一起改（否则视口一变窄，场景就被拉成竖长条）。 */
.ai-viewport {
  position: relative;
  width: 100%;
  flex: 1;
  min-height: 260px;
  overflow: hidden;
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
  color: var(--accent-2);
}

.ai-spinner {
  width: 5rem;
  height: 5rem;
  margin-bottom: 1.25rem;
  border: 4px solid var(--accent-2);
  border-top-color: transparent;
  border-radius: 9999px;
  animation: spin 1s linear infinite;
}

.ai-loading-title {
  margin-bottom: 0.5rem;
  color: var(--text-1);
  font-size: 1.25rem;
  font-weight: 500;
}

.ai-loading-sub {
  color: var(--accent-2);
  font-size: 0.875rem;
}

.ai-progress {
  width: 18rem;
  height: 0.375rem;
  margin-top: 1.25rem;
  overflow: hidden;
  border-radius: 9999px;
  background: var(--bg-inset);
}

.ai-progress-bar {
  height: 100%;
  border-radius: 9999px;
  background: var(--accent-2);
}

/* 操作提示卡：按需显示（H 键切换），常驻噪音已去掉 */
.ai-hint {
  position: absolute;
  left: 1.25rem;
  bottom: 1.25rem;
  padding: 0.75rem 1rem;
  color: var(--text-1);
  font-size: 0.875rem;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 161, 23, 0.4);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-pop);
}

.ai-hint-row {
  display: flex;
  align-items: center;
  margin-bottom: 0.5rem;
}

.ai-hint-row-last {
  margin-bottom: 0;
}

/* 提示行里的键位小徽标：内容是文字（左键 / 滚轮 / Shift），宽度随内容走 */
.control-key {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 28px;
  height: 22px;
  margin-right: 0.5rem;
  padding: 0 0.45rem;
  background: rgba(255, 161, 23, 0.2);
  border: 1px solid rgba(255, 161, 23, 0.4);
  border-radius: 6px;
  font-size: var(--text-xs);
  flex-shrink: 0;
}

/* 视角指示器 */
.ai-camera-panel {
  position: absolute;
  top: 1.25rem;
  right: 1.25rem;
  padding: 0.75rem;
  color: var(--accent-2);
  font-size: 0.875rem;
  background: rgba(0, 0, 0, 0.8);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 161, 23, 0.4);
  border-radius: 0.75rem;
  box-shadow: var(--shadow-pop);
}

.ai-camera-title {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 0.5rem;
  font-weight: 500;
}

.ai-icon {
  width: 1.25rem;
  height: 1.25rem;
  margin-right: 0.5rem;
  flex-shrink: 0;
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
  background: var(--bg-panel);
  color: var(--text-1);
}

/* 键位图里的占位格：留白，不画成一个假按键 */
.ai-key-blank {
  background: transparent;
}

/* R 键横跨整行——它是复位，不是方向键的一部分 */
.ai-key-wide {
  grid-column: span 3;
}

.ai-key-active {
  background: rgba(255, 161, 23, 0.3);
  color: var(--accent-2);
  font-weight: 600;
}

.ai-camera-hint {
  margin-top: 0.5rem;
  color: var(--text-2);
  font-size: 0.6875rem;
  line-height: 1.6;
}

/* 语义色状态点（页头状态 chip 用）：红=LLM 降级、绿=运行中、琥珀=已暂停 */
.ai-dot-red {
  background: var(--danger);
}

.ai-dot-amber {
  background: var(--accent-2);
}

.ai-dot-green {
  background: var(--success);
}

/* ==========================================================================
   响应式
   ========================================================================== */

/* 1180–1439px：24 栏下左右各 5 栏只有 245–290px，环境配置与调试面板被挤扁。
   改 6/12/6：中栏让出约 2 栏（≈100px），侧栏回到 ≈300px 以上。
   取舍：不用「侧栏加 min-width」——轨道是 minmax(0, 1fr)，item 的 min-width
   撑不大轨道、只会让面板溢出压到中栏上；也不动 1440 以上的 5/14/5
   （那时侧栏已 ≥300px，够用）。窄于 1180 直接堆叠，见下一个断点。 */
@media (max-width: 1439px) {
  .ai-col-left,
  .ai-col-right {
    grid-column: span 6;
  }

  .ai-col-center {
    grid-column: span 12;
  }
}

/* 窄屏：放弃「一屏占满」，回到正常滚动的堆叠布局；3D 视图排到最前。
   写在 1439px 断点之后：≤1180 时堆叠的 span 1 / span 2 覆盖上面的 6/12/6。 */
@media (max-width: 1180px) {
  .ai-col-center {
    order: -1;
  }

  .ai-col-left {
    margin-bottom: 1rem;
  }

  .ai-playground-container {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .ai-layout {
    grid-template-columns: repeat(2, minmax(0, 1fr));
    grid-template-rows: none;
    grid-auto-rows: auto;
  }

  .ai-col-left,
  .ai-col-center {
    grid-column: span 1;
  }

  .ai-col-right {
    grid-column: span 2;
  }

  .ai-col-side {
    overflow: visible;
  }

  .ai-viewport {
    flex: none;
    height: 60vh;
    min-height: 420px;
  }
}

@media (max-width: 768px) {
  .control-key {
    min-width: 24px;
    height: 20px;
    font-size: 11px;
  }

  /* 触屏没有键盘操作，悬浮提示层直接不渲染 */
  .ai-hint {
    display: none;
  }

  .ai-camera-panel {
    display: none;
  }
}
</style>
