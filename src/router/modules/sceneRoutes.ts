// src/router/modules/sceneRoutes.ts
import type { RouteRecordRaw } from 'vue-router';

// 场景编辑器的扩展路由：/scene-editor/advanced 与主路由 /scene-editor
// 渲染的是同一个 SceneEditor.vue。
const sceneRoutes: RouteRecordRaw[] = [
  {
    path: '/scene-editor/advanced',
    name: 'AdvancedSceneEditor',
    component: () => import('@/views/SceneEditor.vue'),
    meta: { title: '3D仿真系统 - 高级场景编辑' }
  }
];

export default sceneRoutes; // 关键：默认导出
