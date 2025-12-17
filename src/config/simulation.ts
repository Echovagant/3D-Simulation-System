export const simulationConfig = {
  // 物理引擎配置
  physics: {
    defaultGravity: { x: 0, y: -9.81, z: 0 },
    defaultFriction: 0.5,
    defaultRestitution: 0.2,
    maxSubSteps: 5,
    fixedTimeStep: 1/60 // 60 FPS
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
    collisionLayers: {
      default: 0x0001,
      static: 0x0002,
      dynamic: 0x0004,
      kinematic: 0x0008,
      trigger: 0x0010
    }
  }
};
