// src/composables/useCamera.ts
import type { ShallowRef } from 'vue'
import * as THREE from 'three'
import { useThree } from './useThree'

/**
 * `useCamera` 是 `useThree` 单例相机的**薄封装**——
 * 它不再自己造一台相机（那曾经导致渲染循环用的是另一台相机）。
 */
export interface CameraInstance {
  activeCamera: ShallowRef<THREE.PerspectiveCamera | null>
  setCameraPosition: (x: number, y: number, z: number) => void
  setCameraFov: (fov: number) => void
  lookAt: (x: number, y: number, z: number) => void
}

export function useCamera(): CameraInstance {
  const { camera } = useThree()

  const setCameraPosition = (x: number, y: number, z: number): void => {
    if (!camera.value) return
    camera.value.position.set(x, y, z)
    camera.value.lookAt(0, 0, 0)
  }

  /**
   * 改视野角。
   *
   * ⚠️ 改了必须调 `updateProjectionMatrix()`，否则投影矩阵还是旧的——
   * 画面会一点没变，看起来像是这个函数没用。
   */
  const setCameraFov = (fov: number): void => {
    if (!camera.value) return
    camera.value.fov = fov
    camera.value.updateProjectionMatrix()
  }

  const lookAt = (x: number, y: number, z: number): void => {
    if (!camera.value) return
    camera.value.lookAt(x, y, z)
  }

  return { activeCamera: camera, setCameraPosition, setCameraFov, lookAt }
}
