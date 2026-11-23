<template>
  <div class="resource-center">
    <!-- 模块页签：模型（零件）/ 场景模板（成品）/ 材质 -->
    <nav class="module-tabs" aria-label="资源中心页签">
      <RouterLink to="/resource-center/models" class="module-tab" active-class="module-tab--active">
        模型
      </RouterLink>
      <RouterLink to="/resource-center/templates" class="module-tab" active-class="module-tab--active">
        场景模板
      </RouterLink>
      <RouterLink to="/resource-center/materials" class="module-tab" active-class="module-tab--active">
        材质
      </RouterLink>
    </nav>

    <div class="resource-center-body">
      <RouterView />
    </div>
  </div>
</template>

<script lang="ts" setup name="ResourceCenter">
import { RouterLink, RouterView } from 'vue-router'
</script>

<style scoped>
/*
 * 普通页面壳：不锁高度，子页面各自滚动。
 * 模型页签直接复用完整的 ModelLibrary 页面，保留它自己的 PageHeader；
 * 壳只负责页签条与横向不溢出。
 */
.resource-center {
  display: flex;
  flex-direction: column;
  width: 100%;
  min-width: 0;
}

.module-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 20px;
  padding-bottom: 14px;
  border-bottom: 1px solid var(--border-subtle);
}

.module-tab {
  padding: 7px 16px;
  color: var(--text-2);
  font-size: var(--text-sm);
  text-decoration: none;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  transition: background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease;
}

.module-tab:hover {
  background-color: var(--bg-hover);
  border-color: var(--border-strong);
  color: var(--text-1);
}

.module-tab--active,
.module-tab--active:hover {
  background-color: var(--accent-soft);
  border-color: rgba(var(--accent-rgb), 0.4);
  color: var(--accent);
  font-weight: 600;
}

.resource-center-body {
  min-width: 0;
  max-width: 100%;
}
</style>
