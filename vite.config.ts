import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueDevTools from 'vite-plugin-vue-devtools';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

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
    exclude: ['@dimforge/rapier3d'] // 不让 Vite 预构建 Rapier
  }
});
