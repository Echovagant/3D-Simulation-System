// 资源中心的路由：模型 / 场景模板 / 材质三个页签共用一个入口。
// 「零件（模型）」与「成品（场景模板）」分开摆，但同属一个入口。
import type { RouteRecordRaw } from 'vue-router'

const resourceRoutes: RouteRecordRaw[] = [
  {
    path: '/resource-center',
    name: 'ResourceCenter',
    component: () => import('@/views/ResourceCenter.vue'),
    redirect: '/resource-center/models',
    meta: {
      title: '3D仿真系统 - 资源中心',
      description: '模型、场景模板与材质的统一入口'
    },
    children: [
      {
        path: 'models',
        name: 'ResourceCenterModels',
        component: () => import('@/views/ModelLibrary.vue'),
        meta: { title: '3D仿真系统 - 资源中心 - 模型' }
      },
      {
        path: 'templates',
        name: 'ResourceCenterTemplates',
        component: () => import('@/views/SceneTemplateGallery.vue'),
        meta: { title: '3D仿真系统 - 资源中心 - 场景模板' }
      },
      {
        path: 'materials',
        name: 'ResourceCenterMaterials',
        component: () => import('@/components/resource/MaterialsPanel.vue'),
        meta: { title: '3D仿真系统 - 资源中心 - 材质' }
      }
    ]
  },
  // 旧「模型库」地址：模型库已变成资源中心的模型页签，旧链接继续可达
  {
    path: '/model-library',
    redirect: '/resource-center/models',
    meta: { title: '3D仿真系统 - 资源中心 - 模型' }
  }
]

export default resourceRoutes
