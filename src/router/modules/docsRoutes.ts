// 系统文档的路由。
// 三个子路由渲染的是同一个 Docs.vue，:section? 可选参数决定打开哪个板块——
// 侧边栏的「指南 / API / 示例」三个入口共用一个页面实例，只是深链接地址不同。
import type { RouteRecordRaw } from 'vue-router';

const docsRoutes: RouteRecordRaw[] = [
  {
    path: '/docs',
    name: 'Docs',
    component: () => import('@/views/Docs.vue'),
    meta: {
      title: '3D仿真系统 - 系统文档',
      description: '3D场景编辑与仿真系统的使用文档'
    },
    children: [
      {
        path: 'guide/:section?',
        name: 'DocsGuide',
        component: () => import('@/views/Docs.vue'),
        meta: {
          title: '使用指南',
          description: '系统功能使用指南'
        }
      },
      {
        path: 'api/:section?',
        name: 'DocsApi',
        component: () => import('@/views/Docs.vue'),
        meta: {
          title: 'API参考',
          description: '系统API接口参考文档'
        }
      },
      {
        path: 'examples/:section?',
        name: 'DocsExamples',
        component: () => import('@/views/Docs.vue'),
        meta: {
          title: '示例教程',
          description: '系统功能示例教程'
        }
      }
    ]
  }
];

export default docsRoutes;
