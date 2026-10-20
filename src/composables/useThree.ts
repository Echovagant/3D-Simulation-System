// src/composables/useThree.ts
import { shallowRef, type ShallowRef } from 'vue'
import * as THREE from 'three'

/**
 * `useThree` 的对外契约。
 *
 * ⚠️ scene / camera / renderer **全应用共享同一份**（模块级单例）。
 * 场景编辑器走的是 `useSceneEditor` 自己的 three 上下文，与这里互不影响。
 *
 * ⚠️ 三个对象一律用 `shallowRef` 持有——Three.js 对象绝不能被 Vue 深度代理
 * （代理会破坏对象身份比较，并把整棵场景图变成响应式）。
 */
export interface ThreeInstance {
  scene: ShallowRef<THREE.Scene | null>
  camera: ShallowRef<THREE.PerspectiveCamera | null>
  renderer: ShallowRef<THREE.WebGLRenderer | null>
  initThree: () => void
  initRenderer: (
    canvas: HTMLCanvasElement,
    width?: number,
    height?: number,
  ) => THREE.WebGLRenderer | null
  disposeThree: () => void
}

// 模块级单例：所有调用方拿到的都是这三个 ref
const scene = shallowRef<THREE.Scene | null>(null)
const camera = shallowRef<THREE.PerspectiveCamera | null>(null)
const renderer = shallowRef<THREE.WebGLRenderer | null>(null)

/** 创建（或补齐）场景与相机。重复调用不会清空已经建好的场景。 */
const initThree = (): void => {
  if (!scene.value) {
    scene.value = new THREE.Scene()
    scene.value.background = new THREE.Color(0x05070d)
  }
  if (!camera.value) {
    camera.value = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    )
    camera.value.position.set(14, 11, 14)
    camera.value.lookAt(0, 0, 0)
  }
}

/**
 * 创建渲染器并挂到给定 canvas 上。
 *
 * 渲染器的**唯一持有者是 useThree**——`useRenderer` 只是"用某个容器初始化"的动作。
 */
const initRenderer = (
  canvas: HTMLCanvasElement,
  width?: number,
  height?: number,
): THREE.WebGLRenderer | null => {
  if (renderer.value) {
    renderer.value.dispose()
    renderer.value = null
  }
  const resolvedWidth = width && width > 0 ? width : window.innerWidth
  const resolvedHeight = height && height > 0 ? height : window.innerHeight
  const next = new THREE.WebGLRenderer({ canvas, antialias: true })
  next.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  next.setSize(resolvedWidth, resolvedHeight)
  renderer.value = next
  return next
}

/** 释放渲染器与场景里的几何体/材质（离开页面时调用，避免 GPU 与显存泄漏）。 */
const disposeThree = (): void => {
  if (renderer.value) {
    renderer.value.dispose()
    renderer.value = null
  }
  if (scene.value) {
    scene.value.traverse((object) => {
      const mesh = object as THREE.Mesh
      if (mesh.geometry) mesh.geometry.dispose()
      const material = mesh.material
      if (Array.isArray(material)) material.forEach((item) => item.dispose())
      else if (material) material.dispose()
    })
  }
  scene.value = null
  camera.value = null
}

export function useThree(): ThreeInstance {
  return { scene, camera, renderer, initThree, initRenderer, disposeThree }
}
