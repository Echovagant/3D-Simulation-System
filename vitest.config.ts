import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

/**
 * 测试环境配置。
 *
 * 插件与 `vite.config.ts` 保持一致（wasm / topLevelAwait / vue），
 * 但**故意不带 `vite-plugin-vue-devtools`**——它会往页面里注入浏览器端调试客户端，
 * 在测试里没有意义且会拖慢/干扰用例。dev server 仍然由 `vite.config.ts` 负责。
 */
export default defineConfig({
  plugins: [wasm(), topLevelAwait(), vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      /**
       * 仅测试环境生效（`vite.config.ts` 不受影响，生产构建仍走真正的 `@dimforge/rapier3d`）。
       *
       * `@dimforge/rapier3d` 的 package.json 只有 `module`，没有 `main`/`exports`，
       * 浏览器图靠 `vite-plugin-wasm` 能跑，但 Vitest 的 SSR transform 解析不了入口，
       * 会以 `Failed to resolve entry for package` 让整个测试文件加载失败。
       * `@dimforge/rapier3d-compat` 是同一套引擎，WASM 已内联、无独立 .wasm 资源。
       */
      '@dimforge/rapier3d': '@dimforge/rapier3d-compat',
    },
  },
  // 依赖预构建的排除项与 `vite.config.ts` 相同
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'],
  },
  test: {
    /**
     * 统一用 jsdom，**不要**用 happy-dom：
     * DOMPurify 3.4.17 在 happy-dom 下会剥掉第一个元素的标签
     * （`sanitize('<h1>h1</h1><h2>h2</h2>')` → `h1<h2>h2</h2>`），
     * 那不是生产 bug（真实 Chrome 渲染正常），但会让标题渲染的断言变红。
     */
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['src/utils/**', 'src/data/**', 'src/stores/**', 'src/composables/**'],
    },
  },
})
