// src/composables/useControls.ts
import { ref, watch, type Ref, onMounted, onUnmounted } from 'vue'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls'
import { useThree } from './useThree'

export interface ControlsInstance {
  controls: Ref<OrbitControls | null>
  initControls: () => void
  updateControls: () => void
  disposeControls: () => void
}

/**
 * 轨道控制器。
 *
 * ⚠️ 相机与渲染器来自 `useThree` 单例——单例化之后这里的
 * `camera.value && renderer.value` 守卫才可能通过（此前拿到的是另一套从未初始化的实例）。
 */
export function useControls(): ControlsInstance {
  const { camera, renderer } = useThree()
  const controls = ref<OrbitControls | null>(null)

  const disposeControls = (): void => {
    if (controls.value) {
      controls.value.dispose()
      controls.value = null
    }
  }

  const initControls = (): void => {
    if (!camera.value || !renderer.value) return
    disposeControls()
    controls.value = new OrbitControls(camera.value, renderer.value.domElement)
    controls.value.enableDamping = true
    controls.value.dampingFactor = 0.05
  }

  const updateControls = (): void => {
    if (controls.value) {
      controls.value.update()
    }
  }

  // 渲染器就绪后自动补建控制器（渲染器晚于组件挂载创建时也能生效）
  watch(renderer, (current) => {
    if (current) initControls()
  })

  onMounted(() => {
    initControls()
  })

  onUnmounted(() => {
    disposeControls()
  })

  return { controls, initControls, updateControls, disposeControls }
}
