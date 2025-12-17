import { Object3D, Box3, Vector3 } from 'three';
import * as RAPIER from '@dimforge/rapier3d';
import { simulationConfig } from '@/config/simulation';
import type { PhysicsData } from '@/types';

/**
 * 计算物体的包围盒
 */
export const computeBoundingBox = (object: Object3D): Box3 => {
  const box = new Box3();
  box.setFromObject(object);
  return box;
};

/**
 * 从Three.js物体创建物理形状描述
 */
export const createShapeFromObject = (object: Object3D): RAPIER.ColliderDesc => {
  const physicsData = object.userData.physics || {};
  const boundingBox = computeBoundingBox(object);
  const size = new Vector3();
  boundingBox.getSize(size);

  // 默认使用包围盒的一半作为半尺寸
  const halfExtents = new Vector3(
    size.x / 2,
    size.y / 2,
    size.z / 2
  );

  switch (physicsData.shape || 'box') {
    case 'box':
      return RAPIER.ColliderDesc.cuboid(
        physicsData.halfExtents?.x || halfExtents.x,
        physicsData.halfExtents?.y || halfExtents.y,
        physicsData.halfExtents?.z || halfExtents.z
      );

    case 'sphere':
      const sphereRadius = physicsData.radius || Math.max(halfExtents.x, halfExtents.y, halfExtents.z);
      return RAPIER.ColliderDesc.ball(sphereRadius);

    case 'cylinder':
      const cylinderRadius = physicsData.radius || Math.max(halfExtents.x, halfExtents.z);
      const height = physicsData.height || size.y;
      return RAPIER.ColliderDesc.cylinder(height / 2, cylinderRadius);

    default:
      return RAPIER.ColliderDesc.cuboid(
        halfExtents.x,
        halfExtents.y,
        halfExtents.z
      );
  }
};

/**
 * 配置碰撞体属性
 */
export const configureCollider = (
  colliderDesc: RAPIER.ColliderDesc,
  physicsData: PhysicsData
): RAPIER.ColliderDesc => {
  // 设置摩擦
  colliderDesc.setFriction(physicsData.friction ?? simulationConfig.physics.defaultFriction);

  // 设置恢复系数（弹性）
  colliderDesc.setRestitution(physicsData.restitution ?? simulationConfig.physics.defaultRestitution);

  // 设置碰撞层
  if (physicsData.collisionLayer) {
    //colliderDesc.setCollisionLayers(physicsData.collisionLayer);
  }

  // 设置密度（用于计算质量）
  if (physicsData.mass) {
    // Rapier 3D没有computeVolume方法，这里使用密度设置
    colliderDesc.setDensity(physicsData.mass);
  } else if (physicsData.density) {
    colliderDesc.setDensity(physicsData.density);
  }

  return colliderDesc;
};

/**
 * 创建刚体描述
 */
export const createRigidBodyDesc = (object: Object3D): RAPIER.RigidBodyDesc => {
  const physicsData = object.userData.physics || {};
  const position = object.position;
  const rotation = object.quaternion;

  let rigidBodyDesc: RAPIER.RigidBodyDesc;

  // 根据类型创建不同的刚体描述
  if (physicsData.type === 'static' || physicsData.mass === 0) {
    rigidBodyDesc = RAPIER.RigidBodyDesc.fixed();
  } else if (physicsData.type === 'kinematic') {
    rigidBodyDesc = RAPIER.RigidBodyDesc.kinematicPositionBased();
  } else {
    rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic();

    // 设置线性阻尼
    if (physicsData.linearDamping !== undefined) {
      rigidBodyDesc.setLinearDamping(physicsData.linearDamping);
    }

    // 设置角阻尼
    if (physicsData.angularDamping !== undefined) {
      rigidBodyDesc.setAngularDamping(physicsData.angularDamping);
    }
  }

  // 设置位置和旋转
  rigidBodyDesc.setTranslation(position.x, position.y, position.z);
  rigidBodyDesc.setRotation({
    x: rotation.x,
    y: rotation.y,
    z: rotation.z,
    w: rotation.w
  });

  return rigidBodyDesc;
};

/**
 * 同步Three.js物体与物理引擎中的刚体
 */
export const syncObjectWithRigidBody = (object: Object3D, body: RAPIER.RigidBody) => {
  const position = body.translation();
  const rotation = body.rotation();

  object.position.set(position.x, position.y, position.z);
  object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
};

/**
 * 为物体应用力
 */
export const applyForceToObject = (
  object: Object3D,
  force: Vector3,
  point?: Vector3
) => {
  if (!object.userData.physics?.body) return;

  const body = object.userData.physics.body;

  if (point) {
    // 应用力到特定点
    body.applyForce(
      { x: force.x, y: force.y, z: force.z },
      { x: point.x, y: point.y, z: point.z },
      true
    );
  } else {
    // 应用力到重心
    body.applyForce(
      { x: force.x, y: force.y, z: force.z },
      true
    );
  }
};
