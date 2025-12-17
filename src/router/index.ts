// 创建一个路由器并暴露出去
// 第一步：引入createRouter
import { createRouter, createWebHistory } from 'vue-router'
// 导入路由模块
import sceneRoutes from './modules/sceneRoutes';
import simulationRoutes from './modules/simulationRoutes';
import aiRoutes from './modules/aiRoutes';
import docsRoutes from './modules/docsRoutes';

// 第二步：创建路由器实例
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/', // 根路径路由
      name: 'Welcome',
      component: () => import('@/views/Welcome.vue')
    },
    {
      path: '/overview',
      name: 'Overview',
      component: () => import('@/views/Overview.vue'),
      meta: { title: '3D仿真系统 - 总览', icon: '📊' }
    },
    {
      path: '/scene-editor',
      name: 'SceneEditor',
      component: () => import('@/views/SceneEditor.vue'),
      meta: { title: '3D仿真系统 - 场景编辑器', icon: '🛠️' }
    },
    {
      path: '/simulation-lab',
      name: 'SimulationLab',
      component: () => import('@/views/SimulationLab.vue'),
      meta: { title: '3D仿真系统 - 仿真实验室', icon: '🔬' }
    },
    {
      path: '/model-library',
      name: 'ModelLibrary',
      component: () => import('@/views/ModelLibrary.vue'),
      meta: { title: '3D仿真系统 - 模型库', icon: '📚' }
    },
    {
      path: '/ai-playground',
      name: 'AIPlayground',
      component: () => import('@/views/AIPlayground.vue'),
      meta: { title: '3D仿真系统 - AI演武场', icon: '🤖' }
    },
    {
      path: '/docs',
      name: 'Docs',
      component: () => import('@/views/Docs.vue'),
      meta: { title: '3D仿真系统 - 文档', icon: '📖' }
    },
    // 加入模块化路由
    ...sceneRoutes,
    ...simulationRoutes,
    ...aiRoutes,
    ...docsRoutes, // 添加文档路由
  ],
})

// 保持原有的标题设置方式
router.beforeEach((to, from, next) => {
  if (to.meta.title) {
    document.title = to.meta.title as string;
  }
  next();
});

export default router
