// AI 域的路由：「AI 实验室」把两种工作收进一个入口——
// 实时演练（浏览器前端实时仿真）与评测审计（后端 Gym 会话 + 审计流）。
// 底层仍是两套独立实现，这里只做导航与页签的合并。
import type { RouteRecordRaw } from 'vue-router'

const aiRoutes: RouteRecordRaw[] = [
  {
    path: '/ai-lab',
    name: 'AiLab',
    component: () => import('@/views/AiLab.vue'),
    redirect: '/ai-lab/playground',
    meta: {
      title: '3D仿真系统 - AI实验室',
      description: '实时演练与评测审计的统一入口',
      requiresAuth: false
    },
    children: [
      {
        path: 'playground',
        name: 'AiLabPlayground',
        component: () => import('@/views/AIPlayground.vue'),
        meta: {
          title: '3D仿真系统 - AI实验室 - 实时演练',
          description: 'AI与3D环境交互实验平台',
          requiresAuth: false
        }
      },
      {
        path: 'workbench',
        name: 'AiLabWorkbench',
        component: () => import('@/views/AgentWorkbench.vue'),
        meta: {
          title: '3D仿真系统 - AI实验室 - 评测审计',
          description: 'Gym 会话式环境的 Agent 执行面：会话、动作执行与审计流',
          requiresAuth: false
        }
      }
    ]
  },
  // 旧地址保留可达（外部链接 / 书签），跳到新入口里对应的页签
  {
    path: '/ai-playground',
    redirect: '/ai-lab/playground',
    meta: { title: '3D仿真系统 - AI实验室 - 实时演练' }
  },
  {
    path: '/agent-workbench',
    redirect: '/ai-lab/workbench',
    meta: { title: '3D仿真系统 - AI实验室 - 评测审计' }
  }
]

export default aiRoutes
