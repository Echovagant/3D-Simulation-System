// src/composables/useThree.ts
import { ref , Ref } from 'vue';
import * as THREE from 'three';

// 定义 `useThree` 的返回类型接口
export interface ThreeInstance {
  scene: Ref<THREE.Scene | null>;
  camera: Ref<THREE.PerspectiveCamera | null>;
  renderer: Ref<THREE.WebGLRenderer | null>;
  initThree: () => void;
  initRenderer: (canvas: HTMLCanvasElement) => THREE.WebGLRenderer | null;
}

export function useThree(): ThreeInstance {
  const scene = ref<THREE.Scene | null>(null);
  const camera = ref<THREE.PerspectiveCamera | null>(null);
  const renderer = ref<THREE.WebGLRenderer | null>(null);

  const initRenderer = (canvas: HTMLCanvasElement) => {
    if (renderer.value) renderer.value.dispose();
    renderer.value = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.value.setSize(window.innerWidth, window.innerHeight);
    return renderer.value;
  };

  const initThree = () => {
    scene.value = new THREE.Scene();
    scene.value.background = new THREE.Color(0x000000);

    camera.value = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000
    );
    camera.value.position.set(5, 5, 10);
  };

  return { scene, camera, renderer, initThree, initRenderer };
}
