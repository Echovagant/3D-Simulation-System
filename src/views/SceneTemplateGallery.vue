<template>
  <div class="scene-template-gallery">
    <PageHeader
      title="场景模板"
      lead="搭好的成品场景，打开后可在场景编辑器里继续修改；模型是零件，模板是成品。"
    />

    <ul class="template-grid">
      <li v-for="scene in showcaseScenes" :key="scene.id" class="template-card">
        <div class="template-head">
          <h2 class="template-name">{{ scene.name }}</h2>
          <span
            class="template-badge"
            :class="scene.origin === 'ai' ? 'template-badge--ai' : 'template-badge--handcrafted'"
          >
            {{ scene.origin === 'ai' ? 'AI 生成' : '手工编排' }}
          </span>
        </div>
        <p class="template-meta">
          {{ scene.audience }} · {{ scene.document.objects.length }} 个物体 · 场地
          {{ scene.document.worldSize ?? 40 }} 米
        </p>
        <p class="template-desc">{{ scene.description }}</p>
        <RouterLink
          class="template-open"
          :to="{ path: '/scene-editor', query: { template: scene.id } }"
        >
          在编辑器中打开
        </RouterLink>
      </li>
    </ul>
  </div>
</template>

<script lang="ts" setup name="SceneTemplateGallery">
import { RouterLink } from 'vue-router'
import PageHeader from '@/components/common/PageHeader.vue'
import { SHOWCASE_SCENES } from '@/data/showcaseScenes'

// 模板数据与精选场景同源，这里只读不改
const showcaseScenes = SHOWCASE_SCENES
</script>

<style scoped>
.scene-template-gallery {
  width: 100%;
  min-width: 0;
}

.template-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(var(--grid-min), 1fr));
  gap: var(--grid-gap);
  margin: 0;
  padding: 0;
  list-style: none;
}

.template-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  padding: 18px;
  background-color: var(--bg-panel);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-lg);
}

.template-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 10px;
}

.template-name {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: 600;
  color: var(--text-1);
  line-height: 1.35;
}

.template-badge {
  flex: 0 0 auto;
  padding: 2px 8px;
  font-size: var(--text-xs);
  line-height: 1.6;
  white-space: nowrap;
  border: 1px solid var(--border-subtle);
  border-radius: 9999px;
  color: var(--text-3);
}

.template-badge--ai {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
}

.template-meta {
  margin: 0;
  font-size: var(--text-xs);
  color: var(--text-3);
  font-family: var(--font-mono);
}

.template-desc {
  margin: 0;
  font-size: var(--text-sm);
  line-height: 1.7;
  color: var(--text-2);
}

.template-open {
  align-self: flex-start;
  margin-top: auto;
  padding: 7px 14px;
  font-size: var(--text-sm);
  text-decoration: none;
  color: var(--accent);
  border: 1px solid rgba(var(--accent-rgb), 0.4);
  border-radius: var(--radius-md);
  transition: background-color 0.2s ease, border-color 0.2s ease;
}

.template-open:hover {
  background-color: var(--accent-soft);
  border-color: var(--accent);
}

.template-open:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
</style>
