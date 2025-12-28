import { ref, Ref, onUnmounted } from 'vue';
import { Object3D, Vector3 } from 'three';
import { World, RigidBodyDesc, ColliderDesc, RigidBody } from '@dimforge/rapier3d';
import * as RAPIER from '@dimforge/rapier3d';

// 1. 定义与Rapier实际实现匹配的刚体接口
interface RapierRigidBody extends RigidBody {
  userData?: { object: Object3D };
}

// 2. 定义完整的物理实例接口
interface PhysicsInstance {
  world: Ref<RAPIER.World | null>;
  initPhysics: (scene?: Object3D) => void;
  updatePhysics: (deltaTime: number) => void;
  stepPhysics: (deltaTime: number) => void;
  resetPhysics: () => void;
  addRigidBody: (object: Object3D) => void;
  removeRigidBody: (object: Object3D) => void;
  updatePhysicsParameters: (params: { gravity?: Vector3; friction?: number; restitution?: number }) => void;
}

export function usePhysics(): PhysicsInstance {
  // 3. 明确使用实际World类型的ref
  const world: Ref<RAPIER.World | null> = ref(null);
  const eventQueue: Ref<RAPIER.EventQueue | null> = ref(null);
  const gravity = { x: 0, y: -9.81, z: 0 };

  const initPhysics = (scene?: Object3D) => {
    world.value = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
    eventQueue.value = new RAPIER.EventQueue(true);
    
    // 为world添加scene属性
    if (scene) {
      (world.value as RAPIER.World & { scene?: Object3D }).scene = scene;
    }
  };

  const updatePhysics = (deltaTime: number) => {
    if (!world.value || !eventQueue.value) return;

    world.value.integrationParameters.dt = deltaTime;
    world.value.step(eventQueue.value);

    // 处理碰撞事件
    eventQueue.value.drainCollisionEvents((handle1: number, handle2: number, started: boolean) => {
      console.log(`碰撞: 物体${handle1}与${handle2}, ${started ? '开始' : '结束'}`);
    });

    // 遍历刚体并同步到Three.js对象
    const bodies = world.value.bodies;
    for (let i = 0; i < bodies.len(); i++) {
      const body = bodies.get(i);
      if (!body) continue;
      const userData = (body as RapierRigidBody).userData;
      if (userData?.object && userData.object instanceof Object3D) {
        const position = body.translation();
        const rotation = body.rotation();
        userData.object.position.set(position.x, position.y, position.z);
        userData.object.quaternion.set(rotation.x, rotation.y, rotation.z, rotation.w);
      }
    }
  };

  // 将updatePhysics重命名为stepPhysics以匹配调用
  const stepPhysics = updatePhysics;

  const createGroundPlane = () => {
    if (!world.value) return;
    const ground = new Object3D();
    ground.name = 'Ground';
    ground.position.set(0, -1, 0);
    ground.userData.physics = {
      type: 'static',
      shape: 'box',
      halfExtents: { x: 10, y: 0.5, z: 10 }
    };
    addRigidBody(ground);
  };

  const addRigidBody = (object: Object3D) => {
    if (!world.value || !object.userData.physics) return;

    const physicsData = object.userData.physics;

    let shape: ColliderDesc;
    switch (physicsData.shape || 'box') {
      case 'box':
        const boxHalfExtents = physicsData.halfExtents || {
          x: object.scale.x * 0.5,
          y: object.scale.y * 0.5,
          z: object.scale.z * 0.5
        };
        shape = ColliderDesc.cuboid(
          boxHalfExtents.x,
          boxHalfExtents.y,
          boxHalfExtents.z
        );
        break;
      case 'sphere':
        const radius = physicsData.radius || (object.scale.x * 0.5);
        shape = ColliderDesc.ball(radius);
        break;
      case 'cylinder':
        const radiusCyl = physicsData.radius || (object.scale.x * 0.5);
        const heightCyl = physicsData.height || (object.scale.y);
        shape = ColliderDesc.cylinder(heightCyl * 0.5, radiusCyl);
        break;
      default:
        shape = ColliderDesc.cuboid(0.5, 0.5, 0.5);
    }

    shape.setFriction(physicsData.friction || 0.5);
    shape.setRestitution(physicsData.restitution || 0.2);

    let rigidBodyDesc: RigidBodyDesc;
    if (physicsData.type === 'static' || physicsData.mass === 0) {
      rigidBodyDesc = RigidBodyDesc.fixed();
    } else {
      rigidBodyDesc = RigidBodyDesc.dynamic()
        .setTranslation(
          object.position.x,
          object.position.y,
          object.position.z
        )
        .setRotation({
          x: object.rotation.x,
          y: object.rotation.y,
          z: object.rotation.z,
          w: 1
        });

      if (physicsData.mass) {
        const volume = calculateVolume(physicsData.shape, object.scale);
        if (volume) {
          shape.setDensity(physicsData.mass / volume);
        }
      }
    }

    const rigidBody = world.value.createRigidBody(rigidBodyDesc);
    const collider = world.value.createCollider(shape, rigidBody);

    object.userData.physics.body = rigidBody;
    object.userData.physics.collider = collider;
    (rigidBody as RapierRigidBody).userData = { object };
  };

  const removeRigidBody = (object: Object3D) => {
    if (!world.value || !object.userData.physics?.body) return;
    world.value.removeRigidBody(object.userData.physics.body);
    object.userData.physics.body = null;
    object.userData.physics.collider = null;
  };

  const resetPhysics = () => {
    if (!world.value) return;

    // 获取scene引用
    const scene = (world.value as RAPIER.World & { scene?: Object3D }).scene;

    // 移除所有刚体
    const bodies = world.value.bodies;
    for (let i = 0; i < bodies.len(); i++) {
      const body = bodies.get(i);
      if (body) world.value.removeRigidBody(body);
    }

    // 重新创建物理世界
    world.value = new World(gravity);
    (world.value as RAPIER.World & { scene?: Object3D }).scene = scene;

    // 重新初始化地面和物体
    if (world.value && scene) {
      createGroundPlane();
      scene.traverse((object: Object3D) => {
        if (object.userData.physics) addRigidBody(object);
      });
    }
  };

  const calculateVolume = (shape: string, scale: {x: number, y: number, z: number}) => {
    switch (shape) {
      case 'box': return scale.x * scale.y * scale.z;
      case 'sphere': return (4/3) * Math.PI * Math.pow(scale.x / 2, 3);
      case 'cylinder': return Math.PI * Math.pow(scale.x / 2, 2) * scale.y;
      default: return 1;
    }
  };

  const updatePhysicsParameters = (params: { gravity?: Vector3; friction?: number; restitution?: number }) => {
    if (!world.value) return;
    
    // 更新重力
    if (params.gravity) {
      world.value.gravity = params.gravity;
    }
    
    // 优化：直接更新现有刚体的摩擦力和恢复系数，而不是重置整个物理世界
    if (params.friction !== undefined || params.restitution !== undefined) {
      const scene = (world.value as RAPIER.World & { scene?: Object3D }).scene;
      if (scene) {
        scene.traverse((object: Object3D) => {
          if (object.userData.physics?.collider) {
            const collider = object.userData.physics.collider;
            
            // 直接更新碰撞器的摩擦力
            if (params.friction !== undefined) {
              collider.setFriction(params.friction);
              object.userData.physics.friction = params.friction;
            }
            
            // 直接更新碰撞器的恢复系数
            if (params.restitution !== undefined) {
              collider.setRestitution(params.restitution);
              object.userData.physics.restitution = params.restitution;
            }
          }
        });
      }
    }
  };

  onUnmounted(() => {
    if (world.value) {
      const bodies = world.value.bodies;
      for (let i = 0; i < bodies.len(); i++) {
        const body = bodies.get(i);
        if (body) world.value.removeRigidBody(body);
      }
      world.value = null;
    }
  });

  return {
    world,
    initPhysics,
    updatePhysics,
    stepPhysics,
    resetPhysics,
    addRigidBody,
    removeRigidBody,
    updatePhysicsParameters
  };
}
