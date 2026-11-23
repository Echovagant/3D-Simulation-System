<template>
  <div class="cpd-backdrop" @click.self="close">
    <div class="cpd-dialog" role="dialog" aria-modal="true" aria-label="上下文预览">
      <header class="cpd-header">
        <div class="cpd-header-text">
          <h3 class="cpd-title">提议上下文预览</h3>
          <p class="cpd-subtitle">
            下一次「请求提议」真正会发送的内容；只读，不调用模型，也不发动作。
          </p>
        </div>
        <button type="button" class="cpd-close" aria-label="关闭" @click="close">×</button>
      </header>

      <div class="cpd-body">
        <p v-if="loading" class="cpd-hint">正在收集上下文…</p>
        <p v-else-if="error" class="cpd-error">{{ error }}</p>

        <template v-else-if="context">
          <dl class="cpd-meta">
            <div class="cpd-meta-row">
              <dt>服务商 / 模型</dt>
              <dd>{{ providerLabel }}</dd>
            </div>
            <div class="cpd-meta-row">
              <dt>力上限</dt>
              <dd>{{ forceLimitLabel }}</dd>
            </div>
          </dl>

          <section class="cpd-section">
            <h4 class="cpd-section-title">观测快照</h4>
            <pre class="cpd-pre">{{ snapshotJson }}</pre>
          </section>

          <section class="cpd-section">
            <h4 class="cpd-section-title">注入资料</h4>
            <p v-if="context.references.length === 0" class="cpd-hint">
              未检索到资料（给资料打 gym 标签后会自动检索注入）。
            </p>
            <ul v-else class="cpd-reference-list">
              <li v-for="reference in context.references" :key="reference.id" class="cpd-reference">
                <span class="cpd-reference-title">{{ reference.title }}</span>
                <span class="cpd-reference-id">#{{ reference.id }}</span>
                <p class="cpd-reference-content">{{ reference.content }}</p>
              </li>
            </ul>
          </section>

          <section class="cpd-section">
            <h4 class="cpd-section-title">System prompt</h4>
            <pre class="cpd-pre">{{ systemPrompt }}</pre>
          </section>

          <section class="cpd-section">
            <h4 class="cpd-section-title">User payload</h4>
            <pre class="cpd-pre">{{ userPayload }}</pre>
          </section>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * 提议上下文预览：展示下一次 LLM 提议真正会发送的内容。
 *
 * 上下文统一由 store 的 buildProposalContext 构造（与 autoDecide 共用），
 * 这里只做展示——不调用模型、不发送动作，避免「预览和实际请求不是一回事」。
 */
import { computed, onMounted, ref } from 'vue'
import { useGymWorkbenchStore, type GymProposalContext } from '@/stores/gymWorkbenchStore'
import { GYM_FORCE_MARGIN } from '@/services/llm/gymDecision'

const emit = defineEmits<{ (e: 'close'): void }>()

const store = useGymWorkbenchStore()

const loading = ref(true)
const error = ref('')
const context = ref<GymProposalContext | null>(null)

onMounted(async () => {
  try {
    const built = await store.buildProposalContext()
    if (built.ok) {
      context.value = built.context
    } else {
      error.value = built.error
    }
  } catch (caught) {
    error.value = caught instanceof Error && caught.message ? caught.message : '上下文收集失败'
  } finally {
    loading.value = false
  }
})

const close = (): void => {
  emit('close')
}

const prettyJson = (text: string): string => {
  try {
    return JSON.stringify(JSON.parse(text), null, 2)
  } catch {
    return text
  }
}

const snapshotJson = computed(() =>
  context.value ? JSON.stringify(context.value.snapshot, null, 2) : '',
)

const systemPrompt = computed(() => context.value?.messages[0]?.content ?? '')

/** user 消息本身就是 JSON 文本：解析后再缩进，长 payload 也能读 */
const userPayload = computed(() => prettyJson(context.value?.messages[1]?.content ?? ''))

const providerLabel = computed(() => {
  const current = context.value
  if (!current) return '—'
  const provider = current.provider.trim()
  const model = current.model.trim()
  if (provider && model) return `${provider} / ${model}`
  return model || provider || '未配置'
})

const forceLimitLabel = computed(() => {
  const limit = context.value?.forceLimit
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return '—'
  const safe = Math.round(limit * GYM_FORCE_MARGIN * 100) / 100
  return `${limit} N（安全线 ${safe} N）`
})
</script>

<style scoped>
.cpd-backdrop {
  position: fixed;
  inset: 0;
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background-color: rgba(0, 0, 0, 0.62);
}

.cpd-dialog {
  display: flex;
  flex-direction: column;
  width: min(760px, calc(100vw - 32px));
  max-height: 88vh;
  overflow: hidden;
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-panel);
}

.cpd-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  padding: 14px 18px 12px;
  border-bottom: 1px solid var(--border-subtle);
}

.cpd-header-text {
  min-width: 0;
}

.cpd-title {
  margin: 0;
  font-size: 16px;
  color: var(--text-1);
}

.cpd-subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  color: var(--text-3);
}

.cpd-close {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  background: transparent;
  color: var(--text-2);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-size: 16px;
  line-height: 1;
  cursor: pointer;
}

.cpd-close:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.cpd-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 14px 18px 20px;
}

.cpd-meta {
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.cpd-meta-row {
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-size: 12px;
}

.cpd-meta-row dt {
  color: var(--text-3);
}

.cpd-meta-row dd {
  margin: 0;
  color: var(--text-1);
  font-family: var(--font-mono);
}

.cpd-section {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cpd-section-title {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  color: var(--text-1);
}

.cpd-pre {
  margin: 0;
  padding: 8px 10px;
  background: var(--bg-inset);
  color: var(--text-1);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 11px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  max-height: 260px;
  overflow-y: auto;
}

.cpd-hint {
  margin: 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
}

.cpd-error {
  margin: 0;
  font-size: 12px;
  color: var(--danger);
}

.cpd-reference-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.cpd-reference {
  padding: 6px 9px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
}

.cpd-reference-title {
  font-size: 12px;
  color: var(--text-1);
}

.cpd-reference-id {
  margin-left: 6px;
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--text-3);
}

.cpd-reference-content {
  margin: 2px 0 0;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-3);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
