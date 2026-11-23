<template>
  <div class="agent-workbench">
    <!-- 顶部工具条：full-bleed 工作台没有全局顶栏，标题与状态自己扛 -->
    <div class="workbench-toolbar">
      <div class="toolbar-title">Agent 评测台</div>
      <span class="toolbar-hint">
        Gym 会话式环境：建会话 → 发动作 → 看审计流。会话是内存态，后端重启即清空；记忆按 owner 分区，可从审计提炼失败模式。
      </span>
      <span v-if="backendOffline" class="toolbar-status offline">后端不在，功能暂不可用</span>
      <span v-else-if="sessionsLoaded" class="toolbar-status online">
        后端在线<template v-if="store.sessions.length > 0"> · {{ store.sessions.length }} 个会话</template>
      </span>
    </div>

    <!-- 三栏分区：左会话 / 中执行 / 右审计流+记忆 -->
    <div class="workbench-container">
      <div class="pane pane-left">
        <WorkbenchSessionPanel />
      </div>
      <div class="pane pane-center">
        <div class="center-viewport">
          <WorkbenchViewport :scene="store.currentScene" :observation="store.lastObservation" />
        </div>
        <div class="center-execute">
          <WorkbenchExecutePanel />
        </div>
      </div>
      <div class="pane pane-right">
        <!-- 右栏纵向分两块：审计流在上（轮询主视觉），记忆/资料在下；各自内部滚动 -->
        <WorkbenchAuditPanel class="pane-right-block audit" />
        <div class="pane-right-block side">
          <div class="side-tabs" role="tablist" aria-label="记忆与资料">
            <button
              type="button"
              class="side-tab"
              role="tab"
              :aria-selected="sideTab === 'memory'"
              :class="{ active: sideTab === 'memory' }"
              @click="sideTab = 'memory'"
            >
              记忆
            </button>
            <button
              type="button"
              class="side-tab"
              role="tab"
              :aria-selected="sideTab === 'knowledge'"
              :class="{ active: sideTab === 'knowledge' }"
              @click="sideTab = 'knowledge'"
            >
              资料
            </button>
          </div>
          <div class="side-body">
            <MemoryPanel v-if="sideTab === 'memory'" />
            <KnowledgePanel v-else />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import WorkbenchSessionPanel from '@/components/workbench/WorkbenchSessionPanel.vue'
import WorkbenchExecutePanel from '@/components/workbench/WorkbenchExecutePanel.vue'
import WorkbenchAuditPanel from '@/components/workbench/WorkbenchAuditPanel.vue'
import WorkbenchViewport from '@/components/workbench/WorkbenchViewport.vue'
import MemoryPanel from '@/components/workbench/MemoryPanel.vue'
import KnowledgePanel from '@/components/workbench/KnowledgePanel.vue'
import { useGymWorkbenchStore } from '@/stores/gymWorkbenchStore'

const store = useGymWorkbenchStore()

/** 右栏下部页签：记忆 / 资料（两者都按 owner 隔离，互不依赖） */
const sideTab = ref<'memory' | 'knowledge'>('memory')

/** 进页面拉过一次会话列表且成功过 → 「后端在线」；一次都没成 → 「后端不在」 */
const sessionsLoaded = ref(false)
const backendOffline = computed(() => !sessionsLoaded.value && Boolean(store.listError))

onMounted(async () => {
  sessionsLoaded.value = await store.refreshSessions()
})

onUnmounted(() => {
  // 轮询定时器在 store 里，不随组件销毁——页面卸载必须显式收掉
  store.dispose()
})
</script>

<style scoped>
/* 布局对齐仿真实验室：full-bleed + 顶部工具条 + 主区；黑金令牌不另起炉灶 */
.agent-workbench {
  height: 100vh;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.workbench-toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 10px 16px;
  background-color: var(--bg-panel-raised);
  border-bottom: 1px solid var(--border-subtle);
}

.toolbar-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--accent);
  white-space: nowrap;
}

.toolbar-hint {
  flex: 1 1 auto;
  min-width: 0;
  font-size: 12px;
  color: var(--text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.toolbar-status {
  font-size: 12px;
  white-space: nowrap;
}

.toolbar-status.online {
  color: var(--success);
}

.toolbar-status.offline {
  color: var(--danger);
}

.workbench-container {
  display: flex;
  flex: 1;
  min-height: 0;
  gap: 1px;
  background-color: var(--border-subtle);
}

.pane {
  min-height: 0;
  padding: 14px;
  background-color: var(--bg-panel);
  overflow: hidden;
}

.pane-left {
  width: 340px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-subtle);
}

.pane-center {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.center-viewport {
  flex: 0 0 54%;
  min-height: 220px;
  overflow: hidden;
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-sm);
  background-color: var(--bg-panel-raised);
}

.center-execute {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.pane-right {
  width: 360px;
  flex-shrink: 0;
  border-left: 1px solid var(--border-subtle);
  /* 右栏纵向分两块：审计流占大头，记忆面板贴在下部，各自内部滚动 */
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.pane-right-block {
  min-height: 0;
}

.pane-right-block.audit {
  flex: 1 1 52%;
}

.pane-right-block.side {
  flex: 1 1 48%;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* 页签承担标题职责：面板内部的重复标题在嵌入时隐藏 */
.side-tabs {
  display: flex;
  gap: 4px;
  padding-bottom: 6px;
  border-bottom: 1px solid var(--border-subtle);
}

.side-tab {
  padding: 3px 10px;
  background: transparent;
  color: var(--text-3);
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: 12px;
  cursor: pointer;
}

.side-tab:hover {
  color: var(--text-1);
}

.side-tab.active {
  color: var(--accent);
  background: rgba(var(--accent-rgb), 0.12);
  border-color: rgba(var(--accent-rgb), 0.3);
}

.side-body {
  flex: 1 1 auto;
  min-height: 0;
}

.side-body :deep(.wb-panel-title) {
  display: none;
}

.side-body :deep(.wb-panel-head) {
  justify-content: flex-end;
}

@media (max-width: 900px) {
  .workbench-container {
    flex-direction: column;
    overflow-y: auto;
  }

  .pane-left,
  .pane-right {
    width: 100%;
    border: none;
    border-bottom: 1px solid var(--border-subtle);
  }

  .pane {
    overflow: visible;
  }

  /* 竖排流式布局里不再按比例切高度，交给页面滚动 */
  .pane-right-block.audit,
  .pane-right-block.side {
    flex: none;
    height: auto;
  }

  .side-body {
    height: auto;
  }

  .center-viewport {
    flex: none;
    height: 320px;
  }

  .center-execute {
    flex: none;
    height: auto;
    overflow: visible;
  }
}
</style>
