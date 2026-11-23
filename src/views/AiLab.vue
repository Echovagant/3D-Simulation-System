<template>
  <div class="ai-lab">
    <!-- 模块页签：实时演练（前端实时仿真）/ 评测审计（后端 Gym 会话） -->
    <nav class="module-tabs" aria-label="AI实验室页签">
      <RouterLink to="/ai-lab/playground" class="module-tab" active-class="module-tab--active">
        实时演练
      </RouterLink>
      <RouterLink to="/ai-lab/workbench" class="module-tab" active-class="module-tab--active">
        评测审计
      </RouterLink>
    </nav>

    <div class="ai-lab-body">
      <RouterView />
    </div>
  </div>
</template>

<script lang="ts" setup name="AiLab">
import { RouterLink, RouterView } from 'vue-router'
</script>

<style scoped>
/*
 * full-bleed 壳：页签条 + 子页面。
 * 两个子页面原本按 100vh 自己撑满整屏；加页签条后必须把高度收回到
 * 「页签条以下」，否则整页会出现两条滚动条。
 */
.ai-lab {
  display: flex;
  flex-direction: column;
  height: 100vh;
  min-height: 0;
  overflow: hidden;
  background: var(--bg-canvas);
}

.module-tabs {
  display: flex;
  flex: 0 0 auto;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px 16px;
  background-color: var(--bg-panel-raised);
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

.ai-lab-body {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
}

/* 子页面根节点：高度跟随壳的内容区，而不是 viewport */
.ai-lab-body :deep(.ai-playground-container),
.ai-lab-body :deep(.agent-workbench) {
  height: 100%;
}

/* 窄屏：子页面自己回到「整页滚动」的堆叠布局，壳不再锁一屏高度 */
@media (max-width: 1180px) {
  .ai-lab {
    height: auto;
    min-height: 100vh;
    overflow: visible;
  }

  .ai-lab-body {
    overflow: visible;
  }

  .ai-lab-body :deep(.ai-playground-container) {
    height: auto;
  }

  /* 工作台没有窄屏布局；保持它自己的一屏高度，由页面整体滚动 */
  .ai-lab-body :deep(.agent-workbench) {
    height: 100vh;
  }
}
</style>
