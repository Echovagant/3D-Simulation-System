// src/router/modules/sceneRoutes.ts
import { RouteRecordRaw } from 'vue-router';

const sceneRoutes: RouteRecordRaw[] = [
  // 场景编辑器相关子路由（如果有）
  {
    path: '/scene-editor/advanced',
    name: 'AdvancedSceneEditor',
    component: () => import('@/views/SceneEditor.vue'),
    meta: { title: '3D仿真系统 - 高级场景编辑' }
  }
];

export default sceneRoutes; // 关键：默认导出
