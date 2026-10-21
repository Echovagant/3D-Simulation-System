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
]

export default simulationRoutes
