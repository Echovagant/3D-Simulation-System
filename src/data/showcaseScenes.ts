/**
 * 精选场景：开箱即用的作品集。
 *
 * 这些不是「随机堆几个方块」的演示——每个场景对应一类真实用户：
 * 教学（斜面实验）、具身智能（障碍训练场）、企业展厅（陈列台）、创意可视化（城市天际线）。
 * 全部只用 cube / sphere / ramp 三种可重建基础体，不依赖模型库，打开即用。
 *
 * 作品感的三个来源（也是这一版重写的重点）：
 * 1. **构图**：每个场景都有明确的主次与留白，不是把物体撒满地面；
 * 2. **配色**：每个场景一套 60-30-10 的克制配色（结构色 / 辅助色 / 强调色）；
 * 3. **镜头**：文档自带机位与目标点，打开就是拍好的角度，不用先手动转视角。
 *
 * 结构体用 static 刚体：打开后不会自己塌掉；球体等演示件用 dynamic，
 * 点「播放」就能看到运动。
 */
import type { SceneCamera, SceneDocument, SceneDocumentObject } from '@/types'

export type ShowcaseAudience = '教学' | '具身智能' | '企业办公' | '创意可视化'

export interface ShowcaseScene {
  id: string
  /** 场景文档里的名字（带「精选 · 」前缀，服务器列表据此打标） */
  name: string
  audience: ShowcaseAudience
  description: string
  /** 作品来源：手工编排 / AI 生成后人工筛选。AI 作品在列表里带独立徽标 */
  origin?: 'handcrafted' | 'ai'
  document: SceneDocument
}

type Vec3 = [number, number, number]

interface PrimitiveSpec {
  /** 场景内唯一后缀，拼成稳定 uuid */
  key: string
  type: 'cube' | 'sphere' | 'ramp'
  name: string
  position: Vec3
  scale?: Vec3
  rotation?: Vec3
  color: number
  bodyType?: 'static' | 'dynamic'
}

const vec = ([x, y, z]: Vec3) => ({ x, y, z })

const toObject = (sceneId: string, spec: PrimitiveSpec): SceneDocumentObject => ({
  uuid: `${sceneId}-${spec.key}`,
  type: spec.type,
  name: spec.name,
  position: vec(spec.position),
  rotation: vec(spec.rotation ?? [0, 0, 0]),
  scale: vec(spec.scale ?? [1, 1, 1]),
  visible: true,
  color: spec.color,
  physics: {
    type: spec.bodyType ?? 'static',
    shape: spec.type === 'cube' ? 'box' : spec.type === 'sphere' ? 'sphere' : 'mesh',
    mass: 1,
  },
})

const makeScene = (options: {
  id: string
  name: string
  audience: ShowcaseAudience
  description: string
  primitives: PrimitiveSpec[]
  worldSize?: number
  camera?: SceneCamera
  origin?: 'handcrafted' | 'ai'
}): ShowcaseScene => {
  const sceneId = `showcase-${options.id}`
  const now = '2026-11-23T10:00:00.000Z'
  return {
    id: sceneId,
    name: `精选 · ${options.name}`,
    audience: options.audience,
    description: options.description,
    origin: options.origin ?? 'handcrafted',
    document: {
      id: sceneId,
      name: `精选 · ${options.name}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
      worldSize: options.worldSize ?? 40,
      ...(options.camera ? { camera: options.camera } : {}),
      objects: options.primitives.map((spec) => toObject(sceneId, spec)),
    },
  }
}

// ── 共用色板：低饱和结构色 + 少量高饱和强调色 ────────────────────────────
const INK = 0x2a333d
const STEEL = 0x7f8fa1
const FOG_BLUE = 0x3e5c76
const BRASS = 0xb08d57
const WARM_WHITE = 0xffd166
const ORANGE = 0xff8a5c
const CYAN = 0x4fc3f7
const GREEN = 0x66bb6a
const PURPLE = 0xab7bd6
const RED = 0xef6b6b

// ── 1. 教学：伽利略斜面实验室 ────────────────────────────────────────────
const galileo = makeScene({
  id: 'galileo',
  name: '伽利略斜面实验室',
  audience: '教学',
  description: '实验台、主斜面与三档测量柱，小球从不同高度释放，配合暂停/播放讲重力与加速度。',
  camera: {
    position: { x: -18.7, y: 14.2, z: 22.4 },
    target: { x: -0.6, y: 3.2, z: -1.3 },
    fov: 47,
  },
  primitives: [
    // 实验台与背景墙：先把「房间」立起来，物体才有归属
    { key: 'floor', type: 'cube', name: '实验台', position: [0, 0.15, 0], scale: [24, 0.3, 15], color: 0x424c59 },
    { key: 'wall', type: 'cube', name: '背景墙', position: [0, 2.6, -8.6], scale: [21, 4.9, 0.35], color: INK },
    { key: 'wall-trim', type: 'cube', name: '墙上横梁', position: [0, 5.15, -8.6], scale: [21.6, 0.22, 0.5], color: STEEL },
    { key: 'wall-line-l', type: 'cube', name: '墙面灯带', position: [-9.4, 2.6, -8.35], scale: [0.12, 4.4, 0.08], color: CYAN },
    { key: 'wall-line-r', type: 'cube', name: '墙面灯带', position: [9.4, 2.6, -8.35], scale: [0.12, 4.4, 0.08], color: CYAN },

    // 主斜面：低处 +x、高处 −x，与物理楔形同一份数据
    { key: 'ramp', type: 'ramp', name: '主斜面', position: [-4.5, 1.8, 0], scale: [13, 3, 6], color: STEEL },

    // 三个释放点的小球：贴住斜面，播放后滚向终点
    { key: 'ball-a', type: 'sphere', name: '小球 A', position: [-8.5, 3.35, 0], scale: [1.15, 1.15, 1.15], color: ORANGE, bodyType: 'dynamic' },
    { key: 'ball-b', type: 'sphere', name: '小球 B', position: [-7.6, 3.05, -1.8], scale: [0.95, 0.95, 0.95], color: CYAN, bodyType: 'dynamic' },
    { key: 'ball-c', type: 'sphere', name: '小球 C', position: [-7.2, 2.9, 1.8], scale: [0.8, 0.8, 0.8], color: WARM_WHITE, bodyType: 'dynamic' },

    // 终点区：垫子 + 门框，给运动一个明确的落点
    { key: 'finish', type: 'cube', name: '终点垫', position: [4.5, 0.33, 0], scale: [3.2, 0.08, 6], color: FOG_BLUE },
    { key: 'catch', type: 'cube', name: '挡球栏', position: [11.6, 0.55, 0], scale: [0.3, 0.5, 8], color: STEEL },
    { key: 'gate-l', type: 'cube', name: '终点门柱', position: [4.5, 2.1, -2.9], scale: [0.22, 3.6, 0.22], color: WARM_WHITE },
    { key: 'gate-r', type: 'cube', name: '终点门柱', position: [4.5, 2.1, 2.9], scale: [0.22, 3.6, 0.22], color: WARM_WHITE },
    { key: 'gate-top', type: 'cube', name: '终点横梁', position: [4.5, 3.95, 0], scale: [0.24, 0.24, 6], color: WARM_WHITE },

    // 测量柱：2 / 4 / 6 米三档，高度本身就是刻度
    { key: 'mark-2', type: 'cube', name: '2 米标记', position: [8.2, 1.3, 4.9], scale: [0.14, 2, 0.14], color: GREEN },
    { key: 'mark-4', type: 'cube', name: '4 米标记', position: [10.6, 2.3, 4.9], scale: [0.14, 4, 0.14], color: WARM_WHITE },
    { key: 'mark-6', type: 'cube', name: '6 米标记', position: [13, 3.3, 4.9], scale: [0.14, 6, 0.14], color: ORANGE },

    // 教具：长凳与讲台，让场景像一间真的实验室
    { key: 'bench', type: 'cube', name: '长凳', position: [10, 0.75, -3], scale: [4, 1.2, 1.6], color: STEEL },
    { key: 'podium', type: 'cube', name: '讲台', position: [-13, 0.8, 5], scale: [2.6, 1.3, 2.2], color: 0x596775 },
  ],
})

// ── 2. 具身智能：障碍训练场 ──────────────────────────────────────────────
const arena = makeScene({
  id: 'embodied-arena',
  name: '具身智能障碍训练场',
  audience: '具身智能',
  description: '起点闸门、错位墙体、缓坡与独木桥组成的通行训练场，适合路径规划与避障演示。',
  camera: {
    position: { x: 25.3, y: 20.1, z: 29.5 },
    target: { x: 0, y: 1.6, z: 0 },
    fov: 45,
  },
  primitives: [
    { key: 'floor', type: 'cube', name: '训练场底板', position: [0, 0.1, 0], scale: [34, 0.2, 26], color: 0x333e49 },

    // 起点：绿色平台 + 闸门，三个智能体从这里出发
    { key: 'start', type: 'cube', name: '起点平台', position: [-13, 0.4, -9], scale: [5.5, 0.5, 5.5], color: 0x3f8f6b },
    { key: 'start-post-l', type: 'cube', name: '起点门柱', position: [-13, 1.7, -12], scale: [0.2, 2.6, 0.2], color: STEEL },
    { key: 'start-post-r', type: 'cube', name: '起点门柱', position: [-13, 1.7, -6], scale: [0.2, 2.6, 0.2], color: STEEL },
    { key: 'start-beam', type: 'cube', name: '起点横梁', position: [-13, 3.0, -9], scale: [0.22, 0.2, 6.2], color: STEEL },
    { key: 'agent-1', type: 'sphere', name: '智能体 1', position: [-13, 0.95, -9], scale: [0.9, 0.9, 0.9], color: CYAN, bodyType: 'dynamic' },
    { key: 'agent-2', type: 'sphere', name: '智能体 2', position: [-14.2, 0.95, -8.2], scale: [0.9, 0.9, 0.9], color: 0x4f9dff, bodyType: 'dynamic' },
    { key: 'agent-3', type: 'sphere', name: '智能体 3', position: [-11.8, 0.95, -8.2], scale: [0.9, 0.9, 0.9], color: PURPLE, bodyType: 'dynamic' },

    // 错位墙体：留出可通行缺口，形成 S 形路线
    { key: 'wall-1', type: 'cube', name: '错位墙 1', position: [-7, 1.4, -4.5], scale: [0.35, 2.8, 11], color: STEEL },
    { key: 'wall-2', type: 'cube', name: '错位墙 2', position: [-0.5, 1.4, 4.5], scale: [0.35, 2.8, 11], color: STEEL },
    { key: 'wall-3', type: 'cube', name: '错位墙 3', position: [6, 1.4, -4], scale: [0.35, 2.8, 10], color: STEEL },

    // 缓坡与独木桥：两种典型地形
    { key: 'ramp', type: 'ramp', name: '缓坡', position: [-3.5, 0.85, -7.5], scale: [5, 1.1, 4], color: 0x8d6e63 },
    { key: 'beam', type: 'cube', name: '独木桥', position: [10, 1.0, 3], scale: [8, 0.25, 1.2], color: WARM_WHITE },
    { key: 'beam-support-l', type: 'cube', name: '桥墩', position: [7, 0.5, 3], scale: [0.3, 1.0, 0.9], color: 0x596775 },
    { key: 'beam-support-r', type: 'cube', name: '桥墩', position: [13, 0.5, 3], scale: [0.3, 1.0, 0.9], color: 0x596775 },

    // 终点：橙色平台 + 门框
    { key: 'goal', type: 'cube', name: '目标平台', position: [13, 0.4, 9], scale: [5.5, 0.5, 5.5], color: 0xd97742 },
    { key: 'goal-post-l', type: 'cube', name: '终点门柱', position: [13, 1.7, 6], scale: [0.2, 2.6, 0.2], color: WARM_WHITE },
    { key: 'goal-post-r', type: 'cube', name: '终点门柱', position: [13, 1.7, 12], scale: [0.2, 2.6, 0.2], color: WARM_WHITE },
    { key: 'goal-beam', type: 'cube', name: '终点横梁', position: [13, 3.0, 9], scale: [0.22, 0.2, 6.2], color: WARM_WHITE },

    // 路标与围栏：给出场地边界感，不抢主体
    { key: 'flag-1', type: 'cube', name: '路标 1', position: [-6, 1.1, 8], scale: [0.15, 2.2, 0.15], color: RED },
    { key: 'flag-2', type: 'cube', name: '路标 2', position: [5, 1.1, 8], scale: [0.15, 2.2, 0.15], color: RED },
    { key: 'post-1', type: 'cube', name: '围栏柱', position: [-16, 0.8, -12], scale: [0.3, 1.6, 0.3], color: 0x55616f },
    { key: 'post-2', type: 'cube', name: '围栏柱', position: [-16, 0.8, 12], scale: [0.3, 1.6, 0.3], color: 0x55616f },
    { key: 'post-3', type: 'cube', name: '围栏柱', position: [16, 0.8, -12], scale: [0.3, 1.6, 0.3], color: 0x55616f },
    { key: 'post-4', type: 'cube', name: '围栏柱', position: [16, 0.8, 12], scale: [0.3, 1.6, 0.3], color: 0x55616f },
    { key: 'post-5', type: 'cube', name: '围栏柱', position: [0, 0.8, -12], scale: [0.3, 1.6, 0.3], color: 0x55616f },
    { key: 'post-6', type: 'cube', name: '围栏柱', position: [0, 0.8, 12], scale: [0.3, 1.6, 0.3], color: 0x55616f },
  ],
})

// ── 3. 企业办公：产品陈列厅 ──────────────────────────────────────────────
const showroom = makeScene({
  id: 'showroom',
  name: '企业产品陈列厅',
  audience: '企业办公',
  description: '对称式陈列空间：中央主展品、四座分展台与灯带背景墙，适合评审汇报或展厅大屏。',
  camera: {
    position: { x: 0, y: 9.4, z: 24.3 },
    target: { x: 0, y: 3.4, z: -0.4 },
    fov: 45,
  },
  primitives: [
    { key: 'floor', type: 'cube', name: '展厅地面', position: [0, 0.1, 0], scale: [28, 0.2, 20], color: 0x2a333d },
    { key: 'carpet', type: 'cube', name: '中央地毯', position: [0, 0.22, 1], scale: [6, 0.04, 16], color: 0x3b3147 },
    { key: 'stage', type: 'cube', name: '中央展台', position: [0, 0.55, -3], scale: [10, 0.9, 10], color: 0x2f3945 },
    { key: 'stage-trim', type: 'cube', name: '展台铜边', position: [0, 1.02, -3], scale: [6, 0.06, 6], color: BRASS },
    { key: 'plinth', type: 'cube', name: '中央基座', position: [0, 1.45, -3], scale: [2.6, 1.2, 2.6], color: BRASS },
    { key: 'hero', type: 'sphere', name: '主展品', position: [0, 2.9, -3], scale: [2.4, 2.4, 2.4], color: 0xffc857 },

    // 四座分展台：高度一致、间距对称，把视觉重心让给中央
    { key: 'pedestal-1', type: 'cube', name: '展台 A', position: [-6.5, 0.95, -6.5], scale: [2, 1.4, 2], color: 0x405163 },
    { key: 'pedestal-2', type: 'cube', name: '展台 B', position: [6.5, 0.95, -6.5], scale: [2, 1.4, 2], color: 0x405163 },
    { key: 'pedestal-3', type: 'cube', name: '展台 C', position: [-6.5, 0.95, 0.5], scale: [2, 1.4, 2], color: 0x405163 },
    { key: 'pedestal-4', type: 'cube', name: '展台 D', position: [6.5, 0.95, 0.5], scale: [2, 1.4, 2], color: 0x405163 },
    { key: 'orb-1', type: 'sphere', name: '展品 A', position: [-6.5, 2.3, -6.5], scale: [1.3, 1.3, 1.3], color: CYAN },
    { key: 'orb-2', type: 'sphere', name: '展品 B', position: [6.5, 2.3, -6.5], scale: [1.3, 1.3, 1.3], color: ORANGE },
    { key: 'orb-3', type: 'sphere', name: '展品 C', position: [-6.5, 2.3, 0.5], scale: [1.3, 1.3, 1.3], color: GREEN },
    { key: 'orb-4', type: 'sphere', name: '展品 D', position: [6.5, 2.3, 0.5], scale: [1.3, 1.3, 1.3], color: PURPLE },

    // 背景墙与竖向灯带：展厅的「品牌面」
    { key: 'backdrop', type: 'cube', name: '背景墙', position: [0, 3.2, -9.5], scale: [24, 6.4, 0.5], color: 0x1c242e },
    { key: 'slat-1', type: 'cube', name: '背光灯带', position: [-9, 3.2, -9.2], scale: [0.16, 4.8, 0.1], color: WARM_WHITE },
    { key: 'slat-2', type: 'cube', name: '背光灯带', position: [-6, 3.2, -9.2], scale: [0.16, 4.8, 0.1], color: CYAN },
    { key: 'slat-3', type: 'cube', name: '背光灯带', position: [-3, 3.2, -9.2], scale: [0.16, 4.8, 0.1], color: WARM_WHITE },
    { key: 'slat-4', type: 'cube', name: '背光灯带', position: [3, 3.2, -9.2], scale: [0.16, 4.8, 0.1], color: WARM_WHITE },
    { key: 'slat-5', type: 'cube', name: '背光灯带', position: [6, 3.2, -9.2], scale: [0.16, 4.8, 0.1], color: CYAN },
    { key: 'slat-6', type: 'cube', name: '背光灯带', position: [9, 3.2, -9.2], scale: [0.16, 4.8, 0.1], color: WARM_WHITE },

    // 两侧立柱：框住画面边界
    { key: 'column-l', type: 'cube', name: '立柱', position: [-11.5, 3.3, -7], scale: [0.7, 6.6, 0.7], color: 0x596675 },
    { key: 'column-r', type: 'cube', name: '立柱', position: [11.5, 3.3, -7], scale: [0.7, 6.6, 0.7], color: 0x596675 },
    { key: 'cap-l', type: 'cube', name: '柱头', position: [-11.5, 6.7, -7], scale: [1.0, 0.2, 1.0], color: BRASS },
    { key: 'cap-r', type: 'cube', name: '柱头', position: [11.5, 6.7, -7], scale: [1.0, 0.2, 1.0], color: BRASS },

    // 前场：长凳与两块倾斜展牌
    { key: 'bench', type: 'cube', name: '长凳', position: [0, 0.6, 8], scale: [6, 0.7, 1.8], color: 0x39424e },
    { key: 'sign-l', type: 'cube', name: '展牌', position: [-8, 1.6, 7], scale: [2.4, 2.6, 0.2], color: 0x2f3945, rotation: [0, 0.4, 0] },
    { key: 'sign-r', type: 'cube', name: '展牌', position: [8, 1.6, 7], scale: [2.4, 2.6, 0.2], color: 0x2f3945, rotation: [0, -0.4, 0] },

    // 地毯上的动态演示球：点播放就能看到运动，也打破对称构图的僵硬感
    { key: 'demo-orb', type: 'sphere', name: '演示球', position: [3.5, 0.7, 3.5], scale: [0.9, 0.9, 0.9], color: ORANGE, bodyType: 'dynamic' },
  ],
})

// ── 4. 创意可视化：城市天际线 ────────────────────────────────────────────
const skyline = makeScene({
  id: 'skyline',
  name: '城市天际线',
  audience: '创意可视化',
  description: '河道两岸的楼群、亮灯窗带、公园与桥，一枚悬浮天体压住画面右上角。',
  camera: {
    position: { x: 28.3, y: 23.8, z: 29.6 },
    target: { x: 0.6, y: 7.3, z: -2.1 },
    fov: 45,
  },
  primitives: [
    { key: 'base', type: 'cube', name: '城市底板', position: [0, 0.1, 0], scale: [36, 0.2, 28], color: 0x2e3843 },
    { key: 'river', type: 'cube', name: '河道', position: [3, 0.24, 0], scale: [5.5, 0.06, 28], color: 0x275d80 },
    { key: 'bank-w', type: 'cube', name: '西岸灯带', position: [0.1, 0.3, 0], scale: [0.3, 0.1, 28], color: 0x6fa8c9 },
    { key: 'bank-e', type: 'cube', name: '东岸灯带', position: [5.9, 0.3, 0], scale: [0.3, 0.1, 28], color: 0x6fa8c9 },
    { key: 'bridge', type: 'cube', name: '跨河桥', position: [3, 1.1, 4], scale: [8, 0.35, 2.4], color: STEEL },
    { key: 'bridge-leg-w', type: 'cube', name: '桥墩', position: [0.2, 0.6, 4], scale: [0.4, 1.2, 1.8], color: 0x596775 },
    { key: 'bridge-leg-e', type: 'cube', name: '桥墩', position: [5.8, 0.6, 4], scale: [0.4, 1.2, 1.8], color: 0x596775 },

    // 西侧楼群：冷色为主（60%）
    { key: 'tower-1', type: 'cube', name: '塔楼 1', position: [-15, 2, -8], scale: [3, 4, 3], color: FOG_BLUE },
    { key: 'tower-2', type: 'cube', name: '塔楼 2', position: [-11, 3.5, -8], scale: [2.6, 7, 2.6], color: 0x486f8d },
    { key: 'tower-3', type: 'cube', name: '塔楼 3', position: [-7.5, 2.5, -8], scale: [3.2, 5, 3.2], color: 0x36536b },
    { key: 'tower-4', type: 'cube', name: '主塔', position: [-3, 4.5, -7.5], scale: [3.4, 9, 3.4], color: 0x527d9e },
    { key: 'tower-4-cap', type: 'cube', name: '主塔顶冠', position: [-3, 9.6, -7.5], scale: [2.2, 1.2, 2.2], color: 0x6e9fbf },
    { key: 'tower-4-spire', type: 'cube', name: '主塔尖顶', position: [-3, 10.6, -7.5], scale: [0.3, 1.2, 0.3], color: WARM_WHITE },
    { key: 'tower-5', type: 'cube', name: '塔楼 5', position: [-12, 2, -1], scale: [2.8, 4, 2.8], color: 0x4a6a82 },
    { key: 'tower-6', type: 'cube', name: '塔楼 6', position: [-8, 3, -1], scale: [2.2, 6, 2.2], color: FOG_BLUE },

    // 东侧楼群：暖色点缀（30%）
    { key: 'tower-7', type: 'cube', name: '塔楼 7', position: [9, 2.5, -9], scale: [2.8, 5, 2.8], color: 0x8a5a44 },
    { key: 'tower-8', type: 'cube', name: '塔楼 8', position: [13, 4, -9], scale: [2.4, 8, 2.4], color: 0xb06a4a },
    { key: 'tower-9', type: 'cube', name: '塔楼 9', position: [16, 2, -3], scale: [2.6, 4, 2.6], color: 0x8a5a44 },
    { key: 'tower-10', type: 'cube', name: '塔楼 10', position: [10, 3.5, -2], scale: [2.2, 7, 2.2], color: 0x9c6048 },
    { key: 'tower-11', type: 'cube', name: '塔楼 11', position: [14, 2.8, 4], scale: [2.6, 5.6, 2.6], color: 0x8a5a44 },

    // 亮灯窗带：少量暖黄横条，是「城市有人住」的唯一暗示（10% 强调）
    { key: 'win-1', type: 'cube', name: '窗带', position: [-3, 3.2, -5.7], scale: [2.4, 0.16, 0.1], color: WARM_WHITE },
    { key: 'win-2', type: 'cube', name: '窗带', position: [-3, 5.4, -5.7], scale: [2.4, 0.16, 0.1], color: WARM_WHITE },
    { key: 'win-3', type: 'cube', name: '窗带', position: [-3, 7.6, -5.7], scale: [2.4, 0.16, 0.1], color: WARM_WHITE },
    { key: 'win-4', type: 'cube', name: '窗带', position: [13, 3, -7.7], scale: [1.6, 0.14, 0.1], color: WARM_WHITE },
    { key: 'win-5', type: 'cube', name: '窗带', position: [13, 5.2, -7.7], scale: [1.6, 0.14, 0.1], color: WARM_WHITE },
    { key: 'win-6', type: 'cube', name: '窗带', position: [10, 3.4, -0.8], scale: [1.4, 0.14, 0.1], color: WARM_WHITE },

    // 公园：绿地 + 三棵树，给冷色城市一块呼吸的地方
    { key: 'park', type: 'cube', name: '公园绿地', position: [-11, 0.26, 6], scale: [8, 0.08, 8], color: 0x3f7d58 },
    { key: 'trunk-1', type: 'cube', name: '树干', position: [-13, 0.9, 4], scale: [0.3, 1.2, 0.3], color: 0x5d4037 },
    { key: 'tree-1', type: 'sphere', name: '树冠', position: [-13, 1.95, 4], scale: [1.6, 1.6, 1.6], color: 0x4caf50 },
    { key: 'trunk-2', type: 'cube', name: '树干', position: [-10, 0.9, 7], scale: [0.3, 1.2, 0.3], color: 0x5d4037 },
    { key: 'tree-2', type: 'sphere', name: '树冠', position: [-10, 1.95, 7], scale: [1.6, 1.6, 1.6], color: GREEN },
    { key: 'trunk-3', type: 'cube', name: '树干', position: [-14, 0.9, 8], scale: [0.3, 1.2, 0.3], color: 0x5d4037 },
    { key: 'tree-3', type: 'sphere', name: '树冠', position: [-14, 1.95, 8], scale: [1.6, 1.6, 1.6], color: 0x388e3c },

    // 东侧广场：喷泉池 + 三个动态彩球
    { key: 'plaza', type: 'cube', name: '广场', position: [10, 0.26, 7], scale: [8, 0.08, 7], color: 0x354250 },
    { key: 'fountain', type: 'cube', name: '喷泉池', position: [10, 0.5, 7], scale: [2, 0.5, 2], color: 0x5b6b7a },
    { key: 'fountain-orb', type: 'sphere', name: '水球', position: [10, 1.3, 7], scale: [1.2, 1.2, 1.2], color: CYAN },
    { key: 'ball-1', type: 'sphere', name: '彩球 1', position: [7.5, 1.1, 6.5], scale: [0.9, 0.9, 0.9], color: ORANGE, bodyType: 'dynamic' },
    { key: 'ball-2', type: 'sphere', name: '彩球 2', position: [12.5, 1.4, 6.2], scale: [0.7, 0.7, 0.7], color: CYAN, bodyType: 'dynamic' },
    { key: 'ball-3', type: 'sphere', name: '彩球 3', position: [11, 0.9, 9], scale: [0.8, 0.8, 0.8], color: WARM_WHITE, bodyType: 'dynamic' },

    // 悬浮天体：压住右上角，给画面一个远景层次
    { key: 'moon', type: 'sphere', name: '悬浮天体', position: [16, 13, -12], scale: [3.2, 3.2, 3.2], color: 0xffe9a8 },
  ],
})

// ── AI 作品 1：禅意庭院（真实模型生成 + 人工筛掉物理不合理项）────────────
const zenGarden = makeScene({
  id: 'zen-garden',
  name: '禅意庭院',
  audience: '创意可视化',
  description: 'AI 生成的禅意庭院：低石台、枯山水沙纹、木色拱门与石灯，暖木色点亮冷灰基调。',
  origin: 'ai',
  camera: {
    position: { x: 8.5, y: 8, z: 10.1 },
    target: { x: 0, y: 2, z: 0 },
    fov: 45,
  },
  primitives: [
    { key: 'ai-1', type: 'cube', name: '低石台', position: [0, 0.2, 0], scale: [12, 0.4, 8], color: 0x424a52 },
    { key: 'ai-2', type: 'cube', name: '沙纹一', position: [-3.8, 0.43, 1.2], scale: [2.8, 0.06, 0.12], rotation: [0, -0.18, 0], color: 0xbdb7aa },
    { key: 'ai-3', type: 'cube', name: '沙纹二', position: [-3.1, 0.44, 1.65], scale: [1.9, 0.06, 0.1], rotation: [0, 0.2, 0], color: 0xbdb7aa },
    { key: 'ai-4', type: 'cube', name: '沙纹三', position: [-4.1, 0.45, 2.05], scale: [1.2, 0.06, 0.1], rotation: [0, -0.12, 0], color: 0xbdb7aa },
    { key: 'ai-5', type: 'cube', name: '沙纹四', position: [1.5, 0.43, -1.35], scale: [2.6, 0.06, 0.11], rotation: [0, 0.16, 0], color: 0xbdb7aa },
    { key: 'ai-6', type: 'cube', name: '沙纹五', position: [2.1, 0.44, -1.75], scale: [1.6, 0.06, 0.1], rotation: [0, -0.2, 0], color: 0xbdb7aa },
    { key: 'ai-7', type: 'cube', name: '木门左柱', position: [-2, 2, -2.8], scale: [0.42, 3.2, 0.5], color: 0x8a5d3b },
    { key: 'ai-8', type: 'cube', name: '木门右柱', position: [2, 2, -2.8], scale: [0.42, 3.2, 0.5], color: 0x8a5d3b },
    { key: 'ai-9', type: 'cube', name: '木门横梁', position: [0, 3.35, -2.8], scale: [4.45, 0.42, 0.58], color: 0x9b6942 },
    { key: 'ai-10', type: 'sphere', name: '左球树', position: [-5, 2.25, 1.45], scale: [1.35, 1.15, 1.35], color: 0x46534b },
    { key: 'ai-11', type: 'cube', name: '左树干', position: [-5, 1.05, 1.45], scale: [0.28, 1.3, 0.28], color: 0x705039 },
    { key: 'ai-12', type: 'sphere', name: '右球树', position: [5, 2.45, -0.85], scale: [1.45, 1.25, 1.45], color: 0x4b574f },
    { key: 'ai-13', type: 'cube', name: '右树干', position: [5, 1.15, -0.85], scale: [0.3, 1.5, 0.3], color: 0x705039 },
    { key: 'ai-14', type: 'sphere', name: '后球树', position: [-4.75, 2.35, -2.65], scale: [1.25, 1.1, 1.25], color: 0x465149 },
    { key: 'ai-15', type: 'cube', name: '后树干', position: [-4.75, 1.1, -2.65], scale: [0.27, 1.4, 0.27], color: 0x705039 },
    { key: 'ai-16', type: 'cube', name: '灯座', position: [4.8, 0.58, 2.55], scale: [0.95, 0.36, 0.95], color: 0x596168 },
    { key: 'ai-17', type: 'cube', name: '灯柱', position: [4.8, 1.2, 2.55], scale: [0.38, 0.88, 0.38], color: 0x646c72 },
    { key: 'ai-18', type: 'cube', name: '灯室', position: [4.8, 1.82, 2.55], scale: [0.72, 0.48, 0.72], color: 0x737b80 },
    { key: 'ai-19', type: 'cube', name: '灯顶', position: [4.8, 2.19, 2.55], scale: [1.15, 0.26, 1.15], rotation: [0, 0.45, 0], color: 0x555e65 },
    { key: 'ai-21', type: 'sphere', name: '暖石球一', position: [2.65, 0.93, 1.1], scale: [0.9, 0.9, 0.9], color: 0x6e777b, bodyType: 'dynamic' },
    { key: 'ai-22', type: 'sphere', name: '暖石球二', position: [-2.7, 0.85, 0.55], scale: [0.78, 0.78, 0.78], color: 0x777c7a, bodyType: 'dynamic' },
  ],
})

// ── AI 作品 2：未来发射场 ────────────────────────────────────────────────
const launchPad = makeScene({
  id: 'launch-pad',
  name: '未来发射场',
  audience: '创意可视化',
  description: 'AI 生成的发射场：中央塔架、环形平台、对称推进器与导流槽，橙色喷口是唯一强调色。',
  origin: 'ai',
  camera: {
    position: { x: 12.9, y: 11.6, z: 16.7 },
    target: { x: 0, y: 4, z: 1.1 },
    fov: 50,
  },
  primitives: [
    { key: 'ai-1', type: 'cube', name: '发射基座', position: [0, 0.25, 0], scale: [10, 0.5, 10], color: 0x4a5b6c },
    { key: 'ai-2', type: 'cube', name: '主塔底座', position: [0, 2.5, 0], scale: [2.5, 5, 2.5], color: 0x5b7085 },
    { key: 'ai-3', type: 'cube', name: '主塔中段', position: [0, 5.75, 0], scale: [1.6, 1.5, 1.6], color: 0x7289a0 },
    { key: 'ai-4', type: 'cube', name: '主塔顶冠', position: [0, 7, 0], scale: [1.05, 1, 1.05], color: 0xff8a3d },
    { key: 'ai-5', type: 'cube', name: '环台北段', position: [0, 0.75, -4.1], scale: [4, 0.5, 0.8], color: 0x51667a },
    { key: 'ai-6', type: 'cube', name: '环台南段', position: [0, 0.75, 4.1], scale: [4, 0.5, 0.8], color: 0x51667a },
    { key: 'ai-7', type: 'cube', name: '环台东段', position: [4.1, 0.75, 0], scale: [0.8, 0.5, 4], color: 0x51667a },
    { key: 'ai-8', type: 'cube', name: '环台西段', position: [-4.1, 0.75, 0], scale: [0.8, 0.5, 4], color: 0x51667a },
    { key: 'ai-9', type: 'cube', name: '环台东北段', position: [3.1, 0.75, -3.1], scale: [1.4, 0.5, 1.4], rotation: [0, 0.79, 0], color: 0x5d7287 },
    { key: 'ai-10', type: 'cube', name: '环台东南段', position: [3.1, 0.75, 3.1], scale: [1.4, 0.5, 1.4], rotation: [0, 0.79, 0], color: 0x5d7287 },
    { key: 'ai-11', type: 'cube', name: '环台西南段', position: [-3.1, 0.75, 3.1], scale: [1.4, 0.5, 1.4], rotation: [0, 0.79, 0], color: 0x5d7287 },
    { key: 'ai-12', type: 'cube', name: '环台西北段', position: [-3.1, 0.75, -3.1], scale: [1.4, 0.5, 1.4], rotation: [0, 0.79, 0], color: 0x5d7287 },
    { key: 'ai-13', type: 'cube', name: '东侧推进器', position: [6.3, 2.3, 0], scale: [1.5, 4.6, 1.5], color: 0x4b5f72 },
    { key: 'ai-14', type: 'cube', name: '西侧推进器', position: [-6.3, 2.3, 0], scale: [1.5, 4.6, 1.5], color: 0x4b5f72 },
    { key: 'ai-15', type: 'cube', name: '东喷口', position: [6.3, 4.95, 0], scale: [0.9, 0.7, 0.9], color: 0xff8a3d },
    { key: 'ai-16', type: 'cube', name: '西喷口', position: [-6.3, 4.95, 0], scale: [0.9, 0.7, 0.9], color: 0xff8a3d },
    { key: 'ai-17', type: 'cube', name: '导流槽底', position: [0, 0.1, 7.5], scale: [3.4, 0.2, 5], color: 0x2f3b47 },
    { key: 'ai-18', type: 'cube', name: '导流槽左壁', position: [-2, 0.5, 7.5], scale: [0.4, 0.8, 5], color: 0x6b7f92 },
    { key: 'ai-19', type: 'cube', name: '导流槽右壁', position: [2, 0.5, 7.5], scale: [0.4, 0.8, 5], color: 0x6b7f92 },
    { key: 'ai-20', type: 'cube', name: '后部控制舱', position: [0, 1.3, -7], scale: [2.2, 2.6, 1.4], color: 0x4a5c6e },
    { key: 'ai-21', type: 'cube', name: '能源核心舱', position: [0, 1, -5.7], scale: [1.2, 2, 1], color: 0x7a8fa3 },
    { key: 'ai-22', type: 'sphere', name: '顶部能量球', position: [0, 7.78, 0], scale: [0.55, 0.55, 0.55], color: 0xff9a45, bodyType: 'dynamic' },
    { key: 'ai-23', type: 'sphere', name: '左侧能量球', position: [-2.15, 0.8, 0], scale: [0.5, 0.5, 0.5], color: 0xff8a3d, bodyType: 'dynamic' },
    { key: 'ai-24', type: 'sphere', name: '右侧能量球', position: [2.15, 0.8, 0], scale: [0.5, 0.5, 0.5], color: 0xff8a3d, bodyType: 'dynamic' },
  ],
})

// ── AI 作品 3：校园广场 ──────────────────────────────────────────────────
const campusPlaza = makeScene({
  id: 'campus-plaza',
  name: '校园广场',
  audience: '教学',
  description: 'AI 生成的校园广场：教学楼、旗杆、喷泉、长椅与路灯，傍晚暖色灯头做强调。',
  origin: 'ai',
  camera: {
    position: { x: 12.6, y: 13.1, z: 14.6 },
    target: { x: 0, y: 3.2, z: -1.1 },
    fov: 48,
  },
  primitives: [
    { key: 'ai-1', type: 'cube', name: '广场地坪', position: [0, 0.15, 0], scale: [26, 0.3, 18], color: 0x59636d },
    { key: 'ai-2', type: 'cube', name: '教学楼', position: [0, 2.8, -6.5], scale: [11, 5, 3], color: 0x737d87 },
    { key: 'ai-3', type: 'cube', name: '教学楼门廊', position: [0, 1.5, -4.5], scale: [3, 2.4, 1], color: 0x39424e },
    { key: 'ai-4', type: 'cube', name: '旗杆基座', position: [-2, 0.45, -2], scale: [1, 0.3, 1], color: 0x4b535c },
    { key: 'ai-5', type: 'cube', name: '旗杆', position: [-2, 3.1, -2], scale: [0.14, 5, 0.14], color: 0xd7dce0 },
    { key: 'ai-6', type: 'cube', name: '校旗', position: [-1.35, 5.75, -2], scale: [1.2, 0.7, 0.08], color: 0xb84a4a },
    { key: 'ai-7', type: 'cube', name: '喷泉池壁', position: [0, 0.53, 1.2], scale: [5, 0.45, 5], color: 0x596775 },
    { key: 'ai-8', type: 'cube', name: '喷泉水面', position: [0, 0.79, 1.2], scale: [4.5, 0.08, 4.5], color: 0x4d8791 },
    { key: 'ai-9', type: 'cube', name: '喷泉立柱', position: [0, 1.54, 1.2], scale: [0.9, 1.5, 0.9], color: 0x657381 },
    { key: 'ai-10', type: 'cube', name: '喷泉上盘', position: [0, 2.5, 1.2], scale: [2.4, 0.35, 2.4], color: 0x778591 },
    { key: 'ai-11', type: 'sphere', name: '水珠一', position: [-0.85, 2.95, 1.35], scale: [0.22, 0.35, 0.22], color: 0x67a8b1, bodyType: 'dynamic' },
    { key: 'ai-12', type: 'sphere', name: '水珠二', position: [0.75, 3.05, 0.95], scale: [0.2, 0.3, 0.2], color: 0x67a8b1, bodyType: 'dynamic' },
    { key: 'ai-13', type: 'cube', name: '后左长椅', position: [-3.2, 0.48, -2.2], scale: [3, 0.36, 0.72], color: 0x76675d },
    { key: 'ai-14', type: 'cube', name: '后右长椅', position: [3.2, 0.48, -2.2], scale: [3, 0.36, 0.72], color: 0x76675d },
    { key: 'ai-15', type: 'cube', name: '前左长椅', position: [-3.2, 0.48, 3.8], scale: [3, 0.36, 0.72], color: 0x76675d },
    { key: 'ai-16', type: 'cube', name: '前右长椅', position: [3.2, 0.48, 3.8], scale: [3, 0.36, 0.72], color: 0x76675d },
    { key: 'ai-17', type: 'cube', name: '左树树干', position: [-6, 1.1, -0.5], scale: [0.35, 1.6, 0.35], color: 0x655b52 },
    { key: 'ai-18', type: 'sphere', name: '左树树冠', position: [-6, 2.7, -0.5], scale: [2.4, 2.4, 2.4], color: 0x617568 },
    { key: 'ai-19', type: 'cube', name: '右树树干', position: [6, 1.1, 4.5], scale: [0.35, 1.6, 0.35], color: 0x655b52 },
    { key: 'ai-20', type: 'sphere', name: '右树树冠', position: [6, 2.7, 4.5], scale: [2.4, 2.4, 2.4], color: 0x617568 },
    { key: 'ai-21', type: 'cube', name: '左路灯杆', position: [-5.8, 2.2, 3.2], scale: [0.16, 3.8, 0.16], color: 0x343d46 },
    { key: 'ai-22', type: 'cube', name: '左路灯灯头', position: [-5.8, 4.25, 3.2], scale: [0.6, 0.3, 0.6], color: 0xf2b96b },
    { key: 'ai-23', type: 'cube', name: '右路灯杆', position: [5.8, 2.2, -2.5], scale: [0.16, 3.8, 0.16], color: 0x343d46 },
    { key: 'ai-24', type: 'cube', name: '右路灯灯头', position: [5.8, 4.25, -2.5], scale: [0.6, 0.3, 0.6], color: 0xf2b96b },
  ],
})

export const SHOWCASE_SCENES: ShowcaseScene[] = [
  galileo,
  arena,
  showroom,
  skyline,
  zenGarden,
  launchPad,
  campusPlaza,
]
