// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest'
import { createApp, nextTick, type App } from 'vue'
import DocsContent from './DocsContent.vue'
import { docFiles, resolveDocPath } from '@/utils/docSections'

/**
 * 「空文档」用例不能依赖仓库里任何一份 .md 保持为空——文档后来被补齐内容后，
 * 这种断言就会失效（真实文件一旦有内容，组件走的是渲染分支而不是报错分支）。
 * 这里用一份合成映射把某个章节解析为空串，其余章节仍然走真实映射。
 */
const docMock = vi.hoisted(() => ({
  /** 合成章节：不在真实文档树里，只存在于 mock 的映射中 */
  emptySection: 'guide/empty',
  emptyKey: '/src/docs/guide/empty.md',
  /** 为 true 时，emptyKey 解析出空串（模拟一份 0 字节的文档） */
  emptyActive: false,
}))

vi.mock('@/utils/docSections', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/utils/docSections')>()
  return {
    ...actual,
    docFiles: new Proxy(actual.docFiles, {
      get(target, prop, receiver) {
        if (docMock.emptyActive && prop === docMock.emptyKey) return ''
        return Reflect.get(target, prop, receiver)
      },
      has(target, prop) {
        if (docMock.emptyActive && prop === docMock.emptyKey) return true
        return Reflect.has(target, prop)
      },
    }),
    // 真实章节一律交给真实的 resolveDocPath 判断，只有合成章节由 mock 直接给出 key
    resolveDocPath: (section: string) =>
      section === docMock.emptySection ? docMock.emptyKey : actual.resolveDocPath(section),
  }
})

const mountedApps: App[] = []

/** 挂载组件并等待异步的文档加载结束 */
const mountDocs = async (section: string) => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const app = createApp(DocsContent, { section })
  mountedApps.push(app)
  app.mount(host)
  // 文档加载是异步的，轮询若干轮直到 loading 结束
  for (let i = 0; i < 10; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0))
    await nextTick()
    if (!host.querySelector('.loading-spinner')) break
  }
  return host
}

afterEach(() => {
  // 复位 mock：其余用例必须看到真实的文档映射
  docMock.emptyActive = false
  while (mountedApps.length) {
    mountedApps.pop()?.unmount()
  }
  document.body.innerHTML = ''
})

describe('resolveDocPath', () => {
  it('接受白名单内的合法章节', () => {
    const key = resolveDocPath('guide/introduction')
    expect(key).not.toBeNull()
    expect(docFiles[key as string]).toContain('# 3D场景编辑与仿真系统')
  })

  it('拒绝未知章节', () => {
    expect(resolveDocPath('nonexistent')).toBeNull()
  })

  it('拒绝路径穿越片段', () => {
    expect(resolveDocPath('guide/../../etc/passwd')).toBeNull()
    expect(resolveDocPath('../../etc/passwd')).toBeNull()
  })

  it('拒绝空章节与非白名单目录', () => {
    expect(resolveDocPath('')).toBeNull()
    expect(resolveDocPath('/')).toBeNull()
    expect(resolveDocPath('secret/keys')).toBeNull()
  })
})

describe('DocsContent', () => {
  it('渲染有内容的章节', async () => {
    const host = await mountDocs('guide/introduction')
    expect(host.querySelector('.bg-red-50')).toBeNull()
    expect(host.querySelector('h1')).not.toBeNull()
    expect(host.textContent).toContain('欢迎使用3D场景编辑与仿真系统')
  })

  it('空章节提示尚未编写内容', async () => {
    docMock.emptyActive = true
    const host = await mountDocs(docMock.emptySection)
    expect(host.querySelector('.bg-red-50')).not.toBeNull()
    expect(host.textContent).toContain('该章节尚未编写内容')
  })

  it('未知章节提示未知文档章节', async () => {
    const host = await mountDocs('nonexistent')
    expect(host.textContent).toContain('未知文档章节')
  })

  it('路径穿越被拦截', async () => {
    const host = await mountDocs('guide/../../etc/passwd')
    expect(host.textContent).toContain('未知文档章节')
  })
})
