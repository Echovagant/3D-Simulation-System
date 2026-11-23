/**
 * Agent 工作台 · Gym 会话状态 + 智能体记忆状态。
 *
 * 会话列表 / 当前会话 / 执行结果 / 审计条目的唯一真源；
 * 记忆列表（owner 维度，与会话无关）与写入/删除/审计提炼也在这里。
 * 后端是可选增强：所有动作都不抛异常，失败写进对应的错误位，
 * 界面层按「后端不在」还是业务错误分流展示。
 *
 * 审计流轮询用 setInterval（默认 3s），组件卸载时要调 `dispose()`
 * 收掉定时器——store 不随组件销毁，不收会一直打后端。
 * 记忆列表不轮询：它不随动作执行变化，手动刷新/检索即可。
 */
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import { ApiError, isApiUnavailable } from '@/services/api/client'
import {
  createGymSession,
  deleteGymSession,
  listGymLogs,
  listGymSessions,
  resetGymSession,
  stepGymSession,
  type GymLogQuery,
  type GymObservation,
  type GymParamEcho,
  type GymSessionCreateInput,
  type GymSessionSummary,
  type GymStepLogItem,
  type GymStepResponse,
} from '@/services/api/gymWorkbench'
import {
  consolidateMemory as consolidateMemoryApi,
  createMemory as createMemoryApi,
  deleteMemory as deleteMemoryApi,
  listMemories as listMemoriesApi,
  searchMemories as searchMemoriesApi,
  type ConsolidateResult,
  type MemoryCreateInput,
  type MemoryItem,
} from '@/services/api/memory'
import {
  buildGymDecisionSnapshot,
  GYM_DEFAULT_FORCE_LIMIT,
  proposeForceAction,
  type ForceProposalSource,
} from '@/services/llm/gymDecision'
import { useLlmStore } from './llmStore'

/** 审计流轮询间隔（毫秒） */
export const AUDIT_POLL_INTERVAL_MS = 3000

/** 一次执行的决策来源：LLM 提议还是手动/预设输入（手动不出网） */
export type GymActionSource = 'llm' | 'rule'

/** LLM 提议的留档：提议本身、是否被安全收窄、是否已送进执行面 */
export interface GymProposalRecord {
  /** 提议的动作（已过解析层安全校验，可直接送 step） */
  action: { forceX: number; forceZ: number }
  /** 决策来源留档：哪家服务商哪个模型出的主意 */
  source: ForceProposalSource
  /** 模型原始输出（截到 200 字符，排障用） */
  raw: string
  /** 合力模长超安全上限，被解析层等比缩回 */
  clamped: boolean
  /** 收窄前的原始提议（clamped 为 true 时才有值） */
  original: { forceX: number; forceZ: number } | null
  /** 是否已经送进执行面（送了但 422/网络失败也算送过，executed 为 false） */
  executed: boolean
}

/**
 * 把异常翻译成一句能直接显示的话。
 * 「后端不在」与业务错误是两回事：前者要提示部署状态，后者原样透出。
 */
const describeError = (error: unknown, fallback: string): string => {
  if (isApiUnavailable(error)) return fallback
  if (error instanceof ApiError) return error.message || fallback
  if (error instanceof Error && error.message) return error.message
  return fallback
}

export const useGymWorkbenchStore = defineStore('gymWorkbench', () => {
  const llmStore = useLlmStore()

  // ---- 状态 ----
  /** 本 owner 在场的会话摘要（列表面板用） */
  const sessions = ref<GymSessionSummary[]>([])
  /** 当前会话 id（空串 = 未选中） */
  const currentSessionId = ref('')
  /** 当前会话的参数回显（生效参数 / 丢键 / 回落键 / 力上限），来自 create/reset 响应 */
  const currentParams = ref<GymParamEcho | null>(null)
  /** 最近一次观测（建会话 / reset / step 之后都会更新） */
  const lastObservation = ref<GymObservation | null>(null)
  /** 最近一次 step 的结果（不含观测，观测在 lastObservation 里） */
  const lastStep = ref<Omit<GymStepResponse, 'observation'> | null>(null)
  /** 最近一次动作执行失败的原因（所有失败共用一个位） */
  const stepError = ref('')
  /** 422 越界力的修复指令原文（核心卖点，单独一位好做醒目展示） */
  const repairHint = ref<{ code: string; message: string } | null>(null)
  /** 会话/列表级错误（创建、删除、列表刷新） */
  const listError = ref('')
  /** 审计日志条目（按 ts 升序，与后端一致） */
  const logs = ref<GymStepLogItem[]>([])
  /** 审计流拉取失败的原因 */
  const logsError = ref('')
  /** 审计日志的回合过滤（undefined = 全部回合） */
  const logRoundFilter = ref<number | undefined>(undefined)
  /** 正在提交动作 */
  const stepping = ref(false)
  /** 最近一次执行的决策来源（null = 本次选中会话还没发过动作） */
  const lastActionSource = ref<GymActionSource | null>(null)
  /** 正在请求 LLM 提议（含解析，不含 step） */
  const deciding = ref(false)
  /** LLM 提议环节的失败原因（与 stepError 分开：提议挂了不代表执行挂了） */
  const decisionError = ref('')
  /** 最近一次 LLM 提议与其处置记录（执行面板「LLM 提议动作」区用） */
  const lastProposal = ref<GymProposalRecord | null>(null)
  /** 正在创建会话 */
  const creating = ref(false)
  /** 审计轮询定时器句柄（组件卸载必须收掉） */
  let auditTimer: ReturnType<typeof setInterval> | null = null
  /** 轮询是否在跑：单独一个 ref——定时器句柄本身不需要响应式 */
  const auditPollingActive = ref(false)

  // ---- 记忆状态（owner 维度，与会话无关，不随选会话切换清空） ----
  /** 当前 owner 的记忆列表（最近访问优先；检索时为命中结果） */
  const memories = ref<MemoryItem[]>([])
  /** 记忆列表/检索失败的原因 */
  const memoriesError = ref('')
  /** 记忆写入/删除/提炼失败的原因（与列表失败分开，避免互相盖文案） */
  const memoryActionError = ref('')
  /** 正在写入一条记忆 */
  const memoryWriting = ref(false)
  /** 正在被删除的记忆 id（删完摘除；多条同时删时各自独立） */
  const memoryDeletingIds = ref<number[]>([])
  /** 正在跑审计提炼 */
  const consolidating = ref(false)
  /** 最近一次提炼的结果（面板行内展示；null = 还没跑过） */
  const consolidateResult = ref<ConsolidateResult | null>(null)

  // ---- 派生 ----
  /** 当前会话的摘要（列表里找得到才给） */
  const currentSession = computed<GymSessionSummary | null>(
    () => sessions.value.find((item) => item.sessionId === currentSessionId.value) ?? null,
  )
  /** 轮询是否在跑（组件冒烟测试用它断言卸载清理） */
  // ---- 内部 ----
  /** 拉一次审计日志（当前会话）；失败不中断轮询，错误写进 logsError */
  const fetchLogs = async (): Promise<void> => {
    const sessionId = currentSessionId.value
    if (!sessionId) return
    const query: GymLogQuery = { limit: 200 }
    if (logRoundFilter.value !== undefined) query.round = logRoundFilter.value
    try {
      logs.value = await listGymLogs(llmStore.ownerToken, sessionId, query)
      logsError.value = ''
    } catch (error) {
      logsError.value = describeError(error, '后端不可达，审计流暂时拉不到')
    }
  }

  // ---- 动作 ----
  /** 刷新会话列表；后端缺席时只记错误，不清空已有列表 */
  const refreshSessions = async (): Promise<boolean> => {
    try {
      sessions.value = await listGymSessions(llmStore.ownerToken)
      listError.value = ''
      // 当前会话可能已被别人销毁（后端进程重启会清空全部会话）：如实摘除
      if (
        currentSessionId.value &&
        !sessions.value.some((item) => item.sessionId === currentSessionId.value)
      ) {
        clearCurrent()
      }
      return true
    } catch (error) {
      listError.value = describeError(error, '后端不可达，会话列表暂时刷新不了')
      return false
    }
  }

  /** 清掉当前会话的所有痕迹（销毁 / 后端重启清空时用） */
  const clearCurrent = (): void => {
    stopAuditPolling()
    currentSessionId.value = ''
    currentParams.value = null
    lastObservation.value = null
    lastStep.value = null
    stepError.value = ''
    repairHint.value = null
    lastActionSource.value = null
    lastProposal.value = null
    decisionError.value = ''
    logs.value = []
    logsError.value = ''
  }

  /** 选中一个会话：清掉上一场的执行痕迹，立刻拉一次审计流并开始轮询 */
  const selectSession = (sessionId: string): void => {
    stopAuditPolling()
    currentSessionId.value = sessionId
    // 参数回显来自 create/reset 响应，列表里没有——切会话（含取消选中）时
    // 把旧回显摘掉，等下一次 create/reset 再补上，不拿旧会话的口径冒充当前会话的
    currentParams.value = null
    // 观测跟着会话走：旧会话的观测留着，LLM 提议会拿错场地的数据出主意
    lastObservation.value = null
    lastStep.value = null
    stepError.value = ''
    repairHint.value = null
    lastActionSource.value = null
    lastProposal.value = null
    decisionError.value = ''
    logs.value = []
    logsError.value = ''
    if (!sessionId) return
    void fetchLogs()
    startAuditPolling()
  }

  /**
   * 创建会话。成功后自动选中新会话（含审计轮询）并刷新列表。
   * 返回是否成功；失败原因在 listError。
   */
  const createSession = async (input: GymSessionCreateInput): Promise<boolean> => {
    creating.value = true
    listError.value = ''
    try {
      const created = await createGymSession(llmStore.ownerToken, input)
      selectSession(created.sessionId)
      currentParams.value = {
        effectiveParams: created.effectiveParams,
        droppedParamKeys: created.droppedParamKeys,
        defaultedParamKeys: created.defaultedParamKeys,
        forceLimit: created.forceLimit,
      }
      lastObservation.value = created.observation
      lastStep.value = {
        reward: created.reward,
        terminated: created.terminated,
        truncated: created.truncated,
        info: {},
      }
      void refreshSessions()
      return true
    } catch (error) {
      listError.value = describeError(error, '后端不可达，会话没建起来')
      return false
    } finally {
      creating.value = false
    }
  }

  /**
   * 对当前会话推进一步。
   *
   * source 是这次动作的决策来源（LLM 提议自动发送 / 手动输入），只做留档展示。
   * 422 越界力单独拆成 repairHint（修复指令原文），其余失败进 stepError；
   * 两种失败都不清掉上一次成功的执行结果——界面能对照着看。
   */
  const stepCurrent = async (
    forceX: number,
    forceZ: number,
    source: GymActionSource = 'rule',
  ): Promise<boolean> => {
    const sessionId = currentSessionId.value
    if (!sessionId) {
      stepError.value = '还没有选中会话——先在会话面板建一个或选一个'
      return false
    }
    stepping.value = true
    stepError.value = ''
    repairHint.value = null
    try {
      const result = await stepGymSession(llmStore.ownerToken, sessionId, { forceX, forceZ })
      lastStep.value = {
        reward: result.reward,
        terminated: result.terminated,
        truncated: result.truncated,
        info: result.info,
      }
      // 来源与「最近一步」绑定：失败的一步不改写它的口径
      lastActionSource.value = source
      lastObservation.value = result.observation
      // 审计流不等下一次轮询：step 完立刻刷新，动作与日志的因果关系不脱节
      void fetchLogs()
      return true
    } catch (error) {
      if (
        error instanceof ApiError &&
        error.status === 422 &&
        (error.code === 'gym_force_out_of_range' || error.code === 'gym_agent_invalid_mass')
      ) {
        repairHint.value = { code: error.code, message: error.message }
        stepError.value = error.message
      } else {
        stepError.value = describeError(error, '后端不可达，这一步没送出去')
      }
      return false
    } finally {
      stepping.value = false
    }
  }

  /**
   * LLM 自动决策：把当前观测交给模型提议一个力动作，提议成功就自动发 step。
   *
   * 失败链路（未配 key / 冷却 / 次数上限 / 畸形输出）如实写进 decisionError，
   * **不静默降级执行**——没有提议就没有动作；step 环节的失败照旧走
   * stepError / repairHint（422 修复指令原样透传），两处错误互不覆盖。
   * 提议成功与否都留档在 lastProposal 里，执行面板据此展示预览与状态。
   */
  const autoDecide = async (): Promise<boolean> => {
    if (!currentSessionId.value) {
      decisionError.value = '还没有选中会话——先在会话面板建一个或选一个'
      return false
    }
    const observation = lastObservation.value
    if (!observation) {
      decisionError.value = '当前会话还没有观测——先建会话或重置回合，再请求提议'
      return false
    }
    deciding.value = true
    decisionError.value = ''
    try {
      const snapshot = buildGymDecisionSnapshot({
        observation,
        lastStep: lastStep.value,
        forceLimit: currentParams.value?.forceLimit ?? GYM_DEFAULT_FORCE_LIMIT,
      })
      const proposal = await proposeForceAction(snapshot, {
        invoke: llmStore.invoke,
        provider: llmStore.provider.name,
        model: llmStore.model,
        baseUrl: llmStore.baseUrl,
      })
      if (!proposal.ok) {
        decisionError.value = proposal.error
        return false
      }
      lastProposal.value = {
        action: proposal.action,
        source: proposal.source,
        raw: proposal.raw,
        clamped: proposal.clamped,
        original: proposal.original,
        executed: false,
      }
      const ok = await stepCurrent(proposal.action.forceX, proposal.action.forceZ, 'llm')
      if (lastProposal.value) {
        lastProposal.value = { ...lastProposal.value, executed: ok }
      }
      return ok
    } finally {
      deciding.value = false
    }
  }

  /**
   * 重建世界回到初始状态。成功后刷新参数回显与观测，清掉上一步的结果。
   */
  const resetCurrent = async (): Promise<boolean> => {
    const sessionId = currentSessionId.value
    if (!sessionId) {
      stepError.value = '还没有选中会话——先在会话面板建一个或选一个'
      return false
    }
    stepError.value = ''
    repairHint.value = null
    try {
      const result = await resetGymSession(llmStore.ownerToken, sessionId)
      currentParams.value = {
        effectiveParams: result.effectiveParams,
        droppedParamKeys: result.droppedParamKeys,
        defaultedParamKeys: result.defaultedParamKeys,
        forceLimit: result.forceLimit,
      }
      lastObservation.value = result.observation
      lastStep.value = {
        reward: result.reward,
        terminated: result.terminated,
        truncated: result.truncated,
        info: {},
      }
      void fetchLogs()
      return true
    } catch (error) {
      stepError.value = describeError(error, '后端不可达，回合没重置成')
      return false
    }
  }

  /** 删除当前会话（没有选中时不动）；成功后清掉当前状态并刷新列表 */
  const deleteCurrent = async (): Promise<boolean> => {
    const sessionId = currentSessionId.value
    if (!sessionId) return false
    listError.value = ''
    try {
      await deleteGymSession(llmStore.ownerToken, sessionId)
      clearCurrent()
      await refreshSessions()
      return true
    } catch (error) {
      listError.value = describeError(error, '后端不可达，会话没删掉')
      return false
    }
  }

  /** 改回合过滤并立刻按新过滤拉一次（轮询继续按新过滤跑） */
  const setLogRoundFilter = (round: number | undefined): void => {
    logRoundFilter.value = round
    void fetchLogs()
  }

  // ---- 记忆动作 ----
  /**
   * 拉记忆列表（owner 维度）；有关键词走检索（后端按衰减打分），否则最近优先。
   * 返回是否成功；失败不清空已有列表——界面还能看旧数据。
   */
  const fetchMemories = async (query?: string): Promise<boolean> => {
    const keyword = (query ?? '').trim()
    try {
      const result = keyword
        ? await searchMemoriesApi(llmStore.ownerToken, keyword)
        : await listMemoriesApi(llmStore.ownerToken)
      memories.value = result.items
      memoriesError.value = ''
      return true
    } catch (error) {
      memoriesError.value = describeError(error, '后端不可达，记忆列表暂时拉不到')
      return false
    }
  }

  /** 写一条记忆；成功后把新条目插到列表最前（后端列表本来就是最近优先） */
  const createMemory = async (input: MemoryCreateInput): Promise<boolean> => {
    memoryWriting.value = true
    memoryActionError.value = ''
    try {
      const created = await createMemoryApi(llmStore.ownerToken, input)
      memories.value = [created, ...memories.value.filter((item) => item.id !== created.id)]
      return true
    } catch (error) {
      memoryActionError.value = describeError(error, '后端不可达，记忆没写进去')
      return false
    } finally {
      memoryWriting.value = false
    }
  }

  /** 删除一条记忆；后端成功才动本地列表（404 也算删成了——目标已经不在） */
  const deleteMemory = async (id: number): Promise<boolean> => {
    memoryActionError.value = ''
    memoryDeletingIds.value = [...memoryDeletingIds.value, id]
    try {
      await deleteMemoryApi(llmStore.ownerToken, id)
      memories.value = memories.value.filter((item) => item.id !== id)
      return true
    } catch (error) {
      // 越权/不存在统一 404：条目已经不在了，本地同步摘掉，不算失败
      if (error instanceof ApiError && error.status === 404) {
        memories.value = memories.value.filter((item) => item.id !== id)
        return true
      }
      memoryActionError.value = describeError(error, '后端不可达，记忆没删掉')
      return false
    } finally {
      memoryDeletingIds.value = memoryDeletingIds.value.filter((busyId) => busyId !== id)
    }
  }

  /**
   * 从当前 owner 的 gym 审计提炼失败模式为程序性记忆。
   * 成功后**等列表刷新完**再返回（提炼会新建/更新记忆，调用方拿到结果时
   * 列表已是最新，不用自己再刷一次），结果留在 consolidateResult 供面板展示。
   */
  const consolidate = async (): Promise<boolean> => {
    consolidating.value = true
    memoryActionError.value = ''
    try {
      consolidateResult.value = await consolidateMemoryApi(llmStore.ownerToken)
      await fetchMemories()
      return true
    } catch (error) {
      memoryActionError.value = describeError(error, '后端不可达，审计提炼没跑成')
      return false
    } finally {
      consolidating.value = false
    }
  }

  /** 启动审计流轮询；已有定时器先收掉，避免叠着多个 */
  const startAuditPolling = (intervalMs: number = AUDIT_POLL_INTERVAL_MS): void => {
    stopAuditPolling()
    if (!currentSessionId.value) return
    auditTimer = setInterval(() => {
      void fetchLogs()
    }, intervalMs)
    auditPollingActive.value = true
  }

  /** 收掉审计流轮询 */
  const stopAuditPolling = (): void => {
    if (auditTimer !== null) {
      clearInterval(auditTimer)
      auditTimer = null
    }
    auditPollingActive.value = false
  }

  /** 组件卸载时的统一清理入口：目前只有轮询定时器 */
  const dispose = (): void => {
    stopAuditPolling()
  }

  return {
    // 状态
    sessions,
    currentSessionId,
    currentSession,
    currentParams,
    lastObservation,
    lastStep,
    stepError,
    repairHint,
    listError,
    logs,
    logsError,
    logRoundFilter,
    stepping,
    creating,
    auditPollingActive,
    lastActionSource,
    deciding,
    decisionError,
    lastProposal,
    memories,
    memoriesError,
    memoryActionError,
    memoryWriting,
    memoryDeletingIds,
    consolidating,
    consolidateResult,
    // 动作
    refreshSessions,
    createSession,
    selectSession,
    stepCurrent,
    autoDecide,
    resetCurrent,
    deleteCurrent,
    setLogRoundFilter,
    fetchMemories,
    createMemory,
    deleteMemory,
    consolidate,
    startAuditPolling,
    stopAuditPolling,
    dispose,
  }
})
