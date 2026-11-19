import type { PresetCatalogEntry } from '@/types'
import { createThumbnail } from '@/utils/thumbnail'

/**
 * 预设目录：仿真实验室的**唯一**预设来源。
 *
 * 格式说明（计划 018）：
 * - 这里的场景是**纯数据**，不是 Object3D——字段直接对应仿真实验室渲染时
 *   需要的东西：形状、位置、缩放、物理参数。
 * - 每个物体都写全 rotation，避免渲染层到处补默认值。
 * - id 是深链接的唯一依据（`/simulation-lab/<id>`），**不要**随意改。
 *
 * 目录合并了两套历史预设：原来的 `simulationPresets.ts`（牛顿摆 / 斜坡与球体 /
 * 碰撞测试）与仿真实验室内联的三个（自由落体 / 碰撞 / 钟摆）。
 * 两套的 id 都不冲突，因此全部保留——旧的深链接不会失效。
 */

/** 预设里用的几种材质配色（十六进制） */
const COLORS = {
  metal: 0xbdc3c7,
  concrete: 0x95a5a6,
  wood: 0xa97449,
  rubber: 0x2c3e50,
  blue: 0x3498db,
  red: 0xe74c3c,
  yellow: 0xf1c40f,
  green: 0x2ecc71,
  purple: 0x9b59b6,
} as const

export const simulationPresets: PresetCatalogEntry[] = [
  {
    id: 'newtons-cradle',
    name: '牛顿摆',
    description: '经典的牛顿摆演示动量守恒',
    thumbnail: createThumbnail('牛顿摆', 'props'),
    experiment: {
      purpose: '动量与能量在一维弹性碰撞链上的传递：等质量弹性碰撞交换速度，冲量沿球列传到末端',
      observations: [
        '弹性系数 0.99 时，输入的冲量只从另一端弹出等速的球，中间球保持静止',
        '把 restitution 调低，能量损失让多球一起晃动——可对照非弹性情形',
        '开启「数据记录」导出碰撞前后的速度，核对动量守恒',
      ],
      assignments: [
        '作业：测出两球碰撞前后的速度，写出动量守恒的实验误差来源',
      ],
    },
    scene: {
      name: '牛顿摆',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        {
          id: 'frame',
          type: 'box',
          name: '支架',
          position: { x: 0, y: 2, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 2, y: 0.1, z: 0.5 },
          physics: { type: 'static', mass: 0, friction: 0.5, restitution: 0.1 },
          color: COLORS.metal,
        },
        // 5 个球体
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `ball-${i}`,
          type: 'sphere' as const,
          name: `摆球 ${i + 1}`,
          position: { x: -0.8 + i * 0.4, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 0.2, y: 0.2, z: 0.2 },
          physics: { type: 'dynamic' as const, mass: 1, restitution: 0.99, friction: 0.01 },
          color: COLORS.metal,
        })),
      ],
    },
  },
  {
    id: 'ramp-and-balls',
    name: '斜坡与球体',
    description: '不同质量的球体从斜坡滚落',
    thumbnail: createThumbnail('斜坡与球体', 'props'),
    experiment: {
      purpose: '重力势能到动能的转换，以及质量、摩擦、弹性对滚动行为的影响',
      observations: [
        '三个球体的质量由体积推导（大球更重），滚动路径与次序可对照',
        '摩擦系数 0.1 / 0.3 / 0.5 分别对应三颗球的材质设定',
        '斜坡倾角由 rotation.z 决定，改角度可对比到达底部的时间',
      ],
      assignments: [
        '作业：用「数据记录」的位移-时间数据估算斜面末端动能，与 mgh 理论值对比并解释差值',
      ],
    },
    scene: {
      name: '斜坡与球体',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        // 地面
        {
          id: 'ground',
          type: 'box',
          name: '地面',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 10, y: 0.1, z: 10 },
          physics: { type: 'static', mass: 0, friction: 0.5, restitution: 0.1 },
          color: COLORS.concrete,
        },
        // 斜坡
        {
          id: 'ramp',
          type: 'box',
          name: '斜坡',
          position: { x: -2, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: -0.3 },
          scale: { x: 3, y: 0.1, z: 2 },
          physics: { type: 'static', mass: 0, friction: 0.5, restitution: 0.1 },
          color: COLORS.wood,
        },
        // 不同大小的球体：质量由体积推导
        ...[0.2, 0.3, 0.4].map((size, i) => ({
          id: `ball-${i}`,
          type: 'sphere' as const,
          name: `球体 ${i + 1}`,
          position: { x: -3.5, y: 1 + i * 0.5, z: -0.5 + i * 0.5 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: size, y: size, z: size },
          physics: {
            type: 'dynamic' as const,
            mass: Math.pow(size, 3) * 100, // 基于体积的质量
            restitution: i === 0 ? 0.8 : i === 1 ? 0.2 : 0.5,
            friction: i === 0 ? 0.1 : i === 1 ? 0.3 : 0.5,
          },
          color: i === 0 ? COLORS.rubber : i === 1 ? COLORS.metal : COLORS.wood,
        })),
      ],
    },
  },
  {
    id: 'collision-test',
    name: '碰撞测试 · 多形状',
    description: '不同形状物体的碰撞测试',
    thumbnail: createThumbnail('碰撞测试', 'props'),
    experiment: {
      purpose: '形状与恢复系数对碰撞结果的影响：接触面决定反弹姿态',
      observations: [
        'restitution 0.8 的球弹得最高，0.3 的立方体几乎不弹',
        '立方体与圆柱的落地姿态差异来自接触面不同',
        '三个物体从同一高度 y=3 同时落下',
      ],
      assignments: [
        '作业：预测并验证「相同恢复系数下球与立方体的反弹高度差」，说明接触面建模的局限',
      ],
    },
    scene: {
      name: '碰撞测试',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        // 地面
        {
          id: 'ground',
          type: 'box',
          name: '地面',
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 10, y: 0.1, z: 10 },
          physics: { type: 'static', mass: 0, friction: 0.5, restitution: 0.1 },
          color: COLORS.concrete,
        },
        // 各种形状的物体
        {
          id: 'box',
          type: 'box',
          name: '立方体',
          position: { x: -2, y: 3, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 0.5, y: 0.5, z: 0.5 },
          physics: { type: 'dynamic', mass: 1, restitution: 0.3, friction: 0.5 },
          color: COLORS.metal,
        },
        {
          id: 'sphere',
          type: 'sphere',
          name: '球体',
          position: { x: 0, y: 3, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 0.5, y: 0.5, z: 0.5 },
          physics: { type: 'dynamic', mass: 1, restitution: 0.8, friction: 0.5 },
          color: COLORS.rubber,
        },
        {
          id: 'cylinder',
          type: 'cylinder',
          name: '圆柱体',
          position: { x: 2, y: 3, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 0.3, y: 0.6, z: 0.3 },
          physics: { type: 'dynamic', mass: 1, restitution: 0.5, friction: 0.5 },
          color: COLORS.wood,
        },
      ],
    },
  },
  {
    id: 'free-fall',
    name: '自由落体',
    description: '两个物体从同一高度自由下落',
    thumbnail: createThumbnail('自由落体', 'props'),
    experiment: {
      purpose: '自由落体的匀加速性与质量无关性（g ≈ 9.81）',
      observations: [
        '立方体与球体同时落地——下落时间与质量无关',
        '开启「数据记录」导出位移-时间数据，验证匀加速',
        '两球弹性不同，落地后反弹行为不同',
      ],
      assignments: [
        '作业：从位移-时间数据拟合 g，与 9.81 m/s² 对比并给出误差来源',
      ],
    },
    scene: {
      name: '自由落体',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        {
          id: 'cube',
          type: 'box',
          name: '立方体',
          position: { x: 0, y: 5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.5 },
          color: COLORS.blue,
        },
        {
          id: 'sphere',
          type: 'sphere',
          name: '球体',
          position: { x: 2, y: 5, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.7 },
          color: COLORS.red,
        },
      ],
    },
  },
  {
    id: 'collision',
    name: '双立方体碰撞',
    description: '两个立方体相向而撞',
    thumbnail: createThumbnail('双立方体碰撞', 'props'),
    experiment: {
      purpose: '一维对心碰撞的动量交换（需先手动制造相向运动）',
      observations: [
        '预设默认静止——手动拖动两个立方体相向碰撞',
        'restitution 0.5 下碰撞后各自反弹一半速度',
        '质量相同时完全弹性碰撞会交换速度',
      ],
      assignments: [
        '作业：把 restitution 从 0.3 扫到 1.0，记录碰后速度比，画出恢复系数与速度交换程度的关系',
      ],
    },
    scene: {
      name: '双立方体碰撞',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        {
          id: 'cube-1',
          type: 'box',
          name: '立方体1',
          position: { x: -2, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.5 },
          color: COLORS.blue,
        },
        {
          id: 'cube-2',
          type: 'box',
          name: '立方体2',
          position: { x: 2, y: 1, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 1, y: 1, z: 1 },
          physics: { type: 'dynamic', mass: 1, friction: 0.3, restitution: 0.5 },
          color: COLORS.yellow,
        },
      ],
    },
  },
  {
    id: 'pendulum',
    name: '钟摆',
    description: '单摆来回摆动',
    thumbnail: createThumbnail('钟摆', 'props'),
    experiment: {
      purpose: '（如实边界）摆线约束尚未实现，当前预设是自由落体近似',
      observations: [
        '摆球从 y=3 直接下落，没有摆动周期',
        '摆线约束（铰链）实现后才能演示 T=2π√(L/g)',
        '这条边界也写在预设旁的 ? 提示里',
      ],
      assignments: [
        '作业题：单摆周期公式 T=2π√(L/g) 的成立条件是什么？现有引擎里摆线为什么只能用刚体近似？',
        '作业题：用现有约束近似搭一个「类单摆」，说明它与理想单摆的偏差来源',
      ],
    },
    scene: {
      name: '钟摆',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        {
          id: 'bob',
          type: 'box',
          name: '摆球',
          position: { x: 0, y: 3, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
          scale: { x: 0.5, y: 0.5, z: 0.5 },
          physics: { type: 'dynamic', mass: 1, friction: 0.1, restitution: 0.3 },
          color: COLORS.purple,
        },
      ],
    },
  },
]
