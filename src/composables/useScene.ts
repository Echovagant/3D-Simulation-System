// src/composables/useScene.ts
import { ref, onMounted, watch } from 'vue';
import * as THREE from 'three';
import { useThree } from './useThree';

export function useScene() {
  const { scene, camera, renderer } = useThree(); // 从 useThree 获取核心对象引用
  const sceneRef = ref<THREE.Scene | null>(null);

  // 初始化场景
  const initScene = () => {
    if (!scene.value) {
      scene.value = new THREE.Scene();
      sceneRef.value = scene.value;
      // 设置场景背景色
      scene.value.background = new THREE.Color(0x050505);
      // 添加光源
      addLights();
      // 添加地面
      addGround();
    }
  };

  // 添加场景光源（环境光 + 平行光）
  const addLights = () => {
    if (scene.value) {
      // 环境光：均匀照亮场景
      const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
      scene.value.add(ambientLight);
      // 平行光：模拟主光源（如太阳）
      const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
      directionalLight.position.set(5, 10, 7.5);
      scene.value.add(directionalLight);
    }
  };

  // 添加地面平面
  const addGround = () => {
    if (scene.value) {
      const groundGeo = new THREE.PlaneGeometry(10, 10);
      const groundMat = new THREE.MeshBasicMaterial({ color: 0xcccccc });
      const groundGeometry = new THREE.PlaneGeometry(50, 50);
      const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        side: THREE.DoubleSide, // 双面可见
      });
      const ground = new THREE.Mesh(groundGeometry, groundMaterial);
      ground.rotation.x = -Math.PI / 2; // 旋转为水平平面
      ground.position.y = -0.5; // 地面位置（避免与其他物体重叠）
      scene.value.add(ground);
      // 添加光源
      const addLights = () => {
        if (scene.value) { // 非空检查
          const ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
          scene.value.add(ambientLight);

          const dirLight = new THREE.DirectionalLight(0xffffff, 1);
          dirLight.position.set(5, 10, 7.5);
          scene.value.add(dirLight);
        }
      };
    }
  };

  // 监听渲染器尺寸变化，更新相机比例（保持画面不失真）
  watch(renderer, (newRenderer) => {
    if (newRenderer && camera.value) {
      camera.value.aspect = newRenderer.domElement.clientWidth / newRenderer.domElement.clientHeight;
      camera.value.updateProjectionMatrix();
    }
  });

  onMounted(() => {
    initScene();
    addGround();
    addLights();
  });

  return {
    scene: sceneRef,
    initScene,
    addLights,
    addGround,
  };
}
