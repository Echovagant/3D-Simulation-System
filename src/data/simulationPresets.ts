export const simulationPresets = [
  {
    id: 'newtons-cradle',
    name: '牛顿摆',
    description: '经典的牛顿摆演示动量守恒',
    thumbnail: '/assets/images/presets/newtons-cradle.jpg',
    scene: {
      name: '牛顿摆',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        {
          id: 'frame',
          type: 'object',
          geometry: 'box',
          material: 'metal',
          position: { x: 0, y: 2, z: 0 },
          scale: { x: 2, y: 0.1, z: 0.5 },
          physics: {
            type: 'static',
            shape: 'box'
          }
        },
        // 5个球体
        ...Array.from({ length: 5 }, (_, i) => ({
          id: `ball-${i}`,
          type: 'object',
          geometry: 'sphere',
          material: 'metal',
          position: { x: -0.8 + i * 0.4, y: 1, z: 0 },
          scale: { x: 0.2, y: 0.2, z: 0.2 },
          physics: {
            type: 'dynamic',
            shape: 'sphere',
            mass: 1,
            restitution: 0.99,
            friction: 0.01
          }
        }))
      ]
    }
  },
  {
    id: 'ramp-and-balls',
    name: '斜坡与球体',
    description: '不同质量的球体从斜坡滚落',
    thumbnail: '/assets/images/presets/ramp-and-balls.jpg',
    scene: {
      name: '斜坡与球体',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        // 地面
        {
          id: 'ground',
          type: 'object',
          geometry: 'box',
          material: 'concrete',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 10, y: 0.1, z: 10 },
          physics: {
            type: 'static',
            shape: 'box'
          }
        },
        // 斜坡
        {
          id: 'ramp',
          type: 'object',
          geometry: 'box',
          material: 'wood',
          position: { x: -2, y: 0.5, z: 0 },
          rotation: { x: 0, y: 0, z: -0.3 },
          scale: { x: 3, y: 0.1, z: 2 },
          physics: {
            type: 'static',
            shape: 'box'
          }
        },
        // 不同大小的球体
        ...[0.2, 0.3, 0.4].map((size, i) => ({
          id: `ball-${i}`,
          type: 'object',
          geometry: 'sphere',
          material: i === 0 ? 'rubber' : i === 1 ? 'metal' : 'wood',
          position: { x: -3.5, y: 1 + i * 0.5, z: -0.5 + i * 0.5 },
          scale: { x: size, y: size, z: size },
          physics: {
            type: 'dynamic',
            shape: 'sphere',
            mass: Math.pow(size, 3) * 100, // 基于体积的质量
            restitution: i === 0 ? 0.8 : i === 1 ? 0.2 : 0.5,
            friction: i === 0 ? 0.1 : i === 1 ? 0.3 : 0.5
          }
        }))
      ]
    }
  },
  {
    id: 'collision-test',
    name: '碰撞测试',
    description: '不同形状物体的碰撞测试',
    thumbnail: '/assets/images/presets/collision-test.jpg',
    scene: {
      name: '碰撞测试',
      gravity: { x: 0, y: -9.81, z: 0 },
      objects: [
        // 地面
        {
          id: 'ground',
          type: 'object',
          geometry: 'box',
          material: 'concrete',
          position: { x: 0, y: 0, z: 0 },
          scale: { x: 10, y: 0.1, z: 10 },
          physics: {
            type: 'static',
            shape: 'box'
          }
        },
        // 各种形状的物体
        {
          id: 'box',
          type: 'object',
          geometry: 'box',
          material: 'metal',
          position: { x: -2, y: 3, z: 0 },
          scale: { x: 0.5, y: 0.5, z: 0.5 },
          physics: {
            type: 'dynamic',
            shape: 'box',
            mass: 1,
            restitution: 0.3
          }
        },
        {
          id: 'sphere',
          type: 'object',
          geometry: 'sphere',
          material: 'rubber',
          position: { x: 0, y: 3, z: 0 },
          scale: { x: 0.5, y: 0.5, z: 0.5 },
          physics: {
            type: 'dynamic',
            shape: 'sphere',
            mass: 1,
            restitution: 0.8
          }
        },
        {
          id: 'cylinder',
          type: 'object',
          geometry: 'cylinder',
          material: 'wood',
          position: { x: 2, y: 3, z: 0 },
          scale: { x: 0.3, y: 0.6, z: 0.3 },
          physics: {
            type: 'dynamic',
            shape: 'cylinder',
            mass: 1,
            restitution: 0.5
          }
        }
      ]
    }
  }
];
