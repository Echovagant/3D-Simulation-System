// src/composables/useRenderer.ts
import { onMounted, onUnmounted, type ShallowRef } from 'vue'
import * as THREE from 'three'
import { useThree } from './useThree'

/**
 * `useRenderer` 不再持有渲染器，只是「用某个容器把渲染器初始化出来」这个动作。
 *
 * 渲染器的**唯一持有者是 `useThree`**（模块级单例），
 * 因此渲染循环与轨道控制器拿到的必然是同一个渲染器。
 */
export interface RendererInstance {
  renderer: ShallowRef<THREE.WebGLRenderer | null>
  initRenderer: (container: HTMLElement) => THREE.WebGLRenderer | null
  handleResize: () => void
}

export function useRenderer(): RendererInstance {
  const { renderer, camera, initRenderer: initThreeRenderer } = useThree()

  const initRenderer = (container: HTMLElement): THREE.WebGLRenderer | null => {
    // canvas 由这里创建：display:block 去掉行内元素底部的空隙，
    // 否则容器会比画面多出几像素，出现滚动条
    const canvas = document.createElement('canvas')
    canvas.style.display = 'block'
    container.appendChild(canvas)
    return initThreeRenderer(canvas, container.clientWidth, container.clientHeight)
  }

  /**
   * 跟随窗口尺寸调整渲染器与相机比例。
   *
   * 画布还没挂进容器时（初始化早期）退回窗口尺寸；
   * Math.max(height, 1) 是防极端布局下除以 0。
   */
  const handleResize = (): void => {
    const current = renderer.value
    if (!current) return
    const parent = current.domElement.parentElement
    const width = parent?.clientWidth || window.innerWidth
    const height = parent?.clientHeight || window.innerHeight
    current.setSize(width, height)
    if (camera.value) {
      camera.value.aspect = width / Math.max(height, 1)
      camera.value.updateProjectionMatrix()
    }
  }

  onMounted(() => window.addEventListener('resize', handleResize))
  onUnmounted(() => window.removeEventListener('resize', handleResize))

  return { renderer, initRenderer, handleResize }
}
