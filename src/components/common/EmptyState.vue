<template>
  <div class="empty-state">
    <div v-if="icon" class="empty-icon" aria-hidden="true"><i :class="icon"></i></div>
    <p class="empty-title">{{ title }}</p>
    <p v-if="description" class="empty-desc">{{ description }}</p>
    <div v-if="$slots.cta" class="empty-cta">
      <slot name="cta" />
    </div>
  </div>
</template>

<script lang="ts" setup name="EmptyState">
/**
 * 统一空态：图标 + 标题 + 说明 + 行动按钮（CTA 走插槽）。
 *
 * 全站的空态曾经三种规格（完整 icon+CTA / 纯文字 / v-if 直接隐藏）——
 * 这个组件把「空了之后用户该干什么」变成必须回答的问题：给 CTA 插槽，
 * 就放一个引导按钮；确实无事可做就只给标题与说明。
 * icon 传 Font Awesome 类名（如 fa-box-open），不传则不渲染图标行。
 */
defineProps<{
  /** 空态标题（一句话说清「这里为什么是空的」） */
  title: string
  /** 补充说明（可选） */
  description?: string
  /** Font Awesome 图标类名（可选，如 fa-box-open） */
  icon?: string
}>()
</script>

<style scoped>
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 0.375rem;
  padding: 2rem 1rem;
}

.empty-icon {
  font-size: 26px;
  color: var(--text-3);
  margin-bottom: 0.25rem;
}

.empty-title {
  font-size: var(--text-md);
  font-weight: 600;
  color: var(--text-1);
}

.empty-desc {
  font-size: var(--text-sm);
  color: var(--text-2);
  max-width: 34em;
  line-height: 1.6;
}

.empty-cta {
  margin-top: 0.75rem;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

/* CTA 插槽里的按钮聚焦时给可见焦点环（对齐 InfoTip 的可达性标杆） */
.empty-cta :deep(button:focus-visible),
.empty-cta :deep(a:focus-visible) {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
