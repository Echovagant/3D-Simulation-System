// 创建一个路由器并暴露出去
// 第一步：引入createRouter
import { createRouter, createWebHistory } from 'vue-router'
// 导入路由模块
import sceneRoutes from './modules/sceneRoutes';
import simulationRoutes from './modules/simulationRoutes';
import aiRoutes from './modules/aiRoutes';

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
      // 根路径 = 首页：黑金总览（老版中央面板复现）。Welcome 打字机页与
      // 总览是两个重叠的门户，2026-11-19 合并——首页即总览，导航高亮只有一处。
      path: '/',
      name: 'Overview',
      component: () => import('@/views/Overview.vue'),
      meta: { title: '3D仿真系统' }
    },
    {
      // 老总览地址重定向到根路径，保持外部链接可达
      // （meta.title 满足「每条顶层路由都有标题」的测试约定，实际导航
      // 会被重定向到 / 的标题）
      path: '/overview',
      redirect: '/',
      meta: { title: '3D仿真系统' },
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
  ],
})

// 每次导航用 meta.title 更新浏览器标签页标题——标题跟着路由走，页面自己不用管
router.beforeEach((to, from, next) => {
  if (to.meta.title) {
    document.title = to.meta.title as string;
  }
  next();
});

export default router
