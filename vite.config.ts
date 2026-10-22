import { fileURLToPath, URL } from 'node:url'
import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import vueDevTools from 'vite-plugin-vue-devtools'
import wasm from 'vite-plugin-wasm'
import topLevelAwait from 'vite-plugin-top-level-await'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    wasm(), // 处理 Wasm
    topLevelAwait(), // 支持顶级 await
    vue(), // Vue 插件
    vueDevTools(), // Vue 开发工具插件
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  // 解决开发环境下的 Wasm 加载问题
  optimizeDeps: {
    exclude: ['@dimforge/rapier3d'], // 不让 Vite 预构建 Rapier
  },
  server: {
    proxy: {
      /**
       * 开发期把 /api 转到后端。
       *
       * 这样浏览器只跟自己的源说话，`connect-src 'self'` 就够了——
       * 不必为了接后端去放宽 CSP 的 connect-src。
       * 生产部署由反向代理负责同一件事。
       */
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET ?? 'http://127.0.0.1:8000',
        changeOrigin: true,
        /**
         * 后端连不上时，如实回 503「上游不可达」，别用默认的 500。
         *
         * 500 说的是「我这台服务器出错了」，前端会当成真错误去报警；
         * 503 说的是「你要的那个东西现在没有」——这才是实情，
         * 前端据此安静降级即可。生产环境的反向代理也是这么回的（502/504）。
         */
        configure: (proxy) => {
          proxy.on('error', (_err, _req, res) => {
            if (res.writeHead && !res.headersSent) {
              res.writeHead(503, { 'Content-Type': 'application/json' })
              res.end(
                JSON.stringify({
                  error: { code: 'backend_unavailable', message: '后端不可达', detail: null },
                }),
              )
            }
          })
        },
      },
    },
  },
})
