<template>
  <div
    class="ai-form llm-panel ai-p-4 ai-bg-panel ai-r-lg ai-b ai-b-amber ai-h-full ai-flex ai-flex-col"
  >
    <!-- 状态 -->
    <div class="ai-fs-xs ai-t-muted ai-mb-3">
      <span class="ai-t-amber">状态：</span>
      <span v-if="llm.configured" class="ai-t-blue">已配置</span>
      <span v-else class="ai-t-faint">未配置（只有规则式控制器可用）</span>
      <span class="ai-t-faint"> · {{ llm.provider.name }} · {{ llm.model }}</span>
      <span v-if="llm.hostingMode === 'hosted'" class="ai-t-faint"> · 托管</span>
    </div>

    <!-- Key 来源 -->
    <div class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-hosting-mode">Key 来源</label>
      <select
        id="llm-hosting-mode"
        class="ai-w-full"
        :value="llm.hostingMode"
        @change="onHostingModeChange"
      >
        <option value="direct">自带 Key（浏览器直连厂商）</option>
        <option value="hosted">托管（Key 存在服务端）</option>
      </select>
      <p class="ai-fs-xs ai-t-faint ai-mt-1">
        自带 Key：key 只存在本页内存里，请求直接发到厂商。 托管：key
        交给后端加密保管，请求走后端——配额、审计与故障转移由后端做。
      </p>
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
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <label class="ai-fs-xs ai-t-muted" for="llm-model">模型</label>
        <button
          v-if="llm.hostingMode === 'direct' && llm.provider.models !== false"
          class="ai-fs-xs ai-bg-chip ai-r-sm ai-px-2 ai-py-05"
          :disabled="llm.loadingModels || !llm.configured"
          @click="onLoadModels"
        >
          {{ llm.loadingModels ? '查询中…' : '拉取可用模型' }}
        </button>
      </div>
      <input
        id="llm-model"
        class="ai-w-full"
        :value="llm.model"
        spellcheck="false"
        autocomplete="off"
        @input="onModelInput"
      />
      <p v-if="llm.modelsError" class="ai-fs-xs ai-t-red ai-mt-1">
        {{ llm.modelsError }}
      </p>
      <ul
        v-else-if="llm.availableModels.length > 0"
        class="ai-space-y-1 ai-mt-1 ai-fs-xs ai-t-faint"
      >
        <li
          v-for="item in llm.availableModels"
          :key="item"
          class="ai-flex ai-justify-between ai-items-center"
        >
          <span>{{ item }}</span>
          <button
            v-if="item !== llm.model"
            class="ai-bg-chip ai-r-sm ai-px-2 ai-py-05"
            @click="llm.applyModel(item)"
          >
            用这个
          </button>
        </li>
      </ul>
      <p v-if="llm.keyKindMismatch" class="ai-fs-xs ai-t-amber-soft ai-mt-1">
        {{ llm.keyKindMismatch }}
      </p>
      <p v-if="llm.keyFamilyMismatch" class="ai-fs-xs ai-t-amber-soft ai-mt-1">
        {{ llm.keyFamilyMismatch }}
      </p>
    </div>

    <!-- 端点（自带 Key 模式：托管模式下端点由后端决定） -->
    <div v-if="llm.hostingMode === 'direct'" class="ai-mb-3">
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

    <!-- API Key（自带 Key 模式：key 留在浏览器内存里） -->
    <div v-if="llm.hostingMode === 'direct'" class="ai-mb-3">
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
      <p v-if="llm.provider.keyKind" class="ai-fs-xs ai-t-faint ai-mt-1">
        这一条要的是
        <template v-if="llm.provider.keyKind === 'subscription'">订阅 Key</template>
        <template v-else>按量计费的 API Key</template>
        （前缀 <code>{{ llm.provider.keyPrefix }}</code
        >）。两种凭证不通用，贴错了换 Key 也调不通。
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

    <!-- 托管模式：把 key 交给服务端保管 -->
    <div v-else class="ai-mb-3">
      <label class="ai-fs-xs ai-t-muted ai-mb-1" for="llm-hosted-key">
        提交 {{ llm.provider.name }} 的 API Key
      </label>
      <input
        id="llm-hosted-key"
        v-model="hostedKeyInput"
        type="password"
        class="ai-w-full"
        autocomplete="off"
        spellcheck="false"
        :placeholder="`粘贴 ${llm.provider.name} 的 API Key`"
        @keyup.enter="submitHostedKey"
      />
      <label class="ai-fs-xs ai-t-muted ai-mb-1 ai-mt-2" for="llm-hosted-passphrase">
        口令（后端没配主密钥时才需要）
      </label>
      <input
        id="llm-hosted-passphrase"
        v-model="hostedPassphrase"
        type="password"
        class="ai-w-full"
        autocomplete="off"
        spellcheck="false"
      />
      <p class="ai-fs-xs ai-t-faint ai-mt-1">
        key 提交后由后端加密保管，前端不留存；页面只显示「已配置 / 未配置」。
      </p>
      <div class="ai-flex ai-gap-2 ai-mt-2">
        <button
          class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-amber ai-t-on-amber ai-r-sm"
          :disabled="submitting"
          @click="submitHostedKey"
        >
          {{ submitting ? '提交中…' : '存到服务端' }}
        </button>
        <button
          class="ai-flex-1 ai-py-15 ai-fs-sm ai-bg-chip ai-r-sm"
          :disabled="!llm.hostedAvailable"
          @click="refreshHosted"
        >
          刷新
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

    <!-- 托管模式：服务端密钥库的现状 -->
    <div v-if="llm.hostingMode === 'hosted'" class="ai-mb-3">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <span class="ai-fs-xs ai-t-amber">服务端密钥库</span>
        <span v-if="llm.quota" class="ai-fs-xs ai-t-faint">
          今日剩余 {{ llm.quota.remaining }} / {{ llm.quota.limit }}
        </span>
      </div>
      <ul class="ai-space-y-1">
        <li
          v-for="item in hostedRows"
          :key="item.id"
          class="ai-flex ai-justify-between ai-items-center ai-fs-xs"
        >
          <span :class="item.configured ? 'ai-t-blue' : 'ai-t-faint'">
            {{ item.name }}：{{ item.configured ? '已配置' : '未配置' }}
          </span>
          <button
            v-if="item.configured"
            class="ai-px-2 ai-py-05 ai-fs-xs ai-bg-chip ai-r-sm"
            @click="removeHostedKey(item.id)"
          >
            删除
          </button>
        </li>
      </ul>
      <p v-if="!llm.hostedAvailable" class="ai-fs-xs ai-t-amber-soft ai-mt-1">
        后端暂时连不上：托管功能已停用，其余功能照常。稍后再点「刷新」。
      </p>
      <p v-else-if="llm.hostedError" class="ai-fs-xs ai-t-red ai-mt-1">
        {{ llm.hostedError }}
      </p>
      <p v-if="llm.lastHostedProvider" class="ai-fs-xs ai-t-faint ai-mt-1">
        上次由 {{ llm.lastHostedProvider }} 应答。
      </p>
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

    <!-- 拍数统计：模型到底有没有在起作用 -->
    <!-- ⚠️ 只在 LLM 模式下显示：规则式模式下这些数字恒为 0，是噪声 -->
    <div v-if="llm.mode === 'llm'" class="ai-mb-3">
      <div class="ai-flex ai-justify-between ai-items-center ai-mb-1">
        <span class="ai-fs-xs ai-t-amber">拍数统计</span>
        <span class="ai-fs-xs ai-t-faint">生效 {{ appliedRatio }}</span>
      </div>
      <p class="ai-fs-xs ai-t-faint">
        LLM 生效 {{ ai.llmApplied }} / {{ ai.llmTicks }} 拍（{{ appliedRatio }}）
      </p>
      <ul class="ai-space-y-1 ai-mt-1 ai-fs-xs ai-t-faint">
        <li class="ai-flex ai-justify-between ai-items-center">
          <span>请求在飞（这一拍没动作）</span>
          <span>{{ ai.llmPending }} 拍</span>
        </li>
        <li class="ai-flex ai-justify-between ai-items-center">
          <span>没给出可用动作</span>
          <span>{{ ai.llmRejected }} 拍</span>
        </li>
        <li class="ai-flex ai-justify-between ai-items-center">
          <span>规则式接管</span>
          <span>{{ ai.llmFallbacks }} 拍</span>
        </li>
      </ul>
      <p v-if="ai.llmTicks > 0 && ai.llmApplied === 0" class="ai-fs-xs ai-t-amber-soft ai-mt-1">
        一拍都没生效：模型的动作没通过校验，或请求一直没回来。
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
import { useAiStore } from '@/stores/aiStore'
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
/**
 * 拍数计数从 aiStore 读——控制器（useAI）写，面板只读。
 *
 * ⚠️ 面板不能自己去碰计数器，也不能调 useAI()（见上面的说明）。
 */
const ai = useAiStore()
const keyInput = ref('')
const hostedKeyInput = ref('')
const hostedPassphrase = ref('')
const submitting = ref(false)
const testing = ref(false)
const providers = llmProviders
const maxCalls = llmConfig.maxCallsPerSession

const canExplain = computed(() => llm.configured && !llm.explaining && Boolean(props.agentId))

/**
 * 生效拍数占比。
 *
 * ⚠️ 一拍都还没有时显示「—」：直接做除法会得到 NaN，界面不能出现 NaN。
 */
const appliedRatio = computed<string>(() => {
  const ratio = ai.llmApplyRatio
  return ratio === null ? '—' : `${(ratio * 100).toFixed(1)}%`
})

/** 服务端密钥库里各家的配置状态（只有「配没配」，没有明文） */
const hostedRows = computed(() =>
  providers.map((provider) => ({
    id: provider.id,
    name: provider.name,
    configured: llm.hostedKeys.some((item) => item.providerId === provider.id && item.configured),
  })),
)

const onSelectProvider = (event: Event): void => {
  const target = event.target as HTMLSelectElement
  llm.selectProvider(target.value)
  keyInput.value = ''
}

const onModelInput = (event: Event): void => {
  llm.setModel((event.target as HTMLInputElement).value)
}

/** 拉一把 key 实际能用的模型列表 */
const onLoadModels = async (): Promise<void> => {
  await llm.loadModels()
}

const onBaseUrlInput = (event: Event): void => {
  llm.setBaseUrl((event.target as HTMLInputElement).value)
}

/** 切换 Key 来源：自带 Key ↔ 托管 */
const onHostingModeChange = async (event: Event): Promise<void> => {
  const target = event.target as HTMLSelectElement
  await llm.setHostingMode(target.value === 'hosted' ? 'hosted' : 'direct')
  if (llm.hostingMode === 'hosted') await llm.refreshQuota()
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

/** 提交 key 到服务端：成功后立刻清空输入框，不让明文留在 DOM 里 */
const submitHostedKey = async (): Promise<void> => {
  submitting.value = true
  try {
    const ok = await llm.submitHostedKey(
      llm.providerId,
      hostedKeyInput.value,
      hostedPassphrase.value,
    )
    if (ok) {
      hostedKeyInput.value = ''
      hostedPassphrase.value = ''
    }
  } finally {
    submitting.value = false
  }
}

/** 删掉服务端某个厂商的 key */
const removeHostedKey = async (id: string): Promise<void> => {
  await llm.removeHostedKey(id)
}

/** 重新拉取服务端的密钥库状态与配额 */
const refreshHosted = async (): Promise<void> => {
  await llm.refreshHostedKeys()
  await llm.refreshQuota()
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
