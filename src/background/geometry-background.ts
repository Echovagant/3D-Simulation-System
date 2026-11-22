// src/background/geometry-background.ts
import * as THREE from 'three'

/**
 * 「镜像空间」背景——阿基米德螺旋隧道（蜘蛛侠·英雄无归高潮镜头的几何重构）：
 *
 * 电影台词点题：「Is that an Archimedean spiral? … Square the radius.
 * Divide by pi. Plot points along the curve.」
 *
 * - **螺旋隧道壁**：立方体线框按阿基米德螺旋排布（r = a + b·θ，θ 采样三圈，
 *   半径线性增长、z 向深处延伸），围成一条向无限深处滚动的隧道；
 * - **蛛网射线**：从隧道轴心向「沿曲线标出的每个点位」发射金色细线——
 *   精准计算角度、射出蛛丝、困住目标的那一幕；
 * - **相机**：悬在隧道轴心，隧道向相机滚动（无限飞行感），螺旋整体缓慢自转。
 *
 * 性能守卫：30fps 节流、visibilitychange 暂停、reduced-motion 静帧、dispose 完整。
 */

export interface GeometryBackgroundHandle {
  dispose: () => void
}

/** 阿基米德螺旋：r = a + b·θ（θ 取弧度；台词里的「半径平方除以 π」是它的操作化表达） */
const SPIRAL_A = 6.5
const SPIRAL_B = 1.35 // r 随每 π 增长 1.35
const TURNS = 3
const CUBES_PER_TURN = 19
const CUBE_COUNT = TURNS * CUBES_PER_TURN // 57 个锚点
const TUNNEL_START_Z = -8
const TUNNEL_LENGTH = 66 // 从 -8 到 -74，深处交给雾
const TUNNEL_SPEED = 2.2 // 隧道向相机滚动的速度（单位/秒）

/** 第 i 个锚点的「标称 θ」：沿曲线均匀标点（plot points along the curve） */
function anchorTheta(i: number): number {
  return (i / CUBES_PER_TURN) * TURNS * Math.PI * 2
}

export function mountGeometryBackground(canvas: HTMLCanvasElement): GeometryBackgroundHandle {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    powerPreference: 'low-power', // 背景层用核显，独显留给主视口
  })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  renderer.setSize(window.innerWidth, window.innerHeight, false)

  const scene = new THREE.Scene()
  scene.background = null // 透明：缎面渐变（含顶部暖金微光）从 CSS 透出打底
  const fog = new THREE.Fog(0x101013, 22, 62)

  const camera = new THREE.PerspectiveCamera(
    62,
    window.innerWidth / window.innerHeight,
    0.1,
    120,
  )
  camera.position.set(0, 0, 4)

  const disposables: Array<{ dispose: () => void }> = []
  const track = <T extends { dispose: () => void }>(item: T): T => {
    disposables.push(item)
    return item
  }

  const gold = new THREE.LineBasicMaterial({
    color: 0xffd76a,
    transparent: true,
    opacity: 0.8,
  })
  const goldDim = new THREE.LineBasicMaterial({
    color: 0xd4af37,
    transparent: true,
    opacity: 0.4,
  })
  const silk = new THREE.LineBasicMaterial({
    color: 0xffe9a8,
    transparent: true,
    opacity: 0.3,
  })
  track(gold)
  track(goldDim)
  track(silk)

  // ---- 螺旋隧道壁：57 个立方体线框锚点（阿基米德螺旋，Plot points along the curve） ----
  const cubeEdges = track(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.9, 1.9, 1.9)))
  interface Anchor {
    cube: THREE.LineSegments
    baseZ: number // 标称深度（隧道滚动时循环）
    theta: number // 标称螺旋角
  }
  const anchors: Anchor[] = []
  for (let i = 0; i < CUBE_COUNT; i++) {
    const cube = new THREE.LineSegments(cubeEdges, goldDim)
    scene.add(cube)
    anchors.push({ cube, baseZ: 0, theta: anchorTheta(i) })
  }

  /** 按阿基米德螺旋摆放第 i 个锚点（depth 由隧道滚动相位决定） */
  const placeAnchor = (anchor: Anchor, depth: number): void => {
    const theta = anchor.theta
    const r = SPIRAL_A + SPIRAL_B * theta
    anchor.cube.position.set(r * Math.cos(theta), r * Math.sin(theta) * 0.62, depth)
    const scale = 0.9 + (theta / (TURNS * Math.PI * 2)) * 0.9 // 越外圈越大（近大远小的隧道壁）
    anchor.cube.scale.setScalar(scale)
  }

  /** 隧道滚动：depth += speed·dt，越过相机后回收到最深处（θ 结构不变 → 螺旋永续） */
  const layout = (scrollPhase: number, t: number): void => {
    anchors.forEach((anchor, i) => {
      let depth = TUNNEL_START_Z + ((anchor.baseZ + scrollPhase) % TUNNEL_LENGTH)
      if (depth > 4) depth -= TUNNEL_LENGTH // 越过相机后方 → 回收到隧道深处
      placeAnchor(anchor, depth)
      // 自转：每块缓慢且不同相
      anchor.cube.rotation.set(0.25 + Math.sin(t * 0.12 + i) * 0.1, t * (0.1 + (i % 5) * 0.02), 0)
    })
  }

  // 初始化 baseZ：57 个锚点沿隧道均匀分布（depth 均分，theta 保持螺旋序）
  anchors.forEach((anchor, i) => {
    anchor.baseZ = -(i / CUBE_COUNT) * TUNNEL_LENGTH
  })

  // ---- 蛛网射线：轴心 → 每个锚点（「沿曲线标出点位」后射出蛛丝） ----
  const rayGeo = new THREE.BufferGeometry()
  const rayPositions = new Float32Array(CUBE_COUNT * 2 * 3) // 每条线 2 端点
  rayGeo.setAttribute('position', new THREE.BufferAttribute(rayPositions, 3))
  const rayLines = new THREE.LineSegments(rayGeo, silk)
  scene.add(rayLines)
  track(rayGeo)

  const updateRays = (originZ: number, t: number): void => {
    let idx = 0
    anchors.forEach((anchor, i) => {
      const pulse = 0.18 + 0.14 * Math.sin(t * 1.3 + i * 0.7) // 蛛丝呼吸
      ;(silk as THREE.LineBasicMaterial).opacity = 0.22 + 0.12 * Math.sin(t * 0.8)
      const p = anchor.cube.position
      rayPositions[idx++] = 0 // 轴心 x
      rayPositions[idx++] = 0 // 轴心 y
      rayPositions[idx++] = originZ
      rayPositions[idx++] = p.x
      rayPositions[idx++] = p.y
      rayPositions[idx++] = p.z
      void pulse
    })
    rayGeo.attributes.position.needsUpdate = true
  }

  // ---- 隧道深处/轴心的光感：一个发亮的轴心终点球（线框球，光源意象） ----
  const endSphereEdges = track(new THREE.EdgesGeometry(new THREE.SphereGeometry(2.2, 16, 12)))
  const endSphere = new THREE.LineSegments(endSphereEdges, gold)
  endSphere.position.set(0, 0, -70)
  scene.add(endSphere)
  track(endSphereEdges)

  // ---- 动画循环：30fps 节流 + 页面隐藏暂停 + reduced-motion 静帧 ----
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  let rafId = 0
  let lastFrame = 0
  let disposed = false
  let scroll = 0
  const FRAME_INTERVAL = 1000 / 30

  const renderFrame = (now: number): void => {
    if (disposed) return
    rafId = requestAnimationFrame(renderFrame)
    if (now - lastFrame < FRAME_INTERVAL) return
    lastFrame = now

    const t = now / 1000
    const dt = Math.min((now - lastFrame) / 1000, 0.05)
    scroll = (scroll + TUNNEL_SPEED * dt) % TUNNEL_LENGTH

    layout(scroll, t)
    updateRays(-4, t)

    // 螺旋整体缓慢自转（镜像空间被奇异博士扭转的感觉）
    scene.rotation.z = t * 0.05

    // 轴心终点球缓慢脉动
    endSphere.scale.setScalar(1 + Math.sin(t * 0.6) * 0.08)
    endSphere.rotation.y = t * 0.2

    // 相机极轻微的呼吸晃动（手持感）
    camera.position.x = Math.sin(t * 0.21) * 0.25
    camera.position.y = Math.sin(t * 0.17) * 0.2
    camera.lookAt(0, 0, -30)

    renderer.render(scene, camera)
  }

  const startLoop = (): void => {
    if (disposed || rafId) return
    if (reducedMotion) {
      layout(0, 0)
      updateRays(-4, 0)
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
      rayGeo.dispose()
      renderer.dispose()
      scene.clear()
    },
  }
}
