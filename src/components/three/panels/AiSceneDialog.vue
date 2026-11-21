<template>
  <div class="ai-scene-backdrop" @click.self="$emit('close')">
    <div class="ai-scene-dialog" role="dialog" aria-modal="true" aria-label="AI 生成场景">
      <div class="ai-scene-dialog__header">
        <h3 class="ai-scene-dialog__title">AI 生成场景</h3>
        <button class="ai-scene-dialog__close" @click="$emit('close')" title="关闭" aria-label="关闭">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <p class="ai-scene-dialog__hint">
        用一句话描述想要的场景（最多 10 个物体，基础体组合，出生后落到地面）
      </p>
      <textarea
        v-model="prompt"
        class="ai-scene-dialog__input"
        rows="3"
        :disabled="generating"
        placeholder="例如：一个滑板场，两个斜坡相对，中间放几个障碍块"
      ></textarea>
      <button class="ai-scene-dialog__go" :disabled="generating || !prompt.trim()" @click="generate">
        <i class="fas fa-wand-magic-sparkles"></i>
        {{ generating ? '生成中…' : '生成场景' }}
      </button>
      <div v-if="errorMsg" class="ai-scene-dialog__error">
        <i class="fas fa-circle-exclamation"></i>
        {{ errorMsg }}
      </div>
      <div v-if="resultText" class="ai-scene-dialog__result">{{ resultText }}</div>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * AI 生成场景弹窗：一句话描述 → LLM 输出场景文档 JSON →
 * 校验收敛（parseGeneratedScene）→ 逐个 addPrimitive 摆进场景。
 *
 * LLM 调用走 llmStore.requestSceneGeneration（出网口收口在 llmStore，
 * 未配置 Key/冷却/上限/降级都有可读错误，这里不重复处理网络逻辑）。
 */
import { inject, ref } from 'vue'
import { useLlmStore } from '@/stores/llmStore'

const emit = defineEmits<{ (e: 'close'): void }>()

const llmStore = useLlmStore()
const addPrimitive = inject<
  (spec: {
    type: 'cube' | 'sphere' | 'ramp'
    name?: string
    position: { x: number; y: number; z: number }
    rotation?: { x: number; y: number; z: number }
    scale?: { x: number; y: number; z: number }
  }) => boolean
>('addPrimitive', () => false)

const prompt = ref('')
const generating = ref(false)
const errorMsg = ref('')
const resultText = ref('')

const generate = async (): Promise<void> => {
  const description = prompt.value.trim()
  if (!description || generating.value) return
  generating.value = true
  errorMsg.value = ''
  resultText.value = ''
  try {
    const res = await llmStore.requestSceneGeneration(description)
    if (!res.ok) {
      errorMsg.value = res.error
      return
    }
    let added = 0
    for (const obj of res.objects) {
      if (addPrimitive(obj)) added += 1
    }
    const skippedNote = res.skipped.length ? `，跳过 ${res.skipped.length} 个无效项` : ''
    if (added === 0) {
      errorMsg.value = '没有物体被添加（全部摆放失败）'
      return
    }
    resultText.value = `已添加 ${added} 个物体${skippedNote}——它们会落到地面`
  } finally {
    generating.value = false
  }
}
</script>

<style scoped>
/* 遮罩与弹窗骨架对齐 ImportModelDialog 的约定：元素自带底色，允许黑色 rgba */
.ai-scene-backdrop {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 1000;
  padding: 20px;
}

.ai-scene-dialog {
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 520px;
  box-shadow: var(--shadow-panel);
}

.ai-scene-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 0;
}

.ai-scene-dialog__title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-1);
}

.ai-scene-dialog__close {
  background: none;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
}

.ai-scene-dialog__close:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.ai-scene-dialog__hint {
  margin: 6px 18px 10px;
  font-size: 0.8rem;
  color: var(--text-3);
}

.ai-scene-dialog__input {
  width: calc(100% - 36px);
  margin: 0 18px;
  padding: 8px 10px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: 8px;
  color: var(--text-1);
  font: inherit;
  resize: vertical;
}

.ai-scene-dialog__go {
  display: block;
  width: calc(100% - 36px);
  margin: 10px 18px 0;
  padding: 9px 0;
  background: var(--accent);
  border: none;
  border-radius: 8px;
  color: var(--accent-on);
  font-weight: 600;
  cursor: pointer;
}

.ai-scene-dialog__go:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.ai-scene-dialog__error {
  margin: 10px 18px 0;
  padding: 8px 10px;
  background: rgba(220, 38, 38, 0.15);
  border-radius: 8px;
  color: var(--danger, #f0616a);
  font-size: 0.8rem;
}

.ai-scene-dialog__result {
  margin: 10px 18px 16px;
  padding: 8px 10px;
  background: rgba(46, 204, 113, 0.12);
  border-radius: 8px;
  color: var(--text-1);
  font-size: 0.8rem;
}
</style>
