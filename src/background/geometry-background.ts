// src/background/geometry-background.ts
import * as THREE from 'three'

/**
 * 「镜像空间」背景——阿基米德螺旋全景（蜘蛛侠·英雄无归的几何重构）：
 *
 * 电影台词点题：「Is that an Archimedean spiral? … Square the radius.
 * Divide by pi. Plot points along the curve.」
 *
 * - **螺旋线全貌**：r = a + b·θ 的连续金色螺旋线（三圈），斜上方俯瞰
 *   一览无余——「镜像空间只是几何学」的直接可视化；
 * - **锚点立方体**：沿螺旋均匀标点的立方体线框（Plot points along the
 *   curve 的操作化表达）；
 * - **蛛网射线**：轴心 → 每个锚点的金色细线（呼吸脉动）——射出蛛丝
 *   困住目标的那一幕；
 * - 整体绕轴缓慢旋转（镜像空间被扭转的感觉），相机固定俯瞰。
 *
 * 性能守卫：30fps 节流、visibilitychange 暂停、reduced-motion 静帧、dispose 完整。
 */

export interface GeometryBackgroundHandle {
  dispose: () => void
}

/** 阿基米德螺旋：r = a + b·θ（台词「半径平方除以 π」的操作化表达） */
const SPIRAL_A = 2.2
const SPIRAL_B = 0.95
const TURNS = 3
const CUBES_PER_TURN = 14
const SPIRAL_POINTS = 220 // 连续螺旋线的采样点数

export function mountGeometryBackground(canvas: HTMLCanvasElement): GeometryBackgroundHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight, false)

  const scene = new THREE.Scene()
  scene.background = null // 透明：缎面渐变（含顶部暖金微光）从 CSS 透出
  // 雾距按俯瞰相机（距原点 ~31）校准：近景清晰、螺旋外圈微淡——
  // 隧道版的 30/85 会把整个全景吞进浓雾（俯瞰距离起步就在雾区）
  const fog = new THREE.Fog(0x101013, 42, 110)

  // 斜上方俯瞰：螺旋全貌 + 蛛网放射 + 立方体一屏尽收
  const camera = new THREE.PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    200,
  )
  camera.position.set(0, 26, 17)
  camera.lookAt(0, 0, 0)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const gold = new THREE.LineBasicMaterial({
    color: 0xffd76a,
    transparent: true,
    opacity: 0.85,
  })
  const goldDim = new THREE.LineBasicMaterial({
    color: 0xd4af37,
    transparent: true,
    opacity: 0.45,
  })
  const silk = new THREE.LineBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 0.3,
  })
  track(gold)
  track(goldDim)
  track(silk)

  // 整个几何结构挂在一个 group 下：绕轴缓慢旋转 = 镜像空间被扭转
  const spiralGroup = new THREE.Group()
  scene.add(spiralGroup)

  /** 阿基米德螺旋在水平面上的点位（y=0 平面，y 轴向上） */
  const spiralPoint = (theta: number): THREE.Vector3 => {
    const r = SPIRAL_A + SPIRAL_B * theta
    return new THREE.Vector3(r * Math.cos(theta), 0, r * Math.sin(theta))
  }

  // ---- 连续螺旋线：r = a + b·θ 的直接可视化 ----
  const spiralGeo = track(new THREE.BufferGeometry().setFromPoints(
    Array.from({ length: SPIRAL_POINTS }, (_, i) =>
      spiralPoint((i / (SPIRAL_POINTS - 1)) * TURNS * Math.PI * 2),
    ),
  ))
  const spiralLine = new THREE.Line(spiralGeo, gold)
  spiralGroup.add(spiralLine)

  // ---- 锚点立方体：沿螺旋均匀标点（每圈 14 个，比螺旋线采样稀疏） ----
  const cubeEdges = track(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.1, 1.1, 1.1)))
  const CUBE_COUNT = TURNS * CUBES_PER_TURN
  const cubeAnchors: THREE.Vector3[] = []
  const cubes: THREE.LineSegments[] = []
  for (let i = 0; i < CUBE_COUNT; i++) {
    const theta = ((i + 0.5) / CUBE_COUNT) * TURNS * Math.PI * 2
    const pos = spiralPoint(theta)
    const cube = new THREE.LineSegments(cubeEdges, goldDim)
    cube.position.copy(pos)
    cube.rotation.y = theta // 朝向与螺旋切线一致
    cube.scale.setScalar(0.7 + (theta / (TURNS * Math.PI * 2)) * 0.8) // 外圈渐大
    spiralGroup.add(cube)
    cubes.push(cube)
    cubeAnchors.push(pos.clone())
  }

  // ---- 蛛网射线：轴心 → 每个锚点（呼吸脉动） ----
  const rayGeo = track(new THREE.BufferGeometry().setFromPoints(
    cubeAnchors.flatMap((p) => [new THREE.Vector3(0, 0.2, 0), p]),
  ))
  const rayLines = new THREE.LineSegments(rayGeo, silk)
  spiralGroup.add(rayLines)

  // ---- 轴心：蛛网的出发点（发亮线框球） ----
  const hubEdges = track(new THREE.EdgesGeometry(new THREE.SphereGeometry(0.9, 16, 12)))
  const hub = new THREE.LineSegments(hubEdges, gold)
  spiralGroup.add(hub)

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
    // 镜像空间被扭转：整体绕 y 轴缓转
    spiralGroup.rotation.y = t * 0.06
    // 蛛丝呼吸
    ;(silk as THREE.LineBasicMaterial).opacity = 0.24 + 0.12 * Math.sin(t * 0.9)
    // 轴心脉动
    hub.scale.setScalar(1 + Math.sin(t * 0.7) * 0.12)
    // 立方体随径向轻微起伏（异相，波浪从内向外传）
    cubes.forEach((cube, i) => {
      const theta = ((i + 0.5) / CUBE_COUNT) * TURNS * Math.PI * 2
      cube.position.y = Math.sin(t * 0.5 - theta * 0.5) * 0.35
    })

    renderer.render(scene, camera)
  }

  const startLoop = (): void => {
    if (disposed || rafId) return
    if (reducedMotion) {
      renderer.render(scene, camera) // reduced-motion：只画一帧静态全景
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
  window.addEventListener('resize', onResize)
  document.addEventListener('visibilitychange', onVisibility)

  function onResize(): void {
    if (disposed) return
    renderer.setSize(window.innerWidth, window.innerHeight, false)
    camera.aspect = window.innerWidth / window.innerHeight
    camera.updateProjectionMatrix()
  }

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
