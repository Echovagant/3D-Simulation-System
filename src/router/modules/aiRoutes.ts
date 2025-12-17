import { RouteRecordRaw } from 'vue-router'

const aiRoutes: RouteRecordRaw[] = [
  {
    path: '/ai-playground',
    name: 'AIPlayground',
    component: () => import('@/views/AIPlayground.vue'),
    meta: {
      title: 'AI演武场',
      description: 'AI与3D环境交互实验平台',
      requiresAuth: false
    }
  }
]

export default aiRoutes
