import { RouteRecordRaw } from 'vue-router';

const docsRoutes: RouteRecordRaw[] = [
  {
    path: '/docs',
    name: 'Docs',
    component: () => import('@/views/Docs.vue'),
    meta: {
      title: '系统使用指南',
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
