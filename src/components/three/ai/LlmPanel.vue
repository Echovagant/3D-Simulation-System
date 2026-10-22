<template>
  <div
    class="ai-form llm-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber ai-h-full ai-flex ai-flex-col"
  >
    <h3 class="ai-t-amber ai-fs-lg ai-fw-bold ai-mb-3 ai-flex ai-items-center">
      <i class="fa fa-brain ai-mr-2"></i>LLM 增强
    </h3>

    <!-- 状态 -->
    <div class="ai-fs-xs ai-t-muted ai-mb-3">
      <span class="ai-t-amber">状态：</span>
      <span v-if="llm.configured" class="ai-t-blue">已配置</span>
      <span v-else class="ai-t-faint">未配置（只有规则式控制器可用）</span>
      <span class="ai-t-faint"> · {{ llm.provider.name }} · {{ llm.model }}</span>
    </div>

    <!-- 提供商 -->
    <div class="ai-mb-2">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-provider">服务商</label>
      <select
        id="llm-provider"
        class="ai-w-full"
        :value="llm.providerId"
        @change="onSelectProvider"
      >
        <option v-for="item in providers" :key="item.id" :value="item.id">
          {{ item.name }}
        </option>
      </select>
      <p v-if="llm.provider.note" class="ai-fs-xs ai-t-faint ai-mt-1">
        {{ llm.provider.note }}
      </p>
    </div>

    <!-- 模型 -->
    <div class="ai-mb-2">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-model">模型</label>
      <input
        id="llm-model"
        class="ai-w-full"
        :value="llm.model"
        spellcheck="false"
        autocomplete="off"
        @input="onModelInput"
      />
    </div>

    <!-- 端点 -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-base-url">端点（base_url）</label>
      <input
        id="llm-base-url"
        class="ai-w-full"
        :value="llm.baseUrl"
        spellcheck="false"
        autocomplete="off"
        @input="onBaseUrlInput"
      />
      <p class="ai-fs-xs ai-t-faint ai-mt-1">
        改端点后还要同步放行浏览器的 CSP（index.html 的 connect-src）。
        <a :href="llm.provider.docsUrl" target="_blank" rel="noreferrer noopener">官方文档</a>
      </p>
    </div>

    <!-- API Key -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-api-key">API Key</label>
      <input
        id="llm-api-key"
        v-model="keyInput"
        type="password"
        class="ai-w-full"
        autocomplete="off"
        spellcheck="false"
        :placeholder="`粘贴 ${llm.provider.name} 的 API Key`"
        @keyup.enter="applyKey"
      />
      <p class="ai-fs-xs ai-t-faint ai-mt-1">
        只存在当前页面的内存里，刷新即失效；不写磁盘、不进仓库、不会出现在日志里。
      </p>
      <div class="ai-flex ai-gap-2 ai-mt-2">
        <button
          class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-amber ai-t-on-amber ai-r-sm"
          @click="applyKey"
        >
          应用
        </button>
        <button class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-chip ai-r-sm" @click="clearKey">
          清除
        </button>
        <button
          class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-chip ai-r-sm"
          :disabled="!llm.configured || testing"
          @click="testConnection"
        >
          {{ testing ? '测试中' : '测试' }}
        </button>
      </div>
    </div>

    <!-- 决策来源 -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-mode">决策来源</label>
      <select id="llm-mode" v-model="llm.mode" class="ai-w-full">
        <option value="rule">规则式（默认 · 不出网）</option>
        <option value="llm">LLM 决策（需已配置 Key）</option>
      </select>
      <p class="ai-fs-xs ai-t-faint ai-mt-1">
        LLM 只决定「往哪走」，位移仍由 Rapier 物理引擎计算。
        调用失败或返回不可解析的结果时，会自动回落到规则式并在下面标出来。
      </p>
    </div>

    <!-- 旁路解释 -->
    <div class="ai-mb-3">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <span class="ai-fs-xs ai-t-amber">旁路解释</span>
        <button
          class="ai-py-05 ai-px-2 ai-fs-xs ai-bg-chip ai-r-sm"
          :disabled="!canExplain"
          @click="explain"
        >
          {{ llm.explaining ? '模型思考中…' : '解释当前决策' }}
        </button>
      </div>
      <p v-if="llm.explanation" class="ai-fs-xs ai-t llm-explanation">
        {{ llm.explanation }}
      </p>
      <p v-else class="ai-fs-xs ai-t-faint">
        点上面的按钮，让模型用两三句话说明这个智能体为什么这么走。解释只是旁路说明，不会影响仿真。
      </p>
    </div>

    <!-- 错误与降级 -->
    <p v-if="llm.lastError" class="ai-fs-xs ai-t-red ai-mb-2">
      {{ llm.lastError }}
    </p>
    <p v-if="llm.degraded" class="ai-fs-xs ai-t-amber-soft ai-mb-2">
      LLM 控制器已降级：当前由规则式接管。
    </p>

    <div class="ai-fs-xs ai-t-faint ai-mt-auto">
      本次会话已调用 {{ llm.callCount }} / {{ maxCalls }} 次
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from 'vue'
import { useLlmStore } from '@/stores/llmStore'
import { llmConfig } from '@/config/llm'
import { llmProviders } from '@/config/llmProviders'
import type { AgentSnapshot } from '@/services/llm/prompts'

/**
 * LLM 面板。
 *
 * ⚠️ 这里**故意不调用 useAI()**：useAI 会起一个自己的物理实例与决策循环，
 * 面板再调一次就会多出第二个循环（决策会翻倍）。
 * 需要的状态快照由页面通过 `getSnapshot` 传进来。
 */
const props = defineProps<{
  /** 要解释的智能体 id（为空则没有可解释的对象） */
  agentId: string | null
  /** 取智能体当前状态快照 */
  getSnapshot: (agentId: string) => AgentSnapshot | null
}>()

const llm = useLlmStore()
const keyInput = ref('')
const testing = ref(false)
const providers = llmProviders
const maxCalls = llmConfig.maxCallsPerSession

const canExplain = computed(
  () => llm.configured && !llm.explaining && Boolean(props.agentId),
)

const onSelectProvider = (event: Event): void => {
  const target = event.target as HTMLSelectElement
  llm.selectProvider(target.value)
  keyInput.value = ''
}

const onModelInput = (event: Event): void => {
  llm.setModel((event.target as HTMLInputElement).value)
}

const onBaseUrlInput = (event: Event): void => {
  llm.setBaseUrl((event.target as HTMLInputElement).value)
}

/** 应用 key：写进内存后立刻把输入框清空，不让 key 留在 DOM 里 */
const applyKey = (): void => {
  llm.applyKey(keyInput.value)
  keyInput.value = ''
}

const clearKey = (): void => {
  llm.clearKey()
  keyInput.value = ''
}

const testConnection = async (): Promise<void> => {
  testing.value = true
  try {
    await llm.testConnection()
  } finally {
    testing.value = false
  }
}

const explain = async (): Promise<void> => {
  if (!props.agentId) return
  const snapshot = props.getSnapshot(props.agentId)
  if (!snapshot) {
    llm.setError('拿不到智能体当前状态（可能还没进入场景）')
    return
  }
  await llm.requestExplanation(snapshot)
}
</script>

<style scoped>
/* 解释文本：中文正文按 1.7 行高读起来更舒服 */
.llm-explanation {
  line-height: 1.7;
  padding: 0.5rem;
  background: rgba(0, 0, 0, 0.4);
  border-radius: 4px;
  border-left: 2px solid rgba(255, 161, 23, 0.5);
}
</style>
