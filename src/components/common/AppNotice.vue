<template>
  <div class="app-notice" :class="`app-notice--${type}`" role="status">
    <i class="app-notice-icon" :class="iconByType" aria-hidden="true"></i>
    <div class="app-notice-body">
      <slot>{{ message }}</slot>
    </div>
    <button
      v-if="dismissible"
      type="button"
      class="app-notice-close"
      aria-label="关闭提示"
      @click="$emit('dismiss')"
    >
      <i class="fa-solid fa-times"></i>
    </button>
  </div>
</template>

<script lang="ts" setup name="AppNotice">
import { computed } from 'vue'

/**
 * 统一页内反馈条：success / danger / warning 三态，文档流内的行内条
 * （不是悬浮 toast——「出现位置」由页面自己决定，把条放进它该在的区块里）。
 *
 * 全站的反馈曾经四处各异：SimulationLab 的 toast（fixed 魔数 top:80px）、
 * ModelLibrary 的 download-notice（内联条）、原生 alert()/confirm() 旁路、
 * Toolbar 的临时状态文本。这个组件统一「颜色语义 + 图标 + 可关闭性」，
 * 位置与出现方式归页面管。
 *
 * 颜色走令牌：文字用状态色（--success/--danger/--accent-2），
 * 底是同色 12% 透明合成——深底上均满足 AA。
 */
const props = defineProps<{
  /** 反馈语义：success 成功 / danger 失败 / warning 警示 */
  type: 'success' | 'danger' | 'warning'
  /** 简单文本消息；复杂内容用默认插槽覆盖 */
  message?: string
  /** 是否显示关闭按钮（点击后由页面通过 v-if 控制），关闭发 dismiss 事件 */
  dismissible?: boolean
}>()

defineEmits<{ (e: 'dismiss'): void }>()

const iconByType = computed(() => {
  if (props.type === 'success') return 'fa-solid fa-circle-check'
  if (props.type === 'danger') return 'fa-solid fa-circle-exclamation'
  return 'fa-solid fa-triangle-exclamation'
})
</script>

<style scoped>
.app-notice {
  display: flex;
  align-items: flex-start;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-md);
  border: 1px solid var(--border-subtle);
  border-left-width: 3px;
  font-size: var(--text-sm);
  line-height: 1.5;
}

.app-notice-icon {
  margin-top: 0.125rem;
  flex-shrink: 0;
}

.app-notice-body {
  flex: 1;
  min-width: 0;
  color: var(--text-1);
  word-break: break-word;
}

/* 状态色只落在左边框与图标上——正文用主文字色，深底上更稳 */
.app-notice--success {
  border-left-color: var(--success);
  background: rgba(67, 192, 127, 0.1);
}
.app-notice--success .app-notice-icon {
  color: var(--success);
}

.app-notice--danger {
  border-left-color: var(--danger);
  background: rgba(240, 97, 106, 0.1);
}
.app-notice--danger .app-notice-icon {
  color: var(--danger);
}

.app-notice--warning {
  border-left-color: var(--accent-2);
  background: rgba(255, 161, 23, 0.1);
}
.app-notice--warning .app-notice-icon {
  color: var(--accent-2);
}

.app-notice-close {
  flex-shrink: 0;
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 0.125rem;
  font-size: var(--text-sm);
  color: var(--text-3);
  transition: color 0.2s ease;
}

.app-notice-close:hover {
  color: var(--text-1);
}

.app-notice-close:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
  border-radius: var(--radius-sm);
}
</style>
