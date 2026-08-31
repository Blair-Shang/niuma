import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
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
import {
  ensureSystemAiProvider,
  isSystemAiProvider,
  SYSTEM_AI_PROVIDER_ID,
} from '@/shell/panels/ai/system-provider'

/**
 * AI 对话状态 — 会话列表、消息、流式缓冲与 run 生命周期。
 *
 * 面板开关仍由 useShellStore.aiPanelOpen 控制；本 store 只管对话数据。
 */
export const useAiStore = defineStore('ai', () => {
  const conversations = ref<AiConversation[]>([])
  const activeConversationId = ref<string | null>(null)
  const messages = ref<AiMessage[]>([])
  const providers = ref<AiProvider[]>([])
  const skills = ref<AiSkill[]>([])
  const selectedProviderId = ref<string>('')
  const selectedModelCode = ref<string>('')
  const selectedSkillCode = ref<string>('')

  const runId = ref<string | null>(null)
  const streamingText = ref('')
  const runStatus = ref<'idle' | 'running' | 'done' | 'cancelled' | 'error'>('idle')
  const runError = ref<string | null>(null)
  const loading = ref(false)
  const sending = ref(false)
  const error = ref<string | null>(null)
  /** 历史工具调用（conversation.get）；流式进行中与 liveTools 合并展示。 */
  const toolHistory = ref<AiLiveToolInvocation[]>([])
  /** 进行中的工具调用（Bridge 事件驱动）。 */
  const liveTools = ref<AiLiveToolInvocation[]>([])
  /** 重新生成前保留的上一版助手正文（对比用）。 */
  const previousAssistantContent = ref<string | null>(null)
  /** 编辑重发：目标 user messageId。 */
  const editingMessageId = ref<string | null>(null)
  /** askSelection / 外部注入的待挂 @ 附件。 */
  const pendingComposerAttachments = ref<AiContextAttachment[]>([])
  /** 将用户消息填入输入框。 */
  const composerDraft = ref('')

  const isStreaming = computed(() => runStatus.value === 'running')

  const activeConversation = computed(() =>
    conversations.value.find((c) => c.conversationId === activeConversationId.value) ?? null,
  )

  const modelOptions = computed(() => {
    const p = providers.value.find((x) => x.providerId === selectedProviderId.value)
    return p?.models ?? []
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

  function mapInvocationStatus(status: string): AiLiveToolStatus {
    if (status === 'pending') return 'pending'
    if (status === 'running') return 'running'
    if (status === 'ok' || status === 'done' || status === 'success') return 'ok'
    return 'error'
  }

  function mapToolInvocations(
    records: AiToolInvocationRecord[] | undefined,
    confirmableIds?: Set<string>,
  ): AiLiveToolInvocation[] {
    return (records ?? []).map((r) => {
      let status = mapInvocationStatus(String(r.status))
      if (status === 'pending' && confirmableIds && !confirmableIds.has(r.invocationId)) {
        status = 'error'
      }
      return {
        invocationId: r.invocationId,
        toolName: r.toolName,
        status,
        argsSummary: r.argsSummary,
        resultSummary: r.resultSummary,
        error: status === 'error' && !r.error && r.status === 'pending' ? 'stale pending' : r.error,
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
    if (ev.type === 'platform.ai.token') {
      if (runId.value && ev.runId !== runId.value) {
        return
      }
      streamingText.value += ev.delta ?? ''
      return
    }
    if (ev.type === 'platform.ai.message') {
      if (ev.conversationId && activeConversationId.value && ev.conversationId !== activeConversationId.value) {
        return
      }
      if (ev.role === 'assistant' && ev.content != null) {
        streamingText.value = ''
        const exists = messages.value.some((m) => m.messageId === ev.messageId)
        if (!exists) {
          messages.value.push({
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
      if (runId.value && ev.runId !== runId.value) {
        return
      }
      const existing = liveTools.value.find((t) => t.invocationId === ev.invocationId)
      if (existing) {
        existing.status = 'running'
        existing.toolName = ev.toolName
        existing.argsSummary = ev.argsSummary
        if (ev.risk) existing.risk = ev.risk
        return
      }
      liveTools.value.push({
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
      if (runId.value && ev.runId !== runId.value) {
        return
      }
      const existing = liveTools.value.find((t) => t.invocationId === ev.invocationId)
      if (existing) {
        existing.status = 'pending'
        existing.toolName = ev.toolName || existing.toolName
        existing.argsSummary = ev.argsSummary
        existing.risk = ev.risk
        return
      }
      liveTools.value.push({
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
      if (runId.value && ev.runId !== runId.value) {
        return
      }
      const hit = liveTools.value.find((t) => t.invocationId === ev.invocationId)
      if (hit) {
        hit.status = ev.ok ? 'ok' : 'error'
        hit.resultSummary = ev.resultSummary
        hit.error = ev.error
      }
      return
    }
    if (ev.type === 'platform.ai.run.status') {
      if (runId.value && ev.runId !== runId.value) {
        return
      }
      if (ev.status === 'running') {
        runStatus.value = 'running'
        runError.value = null
        return
      }
      if (ev.status === 'done') {
        runStatus.value = 'done'
        sending.value = false
        runId.value = null
        streamingText.value = ''
        previousAssistantContent.value = null
        editingMessageId.value = null
        void refreshConversations()
        if (activeConversationId.value) {
          void reloadToolHistory(activeConversationId.value)
        }
        liveTools.value = []
        return
      }
      if (ev.status === 'cancelled') {
        runStatus.value = 'cancelled'
        sending.value = false
        runId.value = null
        liveTools.value = liveTools.value.map((t) =>
          t.status === 'running' || t.status === 'pending'
            ? { ...t, status: 'error', error: 'cancelled' }
            : t,
        )
        if (activeConversationId.value) {
          void reloadToolHistory(activeConversationId.value)
        }
        return
      }
      if (ev.status === 'error') {
        runStatus.value = 'error'
        runError.value = ev.error ?? 'unknown error'
        sending.value = false
        runId.value = null
        streamingText.value = ''
        liveTools.value = liveTools.value.map((t) =>
          t.status === 'running' || t.status === 'pending'
            ? { ...t, status: 'error', error: runError.value ?? undefined }
            : t,
        )
        if (activeConversationId.value) {
          void reloadToolHistory(activeConversationId.value)
        }
        return
      }
    }
  }

  async function reloadToolHistory(conversationId: string): Promise<void> {
    try {
      const [res, pending] = await Promise.all([
        aiApi.getConversation({ conversationId }),
        aiApi.listPendingPolicy().catch(() => ({ invocationIds: [] as string[] })),
      ])
      if (activeConversationId.value !== conversationId) {
        return
      }
      const confirmable = new Set(pending.invocationIds ?? [])
      toolHistory.value = mapToolInvocations(res.toolInvocations, confirmable)
    } catch {
      // ignore reload errors
    }
  }

  async function refreshProviders(): Promise<void> {
    const res = await aiApi.listProviders({ includeModels: true, status: 'active' })
    providers.value = res.providers ?? []
    if (!selectedProviderId.value && providers.value.length) {
      const system = providers.value.find((p) => p.providerId === SYSTEM_AI_PROVIDER_ID && p.recordStatus !== 'disabled')
      const first = system ?? providers.value[0]
      selectedProviderId.value = first.providerId
      selectedModelCode.value = first.defaultModelCode || first.models?.[0]?.modelCode || ''
    }
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
        await reloadToolHistory(activeConversationId.value)
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  async function openConversation(conversationId: string): Promise<void> {
    loading.value = true
    error.value = null
    liveTools.value = []
    editingMessageId.value = null
    try {
      const [res, pending] = await Promise.all([
        aiApi.getConversation({ conversationId }),
        aiApi.listPendingPolicy().catch(() => ({ invocationIds: [] as string[] })),
      ])
      activeConversationId.value = conversationId
      messages.value = (res.messages ?? []).filter((m) => m.messageRole !== 'tool')
      const confirmable = new Set(pending.invocationIds ?? [])
      toolHistory.value = mapToolInvocations(res.toolInvocations, confirmable)
      if (res.conversation?.providerId) {
        selectedProviderId.value = res.conversation.providerId
      }
      if (res.conversation?.modelCode) {
        selectedModelCode.value = res.conversation.modelCode
      }
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
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
    try {
      await aiApi.deleteConversation({ conversationId })
      if (activeConversationId.value === conversationId) {
        activeConversationId.value = null
        messages.value = []
        toolHistory.value = []
        liveTools.value = []
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
    runError.value = null
    liveTools.value = []
    previousAssistantContent.value = null

    if (!activeConversationId.value) {
      await newConversation()
      if (!activeConversationId.value) {
        return
      }
    }

    const editId = editingMessageId.value
    sending.value = true
    runStatus.value = 'running'
    streamingText.value = ''

    if (editId) {
      const idx = messages.value.findIndex((m) => m.messageId === editId)
      if (idx >= 0) {
        messages.value = messages.value.slice(0, idx)
        toolHistory.value = []
      }
    }

    const optimisticId = `local-${Date.now()}`
    messages.value.push({
      messageId: optimisticId,
      conversationId: activeConversationId.value,
      messageRole: 'user',
      messageContent: displayContent,
      tokenCount: null,
      createdAt: new Date().toISOString(),
    })

    try {
      const cloudAccessToken = await resolveCloudAccessToken()
      const res = await aiApi.streamChat({
        conversationId: activeConversationId.value,
        content: displayContent,
        providerId: selectedProviderId.value || undefined,
        modelCode: selectedModelCode.value || undefined,
        skillCode: selectedSkillCode.value || undefined,
        editFromMessageId: editId || undefined,
        context: options?.context,
        cloudAccessToken,
      })
      runId.value = res.runId
      editingMessageId.value = null
      const idx = messages.value.findIndex((m) => m.messageId === optimisticId)
      if (idx >= 0) {
        messages.value[idx] = {
          ...messages.value[idx],
          messageId: res.userMessageId,
        }
      }
    } catch (e) {
      sending.value = false
      runStatus.value = 'error'
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === 'login_required') {
        sending.value = false
        runStatus.value = 'idle'
        messages.value = messages.value.filter((m) => m.messageId !== optimisticId)
        return
      }
      runError.value = msg
      error.value = runError.value
      messages.value = messages.value.filter((m) => m.messageId !== optimisticId)
      if (editId && activeConversationId.value) {
        await openConversation(activeConversationId.value)
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
    runError.value = null

    const idx = messages.value.findIndex((m) => m.messageId === assistantMessageId)
    if (idx < 0 || messages.value[idx]?.messageRole !== 'assistant') {
      return
    }

    previousAssistantContent.value = messages.value[idx]?.messageContent ?? null
    sending.value = true
    runStatus.value = 'running'
    streamingText.value = ''
    liveTools.value = []
    messages.value = messages.value.slice(0, idx)

    const pack = options?.context
      ? null
      : buildContextPack([])
    const context: AiContextDraft | undefined = options?.context ?? {
      workspace: pack!.workspace,
      attachments: pack!.attachments,
    }

    try {
      const cloudAccessToken = await resolveCloudAccessToken()
      const res = await aiApi.streamChat({
        conversationId: activeConversationId.value,
        regenerateFromMessageId: assistantMessageId,
        providerId: selectedProviderId.value || undefined,
        modelCode: selectedModelCode.value || undefined,
        skillCode: selectedSkillCode.value || undefined,
        context,
        cloudAccessToken,
      })
      runId.value = res.runId
    } catch (e) {
      sending.value = false
      runStatus.value = 'error'
      runError.value = e instanceof Error ? e.message : String(e)
      error.value = runError.value
      previousAssistantContent.value = null
      await openConversation(activeConversationId.value)
    }
  }

  /** 将用户消息填入输入框并标记为编辑重发。 */
  function editUserMessage(messageId: string, content: string): void {
    editingMessageId.value = messageId
    composerDraft.value = content
  }

  function cancelEdit(): void {
    editingMessageId.value = null
  }

  /** askSelection：把附件排入 Composer。 */
  function queueComposerAttachments(items: AiContextAttachment[]): void {
    if (!items.length) {
      return
    }
    pendingComposerAttachments.value = [...items]
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
    if (!runId.value) {
      return
    }
    try {
      await aiApi.cancelChat({ runId: runId.value })
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    }
  }

  async function confirmTool(invocationId: string, decision: 'approve' | 'reject'): Promise<void> {
    try {
      await aiApi.confirmPolicy({ invocationId, decision })
      const hit =
        liveTools.value.find((t) => t.invocationId === invocationId) ||
        toolHistory.value.find((t) => t.invocationId === invocationId)
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
