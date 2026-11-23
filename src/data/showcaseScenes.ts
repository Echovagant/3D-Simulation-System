/**
 * 精选场景：开箱即用的作品集。
 *
 * 这些不是「随机堆几个方块」的演示——每个场景对应一类真实用户：
 * 教学（斜面实验）、具身智能（障碍训练场）、企业展厅（陈列台）、创意可视化（城市天际线）。
 * 全部只用 cube / sphere / ramp 三种可重建基础体，不依赖模型库，打开即用。
 *
 * 结构体用 static 刚体：打开后不会自己塌掉；球体等演示件用 dynamic，
 * 点「播放」就能看到运动。
 */
import type { SceneDocument, SceneDocumentObject } from '@/types'

export type ShowcaseAudience = '教学' | '具身智能' | '企业办公' | '创意可视化'

export interface ShowcaseScene {
  id: string
  /** 场景文档里的名字（带「精选 · 」前缀，服务器列表据此打标） */
  name: string
  audience: ShowcaseAudience
  description: string
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
}): ShowcaseScene => {
  const sceneId = `showcase-${options.id}`
  const now = '2026-11-23T10:00:00.000Z'
  return {
    id: sceneId,
    name: `精选 · ${options.name}`,
    audience: options.audience,
    description: options.description,
    document: {
      id: sceneId,
      name: `精选 · ${options.name}`,
      createdAt: now,
      updatedAt: now,
      version: 1,
      worldSize: options.worldSize ?? 40,
      objects: options.primitives.map((spec) => toObject(sceneId, spec)),
    },
  }
}

const BLUE = 0x4f9dff
const CYAN = 0x26c6da
const ORANGE = 0xff7043
const AMBER = 0xffc107
const GREEN = 0x66bb6a
const PURPLE = 0xab47bc
const RED = 0xef5350
const STEEL = 0x90a4ae
const BROWN = 0x8d6e63
const YELLOW = 0xffee58

// ── 1. 教学：伽利略斜面实验室 ────────────────────────────────────────────
const galileo = makeScene({
  id: 'galileo',
  name: '伽利略斜面实验室',
  audience: '教学',
  description: '大斜面 + 不同释放点的小球，配合暂停/播放讲解重力、加速度与摩擦。',
  primitives: [
    {
      key: 'ramp',
      type: 'ramp',
      name: '主斜面',
      position: [0, 1.25, 0],
      scale: [10, 2.5, 6],
      color: STEEL,
    },
    {
      key: 'ball-a',
      type: 'sphere',
      name: '小球 A',
      position: [-3.6, 3.4, 0],
      scale: [1.2, 1.2, 1.2],
      color: ORANGE,
      bodyType: 'dynamic',
    },
    {
      key: 'ball-b',
      type: 'sphere',
      name: '小球 B',
      position: [-3.6, 4.3, -1.4],
      scale: [1, 1, 1],
      color: CYAN,
      bodyType: 'dynamic',
    },
    {
      key: 'ball-c',
      type: 'sphere',
      name: '小球 C',
      position: [-3.6, 5.1, 1.4],
      scale: [0.8, 0.8, 0.8],
      color: YELLOW,
      bodyType: 'dynamic',
    },
    { key: 'mark-2', type: 'cube', name: '2 米标记', position: [2, 0.4, 3.6], scale: [0.2, 0.8, 0.2], color: GREEN },
    { key: 'mark-4', type: 'cube', name: '4 米标记', position: [4, 0.4, 3.6], scale: [0.2, 0.8, 0.2], color: AMBER },
    { key: 'mark-6', type: 'cube', name: '6 米标记', position: [6, 0.4, 3.6], scale: [0.2, 0.8, 0.2], color: ORANGE },
    { key: 'target', type: 'cube', name: '终点垫', position: [7, 0.05, 0], scale: [2.6, 0.1, 3], color: BLUE },
    { key: 'gate-l', type: 'cube', name: '终点门柱', position: [7, 1.2, -1.4], scale: [0.25, 2.4, 0.25], color: PURPLE },
    { key: 'gate-r', type: 'cube', name: '终点门柱', position: [7, 1.2, 1.4], scale: [0.25, 2.4, 0.25], color: PURPLE },
  ],
})

// ── 2. 具身智能：障碍训练场 ──────────────────────────────────────────────
const arena = makeScene({
  id: 'embodied-arena',
  name: '具身智能障碍训练场',
  audience: '具身智能',
  description: '窄道、坡道与错位墙体组成的通行训练场，适合路径规划与避障演示。',
  primitives: [
    // 起点与终点
    { key: 'start', type: 'cube', name: '起点平台', position: [-10, 0.05, -8], scale: [4, 0.1, 4], color: GREEN },
    { key: 'goal', type: 'cube', name: '目标平台', position: [10, 0.05, 8], scale: [4, 0.1, 4], color: ORANGE },
    // 三个智能体（球体代表）
    { key: 'agent-1', type: 'sphere', name: '智能体 1', position: [-10, 0.6, -8], color: BLUE, bodyType: 'dynamic' },
    { key: 'agent-2', type: 'sphere', name: '智能体 2', position: [-11.2, 0.6, -7.2], color: CYAN, bodyType: 'dynamic' },
    { key: 'agent-3', type: 'sphere', name: '智能体 3', position: [-9, 0.6, -7], color: PURPLE, bodyType: 'dynamic' },
    // 错位墙体：留出可通行缺口
    { key: 'wall-1', type: 'cube', name: '墙体 1', position: [-5, 1.2, -3], scale: [0.4, 2.4, 9], color: STEEL },
    { key: 'wall-2', type: 'cube', name: '墙体 2', position: [0, 1.2, 4], scale: [0.4, 2.4, 9], color: STEEL },
    { key: 'wall-3', type: 'cube', name: '墙体 3', position: [5, 1.2, -4], scale: [0.4, 2.4, 7], color: STEEL },
    // 坡道与窄道
    { key: 'ramp-1', type: 'ramp', name: '缓坡', position: [-2.5, 0.6, -6], scale: [4, 1.2, 3], color: BROWN },
    { key: 'ramp-2', type: 'ramp', name: '下坡', position: [2.5, 0.6, 6], scale: [4, 1.2, 3], rotation: [0, Math.PI, 0], color: BROWN },
    { key: 'bridge', type: 'cube', name: '窄道', position: [7, 0.5, 0], scale: [7, 0.4, 1.4], color: AMBER },
    // 路标
    { key: 'flag-1', type: 'cube', name: '路标 1', position: [-6, 1, 6], scale: [0.2, 2, 0.2], color: RED },
    { key: 'flag-2', type: 'cube', name: '路标 2', position: [6, 1, -6], scale: [0.2, 2, 0.2], color: RED },
  ],
})

// ── 3. 企业办公：产品陈列厅 ──────────────────────────────────────────────
const showroom = makeScene({
  id: 'showroom',
  name: '企业产品陈列厅',
  audience: '企业办公',
  description: '错落展台与悬浮球体组成的陈列空间，适合评审汇报或展厅大屏。',
  primitives: [
    { key: 'stage', type: 'cube', name: '中央展台', position: [0, 0.3, 0], scale: [8, 0.6, 8], color: STEEL },
    { key: 'pedestal-1', type: 'cube', name: '展台 1', position: [-4, 0.9, -3], scale: [2, 1.8, 2], color: BLUE },
    { key: 'pedestal-2', type: 'cube', name: '展台 2', position: [4, 1.2, -3], scale: [2, 2.4, 2], color: CYAN },
    { key: 'pedestal-3', type: 'cube', name: '展台 3', position: [-4, 1.5, 3], scale: [2, 3, 2], color: PURPLE },
    { key: 'pedestal-4', type: 'cube', name: '展台 4', position: [4, 0.75, 3], scale: [2, 1.5, 2], color: GREEN },
    { key: 'orb-1', type: 'sphere', name: '展品 1', position: [-4, 2.4, -3], scale: [1.3, 1.3, 1.3], color: AMBER },
    { key: 'orb-2', type: 'sphere', name: '展品 2', position: [4, 3, -3], scale: [1.5, 1.5, 1.5], color: ORANGE },
    { key: 'orb-3', type: 'sphere', name: '展品 3', position: [-4, 3.6, 3], scale: [1.2, 1.2, 1.2], color: RED },
    { key: 'orb-4', type: 'sphere', name: '展品 4', position: [4, 2.1, 3], scale: [1.1, 1.1, 1.1], color: BLUE },
    { key: 'backdrop', type: 'cube', name: '品牌背景板', position: [0, 2, -8], scale: [12, 4, 0.4], color: PURPLE },
    { key: 'accent-a', type: 'cube', name: '立柱 A', position: [-8, 2, -8], scale: [0.4, 4, 0.4], color: AMBER },
    { key: 'accent-b', type: 'cube', name: '立柱 B', position: [8, 2, -8], scale: [0.4, 4, 0.4], color: AMBER },
  ],
})

// ── 4. 创意可视化：城市天际线 ────────────────────────────────────────────
const skyline = makeScene({
  id: 'skyline',
  name: '城市天际线',
  audience: '创意可视化',
  description: '高低错落的楼群 + 悬浮天体 + 一颗滚动的球，静态结构与动态演示同框。',
  primitives: [
    { key: 'tower-1', type: 'cube', name: '塔楼 1', position: [-8, 3, -5], scale: [1.6, 6, 1.6], color: BLUE },
    { key: 'tower-2', type: 'cube', name: '塔楼 2', position: [-5.5, 4.5, -5], scale: [1.4, 9, 1.4], color: CYAN },
    { key: 'tower-3', type: 'cube', name: '塔楼 3', position: [-3, 2, -5], scale: [1.8, 4, 1.8], color: STEEL },
    { key: 'tower-4', type: 'cube', name: '塔楼 4', position: [-0.5, 6, -5], scale: [1.5, 12, 1.5], color: PURPLE },
    { key: 'tower-5', type: 'cube', name: '塔楼 5', position: [2, 3.5, -5], scale: [1.6, 7, 1.6], color: BLUE },
    { key: 'tower-6', type: 'cube', name: '塔楼 6', position: [4.5, 5, -5], scale: [1.3, 10, 1.3], color: CYAN },
    { key: 'tower-7', type: 'cube', name: '塔楼 7', position: [7, 2.5, -5], scale: [1.7, 5, 1.7], color: STEEL },
    { key: 'tower-8', type: 'cube', name: '塔楼 8', position: [-7, 2, 1], scale: [1.8, 4, 1.8], color: BROWN },
    { key: 'tower-9', type: 'cube', name: '塔楼 9', position: [-4, 3.5, 1], scale: [1.4, 7, 1.4], color: ORANGE },
    { key: 'tower-10', type: 'cube', name: '塔楼 10', position: [-1, 2.5, 1], scale: [1.6, 5, 1.6], color: GREEN },
    { key: 'tower-11', type: 'cube', name: '塔楼 11', position: [2, 4, 1], scale: [1.5, 8, 1.5], color: AMBER },
    { key: 'tower-12', type: 'cube', name: '塔楼 12', position: [5, 3, 1], scale: [1.7, 6, 1.7], color: BLUE },
    { key: 'moon', type: 'sphere', name: '悬浮天体', position: [9, 11, -2], scale: [3, 3, 3], color: YELLOW },
    { key: 'ramp', type: 'ramp', name: '高架坡道', position: [-8, 0.75, 7], scale: [7, 1.5, 3], color: STEEL },
    { key: 'ball', type: 'sphere', name: '滚球', position: [-10, 2, 7], scale: [1.2, 1.2, 1.2], color: RED, bodyType: 'dynamic' },
    { key: 'plaza', type: 'cube', name: '广场', position: [4, 0.05, 7], scale: [8, 0.1, 5], color: STEEL },
  ],
})

export const SHOWCASE_SCENES: ShowcaseScene[] = [galileo, arena, showroom, skyline]
