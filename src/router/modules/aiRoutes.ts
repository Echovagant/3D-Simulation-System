// AI 域的路由。演武场之外，Agent 工作台是 AI 直接操纵 Gym 环境的执行面。
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
  },
  {
    path: '/agent-workbench',
    name: 'AgentWorkbench',
    component: () => import('@/views/AgentWorkbench.vue'),
    meta: {
      title: '3D仿真系统 - Agent工作台',
      description: 'Gym 会话式环境的 Agent 执行面：会话、动作执行与审计流',
      requiresAuth: false
    }
  }
]

export default aiRoutes
