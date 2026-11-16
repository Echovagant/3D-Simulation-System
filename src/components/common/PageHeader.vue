<template>
  <header class="page-header">
    <div class="page-header-text">
      <h1 class="page-title">{{ title }}</h1>
      <p v-if="lead" class="page-lead">{{ lead }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<script lang="ts" setup name="PageHeader">
/**
 * 统一页头：左对齐标题 + 一句话说明并排，右侧动作区。
 *
 * 全站六页的页头曾经三种写法各一份（居中大标题+emoji / 左对齐+lead /
 * 干脆没有）——这个组件把「工具型页面的第一屏」收敛成一种形态：
 * 紧凑、左对齐、把纵向空间还给内容。大标题控不控在令牌字号阶内。
 */
defineProps<{
  /** 页面标题 */
  title: string
  /** 一句话说明（可选，跟在标题右侧基线对齐） */
  lead?: string
}>()
</script>

<style scoped>
.page-header {
  display: flex;
  align-items: baseline;
  gap: 1.25rem;
  flex-wrap: wrap;
  margin-bottom: 1.25rem;
  width: 100%;
}

.page-header-text {
  display: flex;
  align-items: baseline;
  gap: 1rem;
  flex-wrap: wrap;
  min-width: 0;
}

.page-title {
  font-size: var(--text-2xl);
  font-weight: 700;
  color: var(--text-1);
  letter-spacing: 0.02em;
  line-height: 1.2;
}

.page-lead {
  font-size: var(--text-md);
  color: var(--text-2);
}

.page-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.625rem;
}
</style>
