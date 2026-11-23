/**
 * 场景呈现的统一口径：背景、雾、地面、灯光与色彩管线。
 *
 * 编辑器视口与渲染页必须共用这一份，否则「编辑器里看到的」与
 * 「导出视频里看到的」是两套画面（旧版就有这个问题：渲染页的
 * 环境光比编辑器弱，同一场景两边亮度不一致）。
 *
 * 视觉方向：低饱和冷灰背景 + 暖色主光 + 冷色补光。
 * 目的是让基础体场景也读得出体积与层次，而不是一片均匀的灰。
 */
import * as THREE from 'three'

export const SCENE_PRESENTATION = {
  /** 背景色：偏蓝的深灰，比纯黑更有空气感 */
  background: 0x121820,
  /** 雾从场地半径的 0.9 倍开始，到 2.6 倍完全吃掉——远处结构自然退场 */
  fogNearFactor: 0.9,
  fogFarFactor: 2.6,
  /** 地面：深冷灰，让彩色物体跳出来 */
  groundColor: 0x2b333d,
  groundRoughness: 0.94,
  /** 网格线：主/次两级，都比地面略亮但不抢主体 */
  gridMajor: 0x4d5a68,
  gridMinor: 0x333d49,
  /** 半球光：天空冷、地面暗，给暗部一点方向感 */
  hemiSky: 0xa9c8ff,
  hemiGround: 0x1d232b,
  hemiIntensity: 0.55,
  /** 主光：暖白，负责阴影与主体造型 */
  keyLight: 0xfff1dc,
  keyIntensity: 2.0,
  /** 补光：冷蓝，压掉背光面的死黑 */
  fillLight: 0x8fb4ff,
  fillIntensity: 0.65,
  /** 轮廓光：从背后勾边，深色结构才分得开 */
  rimLight: 0x9fc6ff,
  rimIntensity: 0.7,
  /** 环境光：只留一点点托底，避免把明暗关系冲平 */
  ambientIntensity: 0.16,
  /** ACES 曝光：略高于 1，画面更透 */
  exposure: 1.12,
  /** 默认垂直视野角（度） */
  defaultFov: 50,
  /** 基础体材质：金属度保持很低（没有环境贴图时高金属会发黑） */
  materialMetalness: 0.08,
  materialRoughness: 0.58,
} as const

/**
 * 背景渐变（上深下更深）。
 *
 * 纯色背景会让整个画面像「工程视图」；一层很轻的垂直渐变就能把天空/地面
 * 分开，物体的剪影也更容易读。纹理只生成一次，换场地不重复创建。
 */
let backgroundTexture: THREE.CanvasTexture | null = null
const getBackgroundTexture = (): THREE.CanvasTexture | null => {
  if (backgroundTexture) return backgroundTexture
  if (typeof document === 'undefined') return null
  try {
    const canvas = document.createElement('canvas')
    canvas.width = 2
    canvas.height = 256
    const context = canvas.getContext('2d')
    if (!context) return null
    const gradient = context.createLinearGradient(0, 0, 0, 256)
    gradient.addColorStop(0, '#1d2836')
    gradient.addColorStop(0.55, '#121a23')
    gradient.addColorStop(1, '#0a0e13')
    context.fillStyle = gradient
    context.fillRect(0, 0, 2, 256)
    backgroundTexture = new THREE.CanvasTexture(canvas)
    backgroundTexture.colorSpace = THREE.SRGBColorSpace
    return backgroundTexture
  } catch {
    return null
  }
}

/**
 * 给渲染器装上与「成品画面」一致的色彩管线。
 *
 * - ACES Filmic：高光不会直接切白，暖光下的物体有胶片感
 * - sRGB 输出：颜色与材质在编辑器 / 渲染页 / 截图里一致
 * - PCFSoft：阴影边缘柔和，不是硬邦邦的锯齿块
 */
export const applyCinematicRenderer = (renderer: THREE.WebGLRenderer): void => {
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = SCENE_PRESENTATION.exposure
  renderer.outputColorSpace = THREE.SRGBColorSpace
}

/** 背景与雾跟着场地边长走：换 60×60 场地时雾必须同步后退 */
export const applySceneAtmosphere = (scene: THREE.Scene, worldSize: number): void => {
  scene.background = getBackgroundTexture() ?? new THREE.Color(SCENE_PRESENTATION.background)
  scene.fog = new THREE.Fog(
    SCENE_PRESENTATION.background,
    worldSize * SCENE_PRESENTATION.fogNearFactor,
    worldSize * SCENE_PRESENTATION.fogFarFactor,
  )
}

/** 网格线颜色（主/次）——GridHelper 的构造参数顺序是「中心线 / 网格线」 */
export const createGrid = (worldSize: number): THREE.GridHelper => {
  const grid = new THREE.GridHelper(
    worldSize,
    worldSize,
    SCENE_PRESENTATION.gridMajor,
    SCENE_PRESENTATION.gridMinor,
  )
  // 与地面齐平时会 z-fighting：抬高 1 毫米
  grid.position.y = 0.001
  return grid
}
