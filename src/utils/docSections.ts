/**
 * 文档章节白名单与路径解析
 *
 * 文档以 `src/docs/**` 下的 markdown 文件形式存在。构建期通过
 * `import.meta.glob(..., { query: '?raw' })` 把它们展开成「文件路径 -> markdown 原文」的映射，
 * 运行时只允许从这个映射里取文档——URL 参数不再直接充当模块说明符，越权与路径穿越都不可能。
 *
 * 新增一个文档需要三处同步：
 * 1. 在 `src/docs/` 下新建 `.md` 文件
 * 2. 在 `DocsSidebar.vue` 加一个入口
 * 3. 在 `Docs.vue` 的 `titles` 表加一个标题
 */

/** 构建期展开的全部文档：key 是文件路径，value 是 markdown 原文 */
export const docFiles = import.meta.glob('/src/docs/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>

/**
 * 允许的章节前缀。
 *
 * 产品界面里只放**指南**（`guide/`）：面向使用者的内容。
 * 面向集成者的 API 参考与操作示例随仓库走（`docs/dev/`），不在产品界面里——
 * 放在这儿只会让人误以为那是给使用者看的。
 */
const ALLOWED_PREFIXES = ['guide/']

/**
 * 把 'guide/introduction' 映射到 glob 的 key
 *
 * 这是 URL 参数与模块说明符之间的安全边界：任何不在 glob key 集合里的
 * 章节（未知章节、`..` 穿越、其它目录）一律判为非法。
 *
 * @param section URL 传入的章节标识
 * @returns 命中的 glob key；章节非法时返回 null
 */
export const resolveDocPath = (section: string): string | null => {
  const normalized = section.replace(/^\/+|\/+$/g, '')
  if (!normalized) return null
  // 不允许 `..` 等路径穿越片段
  if (normalized.includes('..')) return null
  // 只允许 guide/ api/ examples/ 三类
  if (!ALLOWED_PREFIXES.some((prefix) => normalized.startsWith(prefix))) return null
  const key = `/src/docs/${normalized}.md`
  return key in docFiles ? key : null
}
