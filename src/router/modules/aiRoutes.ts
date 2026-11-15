// AI 演武场的路由。目前只有一个页面，独立成模块是给后续 AI 页面留位置。
import type { RouteRecordRaw } from 'vue-router'

const aiRoutes: RouteRecordRaw[] = [
  {
    path: '/ai-playground',
    name: 'AIPlayground',
    component: () => import('@/views/AIPlayground.vue'),
    meta: {
      title: '3D仿真系统 - AI演武场',
      description: 'AI与3D环境交互实验平台',
      requiresAuth: false
    }
  }
]

export default aiRoutes
