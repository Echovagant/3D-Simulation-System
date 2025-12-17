import { ref, onMounted, onUnmounted, Ref } from 'vue';
import * as THREE from 'three';

// 定义useRenderer的返回类型接口
export interface RendererInstance {
  renderer: Ref<THREE.WebGLRenderer | null>;
  initRenderer: (container: HTMLDivElement) => void;
  handleResize: () => void;
}

export function useRenderer(): RendererInstance {
  const renderer = ref<THREE.WebGLRenderer | null>(null);

  const initRenderer = (container: HTMLDivElement) => {
    if (renderer.value) renderer.value.dispose();
    renderer.value = new THREE.WebGLRenderer({ antialias: true });
    renderer.value.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.value.domElement);
  };

  const handleResize = () => {
    if (renderer.value && renderer.value.domElement.parentElement) {
      const parent = renderer.value.domElement.parentElement;
      renderer.value.setSize(parent.clientWidth, parent.clientHeight);
    }
  };

  onMounted(() => window.addEventListener('resize', handleResize));
  onUnmounted(() => {
    window.removeEventListener('resize', handleResize);
    if (renderer.value) renderer.value.dispose();
  });

  return { renderer, initRenderer, handleResize };
}
