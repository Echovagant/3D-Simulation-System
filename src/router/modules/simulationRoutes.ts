// 仿真实验室的路由：同一个页面提供两种深链接入口——query 参数（/simulation-lab?preset=…）
// 与路径参数（/simulation-lab/:presetId），都通过 props 传给页面。
import type { RouteRecordRaw } from 'vue-router'

const simulationRoutes: RouteRecordRaw[] = [
  {
    path: '/simulation-lab',
    name: 'SimulationLab',
    component: () => import('@/views/SimulationLab.vue'),
    meta: {
      title: '3D仿真系统 - 仿真实验室',
      requiresAuth: false,
      icon: '🔬',
    },
    // 深链接解析：
    // - ?preset=<id>  直接打开某个预设
    // - ?scene=<id>   直接打开某个已保存的场景
    props: (route) => ({
      presetId: typeof route.query.preset === 'string' ? route.query.preset : undefined,
      sceneId: typeof route.query.scene === 'string' ? route.query.scene : undefined,
    }),
  },
  {
    path: '/simulation-lab/:presetId',
    name: 'SimulationLabWithPreset',
    component: () => import('@/views/SimulationLab.vue'),
    meta: {
      title: '3D仿真系统 - 仿真实验室 - 预设',
      requiresAuth: false,
      icon: '🔬',
    },
    props: (route) => ({
      presetId: route.params.presetId,
      sceneId: typeof route.query.scene === 'string' ? route.query.scene : undefined,
    }),
  },
  {
    // 只读分享回放（M5）：链接即演示。场景从后端拉（跨设备可达），
    // 物理逐帧确定性——重放结果与首跑逐位一致。
    path: '/simulation-lab/share/:sceneId',
    name: 'SimulationLabShare',
    component: () => import('@/views/SimulationLab.vue'),
    meta: {
      title: '3D仿真系统 - 分享回放',
      requiresAuth: false,
      icon: '🔗',
    },
    props: (route) => ({
      sceneId: route.params.sceneId as string,
    }),
  },
]

export default simulationRoutes
