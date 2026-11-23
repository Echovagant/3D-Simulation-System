<template>
  <div class="scene-check-backdrop" @click.self="$emit('close')">
    <div class="scene-check-dialog" role="dialog" aria-modal="true" aria-label="检查场景">
      <div class="scene-check-dialog__header">
        <h3 class="scene-check-dialog__title">检查场景</h3>
        <button
          class="scene-check-dialog__close"
          type="button"
          title="关闭"
          aria-label="关闭"
          @click="$emit('close')"
        >
          <i class="fas fa-times"></i>
        </button>
      </div>

      <p class="scene-check-dialog__hint">
        检查越界、缩放、穿透地面、静态物体悬空与重叠；结果不会阻止保存。
      </p>

      <div v-if="issues.length === 0" class="scene-check-dialog__empty">
        <i class="fas fa-circle-check"></i>
        没有发现问题
      </div>

      <div v-else class="scene-check-dialog__body">
        <section v-if="errors.length > 0" class="scene-check-dialog__section">
          <h4 class="scene-check-dialog__section-title">
            错误 · {{ errors.length }}
          </h4>
          <ul class="scene-check-dialog__list">
            <li v-for="(issue, index) in errors" :key="`error-${index}-${issue.uuid}`">
              <button
                type="button"
                class="scene-check-dialog__item scene-check-dialog__item--error"
                @click="focusIssue(issue)"
              >
                <i class="fas fa-circle-exclamation"></i>
                <span class="scene-check-dialog__name">{{ issue.name }}</span>
                <span class="scene-check-dialog__message">{{ issue.message }}</span>
              </button>
            </li>
          </ul>
        </section>

        <section v-if="warnings.length > 0" class="scene-check-dialog__section">
          <h4 class="scene-check-dialog__section-title">
            提示 · {{ warnings.length }}
          </h4>
          <ul class="scene-check-dialog__list">
            <li v-for="(issue, index) in warnings" :key="`warning-${index}-${issue.uuid}`">
              <button
                type="button"
                class="scene-check-dialog__item scene-check-dialog__item--warning"
                @click="focusIssue(issue)"
              >
                <i class="fas fa-triangle-exclamation"></i>
                <span class="scene-check-dialog__name">{{ issue.name }}</span>
                <span class="scene-check-dialog__message">{{ issue.message }}</span>
              </button>
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useSceneEditorStore } from '@/stores/sceneEditorStore'
import { validateScene } from '@/utils/sceneValidation'

const emit = defineEmits(['close'])

const store = useSceneEditorStore()

/**
 * 检查的是**当前真实变换**：走 buildSceneDocument 拿到的位置来自 mesh
 * （跑过仿真的物体已经在 mesh 上），而不是用户最后在面板里输入的旧值。
 */
const issues = computed(() => validateScene(store.buildSceneDocument('场景检查')))
const errors = computed(() => issues.value.filter((issue) => issue.level === 'error'))
const warnings = computed(() => issues.value.filter((issue) => issue.level === 'warning'))

/** 点一条问题 = 选中对应物体，并关掉弹窗把视野让出来 */
const focusIssue = (issue) => {
  store.setSelectedObject(issue.uuid)
  emit('close')
}
</script>

<style scoped>
/* 遮罩与弹窗骨架对齐 ImportModelDialog / AiSceneDialog 的约定 */
.scene-check-backdrop {
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
  box-sizing: border-box;
}

.scene-check-dialog {
  display: flex;
  flex-direction: column;
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 560px;
  max-height: 80vh;
  box-shadow: var(--shadow-panel);
}

.scene-check-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 0;
}

.scene-check-dialog__title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-1);
}

.scene-check-dialog__close {
  background: none;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
}

.scene-check-dialog__close:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.scene-check-dialog__hint {
  margin: 6px 18px 10px;
  font-size: 0.8rem;
  color: var(--text-3);
  line-height: 1.5;
}

.scene-check-dialog__empty {
  margin: 4px 18px 18px;
  padding: 18px;
  border: 1px dashed var(--border-subtle);
  border-radius: 8px;
  text-align: center;
  color: var(--text-2);
  font-size: 0.85rem;
}

.scene-check-dialog__empty i {
  margin-right: 6px;
  color: var(--success, #3fb950);
}

.scene-check-dialog__body {
  overflow-y: auto;
  padding: 0 18px 18px;
}

.scene-check-dialog__section + .scene-check-dialog__section {
  margin-top: 12px;
}

.scene-check-dialog__section-title {
  margin: 0 0 6px;
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--text-3);
}

.scene-check-dialog__list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.scene-check-dialog__item {
  width: 100%;
  display: grid;
  grid-template-columns: 16px auto 1fr;
  align-items: baseline;
  gap: 8px;
  padding: 8px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: 6px;
  background: var(--bg-inset);
  color: var(--text-1);
  font-size: 0.8rem;
  text-align: left;
  cursor: pointer;
}

.scene-check-dialog__item:hover {
  border-color: var(--border-strong);
  background: var(--bg-hover);
}

.scene-check-dialog__item--error i {
  color: var(--danger, #f0616a);
}

.scene-check-dialog__item--warning i {
  color: var(--warning, #d29922);
}

.scene-check-dialog__name {
  font-weight: 600;
  white-space: nowrap;
}

.scene-check-dialog__message {
  color: var(--text-2);
  line-height: 1.5;
}
</style>
