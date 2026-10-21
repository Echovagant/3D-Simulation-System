import { describe, it, expect } from 'vitest'
import router from './index'
import type { RouteRecordRaw } from 'vue-router'

/** 把路由树压平成「完整路径」列表（含子路由） */
const flattenPaths = (routes: readonly RouteRecordRaw[], parent = ''): string[] =>
  routes.flatMap((route) => {
    const path = route.path.startsWith('/')
      ? route.path
      : `${parent.replace(/\/$/, '')}/${route.path}`
    return [path, ...(route.children ? flattenPaths(route.children, path) : [])]
  })

const flattenNames = (routes: readonly RouteRecordRaw[]): string[] =>
  routes.flatMap((route) => [
    ...(route.name ? [String(route.name)] : []),
    ...(route.children ? flattenNames(route.children) : []),
  ])

describe('路由表', () => {
  const routes = router.options.routes

  it('同一个 path 只出现一次', () => {
    const paths = flattenPaths(routes)
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const p of paths) {
      if (seen.has(p)) duplicates.add(p)
      seen.add(p)
    }
    // 重复定义会让先定义的那份变成"改了也不生效"的死代码
    expect([...duplicates]).toEqual([])
  })

  it('顶层页面的 name 唯一', () => {
    const names = flattenNames(routes)
    const seen = new Set<string>()
    const duplicates = new Set<string>()
    for (const n of names) {
      if (seen.has(n)) duplicates.add(n)
      seen.add(n)
    }
    expect([...duplicates]).toEqual([])
  })

  it('七个顶层页面都在', () => {
    const paths = flattenPaths(routes)
    for (const p of [
      '/',
      '/overview',
      '/scene-editor',
      '/simulation-lab',
      '/model-library',
      '/ai-playground',
      '/docs',
    ]) {
      expect(paths).toContain(p)
    }
  })

  it('仿真实验室的深链接参数仍然透传给页面', () => {
    // /simulation-lab 曾经被定义过两次：index.ts 里的那份没有 props，
    // 模块里的那份才有。模块那份必须活下来。
    const lab = routes.find((r) => r.path === '/simulation-lab')
    expect(lab).toBeDefined()
    expect(lab?.props).toBeTypeOf('function')
  })

  it('文档页的三个子路由都在', () => {
    const paths = flattenPaths(routes)
    for (const p of ['/docs/guide/:section?', '/docs/api/:section?', '/docs/examples/:section?']) {
      expect(paths).toContain(p)
    }
  })

  it('每个顶层页面都有标题元信息', () => {
    for (const route of routes) {
      expect(route.meta?.title, `路由 ${route.path} 缺少 meta.title`).toBeTruthy()
    }
  })
})
