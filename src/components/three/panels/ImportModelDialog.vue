<template>
  <div class="import-dialog-backdrop" @click.self="$emit('close')">
    <div class="import-dialog" role="dialog" aria-modal="true" aria-label="导入模型">
      <div class="import-dialog__header">
        <h3 class="import-dialog__title">导入模型</h3>
        <button class="import-dialog__close" @click="$emit('close')" title="关闭" aria-label="关闭">
          <i class="fas fa-times"></i>
        </button>
      </div>
      <p class="import-dialog__hint">点击模型即导入当前场景（连同刚体与碰撞体一起建好）</p>
      <div class="import-dialog__grid">
        <button
          v-for="model in modelStore.models"
          :key="model.id"
          class="import-card"
          :title="`导入 ${model.name}`"
          @click="select(model)"
        >
          <img
            :src="model.thumbnailUrl"
            :alt="model.name"
            class="import-card__thumb"
            loading="lazy"
          >
          <span class="import-card__name">{{ model.name }}</span>
          <span class="import-card__meta">
            {{ formatSize(model.size) }}<template v-if="model.sessionOnly"> · 仅本会话</template>
          </span>
        </button>
      </div>
      <p v-if="modelStore.models.length === 0" class="import-dialog__empty">模型库为空</p>
    </div>
  </div>
</template>

<script lang="ts" setup>
/**
 * 编辑器内的模型选择弹窗（消灭「导入模型跳页」断链）。
 *
 * 选择只做一件事：把模型写进 modelStore.selectedModelId。
 * 导入由 Toolbar 的既有 watch 消费——与「模型库页跳回编辑器」是同一条
 * 导入链路（走 useSceneEditor.importModel，刚体+碰撞体一起建好），这里
 * 不重复任何导入逻辑。
 */
import { useModelStore } from '@/stores/modelStore'

const emit = defineEmits<{ (e: 'close'): void }>()

const modelStore = useModelStore()

const select = (model: { id: string }): void => {
  modelStore.selectedModelId = model.id
  emit('close')
}

const formatSize = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '—'
  const kb = bytes / 1024
  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`
}
</script>

<style scoped>
/* 遮罩与弹窗骨架对齐模型库页的 modal 约定：元素自带底色，允许黑色 rgba */
.import-dialog-backdrop {
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

.import-dialog {
  background-color: var(--bg-panel-raised);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
  width: 100%;
  max-width: 720px;
  max-height: 85vh;
  overflow-y: auto;
  box-shadow: var(--shadow-panel);
}

.import-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 14px 18px 0;
}

.import-dialog__title {
  margin: 0;
  font-size: 1rem;
  color: var(--text-1);
}

.import-dialog__close {
  background: none;
  border: none;
  color: var(--text-2);
  cursor: pointer;
  padding: 6px;
  border-radius: 6px;
}

.import-dialog__close:hover {
  color: var(--text-1);
  background: var(--bg-hover);
}

.import-dialog__hint {
  margin: 6px 18px 12px;
  font-size: 0.8rem;
  color: var(--text-3);
}

.import-dialog__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
  gap: 12px;
  padding: 0 18px 18px;
}

.import-card {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 6px;
  padding: 8px;
  background: var(--bg-inset);
  border: 1px solid var(--border-subtle);
  border-radius: 10px;
  cursor: pointer;
  color: var(--text-1);
  text-align: left;
  transition: border-color 0.15s, background 0.15s;
}

.import-card:hover {
  border-color: var(--accent);
  background: var(--bg-hover);
}

.import-card__thumb {
  width: 100%;
  aspect-ratio: 4 / 3;
  object-fit: cover;
  border-radius: 6px;
  background: var(--bg-canvas);
}

.import-card__name {
  font-size: 0.85rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.import-card__meta {
  font-size: 0.7rem;
  color: var(--text-3);
}

.import-dialog__empty {
  padding: 24px;
  text-align: center;
  color: var(--text-3);
}
</style>
