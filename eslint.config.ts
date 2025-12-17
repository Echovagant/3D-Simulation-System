import { defineConfigWithVueTs, vueTsConfigs } from '@vue/eslint-config-typescript'
import pluginVue from 'eslint-plugin-vue'
import skipFormatting from '@vue/eslint-config-prettier/skip-formatting'

/**
 * ESLint配置文件（现代Flat Config格式）
 * 本配置已经包含了原.eslintrc.cjs中的所有必要配置
 */
export default defineConfigWithVueTs(
  // 定义需要检查的文件
  {
    name: 'app/files-to-lint',
    files: ['**/*.{ts,mts,tsx,vue}'],
    // 环境配置 - 对应原.eslintrc.cjs中的env
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        browser: true,
        es2021: true
      }
    }
  },

  // 文件忽略配置
  {
    ignores: [
      '**/dist/**',
      '**/dist-ssr/**',
      '**/coverage/**',
      '**/*.min.js',
      'src/assets/js/**/*'
    ]
  },

  // 基础配置 - 对应原.eslintrc.cjs中的extends
  pluginVue.configs['flat/essential'],
  vueTsConfigs.recommended,
  
  // 自定义规则覆盖
  {
    rules: {
      // 禁用“组件名必须多单词”的规则
      'vue/multi-word-component-names': 'off',
      // 禁用template中必须指定lang属性的规则
      'vue/block-lang': 'off',
      
      // TypeScript规则调整（可选，根据项目需求调整）
      '@typescript-eslint/no-explicit-any': 'warn', // 将any类型从error降级为warn
      '@typescript-eslint/no-unused-vars': 'warn'   // 将未使用变量从error降级为warn
    }
  },
  
  // 与Prettier集成
  skipFormatting,
)
