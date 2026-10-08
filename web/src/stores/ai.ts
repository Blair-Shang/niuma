import { defineStore } from 'pinia'
import { computed, reactive, ref } from 'vue'
import { aiApi } from '@/api/ai'
import { subscribeBridgeEventByPrefix } from '@/api/event-bus'
import type {
  AiBridgeEvent,
  AiContextDraft,
  AiConversation,
  AiLiveToolInvocation,
  AiLiveToolStatus,
  AiMessage,
  AiProvider,
  AiSkill,
  AiToolInvocationRecord,
} from '@/api/types/ai'
import { useAccountStore } from '@/stores/account'
import {
  buildContextPack,
  extractAttachmentMarkers,
  type AiContextAttachment,
} from '@/shell/panels/ai/context-pack'
import { modelsForProvider } from '@/shell/panels/ai/model-options'
import {
  ensureSystemAiProvider,
  isSystemAiProvider,
  SYSTEM_AI_PROVIDER_ID,
} from '@/shell/panels/ai/system-provider'

/**
 * AI 对话状态。每个会话各自保存消息、流式缓冲和 run，切换只更换当前显示的会话。
 *
 * 面板开关仍由 useShellStore.aiPanelOpen 控制；本 store 只管对话数据。
 */
type RunStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

/** 一路会话的画面与进行中的 run。事件按 conversationId 写回这一份。 */
interface ConversationSession {
  messages: AiMessage[]
  runId: string | null
  streamingText: string
  runStatus: RunStatus
  runError: string | null
  sending: boolean
  toolHistory: AiLiveToolInvocation[]
  liveTools: AiLiveToolInvocation[]
  previousAssistantContent: string | null
  editingMessageId: string | null
  cancelPending: boolean
  loaded: boolean
}

const EMPTY_MESSAGES: AiMessage[] = []
const EMPTY_TOOLS: AiLiveToolInvocation[] = []

function sessionBusy(slot: ConversationSession): boolean {
  return slot.sending || slot.runStatus === 'running'
}

function createSession(): ConversationSession {
  return {
    messages: [],
    runId: null,
    streamingText: '',
    runStatus: 'idle',
    runError: null,
    sending: false,
    toolHistory: [],
    liveTools: [],
    previousAssistantContent: null,
    editingMessageId: null,
    cancelPending: false,
    loaded: false,
  }
}

export const useAiStore = defineStore('ai', () => {
  const conversations = ref<AiConversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const providers = ref<AiProvider[]>([])
  const skills = ref<AiSkill[]>([])
  const selectedProviderId = ref<string>('')
  const selectedModelCode = ref<string>('')
  const selectedSkillCode = ref<string>('')
  const loading = ref(false)
  const error = ref<string | null>(null)
  /** askSelection / 外部注入的待挂 @ 附件。 */
  const pendingComposerAttachments = ref<AiContextAttachment[]>([])
  /** 将用户消息填入输入框。 */
  const composerDraft = ref('')

  /**
   * 只留当前画面和仍在跑的会话。结束后的正文在库里，离开画面就丢掉内存副本。
   * 事件只更新已有槽，不因迟到事件再造出一份会话。
   */
  const sessions = reactive<Record<string, ConversationSession>>({})
  /** 已删除的会话。迟到的 runId 只负责取消，不再写回画面。 */
  const droppedConversationIds = new Set<string>()
  const loadGen = new Map<string, number>()

  function sessionOf(id: string): ConversationSession {
    if (!sessions[id]) {
      sessions[id] = createSession()
    }
    return sessions[id]
  }

  const activeLive = computed(() => {
    const id = activeConversationId.value
    return id ? sessions[id] ?? null : null
  })

  const messages = computed(() => activeLive.value?.messages ?? EMPTY_MESSAGES)
  const runId = computed(() => activeLive.value?.runId ?? null)
  const streamingText = computed(() => activeLive.value?.streamingText ?? '')
  const runStatus = computed(() => activeLive.value?.runStatus ?? 'idle')
  const runError = computed(() => activeLive.value?.runError ?? null)
  const sending = computed(() => activeLive.value?.sending ?? false)
  const toolHistory = computed(() => activeLive.value?.toolHistory ?? EMPTY_TOOLS)
  const liveTools = computed(() => activeLive.value?.liveTools ?? EMPTY_TOOLS)
  const previousAssistantContent = computed(() => activeLive.value?.previousAssistantContent ?? null)
  const editingMessageId = computed(() => activeLive.value?.editingMessageId ?? null)
  const isStreaming = computed(() => runStatus.value === 'running')
  const busyConversationIds = computed(() => {
    const ids = new Set<string>()
    for (const [id, slot] of Object.entries(sessions)) {
      if (slot.sending || slot.runStatus === 'running') {
        ids.add(id)
      }
    }
    return ids
  })

  const activeConversation = computed(() =>
    conversations.value.find((c) => c.conversationId === activeConversationId.value) ?? null,
  )

  const modelOptions = computed(() => {
    const p = providers.value.find((x) => x.providerId === selectedProviderId.value)
    return p ? modelsForProvider(p) : []
  })

  /** 面板展示用：流式时以 live 为准，否则回放历史。 */
  const displayTools = computed((): AiLiveToolInvocation[] => {
    if (isStreaming.value || liveTools.value.length) {
      const byId = new Map<string, AiLiveToolInvocation>()
      for (const t of toolHistory.value) {
        byId.set(t.invocationId, t)
      }
      for (const t of liveTools.value) {
        byId.set(t.invocationId, t)
      }
      return [...byId.values()]
    }
    return toolHistory.value
  })

  let eventUnsub: (() => void) | null = null
  /** 已经结束的 run。只留最近若干个，挡住刚结束那一轮的迟到事件。 */
  const closedRunIds = new Set<string>()
  const closedRunLimit = 64

  function acceptsRun(slot: ConversationSession, eventRunId?: string): boolean {
    if (eventRunId && closedRunIds.has(eventRunId)) {
      return false
    }
    if (slot.cancelPending && !slot.runId) {
      return false
    }
    if (slot.runId && eventRunId && eventRunId !== slot.runId) {
      return false
    }
    if (!slot.runId && !slot.sending && slot.runStatus !== 'running') {
      return false
    }
    return true
  }

  function closeRun(id: string | undefined): void {
    if (!id || closedRunIds.has(id)) {
      return
    }
    closedRunIds.add(id)
    while (closedRunIds.size > closedRunLimit) {
      const oldest = closedRunIds.values().next().value
      if (!oldest) {
        break
      }
      closedRunIds.delete(oldest)
    }
  }

  /** 丢掉不在画面上、也没有进行中 run 的会话副本。取消/失败保留状态，正文仍从库里再取。 */
  function releaseIdleSession(id: string | null | undefined): void {
    if (!id || id === activeConversationId.value) {
      return
    }
    const slot = sessions[id]
    if (!slot || sessionBusy(slot)) {
      return
    }
    loadGen.delete(id)
    if (slot.runStatus === 'cancelled' || slot.runStatus === 'error') {
      slot.messages = []
      slot.toolHistory = []
      slot.liveTools = []
      slot.streamingText = ''
      slot.previousAssistantContent = null
      slot.loaded = false
      return
    }
    delete sessions[id]
  }

  /** 当前画面刷新工具历史；不在画面上的会话立刻释放正文副本。 */
  function settleSessionView(conversationId: string): void {
    if (activeConversationId.value === conversationId) {
      void reloadToolHistory(conversationId)
      return
    }
    releaseIdleSession(conversationId)
  }

  function discardRun(id: string): void {
    closeRun(id)
    void aiApi.cancelChat({ runId: id }).catch(() => undefined)
  }

  /** 进行中的工具收成终态，留在该会话的历史里。 */
  function settleOpenTools(slot: ConversationSession, errorText: string): void {
    const mark = (t: AiLiveToolInvocation): AiLiveToolInvocation =>
      t.status === 'running' || t.status === 'pending'
        ? { ...t, status: 'error', error: t.error || errorText }
        : t
    const byId = new Map(slot.toolHistory.map((t) => [t.invocationId, t]))
    for (const t of slot.liveTools) {
      byId.set(t.invocationId, t)
    }
    slot.toolHistory = [...byId.values()].map(mark)
    slot.liveTools = []
  }

  /**
   * 采纳 streamChat 返回的 runId，写回发起这次发送的会话。
   * 该会话已停止或已删除时，取消这一轮并返回 false。
   */
  function adoptRun(conversationId: string, id: string): boolean {
    if (droppedConversationIds.has(conversationId)) {
      discardRun(id)
      return false
    }
    const slot = sessions[conversationId]
    if (!slot) {
      discardRun(id)
      return false
    }
    if (!slot.cancelPending) {
      slot.runId = id
      return true
    }
    slot.cancelPending = false
    closeRun(id)
    settleOpenTools(slot, 'cancelled')
    slot.streamingText = ''
    slot.runId = null
    slot.runStatus = 'cancelled'
    slot.sending = false
    void aiApi.cancelChat({ runId: id }).catch((e) => {
      if (activeConversationId.value === conversationId) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    })
    return false
  }

  function mapInvocationStatus(status: string): AiLiveToolStatus {
    if (status === 'pending') return 'pending'
    if (status === 'running') return 'running'
    if (status === 'ok' || status === 'done' || status === 'success') return 'ok'
    return 'error'
  }

  function mapToolInvocations(
    records: AiToolInvocationRecord[] | undefined,
    confirmableIds: Set<string> | undefined,
    currentRun: string | null,
  ): AiLiveToolInvocation[] {
    return (records ?? []).map((r) => {
      let status = mapInvocationStatus(String(r.status))
      let error = r.error
      if (status === 'pending' && confirmableIds && !confirmableIds.has(r.invocationId)) {
        status = 'error'
        if (!error) error = 'stale pending'
      }
      // 停止后库里可能仍短暂为 running：非当前 run 的进行中卡片按已取消回放
      if (status === 'running' && (!currentRun || (r.runId && r.runId !== currentRun))) {
        status = 'error'
        if (!error) error = 'cancelled'
      }
      return {
        invocationId: r.invocationId,
        toolName: r.toolName,
        status,
        argsSummary: r.argsSummary,
        resultSummary: r.resultSummary,
        error: status === 'error' && !error && r.status === 'pending' ? 'stale pending' : error,
        risk: r.risk,
        createdAt: r.createdAt,
        runId: r.runId,
      }
    })
  }

  /** 确保订阅 platform.ai.* 事件（幂等）。 */
  function ensureEventSubscription(): void {
    if (eventUnsub) {
      return
    }
    eventUnsub = subscribeBridgeEventByPrefix('platform.ai.', (detail) => {
      applyBridgeEvent(detail as AiBridgeEvent)
    })
  }

  function applyBridgeEvent(ev: AiBridgeEvent): void {
    if (!ev || typeof ev !== 'object' || !('type' in ev)) {
      return
    }
    const conversationId = 'conversationId' in ev ? ev.conversationId : undefined
    if (!conversationId || droppedConversationIds.has(conversationId)) {
      return
    }
    const slot = sessions[conversationId]
    if (!slot || !acceptsRun(slot, ev.runId)) {
      return
    }
    if (ev.type === 'platform.ai.token') {
      slot.streamingText += ev.delta ?? ''
      return
    }
    if (ev.type === 'platform.ai.message') {
      if (ev.role === 'assistant' && ev.content != null) {
        slot.streamingText = ''
        const exists = slot.messages.some((m) => m.messageId === ev.messageId)
        if (!exists) {
          slot.messages.push({
            messageId: ev.messageId,
            conversationId: ev.conversationId,
            messageRole: ev.role,
            messageContent: ev.content,
            tokenCount: null,
            createdAt: new Date().toISOString(),
          })
        }
      }
      return
    }
    if (ev.type === 'platform.ai.tool.start') {
      const existing = slot.liveTools.find((t) => t.invocationId === ev.invocationId)
      if (existing) {
        existing.status = 'running'
        existing.toolName = ev.toolName
        existing.argsSummary = ev.argsSummary
        if (ev.risk) existing.risk = ev.risk
        return
      }
      slot.liveTools.push({
        invocationId: ev.invocationId,
        toolName: ev.toolName,
        status: 'running',
        argsSummary: ev.argsSummary,
        risk: ev.risk,
        createdAt: new Date().toISOString(),
        runId: ev.runId,
      })
      return
    }
    if (ev.type === 'platform.ai.tool.pending') {
      const existing = slot.liveTools.find((t) => t.invocationId === ev.invocationId)
      if (existing) {
        existing.status = 'pending'
        existing.toolName = ev.toolName || existing.toolName
        existing.argsSummary = ev.argsSummary
        existing.risk = ev.risk
        return
      }
      slot.liveTools.push({
        invocationId: ev.invocationId,
        toolName: ev.toolName || 'tool',
        status: 'pending',
        argsSummary: ev.argsSummary,
        risk: ev.risk,
        createdAt: new Date().toISOString(),
        runId: ev.runId,
      })
      return
    }
    if (ev.type === 'platform.ai.tool.result') {
      const applyResult = (t: AiLiveToolInvocation): AiLiveToolInvocation => {
        if (t.invocationId !== ev.invocationId) {
          return t
        }
        // 已因停止标成 cancelled 的卡片，不接受随后跑完的成功结果
        if (t.error === 'cancelled' && ev.ok) {
          return t
        }
        return {
          ...t,
          status: ev.ok ? 'ok' : 'error',
          resultSummary: ev.resultSummary,
          error: ev.error,
        }
      }
      slot.liveTools = slot.liveTools.map(applyResult)
      slot.toolHistory = slot.toolHistory.map(applyResult)
      return
    }
    if (ev.type === 'platform.ai.run.status') {
      if (ev.status === 'done' || ev.status === 'cancelled' || ev.status === 'error') {
        closeRun(ev.runId)
      }
      if (ev.status === 'running') {
        slot.runStatus = 'running'
        slot.runError = null
        return
      }
      if (ev.status === 'done') {
        slot.runStatus = 'done'
        slot.sending = false
        slot.runId = null
        slot.streamingText = ''
        slot.previousAssistantContent = null
        slot.editingMessageId = null
        slot.liveTools = []
        void refreshConversations()
        settleSessionView(conversationId)
        return
      }
      if (ev.status === 'cancelled') {
        slot.runStatus = 'cancelled'
        slot.sending = false
        slot.runId = null
        settleOpenTools(slot, 'cancelled')
        settleSessionView(conversationId)
        return
      }
      if (ev.status === 'error') {
        slot.runStatus = 'error'
        slot.runError = ev.error ?? 'unknown error'
        slot.sending = false
        slot.runId = null
        slot.streamingText = ''
        settleOpenTools(slot, slot.runError ?? 'error')
        settleSessionView(conversationId)
      }
    }
  }

  async function reloadToolHistory(conversationId: string): Promise<void> {
    const slot = sessions[conversationId]
    if (!slot || droppedConversationIds.has(conversationId)) {
      return
    }
    try {
      const [res, pending] = await Promise.all([
        aiApi.getConversation({ conversationId }),
        aiApi.listPendingPolicy().catch(() => ({ invocationIds: [] as string[] })),
      ])
      if (slot.sending || slot.runStatus === 'running') {
        return
      }
      const confirmable = new Set(pending.invocationIds ?? [])
      slot.toolHistory = mapToolInvocations(res.toolInvocations, confirmable, slot.runId)
    } catch {
      // ignore reload errors
    }
  }

  function reconcileSelectedModel(): void {
    const current = providers.value.find((p) => p.providerId === selectedProviderId.value)
    if (!current) {
      if (!providers.value.length) {
        selectedProviderId.value = ''
        selectedModelCode.value = ''
        return
      }
      const system = providers.value.find(
        (p) => p.providerId === SYSTEM_AI_PROVIDER_ID && p.recordStatus !== 'disabled',
      )
      const first = system ?? providers.value[0]
      selectedProviderId.value = first.providerId
      const codes = modelsForProvider(first).map((m) => m.modelCode)
      selectedModelCode.value =
        (first.defaultModelCode && codes.includes(first.defaultModelCode)
          ? first.defaultModelCode
          : codes[0]) ?? ''
      return
    }
    const codes = modelsForProvider(current).map((m) => m.modelCode)
    if (selectedModelCode.value && codes.includes(selectedModelCode.value)) {
      return
    }
    selectedModelCode.value =
      (current.defaultModelCode && codes.includes(current.defaultModelCode)
        ? current.defaultModelCode
        : codes[0]) ?? ''
  }

  async function refreshProviders(): Promise<void> {
    const res = await aiApi.listProviders({ includeModels: true, status: 'active' })
    providers.value = res.providers ?? []
    reconcileSelectedModel()
  }

  async function refreshSkills(): Promise<void> {
    try {
      const res = await aiApi.listSkills({ status: 'active' })
      skills.value = res.skills ?? []
    } catch {
      skills.value = []
    }
  }

  async function refreshConversations(): Promise<void> {
    const res = await aiApi.listConversations({ limit: 50 })
    conversations.value = res.conversations ?? []
  }

  async function bootstrap(): Promise<void> {
    ensureEventSubscription()
    loading.value = true
    error.value = null
    try {
      const account = useAccountStore()
      if (account.isLoggedIn) {
        try {
          const token = await account.ensureAccess()
          await ensureSystemAiProvider(token)
        } catch {
          // 云端未开通或离线时继续用已有 Provider
        }
      }
      await Promise.all([refreshProviders(), refreshConversations(), refreshSkills()])
      if (!activeConversationId.value && conversations.value.length) {
        await openConversation(conversations.value[0].conversationId)
      } else if (activeConversationId.value) {
        await hydrateConversation(activeConversationId.value)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  function applyConversationModel(providerId?: string, modelCode?: string): void {
    if (providerId) {
      selectedProviderId.value = providerId
    }
    if (modelCode) {
      selectedModelCode.value = modelCode
    }
    reconcileSelectedModel()
  }

  /** 把已落库的消息写入该会话。进行中的 run 保持内存里的流式内容。 */
  async function hydrateConversation(conversationId: string): Promise<void> {
    const slot = sessionOf(conversationId)
    if (slot.sending || slot.runStatus === 'running') {
      return
    }
    const gen = (loadGen.get(conversationId) ?? 0) + 1
    loadGen.set(conversationId, gen)
    const showLoading = !slot.loaded && activeConversationId.value === conversationId
    if (showLoading) {
      loading.value = true
    }
    try {
      const [res, pending] = await Promise.all([
        aiApi.getConversation({ conversationId }),
        aiApi.listPendingPolicy().catch(() => ({ invocationIds: [] as string[] })),
      ])
      if (loadGen.get(conversationId) !== gen || droppedConversationIds.has(conversationId)) {
        return
      }
      if (sessionBusy(slot)) {
        return
      }
      const confirmable = new Set(pending.invocationIds ?? [])
      slot.messages = (res.messages ?? []).filter((m) => m.messageRole !== 'tool')
      slot.toolHistory = mapToolInvocations(res.toolInvocations, confirmable, slot.runId)
      slot.loaded = true
      if (activeConversationId.value === conversationId) {
        applyConversationModel(res.conversation?.providerId, res.conversation?.modelCode)
      }
    } catch (e) {
      if (activeConversationId.value === conversationId) {
        error.value = e instanceof Error ? e.message : String(e)
      }
    } finally {
      if (showLoading && activeConversationId.value === conversationId && loadGen.get(conversationId) === gen) {
        loading.value = false
      }
    }
  }

  async function openConversation(conversationId: string): Promise<void> {
    const previousId = activeConversationId.value
    activeConversationId.value = conversationId
    if (previousId !== conversationId) {
      releaseIdleSession(previousId)
    }
    error.value = null
    const listed = conversations.value.find((c) => c.conversationId === conversationId)
    applyConversationModel(listed?.providerId, listed?.modelCode)
    const slot = sessionOf(conversationId)
    if (slot.sending || slot.runStatus === 'running') {
      loading.value = false
      return
    }
    await hydrateConversation(conversationId)
  }

  async function resolveCloudAccessToken(): Promise<string | undefined> {
    const current =
      providers.value.find((p) => p.providerId === selectedProviderId.value) ??
      { providerId: selectedProviderId.value }
    if (!isSystemAiProvider(current)) {
      return undefined
    }
    const account = useAccountStore()
    if (!account.isLoggedIn) {
      account.openAuth('login')
      throw new Error('login_required')
    }
    return account.ensureAccess()
  }

  async function newConversation(): Promise<void> {
    error.value = null
    try {
      const res = await aiApi.createConversation({
        providerId: selectedProviderId.value || undefined,
        modelCode: selectedModelCode.value || undefined,
      })
      await refreshConversations()
      await openConversation(res.conversationId)
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function removeConversation(conversationId: string): Promise<void> {
    error.value = null
    const removingActive = activeConversationId.value === conversationId
    try {
      await aiApi.deleteConversation({ conversationId })
      droppedConversationIds.add(conversationId)
      const slot = sessions[conversationId]
      if (slot?.runId) {
        discardRun(slot.runId)
      } else if (slot?.cancelPending || slot?.sending || slot?.runStatus === 'running') {
        slot.cancelPending = true
      }
      delete sessions[conversationId]
      loadGen.delete(conversationId)
      if (removingActive) {
        activeConversationId.value = null
      }
      await refreshConversations()
      if (!activeConversationId.value && conversations.value.length) {
        await openConversation(conversations.value[0].conversationId)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function send(
    content: string,
    options?: {
      markers?: string
      context?: AiContextDraft
    },
  ): Promise<void> {
    const text = content.trim()
    const markers = options?.markers ?? ''
    const displayContent = `${markers}${text}`
    if (
      (!text && !markers.includes('⟦nm-img:') && !markers.includes('⟦nm-txt:')) ||
      !displayContent.trim() ||
      sending.value
    ) {
      return
    }
    ensureEventSubscription()
    error.value = null

    if (!activeConversationId.value) {
      await newConversation()
      if (!activeConversationId.value) {
        return
      }
    }

    const conversationId = activeConversationId.value
    const slot = sessionOf(conversationId)
    if (slot.runId) {
      closeRun(slot.runId)
    }
    const editId = slot.editingMessageId
    slot.cancelPending = false
    slot.runError = null
    slot.liveTools = []
    slot.previousAssistantContent = null
    slot.runId = null
    slot.sending = true
    slot.runStatus = 'running'
    slot.streamingText = ''

    if (editId) {
      const idx = slot.messages.findIndex((m) => m.messageId === editId)
      if (idx >= 0) {
        slot.messages = slot.messages.slice(0, idx)
        slot.toolHistory = []
      }
    }

    const optimisticId = `local-${Date.now()}`
    slot.messages.push({
      messageId: optimisticId,
      conversationId,
      messageRole: 'user',
      messageContent: displayContent,
      tokenCount: null,
      createdAt: new Date().toISOString(),
    })

    const providerId = selectedProviderId.value || undefined
    const modelCode = selectedModelCode.value || undefined
    const skillCode = selectedSkillCode.value || undefined

    try {
      const cloudAccessToken = await resolveCloudAccessToken()
      if (droppedConversationIds.has(conversationId) || !sessions[conversationId]) {
        return
      }
      const res = await aiApi.streamChat({
        conversationId,
        content: displayContent,
        providerId,
        modelCode,
        skillCode,
        editFromMessageId: editId || undefined,
        context: options?.context,
        cloudAccessToken,
      })
      const current = sessions[conversationId]
      if (current && !droppedConversationIds.has(conversationId)) {
        current.editingMessageId = null
        const idx = current.messages.findIndex((m) => m.messageId === optimisticId)
        if (idx >= 0) {
          current.messages[idx] = {
            ...current.messages[idx],
            messageId: res.userMessageId,
          }
        }
      }
      if (!adoptRun(conversationId, res.runId)) {
        return
      }
    } catch (e) {
      const current = sessions[conversationId]
      if (!current || droppedConversationIds.has(conversationId)) {
        return
      }
      current.sending = false
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'login_required') {
        current.runStatus = 'idle'
        current.messages = current.messages.filter((m) => m.messageId !== optimisticId)
        return
      }
      current.runStatus = 'error'
      current.runError = msg
      current.messages = current.messages.filter((m) => m.messageId !== optimisticId)
      if (activeConversationId.value === conversationId) {
        error.value = msg
      }
      if (editId) {
        await hydrateConversation(conversationId)
      }
    }
  }

  /** 重新生成某条助手回复（截断该消息及之后，不重复插入 user；附带当前工作区 Context）。 */
  async function regenerate(
    assistantMessageId: string,
    options?: { context?: AiContextDraft },
  ): Promise<void> {
    if (!assistantMessageId || sending.value || !activeConversationId.value) {
      return
    }
    ensureEventSubscription()
    error.value = null

    const conversationId = activeConversationId.value
    const slot = sessionOf(conversationId)
    const idx = slot.messages.findIndex((m) => m.messageId === assistantMessageId)
    if (idx < 0 || slot.messages[idx]?.messageRole !== 'assistant') {
      return
    }

    if (slot.runId) {
      closeRun(slot.runId)
    }
    slot.cancelPending = false
    slot.runError = null
    slot.previousAssistantContent = slot.messages[idx]?.messageContent ?? null
    slot.runId = null
    slot.sending = true
    slot.runStatus = 'running'
    slot.streamingText = ''
    slot.liveTools = []
    slot.messages = slot.messages.slice(0, idx)

    const pack = options?.context
      ? null
      : buildContextPack([])
    const context: AiContextDraft | undefined = options?.context ?? {
      workspace: pack!.workspace,
      attachments: pack!.attachments,
    }
    const providerId = selectedProviderId.value || undefined
    const modelCode = selectedModelCode.value || undefined
    const skillCode = selectedSkillCode.value || undefined

    try {
      const cloudAccessToken = await resolveCloudAccessToken()
      if (droppedConversationIds.has(conversationId) || !sessions[conversationId]) {
        return
      }
      const res = await aiApi.streamChat({
        conversationId,
        regenerateFromMessageId: assistantMessageId,
        providerId,
        modelCode,
        skillCode,
        context,
        cloudAccessToken,
      })
      if (!adoptRun(conversationId, res.runId)) {
        const current = sessions[conversationId]
        if (current) {
          current.previousAssistantContent = null
        }
        return
      }
    } catch (e) {
      const current = sessions[conversationId]
      if (!current || droppedConversationIds.has(conversationId)) {
        return
      }
      current.sending = false
      current.runStatus = 'error'
      current.runError = e instanceof Error ? e.message : String(e)
      current.previousAssistantContent = null
      if (activeConversationId.value === conversationId) {
        error.value = current.runError
      }
      await hydrateConversation(conversationId)
    }
  }

  /** 将用户消息填入输入框并标记为编辑重发。 */
  function editUserMessage(messageId: string, content: string): void {
    const slot = activeLive.value
    if (!slot) {
      return
    }
    slot.editingMessageId = messageId
    composerDraft.value = content
  }

  function cancelEdit(): void {
    const slot = activeLive.value
    if (!slot) {
      return
    }
    slot.editingMessageId = null
  }

  /** askSelection：把附件排入 Composer。 */
  function queueComposerAttachments(items: AiContextAttachment[]): void {
    if (!items.length) {
      return
    }
    pendingComposerAttachments.value = [...pendingComposerAttachments.value, ...items]
  }

  function takePendingComposerAttachments(): AiContextAttachment[] {
    const items = pendingComposerAttachments.value
    pendingComposerAttachments.value = []
    return items
  }

  /** 从某条用户消息开新对话分支（附带前置历史摘要作为 @ 引用）。 */
  async function branchFrom(messageId: string): Promise<void> {
    const idx = messages.value.findIndex((m) => m.messageId === messageId)
    const msg = idx >= 0 ? messages.value[idx] : null
    if (!msg || msg.messageRole !== 'user') {
      return
    }
    const { text: userText } = extractAttachmentMarkers(msg.messageContent)
    const prior = messages.value.slice(0, idx)
    const historyLines: string[] = []
    for (const m of prior.slice(-12)) {
      if (m.messageRole !== 'user' && m.messageRole !== 'assistant') {
        continue
      }
      const role = m.messageRole === 'user' ? 'User' : 'Assistant'
      const body = extractAttachmentMarkers(m.messageContent).text.trim().slice(0, 600)
      if (body) {
        historyLines.push(`[${role}] ${body}`)
      }
    }
    await newConversation()
    composerDraft.value = userText.trim() || msg.messageContent
    if (historyLines.length) {
      queueComposerAttachments([
        {
          id: `branch-hist:${messageId}`,
          kind: 'diagnostic',
          label: '分支上文',
          detail: `${historyLines.length} turns`,
          payload: { text: historyLines.join('\n\n').slice(0, 4000), kind: 'branch_history' },
        },
      ])
    }
  }

  /** 重命名当前或指定会话标题。 */
  async function renameConversation(conversationId: string, title: string): Promise<void> {
    const trimmed = title.trim()
    if (!conversationId || !trimmed) {
      return
    }
    error.value = null
    try {
      const res = await aiApi.updateConversation({ conversationId, title: trimmed })
      const hit = conversations.value.find((c) => c.conversationId === conversationId)
      if (hit) {
        hit.conversationTitle = res.title || trimmed
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  /** 导出当前会话为 Markdown 文本（助手消息剥离思考块）。 */
  function exportConversationMarkdown(): string {
    if (!messages.value.length) {
      return ''
    }
    const lines: string[] = []
    const title = activeConversation.value?.conversationTitle?.trim() || 'AI Chat'
    lines.push(`# ${title}`, '')
    for (const m of messages.value) {
      if (m.messageRole === 'tool' || m.messageRole === 'system') {
        continue
      }
      const role =
        m.messageRole === 'user' ? 'User' : m.messageRole === 'assistant' ? 'Assistant' : String(m.messageRole)
      let body = m.messageContent.trim()
      if (m.messageRole === 'assistant' && body) {
        body = body
          .replace(/<\s*(?:think|thinking)\s*>[\s\S]*?<\s*\/\s*(?:think|thinking)\s*>/gi, '')
          .replace(/<\s*(?:think|thinking)\s*>[\s\S]*$/gi, '')
          .trim()
      }
      if (!body) {
        continue
      }
      lines.push(`## ${role}`, '', body, '', '---', '')
    }
    while (lines.length && (lines[lines.length - 1] === '' || lines[lines.length - 1] === '---')) {
      lines.pop()
    }
    lines.push('')
    return lines.join('\n')
  }

  async function stop(): Promise<void> {
    const slot = activeLive.value
    if (!slot) {
      return
    }
    const id = slot.runId
    if (!id) {
      if (slot.sending || slot.runStatus === 'running') {
        slot.cancelPending = true
      }
      return
    }
    try {
      await aiApi.cancelChat({ runId: id })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function confirmTool(
    invocationId: string,
    decision: 'approve' | 'reject',
    scope: 'once' | 'run' | 'conversation' = 'once',
  ): Promise<void> {
    try {
      await aiApi.confirmPolicy({
        invocationId,
        decision,
        scope: decision === 'approve' ? scope : 'once',
      })
      const slot = activeLive.value
      const hit =
        slot?.liveTools.find((t) => t.invocationId === invocationId) ||
        slot?.toolHistory.find((t) => t.invocationId === invocationId)
      if (hit && decision === 'reject') {
        hit.status = 'error'
        hit.error = 'rejected'
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  return {
    conversations,
    activeConversationId,
    activeConversation,
    messages,
    providers,
    skills,
    selectedProviderId,
    selectedModelCode,
    selectedSkillCode,
    modelOptions,
    runId,
    streamingText,
    runStatus,
    runError,
    loading,
    sending,
    isStreaming,
    error,
    liveTools,
    toolHistory,
    displayTools,
    previousAssistantContent,
    composerDraft,
    editingMessageId,
    busyConversationIds,
    pendingComposerAttachments,
    bootstrap,
    refreshProviders,
    refreshSkills,
    refreshConversations,
    openConversation,
    newConversation,
    removeConversation,
    send,
    stop,
    regenerate,
    editUserMessage,
    cancelEdit,
    queueComposerAttachments,
    takePendingComposerAttachments,
    branchFrom,
    renameConversation,
    exportConversationMarkdown,
    confirmTool,
  }
})
