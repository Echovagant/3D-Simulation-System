// src/composables/useScene.ts
import { onMounted, watch } from 'vue'
import * as THREE from 'three'
import { useThree } from './useThree'

const GROUND_NAME = 'ai-arena-ground'
const GRID_NAME = 'ai-arena-grid'
const AMBIENT_LIGHT_NAME = 'ai-arena-ambient-light'
const DIRECTIONAL_LIGHT_NAME = 'ai-arena-directional-light'

/**
 * 演武场的静态布景：地面 + 网格 + 灯光。
 *
 * ⚠️ 场景本身由 `useThree` 单例持有，这里只往里放东西；
 * `addLights` / `addGround` 都是**幂等**的（按名字查重），
 * 避免历史上"onMounted 里重复调用"造成的 2 个地面 + 4 个灯。
 */
export function useScene() {
  const { scene, camera, renderer, initThree } = useThree()

  /** 环境光 + 平行光（幂等） */
  const addLights = (): void => {
    if (!scene.value) return
    if (!scene.value.getObjectByName(AMBIENT_LIGHT_NAME)) {
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.9)
      ambientLight.name = AMBIENT_LIGHT_NAME
      scene.value.add(ambientLight)
    }
    if (!scene.value.getObjectByName(DIRECTIONAL_LIGHT_NAME)) {
      const directionalLight = new THREE.DirectionalLight(0xffffff, 2)
      directionalLight.name = DIRECTIONAL_LIGHT_NAME
      directionalLight.position.set(8, 14, 10)
      scene.value.add(directionalLight)
    }
  }

  /** 地面平面 + 网格辅助线（幂等） */
  const addGround = (): void => {
    if (!scene.value) return
    if (!scene.value.getObjectByName(GROUND_NAME)) {
      const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(60, 60),
        new THREE.MeshStandardMaterial({ color: 0x1f2530, roughness: 0.95, metalness: 0 }),
      )
      ground.name = GROUND_NAME
      ground.rotation.x = -Math.PI / 2
      ground.position.y = 0
      ground.receiveShadow = true
      scene.value.add(ground)
    }
    if (!scene.value.getObjectByName(GRID_NAME)) {
      // 网格不用智能体那道亮黄——画面里唯一的黄色像素应当是智能体本身
      const grid = new THREE.GridHelper(60, 60, 0x6f7c8c, 0x39414f)
      grid.name = GRID_NAME
      grid.position.y = 0.01
      scene.value.add(grid)
    }
  }

  /** 确保场景存在并把布景放进去（可重复调用） */
  const initScene = (): void => {
    initThree()
    addLights()
    addGround()
  }

  // 渲染器就绪后按画布尺寸校正相机比例（保持画面不失真）
  watch(renderer, (current) => {
    if (!current || !camera.value) return
    const element = current.domElement
    const width = element.clientWidth || element.width || window.innerWidth
    const height = element.clientHeight || element.height || window.innerHeight
    camera.value.aspect = width / Math.max(height, 1)
    camera.value.updateProjectionMatrix()
  })

  onMounted(() => {
    initScene()
  })

  return {
    scene,
    initScene,
    addLights,
    addGround,
  }
}
