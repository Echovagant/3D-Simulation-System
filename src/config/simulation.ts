/**
 * 仿真的全局参数口径（仿真实验室 / 场景编辑器 / AI 演武场共用）。
 *
 * ⚠️ 真正被消费的只有 physics 的三项：fixedTimeStep / maxSubSteps / maxFrameDelta
 * 喂给固定步长累加器（src/utils/fixedStepAccumulator.ts）。
 * 其余分组（controls / visualization / objects）是预留字段，尚未接线——
 * 改它们不会产生任何效果。
 */
export const simulationConfig = {
  // 物理引擎配置
  physics: {
    defaultGravity: { x: 0, y: -9.81, z: 0 },
    defaultFriction: 0.5,
    defaultRestitution: 0.2,
    // 单帧最多补推多少个物理步：限制追帧开销，防止低帧率机器陷入「越追越卡」
    maxSubSteps: 5,
    // 固定步长（秒）：确定性物理的基准，不随显示帧率变化
    fixedTimeStep: 1/60, // 60 FPS
    maxFrameDelta: 0.25 // 单帧最多采纳 250ms 真实时间，防止后台标签页回来后物理炸开
  },

  // 仿真控制配置
  controls: {
    minSpeed: 0.1,
    maxSpeed: 5,
    defaultSpeed: 1,
    stepSizes: [0.01, 0.05, 0.1, 0.2, 0.5, 1],
    defaultStepSize: 0.016 // ~1/60秒
  },

  // 可视化配置
  visualization: {
    showColliders: false,
    showNormals: false,
    showBoundingBoxes: false,
    showWireframes: false,
    maxFps: 60
  },

  // 物体默认配置
  objects: {
    defaultMass: 1,
    defaultDensity: 1000, // kg/m³
    maxObjects: 1000,
    // 预留的碰撞分层位掩码：当前物理路径尚未使用
    collisionLayers: {
      default: 0x0001,
      static: 0x0002,
      dynamic: 0x0004,
      kinematic: 0x0008,
      trigger: 0x0010
    }
  }
};
