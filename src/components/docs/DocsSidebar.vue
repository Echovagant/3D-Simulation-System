<template>
  <div class="docs-sidebar bg-gray-50 dark:bg-gray-900 p-4 h-full overflow-y-auto">
    <div class="mb-6">
      <h2 class="text-lg font-semibold mb-3 text-gray-800 dark:text-gray-200">指南</h2>
      <ul class="space-y-2">
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'guide/overview'}"
            @click="$emit('change-section', 'guide/overview')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            系统总览
          </a>
        </li>
        <li>
          <a
            :class="{'text-primary font-medium': currentSection === 'guide/known-issues'}"
            @click="$emit('change-section', 'guide/known-issues')"
            class="block text-gray-600 dark:text-gray-400 hover:text-primary transition-colors"
          >
            已知问题与边界
          </a>
        </li>
      </ul>
    </div>

    <!--
      开发者文档（API 参考、操作示例）不在产品界面里：
      面向的是集成者而不是使用者，放在这儿只是让人误以为该读它们。
      它们随仓库走，见仓库的 docs/dev/。
    -->
    <div class="docs-sidebar-note">
      <p class="text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
        面向集成者的 API 参考与操作示例随仓库走，见仓库的
        <code>docs/dev/</code>。
      </p>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  currentSection: string
}>()

defineEmits<{
  (event: 'change-section', section: string): void
}>()
</script>

<style scoped>
.docs-sidebar {
  width: 260px;
  border-right: 1px solid #e2e8f0;
}

.docs-sidebar-note {
  padding-top: 1rem;
  border-top: 1px solid rgb(229 231 235);
}

:global(.dark) .docs-sidebar-note {
  border-top-color: rgb(55 65 81);
}

code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.75rem;
  background: rgb(243 244 246);
  padding: 0.05rem 0.25rem;
  border-radius: 3px;
}

:global(.dark) code {
  background: rgb(31 41 55);
}
</style>
