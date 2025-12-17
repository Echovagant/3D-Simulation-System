// src/composables/useControls.ts
import { ref, Ref, onMounted, onUnmounted } from 'vue';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { useThree } from './useThree';

export interface ControlsInstance {
  controls: Ref<OrbitControls | null>;
  initControls: () => void;
  updateControls: () => void;
}

export function useControls(): ControlsInstance {
  const { camera, renderer } = useThree();
  const controls = ref<OrbitControls | null>(null);

  const initControls = () => {
    if (camera.value && renderer.value) {
      controls.value = new OrbitControls(camera.value, renderer.value.domElement);
      controls.value.enableDamping = true;
      controls.value.dampingFactor = 0.05;
    }
  };

  const updateControls = () => {
    if (controls.value) {
      controls.value.update();
    }
  };

  onMounted(() => {
    initControls();
  });

  onUnmounted(() => {
    if (controls.value) {
      controls.value.dispose();
      controls.value = null;
    }
  });

  return { controls, initControls, updateControls };
}
