import { RouteRecordRaw } from 'vue-router';

const simulationRoutes: RouteRecordRaw[] = [
  {
    path: '/simulation-lab',
    name: 'SimulationLab',
    component: () => import('@/views/SimulationLab.vue'),
    meta: {
      title: '仿真实验室',
      requiresAuth: false,
      icon: '🔬'
    }
  },
  {
    path: '/simulation-lab/:presetId',
    name: 'SimulationLabWithPreset',
    component: () => import('@/views/SimulationLab.vue'),
    meta: {
      title: '仿真实验室 - 预设',
      requiresAuth: false,
      icon: '🔬'
    },
    props: (route) => ({
      presetId: route.params.presetId
    })
  }
];

export default simulationRoutes;
