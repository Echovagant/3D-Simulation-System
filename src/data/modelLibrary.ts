import type { Model } from '@/stores/modelStore';
import { createThumbnail } from '@/utils/thumbnail'

/**
 * 模型库的基准时间（固定值）。
 * 用固定基准而不是 Date.now()，是为了让 uploadDate 可复现：
 * 同一个 seed 永远得到同一个日期，测试与截图都不会随时间漂移。
 */
const LIBRARY_EPOCH = Date.UTC(2026, 0, 1);

/**
 * 由种子生成确定性的日期字符串（基准时间往前推若干天）。
 * @param seed 种子，同一个种子永远得到同一个日期
 */
export const getRandomDate = (seed: number): string => {
  const offset = (Math.abs(seed) % 365) * 24 * 60 * 60 * 1000;
  return new Date(LIBRARY_EPOCH - offset).toISOString();
};

// 角色模型
export const createCharacterModels = (seed: number = 0): Model[] => [
  {
    id: 'char-001',
    name: '士兵',
    description: '未来派士兵角色，带有完整动画集',
    category: 'characters',
    thumbnailUrl: createThumbnail('士兵', 'characters'),
    modelUrl: '/assets/models/characters/tactical-ops-soldier.glb',
    format: 'GLB',
    size: 2450000,
    uploadDate: getRandomDate(seed + 0),
    polyCount: 12500,
    materialCount: 5,
    hasAnimation: true
  },
  {
    id: 'char-002',
    name: '狐狸',
    description: '抽象风格的动物角色',
    category: 'characters',
    thumbnailUrl: createThumbnail('狐狸', 'characters'),
    modelUrl: '/assets/models/characters/Fox.glb',
    format: 'GLTF',
    size: 1850000,
    uploadDate: getRandomDate(seed + 1),
    polyCount: 9800,
    materialCount: 4,
    hasAnimation: true
  },
  {
    id: 'char-003',
    name: '机械机器人',
    description: '工业风格机器人角色',
    category: 'characters',
    thumbnailUrl: createThumbnail('机械机器人', 'characters'),
    modelUrl: '/assets/models/characters/DamagedHelmet.glb',
    format: 'FBX',
    size: 3200000,
    uploadDate: getRandomDate(seed + 2),
    polyCount: 15600,
    materialCount: 6,
    hasAnimation: true
  }
];

// 环境模型
export const createEnvironmentModels = (seed: number = 0): Model[] => [
  {
    id: 'env-001',
    name: '太空站内部',
    description: '未来主义太空站内部环境',
    category: 'environments',
    thumbnailUrl: createThumbnail('太空站内部', 'environments'),
    modelUrl: '#',
    format: 'GLB',
    size: 8500000,
    uploadDate: getRandomDate(seed + 3),
    polyCount: 45200,
    materialCount: 12,
    hasAnimation: false
  },
  {
    id: 'env-002',
    name: '森林场景',
    description: '自然森林环境，带有可交互元素',
    category: 'environments',
    thumbnailUrl: createThumbnail('森林场景', 'environments'),
    modelUrl: '#',
    format: 'GLTF',
    size: 6200000,
    uploadDate: getRandomDate(seed + 4),
    polyCount: 38700,
    materialCount: 8,
    hasAnimation: false
  },
  {
    id: 'env-003',
    name: '城市街道',
    description: '城市街道环境，包含多种建筑',
    category: 'environments',
    thumbnailUrl: createThumbnail('城市街道', 'environments'),
    modelUrl: '#',
    format: 'FBX',
    size: 12500000,
    uploadDate: getRandomDate(seed + 5),
    polyCount: 78500,
    materialCount: 15,
    hasAnimation: false
  }
];

// 道具模型
export const createPropModels = (seed: number = 0): Model[] => [
  {
    id: 'prop-001',
    name: '科幻武器',
    description: '未来风格能量武器',
    category: 'props',
    thumbnailUrl: createThumbnail('科幻武器', 'props'),
    modelUrl: '#',
    format: 'GLB',
    size: 1200000,
    uploadDate: getRandomDate(seed + 6),
    polyCount: 5400,
    materialCount: 3,
    hasAnimation: true
  },
  {
    id: 'prop-002',
    name: '魔法书',
    description: '古老的魔法书，带有动画效果',
    category: 'props',
    thumbnailUrl: createThumbnail('魔法书', 'props'),
    modelUrl: '#',
    format: 'GLTF',
    size: 950000,
    uploadDate: getRandomDate(seed + 7),
    polyCount: 3200,
    materialCount: 2,
    hasAnimation: true
  },
  {
    id: 'prop-003',
    name: '控制台',
    description: '高科技控制台，带有交互元素',
    category: 'props',
    thumbnailUrl: createThumbnail('控制台', 'props'),
    modelUrl: '#',
    format: 'OBJ',
    size: 2100000,
    uploadDate: getRandomDate(seed + 8),
    polyCount: 8700,
    materialCount: 4,
    hasAnimation: true
  }
];

/**
 * 整合所有模型。
 * 做成工厂而不是模块级常量：每次调用都返回全新数组，
 * 调用方（modelStore）再复制一份，就不会再出现"两个 store 共享同一份数组"的问题。
 */
export const createModelLibrary = (seed: number = 0): Model[] => [
  ...createCharacterModels(seed),
  ...createEnvironmentModels(seed),
  ...createPropModels(seed)
];
