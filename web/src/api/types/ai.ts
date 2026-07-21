/**
 * AI 助手 Bridge 类型（platform.ai.*）。
 *
 * 设计见 docs/24-ai-assistant.md；密钥明文仅在写入请求中短暂出现，列表回包只用 hasApiKey。
 */

export type AiProviderKind = 'openai' | 'anthropic' | 'azure_openai' | 'ollama' | 'custom'

export type AiRecordStatus = 'active' | 'disabled'

/** LLM Provider（不含 API Key 明文）。 */
export interface AiProvider {
  providerId: string
  providerName: string
  providerKind: AiProviderKind
  baseUrl: string
  hasApiKey: boolean
  defaultModelCode: string
  providerOptions: Record<string, unknown> | string
  recordStatus: AiRecordStatus
  sortOrder: number
  rowVersion: number
  createdAt: string
  updatedAt: string
  models?: AiModel[]
}

/** Provider 下的模型条目。 */
export interface AiModel {
  modelId: string
  providerId: string
  modelCode: string
  modelLabel: string
  contextWindow: number | null
  maxOutputTokens: number | null
  modelOptions: Record<string, unknown> | string
  recordStatus: AiRecordStatus
  sortOrder: number
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export interface AiProviderListParams {
  status?: string
  includeModels?: boolean
}

export interface AiProviderListResult {
  providers: AiProvider[]
}

export interface AiProviderGetParams {
  providerId: string
}

export interface AiProviderGetResult {
  provider: AiProvider | null
}

export interface AiProviderGetApiKeyParams {
  providerId: string
}

/** 编辑回填用；仅本地 IPC，列表接口仍不返回明文。 */
export interface AiProviderGetApiKeyResult {
  found: boolean
  apiKey: string
}

/** upsert 时的业务字段；apiKey 为空表示不改动既有密钥。 */
export interface AiProviderUpsertFields {
  providerName: string
  providerKind: AiProviderKind
  baseUrl?: string
  defaultModelCode?: string
  providerOptions?: Record<string, unknown>
  recordStatus?: AiRecordStatus
  sortOrder?: number
  apiKey?: string
}

export interface AiProviderUpsertParams {
  providerId?: string
  provider: AiProviderUpsertFields
  rowVersion?: number
}

export interface AiProviderUpsertResult {
  providerId: string
  rowVersion: number
}

export interface AiProviderDeleteParams {
  providerId: string
}

export interface AiProviderDeleteResult {
  deleted: boolean
}

/** 连通探测 / 拉取远程模型：可传未保存的表单字段；已保存时可用 providerId 取 Vault 密钥。 */
export interface AiProviderProbeParams {
  providerId?: string
  baseUrl?: string
  providerKind?: string
  apiKey?: string
}

export interface AiProviderTestResult {
  ok: boolean
  latencyMs: number
  modelCount: number
  endpoint: string
  message: string
}

export interface AiRemoteModel {
  id: string
}

export interface AiProviderListRemoteModelsResult {
  models: AiRemoteModel[]
  endpoint: string
}

export interface AiModelListParams {
  providerId?: string
}

export interface AiModelListResult {
  models: AiModel[]
}

export interface AiModelUpsertFields {
  providerId: string
  modelCode: string
  modelLabel?: string
  contextWindow?: number | null
  maxOutputTokens?: number | null
  modelOptions?: Record<string, unknown>
  recordStatus?: AiRecordStatus
  sortOrder?: number
}

export interface AiModelUpsertParams {
  modelId?: string
  model: AiModelUpsertFields
  rowVersion?: number
}

export interface AiModelUpsertResult {
  modelId: string
  rowVersion: number
}

export interface AiModelDeleteParams {
  modelId: string
}

export interface AiModelDeleteResult {
  deleted: boolean
}

/** 对话会话（不含消息正文）。 */
export interface AiConversation {
  conversationId: string
  workspaceId: string
  conversationTitle: string
  providerId: string
  modelCode: string
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export type AiMessageRole = 'user' | 'assistant' | 'system' | 'tool'

/** 会话内一条消息。 */
export interface AiMessage {
  messageId: string
  conversationId: string
  messageRole: AiMessageRole | string
  messageContent: string
  toolCallId?: string
  tokenCount: number | null
  createdAt: string
}

export interface AiConversationListParams {
  limit?: number
}

export interface AiConversationListResult {
  conversations: AiConversation[]
}

export interface AiConversationGetParams {
  conversationId: string
}

/** 会话内工具调用流水（conversation.get 回放）。 */
export interface AiToolInvocationRecord {
  invocationId: string
  conversationId: string
  runId: string
  toolName: string
  argsSummary?: string
  risk?: AiToolRiskLevel | string
  status: AiLiveToolStatus | string
  resultSummary?: string
  error?: string
  createdAt: string
}

export interface AiConversationGetResult {
  conversation: AiConversation | null
  messages: AiMessage[]
  toolInvocations?: AiToolInvocationRecord[]
}

export interface AiConversationCreateParams {
  title?: string
  providerId?: string
  modelCode?: string
}

export interface AiConversationCreateResult {
  conversationId: string
}

export interface AiConversationDeleteParams {
  conversationId: string
}

export interface AiConversationDeleteResult {
  deleted: boolean
}

export interface AiConversationUpdateParams {
  conversationId: string
  title: string
}

export interface AiConversationUpdateResult {
  ok: boolean
  title: string
}

/** Context Pack 草稿（Web 采集；Orchestrator Normalize 后再入模）。见 docs/24 §15.2 */
export type AiContextAttachmentKind = 'tab' | 'selection' | 'connection' | 'diagnostic' | 'schema'

export interface AiContextAttachmentDraft {
  id: string
  kind: AiContextAttachmentKind
  label: string
  detail?: string
  payload?: Record<string, unknown>
}

export interface AiContextDraft {
  workspace?: {
    tabId?: string
    moduleId?: string
    profileId?: string
    sessionId?: string
    title?: string
    database?: string
    schema?: string
    dialectFamily?: string
    capabilities?: string[]
    dialectRules?: string
  }
  attachments?: AiContextAttachmentDraft[]
}

export interface AiChatStreamParams {
  conversationId: string
  content?: string
  providerId?: string
  modelCode?: string
  /** 可选 Skill 标识，装配提示词模板。 */
  skillCode?: string
  /** 重新生成：删除该 assistant 及之后消息，基于前置 user 重跑。 */
  regenerateFromMessageId?: string
  /** 编辑重发：删除该 user 及之后消息，以 content 作为新用户消息重跑。 */
  editFromMessageId?: string
  /** 工作区上下文草稿；后端须校验/截断/脱敏，不得仅信任前端附录。 */
  context?: AiContextDraft
}

export interface AiChatStreamResult {
  runId: string
  conversationId: string
  userMessageId: string
}

export interface AiChatCancelParams {
  runId: string
}

export interface AiChatCancelResult {
  cancelled: boolean
}

export type AiLiveToolStatus = 'running' | 'ok' | 'error' | 'pending'

export type AiToolRiskLevel = 'read' | 'write' | 'dangerous'

export interface AiLiveToolInvocation {
  invocationId: string
  toolName: string
  status: AiLiveToolStatus
  argsSummary?: string
  resultSummary?: string
  error?: string
  risk?: AiToolRiskLevel | string
  /** 用于挂到对应助手轮次（conversation.get 回放或直播推入时写入）。 */
  createdAt?: string
  runId?: string
}

/** Bridge 推送的 AI 事件（platform.ai.*）。 */
export type AiBridgeEvent =
  | {
      type: 'platform.ai.token'
      runId: string
      conversationId: string
      delta: string
    }
  | {
      type: 'platform.ai.message'
      runId: string
      conversationId: string
      messageId: string
      role: string
      content?: string
    }
  | {
      type: 'platform.ai.run.status'
      runId: string
      conversationId?: string
      status: 'running' | 'done' | 'cancelled' | 'error' | string
      error?: string
    }
  | {
      type: 'platform.ai.tool.start'
      runId: string
      invocationId: string
      toolName: string
      argsSummary?: string
      risk?: AiToolRiskLevel | string
    }
  | {
      type: 'platform.ai.tool.result'
      runId: string
      invocationId: string
      ok: boolean
      resultSummary?: string
      error?: string
    }
  | {
      type: 'platform.ai.tool.pending'
      runId: string
      invocationId: string
      toolName?: string
      argsSummary?: string
      risk?: AiToolRiskLevel | string
    }

/** MCP Server / Tool（Settings ai-mcp） */
export type AiMcpTransportKind = 'stdio' | 'sse' | 'streamable_http'

export interface AiMcpTool {
  toolId: string
  serverId: string
  toolName: string
  toolTitle?: string
  toolDescription?: string
  inputSchema: string
  enabled: boolean
  riskLevel?: AiToolRiskLevel | string
  discoveredAt: string
}

export interface AiMcpServer {
  serverId: string
  serverName: string
  transportKind: AiMcpTransportKind | string
  endpointUrl?: string
  commandPath?: string
  launchOptions: string
  hasCredential: boolean
  recordStatus: string
  sortOrder: number
  rowVersion: number
  createdAt: string
  updatedAt: string
  tools?: AiMcpTool[]
}

export interface AiMcpListParams {
  status?: string
  withTools?: boolean
}

export interface AiMcpListResult {
  servers: AiMcpServer[]
}

export interface AiMcpGetParams {
  serverId: string
}

export interface AiMcpGetResult {
  server: AiMcpServer | null
}

export interface AiMcpUpsertParams {
  serverId?: string
  serverName: string
  transportKind: AiMcpTransportKind | string
  endpointUrl?: string
  commandPath?: string
  launchOptions?: string
  recordStatus?: string
  sortOrder?: number
  rowVersion?: number
  bearerToken?: string
  clearToken?: boolean
}

export interface AiMcpUpsertResult {
  server: AiMcpServer
}

export interface AiMcpDeleteParams {
  serverId: string
}

export interface AiMcpDeleteResult {
  deleted: boolean
}

export interface AiMcpRefreshParams {
  serverId: string
}

export interface AiMcpRefreshResult {
  server: AiMcpServer
}

export interface AiMcpSetToolEnabledParams {
  toolId: string
  enabled: boolean
}

export interface AiMcpSetToolEnabledResult {
  ok: boolean
}

export interface AiMcpSetToolRiskParams {
  toolId: string
  riskLevel: AiToolRiskLevel | string
}

export interface AiMcpSetToolRiskResult {
  ok: boolean
}

export interface AiPolicyConfirmParams {
  invocationId: string
  decision: 'approve' | 'reject'
}

export interface AiPolicyConfirmResult {
  ok: boolean
}

export interface AiPolicyListPendingParams {
  runId?: string
}

export interface AiPolicyListPendingResult {
  invocationIds: string[]
}

/** AI Skill（Settings ai-skills） */
export interface AiSkill {
  skillId: string
  skillCode: string
  skillName: string
  skillScope?: string
  promptTemplate: string
  paramSchema: string
  skillOptions: string
  recordStatus: AiRecordStatus | string
  sortOrder: number
  rowVersion: number
  createdAt: string
  updatedAt: string
}

export interface AiSkillListParams {
  status?: string
}

export interface AiSkillListResult {
  skills: AiSkill[]
}

export interface AiSkillGetParams {
  skillId: string
}

export interface AiSkillGetResult {
  skill: AiSkill | null
}

export interface AiSkillUpsertParams {
  skillId?: string
  skillCode: string
  skillName: string
  skillScope?: string
  promptTemplate: string
  paramSchema?: string
  skillOptions?: string
  recordStatus?: AiRecordStatus | string
  sortOrder?: number
  rowVersion?: number
}

export interface AiSkillUpsertResult {
  skill: AiSkill
}

export interface AiSkillDeleteParams {
  skillId: string
}

export interface AiSkillDeleteResult {
  deleted: boolean
}
