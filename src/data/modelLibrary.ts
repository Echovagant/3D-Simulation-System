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

/**
 * 是否是「占位条目」——没有可加载的文件。
 *
 * 占位条目**不报告任何文件属性**（格式/大小/面数/材质/动画）：
 * 没有文件，就没有这些数字对应的事实基础。
 * 界面据此显示「—」，而不是一组看起来很真的假数字。
 */
export const isPlaceholderModel = (model: Pick<Model, 'modelUrl'>): boolean =>
  model.modelUrl === '#';

/**
 * 内置模型的文件属性一律取自 GLB 实测值。
 *
 * 这些数字由 `scripts/check-model-metadata.mjs` 在构建时重新核对一遍：
 * 直接解析 public/ 下的 GLB，比对字节数、三角形数、材质数、动画数。
 * 改了文件或改了这里而没同步，构建会失败。
 */

// 角色模型
export const createCharacterModels = (seed: number = 0): Model[] => [
  {
    id: 'char-001',
    name: '士兵',
    description: '未来派士兵角色（占位条目，尚未提供可加载模型）',
    category: 'characters',
    thumbnailUrl: createThumbnail('士兵', 'characters'),
    modelUrl: '#',
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 0),
    polyCount: 0,
    materialCount: 0,
    hasAnimation: false
  },
  {
    id: 'char-002',
    name: '狐狸',
    description: '低多边形狐狸，含 3 段动画',
    category: 'characters',
    thumbnailUrl: '/assets/models/thumbnails/Fox.png',
    modelUrl: '/assets/models/characters/Fox.glb',
    format: 'GLB',
    size: 162852,
    uploadDate: getRandomDate(seed + 1),
    polyCount: 576,
    materialCount: 1,
    hasAnimation: true
  },
  {
    id: 'char-003',
    name: '破损头盔',
    description: '带战斗损伤的飞行头盔，源自 Khronos glTF 示例资产',
    category: 'characters',
    thumbnailUrl: '/assets/models/thumbnails/DamagedHelmet.png',
    modelUrl: '/assets/models/characters/DamagedHelmet.glb',
    format: 'GLB',
    size: 3773916,
    uploadDate: getRandomDate(seed + 2),
    polyCount: 15452,
    materialCount: 1,
    hasAnimation: false
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
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 3),
    polyCount: 0,
    materialCount: 0,
    hasAnimation: false
  },
  {
    id: 'env-002',
    name: '森林场景',
    description: '自然森林环境，带有可交互元素',
    category: 'environments',
    thumbnailUrl: createThumbnail('森林场景', 'environments'),
    modelUrl: '#',
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 4),
    polyCount: 0,
    materialCount: 0,
    hasAnimation: false
  },
  {
    id: 'env-003',
    name: '城市街道',
    description: '城市街道环境，包含多种建筑',
    category: 'environments',
    thumbnailUrl: createThumbnail('城市街道', 'environments'),
    modelUrl: '#',
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 5),
    polyCount: 0,
    materialCount: 0,
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
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 6),
    polyCount: 0,
    materialCount: 0,
    hasAnimation: false
  },
  {
    id: 'prop-002',
    name: '魔法书',
    description: '古老的魔法书，带有动画效果',
    category: 'props',
    thumbnailUrl: createThumbnail('魔法书', 'props'),
    modelUrl: '#',
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 7),
    polyCount: 0,
    materialCount: 0,
    hasAnimation: false
  },
  {
    id: 'prop-003',
    name: '控制台',
    description: '高科技控制台，带有交互元素',
    category: 'props',
    thumbnailUrl: createThumbnail('控制台', 'props'),
    modelUrl: '#',
    format: '',
    size: 0,
    uploadDate: getRandomDate(seed + 8),
    polyCount: 0,
    materialCount: 0,
    hasAnimation: false
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
