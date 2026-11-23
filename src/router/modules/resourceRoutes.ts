// 资源中心的路由：模型 / 场景模板 / 材质三个页签共用一个入口。
// 「零件（模型）」与「成品（场景模板）」分开摆，但同属一个入口。
import { defineComponent, h } from 'vue'
import type { RouteRecordRaw } from 'vue-router'

/**
 * 资源中心 · 材质页签。
 *
 * 当前版本没有材质预设数据，也没有材质编辑接口，所以这里刻意不摆
 * 按钮、筛选器之类的假控件——只说明真实现状与后续计划。
 */
const ResourceCenterMaterials = defineComponent({
  name: 'ResourceCenterMaterials',
  setup() {
    const titleStyle = {
      margin: '0 0 12px',
      fontSize: 'var(--text-xl)',
      color: 'var(--text-1)'
    }
    const sectionStyle = {
      maxWidth: '720px',
      color: 'var(--text-2)',
      fontSize: 'var(--text-md)',
      lineHeight: '1.7'
    }
    const planTitleStyle = {
      margin: '20px 0 8px',
      fontSize: 'var(--text-md)',
      color: 'var(--text-1)'
    }
    return () =>
      h('section', { style: sectionStyle }, [
        h('h1', { style: titleStyle }, '材质'),
        h(
          'p',
          { style: { margin: '0' } },
          '材质库还没有实现：当前版本没有材质预设，也没有材质编辑面板。模型的外观来自模型文件自带的材质；场景里的基础体只有场景数据里的颜色字段，界面上没有可调参数。'
        ),
        h('h2', { style: planTitleStyle }, '规划中的能力'),
        h('ul', { style: { margin: '0', paddingLeft: '1.2em' } }, [
          h('li', 'P1：金属、木纹、混凝土等 PBR 预设，应用后可继续微调。'),
          h('li', 'P1：导入模型时读取材质通道，贴图缺失给出提示。'),
          h('li', 'P2：材质收藏、批量替换与场景级材质覆盖。')
        ]),
        h(
          'p',
          { style: { margin: '16px 0 0', color: 'var(--text-3)' } },
          '在这些能力上线之前，材质随模型文件自带，场景物体不提供独立的材质设置。'
        )
      ])
  }
})

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
        component: ResourceCenterMaterials,
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
