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

  it('五个导航入口与新壳的子路由都在', () => {
    const paths = flattenPaths(routes)
    for (const p of [
      '/',
      '/overview',
      '/scene-editor',
      '/simulation-lab',
      '/resource-center',
      '/resource-center/models',
      '/resource-center/templates',
      '/resource-center/materials',
      '/ai-lab',
      '/ai-lab/playground',
      '/ai-lab/workbench',
    ]) {
      expect(paths).toContain(p)
    }
  })

  it('两个新壳默认落到第一个页签', () => {
    const redirectOf = (path: string) => {
      const route = routes.find((r) => r.path === path)
      return route && 'redirect' in route ? route.redirect : undefined
    }
    expect(redirectOf('/ai-lab')).toBe('/ai-lab/playground')
    expect(redirectOf('/resource-center')).toBe('/resource-center/models')
  })

  it('旧地址保留重定向，不丢入口', () => {
    const redirectOf = (path: string) => {
      const route = routes.find((r) => r.path === path)
      return route && 'redirect' in route ? route.redirect : undefined
    }
    expect(redirectOf('/ai-playground')).toBe('/ai-lab/playground')
    expect(redirectOf('/agent-workbench')).toBe('/ai-lab/workbench')
    expect(redirectOf('/model-library')).toBe('/resource-center/models')
  })

  it('仿真实验室的深链接参数仍然透传给页面', () => {
    // /simulation-lab 曾经被定义过两次：index.ts 里的那份没有 props，
    // 模块里的那份才有。模块那份必须活下来。
    const lab = routes.find((r) => r.path === '/simulation-lab')
    expect(lab).toBeDefined()
    expect(lab?.props).toBeTypeOf('function')
  })

  it('每个顶层页面都有标题元信息', () => {
    for (const route of routes) {
      expect(route.meta?.title, `路由 ${route.path} 缺少 meta.title`).toBeTruthy()
    }
  })
})
