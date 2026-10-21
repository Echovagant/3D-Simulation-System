import type { Model } from '@/stores/modelStore';

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
 *
 * 缩略图同样是**从这些文件渲染出来的**（npm run gen:thumbnails），
 * 不是占位图——卡片上看到的就是点进去加载到的东西。
 *
 * 其中 7 个模型是本仓库自己程序化生成的（scripts/model-recipes.mjs + generate-model-assets.mjs），
 * 随 Apache-2.0 发布，不涉及任何第三方素材授权；
 * 狐狸与破损头盔是第三方资产，署名见 NOTICE。
 */

// 角色模型
export const createCharacterModels = (seed: number = 0): Model[] => [
  {
    id: 'char-001',
    name: '机甲',
    description: '风格化机甲，装甲与能源核心为靛紫主色',
    category: 'characters',
    thumbnailUrl: '/assets/models/thumbnails/mech.png',
    modelUrl: '/assets/models/characters/mech.glb',
    format: 'GLB',
    size: 79940,
    uploadDate: getRandomDate(seed + 0),
    polyCount: 656,
    materialCount: 7,
    hasAnimation: false
  },
  {
    id: 'char-002',
    name: '狐狸',
    description: '低多边形狐狸，含 3 段循环动画',
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
    description: '一段舱室：舷窗、管线、货箱与控制台',
    category: 'environments',
    thumbnailUrl: '/assets/models/thumbnails/space-station-interior.png',
    modelUrl: '/assets/models/environments/space-station-interior.glb',
    format: 'GLB',
    size: 170296,
    uploadDate: getRandomDate(seed + 3),
    polyCount: 1616,
    materialCount: 9,
    hasAnimation: false
  },
  {
    id: 'env-002',
    name: '森林场景',
    description: '低多边形林地：四棵树、灌木与碎石',
    category: 'environments',
    thumbnailUrl: '/assets/models/thumbnails/forest.png',
    modelUrl: '/assets/models/environments/forest.glb',
    format: 'GLB',
    size: 78544,
    uploadDate: getRandomDate(seed + 4),
    polyCount: 664,
    materialCount: 4,
    hasAnimation: false
  },
  {
    id: 'env-003',
    name: '城市街道',
    description: '街区块：两侧楼宇、路灯与发亮的窗带',
    category: 'environments',
    thumbnailUrl: '/assets/models/thumbnails/city-street.png',
    modelUrl: '/assets/models/environments/city-street.glb',
    format: 'GLB',
    size: 47292,
    uploadDate: getRandomDate(seed + 5),
    polyCount: 340,
    materialCount: 6,
    hasAnimation: false
  }
];

// 道具模型
export const createPropModels = (seed: number = 0): Model[] => [
  {
    id: 'prop-001',
    name: '科幻武器',
    description: '紧凑型能量手枪，靛紫外壳配琥珀能量条',
    category: 'props',
    thumbnailUrl: '/assets/models/thumbnails/energy-blaster.png',
    modelUrl: '/assets/models/props/energy-blaster.glb',
    format: 'GLB',
    size: 124428,
    uploadDate: getRandomDate(seed + 6),
    polyCount: 1200,
    materialCount: 6,
    hasAnimation: false
  },
  {
    id: 'prop-002',
    name: '魔法书',
    description: '悬浮的靛紫古籍，封面符文与光点发亮',
    category: 'props',
    thumbnailUrl: '/assets/models/thumbnails/arcane-book.png',
    modelUrl: '/assets/models/props/arcane-book.glb',
    format: 'GLB',
    size: 30012,
    uploadDate: getRandomDate(seed + 7),
    polyCount: 212,
    materialCount: 5,
    hasAnimation: false
  },
  {
    id: 'prop-003',
    name: '控制台',
    description: '斜面操作台，青色屏幕配琥珀按键',
    category: 'props',
    thumbnailUrl: '/assets/models/thumbnails/terminal-console.png',
    modelUrl: '/assets/models/props/terminal-console.glb',
    format: 'GLB',
    size: 57328,
    uploadDate: getRandomDate(seed + 8),
    polyCount: 480,
    materialCount: 7,
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
