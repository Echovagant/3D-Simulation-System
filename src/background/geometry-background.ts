// src/background/geometry-background.ts
import * as THREE from 'three'

/**
 * 「几何空间」背景（蜘蛛侠·镜像空间意象 × 黑金主题）：
 *
 * - 主视觉：一个 z = f(x, y, t) 的**数学函数曲面线框**，顶点随时间缓慢
 *   波动——「复杂数学函数图形（具备 x/y/z 轴）」的直接呈现；
 * - 纵深：向远处延伸的**立方体线框阵列**（镜像空间的无限重复结构）；
 * - 地面：三维坐标网格（GridHelper）——仿真平台的身份符号。
 *
 * 全部元素用 LineSegments/EdgesGeometry（线框，不画实体面）：
 * 低多边形 + 金色发光线 + 深灰雾衰减，背景安静但一眼可辨「这是数学」。
 *
 * 性能守卫（对齐 Astrato 工具类背景守则）：
 * - 30fps 节流（背景不需要 60fps）；
 * - document.hidden / reduced-motion 时暂停或静帧；
 * - dispose 完整（几何/材质/渲染循环）。
 */

export interface GeometryBackgroundHandle {
  dispose: () => void
}

/** 数学界常客：径向衰减的多频波纹叠加——「难但好看」的典型函数形状。 */
function surfaceHeight(x: number, y: number, t: number): number {
  const r2 = x * x + y * y
  const falloff = Math.exp(-0.06 * r2)
  return (
    0.55 * Math.sin(1.4 * x + t * 0.9) * Math.cos(1.4 * y - t * 0.6) * falloff +
    0.3 * Math.sin(0.7 * (x + y) + t * 0.4) * falloff
  )
}

export function mountGeometryBackground(canvas: HTMLCanvasElement): GeometryBackgroundHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power', // 背景层用核显即可，独显留给主视口
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight)

  const scene = new THREE.Scene()
  scene.background = null // 透明：让 .app-background 的缎面渐变透出来打底

  // 雾与背景同色系（深灰），远端元素淡出避免边缘硬切
  const fog = new THREE.Fog(0x151518, 26, 60)

  const camera = new THREE.PerspectiveCamera(
    55,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  )
  camera.position.set(0, 6.5, 16)
  camera.lookAt(0, 1.5, 0)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const goldBright = new THREE.LineBasicMaterial({
    color: 0xffd76a,
    transparent: true,
    opacity: 0.85,
  })
  const goldMid = new THREE.LineBasicMaterial({
    color: 0xd4af37,
    transparent: true,
    opacity: 0.45,
    fog: true,
  })
  const goldFaint = new THREE.LineBasicMaterial({
    color: 0xb8940f,
    transparent: true,
    opacity: 0.22,
    fog: true,
  })
  track(goldBright)
  track(goldMid)
  track(goldFaint)

  // ---- 主视觉：函数曲面线框（40×40 网格，顶点动画） ----
  const SURF = 40
  const SPAN = 18
  const surfGeo = new THREE.BufferGeometry()
  const positions = new Float32Array(SURF * SURF * 2 * 3) // 每格两条线段
  surfGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  const surfLines = new THREE.LineSegments(surfGeo, goldBright)
  scene.add(surfLines)
  track(surfGeo)
  track(goldBright)

  const updateSurface = (t: number): void => {
    let idx = 0
    const half = SPAN / 2
    const step = SPAN / (SURF - 1)
    // 横向线（y 固定、x 扫过）
    for (let iy = 0; iy < SURF; iy++) {
      const y = -half + iy * step
      for (let ix = 0; ix < SURF - 1; ix++) {
        const x0 = -half + ix * step
        const x1 = x0 + step
        positions[idx++] = x0
        positions[idx++] = surfaceHeight(x0, y, t)
        positions[idx++] = y
        positions[idx++] = x1
        positions[idx++] = surfaceHeight(x1, y, t)
        positions[idx++] = y
      }
    }
    // 纵向线（x 固定、y 扫过）
    for (let ix = 0; ix < SURF; ix++) {
      const x = -half + ix * step
      for (let iy = 0; iy < SURF - 1; iy++) {
        const y0 = -half + iy * step
        const y1 = y0 + step
        positions[idx++] = x
        positions[idx++] = surfaceHeight(x, y0, t)
        positions[idx++] = y0
        positions[idx++] = x
        positions[idx++] = surfaceHeight(x, y1, t)
        positions[idx++] = y1
      }
    }
    surfGeo.attributes.position.needsUpdate = true
  }

  // ---- 纵深：立方体线框阵列（镜像空间的重复结构） ----
  const cubeEdges = track(new THREE.EdgesGeometry(new THREE.BoxGeometry(2.4, 2.4, 2.4)))
  const cubeRows: Array<[number, number, number, number]> = [
    // [x, y, z, 尺度]
    [-9, 2.2, -14, 1.0],
    [9, 3.0, -16, 1.4],
    [-13, 4.0, -22, 1.8],
    [13, 2.0, -24, 1.2],
    [0, 5.5, -30, 2.2],
  ]
  const cubes: THREE.LineSegments[] = []
  cubeRows.forEach(([x, y, z, s], i) => {
    const cube = new THREE.LineSegments(cubeEdges, goldFaint)
    cube.position.set(x, y, z)
    cube.scale.setScalar(s)
    cube.rotation.set(0.2, 0.5, 0)
    scene.add(cube)
    cubes.push(cube)
  })

  // ---- 地面：三维坐标网格（身份符号） ----
  const grid = new THREE.GridHelper(60, 40, 0x8a7620, 0x3a3420)
  ;(grid.material as THREE.Material).transparent = true
  ;(grid.material as THREE.Material).opacity = 0.3
  scene.add(grid)
  track(grid.geometry)
  track(grid.material as THREE.Material)

  // ---- 坐标轴：三条发亮轴线（x/y/z 的存在感） ----
  const axisGeo = track(new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-14, 0, 0),
    new THREE.Vector3(14, 0, 0),
  ]))
  const axisX = new THREE.LineSegments(axisGeo, goldMid)
  scene.add(axisX)
  const axisZ = new THREE.LineSegments(axisGeo, goldMid)
  axisZ.rotation.y = Math.PI / 2
  scene.add(axisZ)

  // ---- 动画循环：30fps 节流 + 页面隐藏暂停 + reduced-motion 静帧 ----
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let rafId = 0
  let lastFrame = 0
  let disposed = false
  const FRAME_INTERVAL = 1000 / 30

  const renderFrame = (now: number): void => {
    if (disposed) return
    rafId = requestAnimationFrame(renderFrame)
    if (now - lastFrame < FRAME_INTERVAL) return
    lastFrame = now

    const t = now / 1000
    updateSurface(t)

    // 相机缓慢漂移（镜像空间的空间失重感）
    camera.position.x = Math.sin(t * 0.11) * 1.6
    camera.position.y = 6.5 + Math.sin(t * 0.07) * 0.5
    camera.lookAt(0, 1.2, -4)
    cubeRows.forEach(([x, y, z, s], i) => {
      const cube = cubes[i]
      cube.rotation.y = 0.5 + t * (0.06 + i * 0.015)
      cube.rotation.x = 0.2 + Math.sin(t * 0.1 + i) * 0.08
      cube.scale.setScalar(s)
      cube.position.y = y + Math.sin(t * 0.13 + i * 1.7) * 0.3
    })

    renderer.render(scene, camera)
  }

  const startLoop = (): void => {
    if (disposed || rafId) return
    if (reducedMotion) {
      updateSurface(0)
      renderer.render(scene, camera) // 静帧
      return
    }
    rafId = requestAnimationFrame(renderFrame)
  }

  const onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(rafId)
      rafId = 0
    } else {
      lastFrame = performance.now()
      startLoop()
    }
  }
  document.addEventListener('visibilitychange', onVisibility)
  window.addEventListener('resize', onResize)

  function onResize(): void {
    if (disposed) return
    renderer.setSize(window.innerWidth, window.innerHeight)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }

  updateSurface(0)
  startLoop()

  return {
    dispose: () => {
      disposed = true
      cancelAnimationFrame(rafId)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('resize', onResize)
      disposables.forEach((item) => item.dispose())
      renderer.dispose()
      scene.clear()
    },
  }
}
