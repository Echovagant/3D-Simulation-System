import { Model } from '@/stores/modelStore';

// 生成随机日期（过去一年内）
const getRandomDate = () => {
  const now = new Date();
  const pastYear = new Date(now.setFullYear(now.getFullYear() - 1));
  return new Date(pastYear.getTime() + Math.random() * (now.getTime() - pastYear.getTime())).toISOString();
};

// 角色模型
export const characterModels: Model[] = [
  {
    id: 'char-001',
    name: '士兵',
    description: '未来派士兵角色，带有完整动画集',
    category: 'characters',
    thumbnailUrl: 'https://picsum.photos/seed/soldier/400/300',
    modelUrl: '../assets/models/characters/tactical-ops-soldier.glb',
    format: 'GLB',
    size: 2450000,
    uploadDate: getRandomDate(),
    polyCount: 12500,
    materialCount: 5,
    hasAnimation: true
  },
  {
    id: 'char-002',
    name: '狐狸',
    description: '抽象风格的动物角色',
    category: 'characters',
    thumbnailUrl: 'https://picsum.photos/seed/wizard/400/300',
    modelUrl: '../assets/models/characters/Fox.glb',
    format: 'GLTF',
    size: 1850000,
    uploadDate: getRandomDate(),
    polyCount: 9800,
    materialCount: 4,
    hasAnimation: true
  },
  {
    id: 'char-003',
    name: '机械机器人',
    description: '工业风格机器人角色',
    category: 'characters',
    thumbnailUrl: 'https://picsum.photos/seed/robot/400/300',
    modelUrl: '../assets/models/characters/DamagedHelmet.glb',
    format: 'FBX',
    size: 3200000,
    uploadDate: getRandomDate(),
    polyCount: 15600,
    materialCount: 6,
    hasAnimation: true
  }
];

// 环境模型
export const environmentModels: Model[] = [
  {
    id: 'env-001',
    name: '太空站内部',
    description: '未来主义太空站内部环境',
    category: 'environments',
    thumbnailUrl: 'https://picsum.photos/seed/spacestation/400/300',
    modelUrl: '#',
    format: 'GLB',
    size: 8500000,
    uploadDate: getRandomDate(),
    polyCount: 45200,
    materialCount: 12,
    hasAnimation: false
  },
  {
    id: 'env-002',
    name: '森林场景',
    description: '自然森林环境，带有可交互元素',
    category: 'environments',
    thumbnailUrl: 'https://picsum.photos/seed/forest/400/300',
    modelUrl: '#',
    format: 'GLTF',
    size: 6200000,
    uploadDate: getRandomDate(),
    polyCount: 38700,
    materialCount: 8,
    hasAnimation: false
  },
  {
    id: 'env-003',
    name: '城市街道',
    description: '城市街道环境，包含多种建筑',
    category: 'environments',
    thumbnailUrl: 'https://picsum.photos/seed/city/400/300',
    modelUrl: '#',
    format: 'FBX',
    size: 12500000,
    uploadDate: getRandomDate(),
    polyCount: 78500,
    materialCount: 15,
    hasAnimation: false
  }
];

// 道具模型
export const propModels: Model[] = [
  {
    id: 'prop-001',
    name: '科幻武器',
    description: '未来风格能量武器',
    category: 'props',
    thumbnailUrl: 'https://picsum.photos/seed/weapon/400/300',
    modelUrl: '#',
    format: 'GLB',
    size: 1200000,
    uploadDate: getRandomDate(),
    polyCount: 5400,
    materialCount: 3,
    hasAnimation: true
  },
  {
    id: 'prop-002',
    name: '魔法书',
    description: '古老的魔法书，带有动画效果',
    category: 'props',
    thumbnailUrl: 'https://picsum.photos/seed/book/400/300',
    modelUrl: '#',
    format: 'GLTF',
    size: 950000,
    uploadDate: getRandomDate(),
    polyCount: 3200,
    materialCount: 2,
    hasAnimation: true
  },
  {
    id: 'prop-003',
    name: '控制台',
    description: '高科技控制台，带有交互元素',
    category: 'props',
    thumbnailUrl: 'https://picsum.photos/seed/console/400/300',
    modelUrl: '#',
    format: 'OBJ',
    size: 2100000,
    uploadDate: getRandomDate(),
    polyCount: 8700,
    materialCount: 4,
    hasAnimation: true
  }
];

// 整合所有模型
export const modelLibrary: Model[] = [
  ...characterModels,
  ...environmentModels,
  ...propModels
];
