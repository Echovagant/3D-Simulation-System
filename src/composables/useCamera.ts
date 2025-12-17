import { ref , Ref } from 'vue';
import { PerspectiveCamera } from 'three';

// 定义useCamera的返回类型接口
export interface CameraInstance {
  activeCamera: Ref<PerspectiveCamera>;
  setCameraPosition: (x: number, y: number, z: number) => void;
}

export function useCamera(): CameraInstance {
  const activeCamera = ref<PerspectiveCamera>(
    new PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000)
  );

  const setCameraPosition = (x: number, y: number, z: number) => {
    activeCamera.value.position.set(x, y, z);
    activeCamera.value.lookAt(0, 0, 0);
  };

  return { activeCamera, setCameraPosition };
}
