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
      <div class="ai-scene-dialog__examples">
        <button
          v-for="example in EXAMPLES"
          :key="example"
          type="button"
          class="ai-scene-dialog__chip"
          :disabled="generating"
          @click="prompt = example"
        >
          {{ example }}
        </button>
      </div>
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
      <div v-if="resultText" class="ai-scene-dialog__result">
        <p class="ai-scene-dialog__result-text">{{ resultText }}</p>
        <button
          v-if="generated"
          class="ai-scene-dialog__save"
          :disabled="saving || saved"
          @click="saveGeneratedScene"
        >
          <i class="fas" :class="saved ? 'fa-check' : 'fa-save'"></i>
          {{ saved ? '已保存' : saving ? '保存中…' : '保存为场景' }}
        </button>
      </div>
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
import { useSceneEditorStore } from '@/stores/sceneEditorStore'

const EXAMPLES = [
  '伽利略斜面：一个大斜坡，三个小球从不同高度滚下',
  '滑板场：两个斜坡相对，中间放几个障碍块',
  '障碍训练场：错位墙体和窄道，起点放三个球',
  '城市广场：高低不同的方块楼群，中间一个喷泉球',
] as const

const llmStore = useLlmStore()
const sceneStore = useSceneEditorStore()
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
const generated = ref(false)
const saving = ref(false)
const saved = ref(false)

const generate = async (): Promise<void> => {
  const description = prompt.value.trim()
  if (!description || generating.value) return
  generating.value = true
  errorMsg.value = ''
  resultText.value = ''
  generated.value = false
  saved.value = false
  try {
    const res = await llmStore.requestSceneGeneration(description)
    if (!res.ok) {
      errorMsg.value = res.error
      return
    }

    // 整批只占一条历史：用户撤销一次就回到生成前
    const snapshot = sceneStore.snapshotForHistory()
    let added = 0
    for (const obj of res.objects) {
      if (addPrimitive(obj)) added += 1
    }
    const skippedNote = res.skipped.length ? `，跳过 ${res.skipped.length} 个无效项` : ''
    if (added === 0) {
      errorMsg.value = '没有物体被添加（全部摆放失败）'
      return
    }
    sceneStore.pushHistory('AI 生成场景', snapshot)
    generated.value = true
    resultText.value = `已添加 ${added} 个物体${skippedNote}——它们会落到地面`
  } finally {
    generating.value = false
  }
}

/** 把刚生成的场景存进「我的场景」（同时会推一份到后端） */
const saveGeneratedScene = async (): Promise<void> => {
  if (saving.value || saved.value) return
  saving.value = true
  errorMsg.value = ''
  try {
    const name = `AI 场景 · ${prompt.value.trim().slice(0, 18) || '未命名'}`
    const sceneId = await sceneStore.saveScene(name)
    saved.value = true
    resultText.value = `已保存为「${name}」（ID: ${sceneId}），可在右侧「我的场景」打开`
  } catch (error) {
    console.warn('[AiSceneDialog] 保存生成场景失败', error)
    errorMsg.value = '保存失败：本地存储写入异常'
  } finally {
    saving.value = false
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

.ai-scene-dialog__examples {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0 18px 10px;
}

.ai-scene-dialog__chip {
  padding: 4px 9px;
  border: 1px solid var(--border-subtle);
  border-radius: 999px;
  background: transparent;
  color: var(--text-2);
  font-size: 11px;
  cursor: pointer;
}

.ai-scene-dialog__chip:hover:not(:disabled) {
  border-color: var(--border-strong);
  color: var(--text-1);
  background: var(--bg-hover);
}

.ai-scene-dialog__chip:disabled {
  opacity: 0.5;
  cursor: not-allowed;
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

.ai-scene-dialog__result-text {
  margin: 0;
  line-height: 1.5;
}

.ai-scene-dialog__save {
  margin-top: 8px;
  padding: 6px 12px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: transparent;
  color: var(--text-1);
  font-size: 0.78rem;
  cursor: pointer;
}

.ai-scene-dialog__save:hover:not(:disabled) {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.ai-scene-dialog__save:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
