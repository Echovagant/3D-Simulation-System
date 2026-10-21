// 创建一个路由器并暴露出去
// 第一步：引入createRouter
import { createRouter, createWebHistory } from 'vue-router'
// 导入路由模块
import sceneRoutes from './modules/sceneRoutes';
import simulationRoutes from './modules/simulationRoutes';
import aiRoutes from './modules/aiRoutes';
import docsRoutes from './modules/docsRoutes';

// 第二步：创建路由器实例。
//
// 路由归属规则（避免重复定义）：
//   - 顶层页面路由只在这里写一份；
//   - 带子路由、带深链接 props、或有独立元信息的路由，放到 ./modules/ 下；
//   - 同一个 path 只能出现一次——后定义的会覆盖先定义的，
//     那会让先定义的那份变成改了也不生效的死代码。
// 这里只声明「本文件独有」的四条，其余由模块提供。
const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/', // 根路径路由
      name: 'Welcome',
      component: () => import('@/views/Welcome.vue'),
      meta: { title: '3D仿真系统 - 首页' }
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
      path: '/model-library',
      name: 'ModelLibrary',
      component: () => import('@/views/ModelLibrary.vue'),
      meta: { title: '3D仿真系统 - 模型库', icon: '📚' }
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
