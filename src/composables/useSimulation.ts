import { ref, onUnmounted } from 'vue';
import { Object3D, Clock, Vector3, Euler, Scene } from 'three';
import { useSimulationStore } from '@/stores/simulationStore';
import { usePhysics } from './usePhysics';

// 定义允许的属性类型
type Object3DProperty = 'name' | 'visible' | 'castShadow' | 'receiveShadow';
type Object3DTransformProperty = 'position' | 'rotation' | 'scale';
type TransformAxis = 'x' | 'y' | 'z';
type PhysicsProperty = 'mass' | 'friction' | 'restitution';

type Vector3Data = {
  x: number;
  y: number;
  z: number;
};

type ObjectProperties = {
  name: string;
  position: Vector3Data;
  rotation: Vector3Data;
  scale: Vector3Data;
  visible: boolean;
  physics?: {
    mass: number;
    friction: number;
    restitution: number;
  };
};

export function useSimulation() {
  const simulationStore = useSimulationStore();
  const { world, stepPhysics, resetPhysics, addRigidBody, removeRigidBody } = usePhysics();

  // 状态
  const simulationScene = ref<Scene | null>(null);
  const isPlaying = ref(false);
  const simulationSpeed = ref(1);
  const stepSize = ref(0.016); // ~1/60秒
  const simulationTime = ref(0);
  const clock = new Clock();

  // 内部变量
  let animationFrameId: number;

  // 初始化仿真场景
  const initializeSimulation = (scene: Scene) => {
    simulationScene.value = scene;
    scene.traverse((object: Object3D) => {
      if (object.userData.physics) {
        addRigidBody(object);
      }
    });
  };

  // 仿真循环
  const simulationLoop = () => {
    if (!isPlaying.value || !world.value) return;

    const delta = clock.getDelta() * simulationSpeed.value;
    simulationTime.value += delta;
    stepPhysics(delta);
    animationFrameId = requestAnimationFrame(simulationLoop);
  };

  // 控制方法
  const startSimulation = () => {
    if (!isPlaying.value) {
      isPlaying.value = true;
      clock.start();
      simulationLoop();
    }
  };

  const pauseSimulation = () => {
    isPlaying.value = false;
    clock.stop();
    cancelAnimationFrame(animationFrameId);
  };

  const stepSimulation = () => {
    if (!world.value) return;

    const wasPlaying = isPlaying.value;
    if (wasPlaying) pauseSimulation();

    stepPhysics(stepSize.value);
    simulationTime.value += stepSize.value;

    if (wasPlaying) startSimulation();
  };

  const resetSimulation = () => {
    pauseSimulation();
    simulationTime.value = 0;
    clock.start();
    clock.elapsedTime = 0;
    clock.stop();
    resetPhysics();
  };

  // 对象属性处理
  const getObjectProperties = (object: Object3D): ObjectProperties => {
    const properties: ObjectProperties = {
      name: object.name,
      position: {
        x: object.position.x,
        y: object.position.y,
        z: object.position.z
      },
      rotation: {
        x: object.rotation.x,
        y: object.rotation.y,
        z: object.rotation.z
      },
      scale: {
        x: object.scale.x,
        y: object.scale.y,
        z: object.scale.z
      },
      visible: object.visible
    };

    if (object.userData.physics) {
      properties.physics = {
        mass: object.userData.physics.mass,
        friction: object.userData.physics.friction,
        restitution: object.userData.physics.restitution
      };
    }

    return properties;
  };

  // 类型守卫
  const isTransformProperty = (prop: string): prop is Object3DTransformProperty => {
    return ['position', 'rotation', 'scale'].includes(prop);
  };

  const isTransformAxis = (axis: string): axis is TransformAxis => {
    return ['x', 'y', 'z'].includes(axis);
  };

  const isObject3DProperty = (prop: string): prop is Object3DProperty => {
    return ['name', 'visible', 'castShadow', 'receiveShadow'].includes(prop);
  };

  const isPhysicsProperty = (prop: string): prop is PhysicsProperty => {
    return ['mass', 'friction', 'restitution'].includes(prop);
  };

  const updateObjectProperty = (object: Object3D, property: string, value: number | string | boolean) => {
    if (property.includes('.')) {
      const [parentProp, childProp] = property.split('.');

      // 处理变换属性（position/rotation/scale的x/y/z）
      if (isTransformProperty(parentProp) && isTransformAxis(childProp) && typeof value === 'number') {
        const transform = object[parentProp] as Vector3 | Euler;
        // 明确指定类型，避免never类型推断
        if (transform instanceof Vector3) {
          transform[childProp] = value;
        } else if (transform instanceof Euler) {
          transform[childProp] = value;
        }

        // 更新物理引擎
        if (world.value && object.userData.physics?.body) {
          world.value.removeRigidBody(object.userData.physics.body);
          addRigidBody(object);
        }
      }
      // 处理物理属性
      else if (parentProp === 'physics' && isPhysicsProperty(childProp) && typeof value === 'number') {
        if (object.userData.physics) {
          object.userData.physics[childProp] = value;

          if (world.value && object.userData.physics?.body) {
            world.value.removeRigidBody(object.userData.physics.body);
            addRigidBody(object);
          }
        }
      }
    }
    // 处理直接属性
    else if (isObject3DProperty(property)) {
      // 根据属性类型进行赋值，避免类型不匹配
      if (property === 'name' && typeof value === 'string') {
        object[property] = value;
      } else if ((property === 'visible' || property === 'castShadow' || property === 'receiveShadow') && typeof value === 'boolean') {
        object[property] = value;
      }
    }
  };

  // 清理
  onUnmounted(() => {
    pauseSimulation();
  });

  return {
    simulationScene,
    isPlaying,
    simulationSpeed,
    stepSize,
    simulationTime,
    initializeSimulation,
    startSimulation,
    pauseSimulation,
    stepSimulation,
    resetSimulation,
    getObjectProperties,
    updateObjectProperty
  };
}
