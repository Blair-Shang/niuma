import { bridgeInvoke } from '@/api/client'
import type {
  AiChatCancelParams,
  AiChatCancelResult,
  AiChatStreamParams,
  AiChatStreamResult,
  AiConversationCreateParams,
  AiConversationCreateResult,
  AiConversationDeleteParams,
  AiConversationDeleteResult,
  AiConversationGetParams,
  AiConversationGetResult,
  AiConversationListParams,
  AiConversationListResult,
  AiConversationUpdateParams,
  AiConversationUpdateResult,
  AiModelDeleteParams,
  AiModelDeleteResult,
  AiModelListParams,
  AiModelListResult,
  AiModelUpsertParams,
  AiModelUpsertResult,
  AiMcpDeleteParams,
  AiMcpDeleteResult,
  AiMcpGetParams,
  AiMcpGetResult,
  AiMcpListParams,
  AiMcpListResult,
  AiMcpRefreshParams,
  AiMcpRefreshResult,
  AiMcpSetToolEnabledParams,
  AiMcpSetToolEnabledResult,
  AiMcpSetToolRiskParams,
  AiMcpSetToolRiskResult,
  AiMcpUpsertParams,
  AiMcpUpsertResult,
  AiPolicyConfirmParams,
  AiPolicyConfirmResult,
  AiPolicyListPendingParams,
  AiPolicyListPendingResult,
  AiSkillDeleteParams,
  AiSkillDeleteResult,
  AiSkillExportPackParams,
  AiSkillExportPackResult,
  AiSkillGetParams,
  AiSkillGetResult,
  AiSkillInstallPackParams,
  AiSkillInstallPackResult,
  AiSkillListParams,
  AiSkillListResult,
  AiSkillUpsertParams,
  AiSkillUpsertResult,
  AiProviderDeleteParams,
  AiProviderDeleteResult,
  AiProviderGetParams,
  AiProviderGetResult,
  AiProviderGetApiKeyParams,
  AiProviderGetApiKeyResult,
  AiProviderListParams,
  AiProviderListResult,
  AiProviderListRemoteModelsResult,
  AiProviderProbeParams,
  AiProviderTestResult,
  AiProviderUpsertParams,
  AiProviderUpsertResult,
} from '@/api/types/ai'

/**
 * AI 助手 Bridge API（配置 + 对话）。
 *
 * - Provider/Model：全局设置侧边栏
 * - Conversation/Chat：AiPanel 使用面
 */
export const aiApi = {
  listProviders(params: AiProviderListParams = {}): Promise<AiProviderListResult> {
    return bridgeInvoke<AiProviderListResult>('platform.ai.provider.list', params)
  },

  getProvider(params: AiProviderGetParams): Promise<AiProviderGetResult> {
    return bridgeInvoke<AiProviderGetResult>('platform.ai.provider.get', params)
  },

  getProviderApiKey(params: AiProviderGetApiKeyParams): Promise<AiProviderGetApiKeyResult> {
    return bridgeInvoke<AiProviderGetApiKeyResult>('platform.ai.provider.getApiKey', params)
  },

  upsertProvider(params: AiProviderUpsertParams): Promise<AiProviderUpsertResult> {
    return bridgeInvoke<AiProviderUpsertResult>('platform.ai.provider.upsert', params)
  },

  deleteProvider(params: AiProviderDeleteParams): Promise<AiProviderDeleteResult> {
    return bridgeInvoke<AiProviderDeleteResult>('platform.ai.provider.delete', params)
  },

  testProvider(params: AiProviderProbeParams): Promise<AiProviderTestResult> {
    return bridgeInvoke<AiProviderTestResult>('platform.ai.provider.test', params)
  },

  listRemoteModels(params: AiProviderProbeParams): Promise<AiProviderListRemoteModelsResult> {
    return bridgeInvoke<AiProviderListRemoteModelsResult>(
      'platform.ai.provider.listRemoteModels',
      params,
    )
  },

  listModels(params: AiModelListParams = {}): Promise<AiModelListResult> {
    return bridgeInvoke<AiModelListResult>('platform.ai.model.list', params)
  },

  upsertModel(params: AiModelUpsertParams): Promise<AiModelUpsertResult> {
    return bridgeInvoke<AiModelUpsertResult>('platform.ai.model.upsert', params)
  },

  deleteModel(params: AiModelDeleteParams): Promise<AiModelDeleteResult> {
    return bridgeInvoke<AiModelDeleteResult>('platform.ai.model.delete', params)
  },

  listConversations(params: AiConversationListParams = {}): Promise<AiConversationListResult> {
    return bridgeInvoke<AiConversationListResult>('platform.ai.conversation.list', params)
  },

  getConversation(params: AiConversationGetParams): Promise<AiConversationGetResult> {
    return bridgeInvoke<AiConversationGetResult>('platform.ai.conversation.get', params)
  },

  createConversation(params: AiConversationCreateParams = {}): Promise<AiConversationCreateResult> {
    return bridgeInvoke<AiConversationCreateResult>('platform.ai.conversation.create', params)
  },

  deleteConversation(params: AiConversationDeleteParams): Promise<AiConversationDeleteResult> {
    return bridgeInvoke<AiConversationDeleteResult>('platform.ai.conversation.delete', params)
  },

  updateConversation(params: AiConversationUpdateParams): Promise<AiConversationUpdateResult> {
    return bridgeInvoke<AiConversationUpdateResult>('platform.ai.conversation.update', params)
  },

  streamChat(params: AiChatStreamParams): Promise<AiChatStreamResult> {
    return bridgeInvoke<AiChatStreamResult>('platform.ai.chat.stream', params)
  },

  cancelChat(params: AiChatCancelParams): Promise<AiChatCancelResult> {
    return bridgeInvoke<AiChatCancelResult>('platform.ai.chat.cancel', params)
  },

  listMcpServers(params: AiMcpListParams = {}): Promise<AiMcpListResult> {
    return bridgeInvoke<AiMcpListResult>('platform.ai.mcp.list', params)
  },

  getMcpServer(params: AiMcpGetParams): Promise<AiMcpGetResult> {
    return bridgeInvoke<AiMcpGetResult>('platform.ai.mcp.get', params)
  },

  upsertMcpServer(params: AiMcpUpsertParams): Promise<AiMcpUpsertResult> {
    return bridgeInvoke<AiMcpUpsertResult>('platform.ai.mcp.upsert', params)
  },

  deleteMcpServer(params: AiMcpDeleteParams): Promise<AiMcpDeleteResult> {
    return bridgeInvoke<AiMcpDeleteResult>('platform.ai.mcp.delete', params)
  },

  refreshMcpTools(params: AiMcpRefreshParams): Promise<AiMcpRefreshResult> {
    return bridgeInvoke<AiMcpRefreshResult>('platform.ai.mcp.refresh', params)
  },

  setMcpToolEnabled(params: AiMcpSetToolEnabledParams): Promise<AiMcpSetToolEnabledResult> {
    return bridgeInvoke<AiMcpSetToolEnabledResult>('platform.ai.mcp.setToolEnabled', params)
  },

  setMcpToolRisk(params: AiMcpSetToolRiskParams): Promise<AiMcpSetToolRiskResult> {
    return bridgeInvoke<AiMcpSetToolRiskResult>('platform.ai.mcp.setToolRisk', params)
  },

  confirmPolicy(params: AiPolicyConfirmParams): Promise<AiPolicyConfirmResult> {
    return bridgeInvoke<AiPolicyConfirmResult>('platform.ai.policy.confirm', params)
  },

  listPendingPolicy(params: AiPolicyListPendingParams = {}): Promise<AiPolicyListPendingResult> {
    return bridgeInvoke<AiPolicyListPendingResult>('platform.ai.policy.listPending', params)
  },

  listSkills(params: AiSkillListParams = {}): Promise<AiSkillListResult> {
    return bridgeInvoke<AiSkillListResult>('platform.ai.skill.list', params)
  },

  getSkill(params: AiSkillGetParams): Promise<AiSkillGetResult> {
    return bridgeInvoke<AiSkillGetResult>('platform.ai.skill.get', params)
  },

  upsertSkill(params: AiSkillUpsertParams): Promise<AiSkillUpsertResult> {
    return bridgeInvoke<AiSkillUpsertResult>('platform.ai.skill.upsert', params)
  },

  deleteSkill(params: AiSkillDeleteParams): Promise<AiSkillDeleteResult> {
    return bridgeInvoke<AiSkillDeleteResult>('platform.ai.skill.delete', params)
  },

  installSkillPack(params: AiSkillInstallPackParams): Promise<AiSkillInstallPackResult> {
    return bridgeInvoke<AiSkillInstallPackResult>('platform.ai.skill.installPack', params)
  },

  exportSkillPack(params: AiSkillExportPackParams): Promise<AiSkillExportPackResult> {
    return bridgeInvoke<AiSkillExportPackResult>('platform.ai.skill.exportPack', params)
  },
} as const
