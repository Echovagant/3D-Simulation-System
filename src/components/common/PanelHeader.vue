<template>
  <div class="panel-header">
    <div class="panel-header-text">
      <h3 class="panel-title">{{ title }}</h3>
      <span v-if="hint" class="panel-hint">{{ hint }}</span>
    </div>
    <div v-if="$slots.default" class="panel-header-meta">
      <slot />
    </div>
    <div v-if="$slots.actions" class="panel-header-actions">
      <slot name="actions" />
    </div>
  </div>
</template>

<script lang="ts" setup name="PanelHeader">
/**
 * 统一面板头：标题 + 可选副文字 + 默认插槽（InfoTip 等元信息）+ 右侧动作插槽。
 *
 * 「面板标题 + InfoTip」这个组合在全站自发出现了七处、挂法各不相同——
 * 这个组件把它收敛成一种：InfoTip 走默认插槽（面板头内嵌在标题右侧），
 * 按钮/开关走 actions 插槽。是否要上边框由外层面板自定。
 */
defineProps<{
  /** 面板标题 */
  title: string
  /** 标题右侧的副文字（可选） */
  hint?: string
}>()
</script>

<style scoped>
.panel-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  flex-wrap: wrap;
  margin-bottom: 0.75rem;
}

.panel-header-text {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  min-width: 0;
}

.panel-title {
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.3;
}

.panel-hint {
  font-size: var(--text-xs);
  color: var(--text-3);
}

.panel-header-meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.panel-header-actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 0.375rem;
}
</style>
