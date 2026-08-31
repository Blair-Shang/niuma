// Package handler 实现 Platform 应用 IPC 的方法分发。
//
// Shell 把 Web 的 cefQuery 原始请求 JSON 原样透传过来；本包解析其中的
// method/params/id，路由到对应处理逻辑，并组装响应。响应中的 result 字段是
// 一个“被 JSON 编码后的字符串”（即业务结果对象序列化后的文本），以便 C++
// 壳层用其极简 JSON 解析器直接取出后回传给 Web。
package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/pkg/serviceipc/envelope"
	"niuma/platform/internal/ai"
	"niuma/platform/internal/appupdate"
	"niuma/platform/internal/components"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/store"
)

// 方法名常量：与 web/src/api/*.ts 中的 Bridge 契约保持一致。
const (
	// MethodSettingsGet 读取应用级 KV 配置。
	MethodSettingsGet = "platform.settings.get"
	// MethodSettingsSet 写入应用级 KV 配置。
	MethodSettingsSet = "platform.settings.set"
	// MethodConnectionList 列出连接站点。
	MethodConnectionList = "platform.connection.list"
	// MethodConnectionGet 读取单个连接站点。
	MethodConnectionGet = "platform.connection.get"
	// MethodConnectionCreate 新建连接站点（可携带凭据）。
	MethodConnectionCreate = "platform.connection.create"
	// MethodConnectionUpdate 以乐观锁更新连接站点。
	MethodConnectionUpdate = "platform.connection.update"
	// MethodConnectionDelete 删除连接站点并级联清理孤儿凭据。
	MethodConnectionDelete = "platform.connection.delete"
	// MethodConnectionExport 导出连接配置到本机 JSON 文件（不含凭据明文）。
	MethodConnectionExport = "platform.connection.export"
	// MethodConnectionImport 从本机 JSON 文件导入连接配置（不含凭据明文）。
	MethodConnectionImport = "platform.connection.import"
	// MethodConnectionOrganizationGet 读取连接树文件夹组织层。
	MethodConnectionOrganizationGet = "platform.connection.organization.get"
	// MethodConnectionOrganizationSet 写入连接树文件夹组织层。
	MethodConnectionOrganizationSet = "platform.connection.organization.set"
	// MethodCredentialSet 写入或更新凭据（明文经 VaultStore 加密写入 cipher_text）。
	MethodCredentialSet = "platform.credential.set"
	// MethodCredentialDelete 删除凭据（密文行与关联一并清理）。
	MethodCredentialDelete = "platform.credential.delete"
	// MethodCredentialGet 按站点 ID 解密读取凭据明文（仅供本地 IPC 使用）。
	MethodCredentialGet = "platform.credential.get"
	// MethodComponentsList 列出工具组件包及探测状态。
	MethodComponentsList = "platform.components.list"
	// MethodComponentsDetect 重新探测指定工具组件包。
	MethodComponentsDetect = "platform.components.detect"
	// MethodComponentsSetPath 设置或清除工具可执行文件路径。
	MethodComponentsSetPath = "platform.components.setPath"
	// MethodComponentsGetDownload 返回工具官方下载页 URL。
	MethodComponentsGetDownload = "platform.components.getDownload"
	// MethodComponentsInstall 下载并安装组件包至 data/components/。
	MethodComponentsInstall = "platform.components.install"
	// MethodAppUpdateDownload / Verify / Cancel：本体安装包受限下载（见 appupdate）。
	// Web/Shell 契约亦接受 shell.update.*，由壳层改写或直达此处。
	// MethodAIProviderList 列出 LLM Provider。
	MethodAIProviderList = "platform.ai.provider.list"
	// MethodAIProviderGet 读取单个 Provider（含模型列表）。
	MethodAIProviderGet = "platform.ai.provider.get"
	// MethodAIProviderUpsert 新建或更新 Provider（API Key 经 Vault 加密）。
	MethodAIProviderUpsert = "platform.ai.provider.upsert"
	// MethodAIProviderDelete 删除 Provider 并级联清理模型与凭据。
	MethodAIProviderDelete = "platform.ai.provider.delete"
	// MethodAIProviderTest 探测 Provider 连通性（OpenAI 兼容 /models）。
	MethodAIProviderTest = "platform.ai.provider.test"
	// MethodAIProviderListRemoteModels 从上游拉取可用模型列表。
	MethodAIProviderListRemoteModels = "platform.ai.provider.listRemoteModels"
	// MethodAIProviderGetApiKey 解密读取 Provider API Key（仅本地 IPC，供编辑回填）。
	MethodAIProviderGetApiKey = "platform.ai.provider.getApiKey"
	// MethodAIProviderEnsureSystem 按云端目录同步本机系统 Provider。
	MethodAIProviderEnsureSystem = "platform.ai.provider.ensureSystem"
	// MethodAIModelList 列出模型。
	MethodAIModelList = "platform.ai.model.list"
	// MethodAIModelUpsert 新建或更新模型。
	MethodAIModelUpsert = "platform.ai.model.upsert"
	// MethodAIModelDelete 删除模型。
	MethodAIModelDelete = "platform.ai.model.delete"
	// MethodAIConversationList 列出 AI 对话会话。
	MethodAIConversationList = "platform.ai.conversation.list"
	// MethodAIConversationGet 读取会话及消息。
	MethodAIConversationGet = "platform.ai.conversation.get"
	// MethodAIConversationCreate 新建会话。
	MethodAIConversationCreate = "platform.ai.conversation.create"
	// MethodAIConversationDelete 删除会话（级联消息）。
	MethodAIConversationDelete = "platform.ai.conversation.delete"
	// MethodAIConversationUpdate 更新会话标题等元数据。
	MethodAIConversationUpdate = "platform.ai.conversation.update"
	// MethodAIChatStream 启动流式对话（立即返回 runId）。
	MethodAIChatStream = "platform.ai.chat.stream"
	// MethodAIChatCancel 取消进行中的流式 run。
	MethodAIChatCancel = "platform.ai.chat.cancel"
	// MethodAIMCPList 列出 MCP Server。
	MethodAIMCPList = "platform.ai.mcp.list"
	// MethodAIMCPGet 读取单个 MCP Server（含工具缓存）。
	MethodAIMCPGet = "platform.ai.mcp.get"
	// MethodAIMCPUpsert 新建或更新 MCP Server。
	MethodAIMCPUpsert = "platform.ai.mcp.upsert"
	// MethodAIMCPDelete 删除 MCP Server 及工具缓存。
	MethodAIMCPDelete = "platform.ai.mcp.delete"
	// MethodAIMCPRefresh 发现工具并写入 nm_mcp_tool。
	MethodAIMCPRefresh = "platform.ai.mcp.refresh"
	// MethodAIMCPSetToolEnabled 启用/禁用工具。
	MethodAIMCPSetToolEnabled = "platform.ai.mcp.setToolEnabled"
	// MethodAIMCPSetToolRisk 设置工具风险等级。
	MethodAIMCPSetToolRisk = "platform.ai.mcp.setToolRisk"
	// MethodAIPolicyConfirm 确认或拒绝待执行工具。
	MethodAIPolicyConfirm = "platform.ai.policy.confirm"
	// MethodAIPolicyListPending 列出当前待确认工具。
	MethodAIPolicyListPending = "platform.ai.policy.listPending"
	// MethodAISkillList 列出 AI Skill。
	MethodAISkillList = "platform.ai.skill.list"
	// MethodAISkillGet 读取单个 Skill。
	MethodAISkillGet = "platform.ai.skill.get"
	// MethodAISkillUpsert 新建或更新 Skill。
	MethodAISkillUpsert = "platform.ai.skill.upsert"
	// MethodAISkillDelete 删除 Skill。
	MethodAISkillDelete = "platform.ai.skill.delete"
	// MethodAISkillInstallPack 从目录或 zip 安装 OpenClaw 风格 Skill 包。
	MethodAISkillInstallPack = "platform.ai.skill.installPack"
	// MethodAISkillExportPack 导出 Skill 包为 zip（本机「下载」）。
	MethodAISkillExportPack = "platform.ai.skill.exportPack"
	// MethodDiagTrace 按 traceId 检索本机 observe.jsonl。
	MethodDiagTrace = "platform.diag.trace"
	// MethodDiagSummary 汇总本机 RPC 耗时与失败码。
	MethodDiagSummary = "platform.diag.summary"
	// MethodDiagCrashes 列出本机崩溃转储聚类。
	MethodDiagCrashes = "platform.diag.crashes"
)

// Request 是 Shell 透传过来的原始请求（cefQuery 请求体）。
type Request = envelope.Request

// Response 是回写给 Shell 的响应帧结构。
//
// Result 存放业务结果对象“序列化后的 JSON 字符串”（而非对象本身），因此在
// 线路上会被再编码一层，例如 {"result":"{\"value\":\"dark\"}"}。另含 v / errorCode / traceId。
type Response = envelope.Response

// settingGetResult 对应 web SettingGetResult：value 为 JSON 字符串或 null。
type settingGetResult struct {
	Value *string `json:"value"`
}

// settingSetResult 对应 web SettingSetResult。
type settingSetResult struct {
	Updated bool `json:"updated"`
}

// settingGetParams 是 platform.settings.get 的入参。
type settingGetParams struct {
	Key string `json:"key"`
}

// settingSetParams 是 platform.settings.set 的入参。
type settingSetParams struct {
	Key   string `json:"key"`
	Value string `json:"value"`
}

// Deps 汇集 Dispatcher 所需的全部仓储与工具依赖。
//
// 仅设置 Settings 也可用于只涉及 platform.settings.* 的场景（如往返测试）；
// 连接/凭据相关方法需要 Connections、Credentials、Secrets 与 IDs 均就位。
type Deps struct {
	Settings     *store.SettingStore
	Connections  *store.ConnectionStore
	Organization *store.OrganizationStore
	Credentials  *store.CredentialStore
	Secrets      store.SecretStore
	IDs          idgen.Generator
	Capabilities *CapabilityRegistry
	FileEditor   *FileEditorCoordinator
	Components   *components.Registry
	AppUpdate    *appupdate.Manager
	AI           *ai.Service
	Events       EventPublisher
}

// Dispatcher 持有各处理逻辑所需的依赖并执行方法分发。
type Dispatcher struct {
	settings     *store.SettingStore
	connections  *store.ConnectionStore
	organization *store.OrganizationStore
	credentials  *store.CredentialStore
	secrets      store.SecretStore
	ids          idgen.Generator
	capabilities *CapabilityRegistry
	fileEditor   *FileEditorCoordinator
	components   *components.Registry
	appUpdate    *appupdate.Manager
	ai           *ai.Service
	events       EventPublisher
}

// New 依据 deps 创建 Dispatcher。
func New(deps Deps) *Dispatcher {
	return &Dispatcher{
		settings:     deps.Settings,
		connections:  deps.Connections,
		organization: deps.Organization,
		credentials:  deps.Credentials,
		secrets:      deps.Secrets,
		ids:          deps.IDs,
		capabilities: deps.Capabilities,
		fileEditor:   deps.FileEditor,
		components:   deps.Components,
		appUpdate:    deps.AppUpdate,
		ai:           deps.AI,
		events:       deps.Events,
	}
}

// HandleFrame 解析一帧请求 JSON，分发处理，并返回一帧响应 JSON 字节。
//
// raw 为请求帧载荷。即使解析失败或方法未知，也总是返回结构化的错误响应
// 而非 error，以保证壳层能拿到可读的失败信息（Web 端据此回退本地缓存）。
func (d *Dispatcher) HandleFrame(ctx context.Context, raw []byte) []byte {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return marshalResponse(envelope.Fail("", fmt.Sprintf("invalid request json: %v", err)))
	}
	return marshalResponse(envelope.WithRequest(req, d.dispatch(ctx, req)))
}

// dispatch 按 method 路由并记录失败信封（id / traceId / errorCode）。
func (d *Dispatcher) dispatch(ctx context.Context, req Request) Response {
	resp := d.dispatchMethod(ctx, req)
	logDispatchError(req, resp)
	return resp
}

func (d *Dispatcher) dispatchMethod(ctx context.Context, req Request) Response {
	switch req.Method {
	case MethodSettingsGet:
		return d.settingsGet(ctx, req)
	case MethodSettingsSet:
		return d.settingsSet(ctx, req)
	case MethodConnectionList:
		return d.connectionList(ctx, req)
	case MethodConnectionGet:
		return d.connectionGet(ctx, req)
	case MethodConnectionCreate:
		return d.connectionCreate(ctx, req)
	case MethodConnectionUpdate:
		return d.connectionUpdate(ctx, req)
	case MethodConnectionDelete:
		return d.connectionDelete(ctx, req)
	case MethodConnectionExport:
		return d.connectionExport(ctx, req)
	case MethodConnectionImport:
		return d.connectionImport(ctx, req)
	case MethodConnectionOrganizationGet:
		return d.connectionOrganizationGet(ctx, req)
	case MethodConnectionOrganizationSet:
		return d.connectionOrganizationSet(ctx, req)
	case MethodCredentialSet:
		return d.credentialSet(ctx, req)
	case MethodCredentialDelete:
		return d.credentialDelete(ctx, req)
	case MethodCredentialGet:
		return d.credentialGet(ctx, req)
	case MethodComponentsList:
		return d.componentsList(ctx, req)
	case MethodComponentsDetect:
		return d.componentsDetect(ctx, req)
	case MethodComponentsSetPath:
		return d.componentsSetPath(ctx, req)
	case MethodComponentsGetDownload:
		return d.componentsGetDownload(ctx, req)
	case MethodComponentsInstall:
		return d.componentsInstall(ctx, req)
	case MethodAppUpdateDownload:
		return d.appUpdateDownload(ctx, req)
	case MethodAppUpdateVerify:
		return d.appUpdateVerify(ctx, req)
	case MethodAppUpdateCancel:
		return d.appUpdateCancel(ctx, req)
	case MethodAIProviderList:
		return d.aiProviderList(ctx, req)
	case MethodAIProviderGet:
		return d.aiProviderGet(ctx, req)
	case MethodAIProviderUpsert:
		return d.aiProviderUpsert(ctx, req)
	case MethodAIProviderDelete:
		return d.aiProviderDelete(ctx, req)
	case MethodAIProviderTest:
		return d.aiProviderTest(ctx, req)
	case MethodAIProviderListRemoteModels:
		return d.aiProviderListRemoteModels(ctx, req)
	case MethodAIProviderGetApiKey:
		return d.aiProviderGetApiKey(ctx, req)
	case MethodAIProviderEnsureSystem:
		return d.aiProviderEnsureSystem(ctx, req)
	case MethodAIModelList:
		return d.aiModelList(ctx, req)
	case MethodAIModelUpsert:
		return d.aiModelUpsert(ctx, req)
	case MethodAIModelDelete:
		return d.aiModelDelete(ctx, req)
	case MethodAIConversationList:
		return d.aiConversationList(ctx, req)
	case MethodAIConversationGet:
		return d.aiConversationGet(ctx, req)
	case MethodAIConversationCreate:
		return d.aiConversationCreate(ctx, req)
	case MethodAIConversationDelete:
		return d.aiConversationDelete(ctx, req)
	case MethodAIConversationUpdate:
		return d.aiConversationUpdate(ctx, req)
	case MethodAIChatStream:
		return d.aiChatStream(ctx, req)
	case MethodAIChatCancel:
		return d.aiChatCancel(ctx, req)
	case MethodAIMCPList:
		return d.aiMCPList(ctx, req)
	case MethodAIMCPGet:
		return d.aiMCPGet(ctx, req)
	case MethodAIMCPUpsert:
		return d.aiMCPUpsert(ctx, req)
	case MethodAIMCPDelete:
		return d.aiMCPDelete(ctx, req)
	case MethodAIMCPRefresh:
		return d.aiMCPRefresh(ctx, req)
	case MethodAIMCPSetToolEnabled:
		return d.aiMCPSetToolEnabled(ctx, req)
	case MethodAIMCPSetToolRisk:
		return d.aiMCPSetToolRisk(ctx, req)
	case MethodAIPolicyConfirm:
		return d.aiPolicyConfirm(ctx, req)
	case MethodAIPolicyListPending:
		return d.aiPolicyListPending(ctx, req)
	case MethodAISkillList:
		return d.aiSkillList(ctx, req)
	case MethodAISkillGet:
		return d.aiSkillGet(ctx, req)
	case MethodAISkillUpsert:
		return d.aiSkillUpsert(ctx, req)
	case MethodAISkillDelete:
		return d.aiSkillDelete(ctx, req)
	case MethodAISkillInstallPack:
		return d.aiSkillInstallPack(ctx, req)
	case MethodAISkillExportPack:
		return d.aiSkillExportPack(ctx, req)
	case MethodDiagTrace:
		return d.diagTrace(ctx, req)
	case MethodDiagSummary:
		return d.diagSummary(ctx, req)
	case MethodDiagCrashes:
		return d.diagCrashes(ctx, req)
	default:
		if d.fileEditor != nil {
			if resp, handled := d.fileEditor.Dispatch(ctx, req); handled {
				return resp
			}
		}
		if d.capabilities != nil {
			if resp, handled := d.capabilities.Dispatch(ctx, d, req); handled {
				return resp
			}
		}
		return envelope.Fail(req.ID, "method not found: "+req.Method)
	}
}

// settingsGet 处理 platform.settings.get：键不存在时 value 为 null。
func (d *Dispatcher) settingsGet(ctx context.Context, req Request) Response {
	var params settingGetParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Key == "" {
		return errorResponse(req.ID, "key required")
	}

	value, ok, err := d.settings.Get(ctx, params.Key)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	result := settingGetResult{}
	if ok {
		v := value
		result.Value = &v
	}
	return okResponse(req.ID, result)
}

// settingsSet 处理 platform.settings.set：UPSERT 后返回 {updated:true}。
func (d *Dispatcher) settingsSet(ctx context.Context, req Request) Response {
	var params settingSetParams
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Key == "" {
		return errorResponse(req.ID, "key required")
	}

	if err := d.settings.Set(ctx, params.Key, params.Value); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, settingSetResult{Updated: true})
}

// okResponse 把业务结果对象序列化为字符串并封装成成功响应。
func okResponse(id string, result any) Response {
	return envelope.OK(id, result)
}

// errorResponse 构造失败响应（error 仍为人可读字符串，errorCode 由信封推断）。
func errorResponse(id, message string) Response {
	return envelope.Fail(id, message)
}

// marshalResponse 序列化响应；理论上不会失败，兜底返回一个最小错误帧。
func marshalResponse(resp Response) []byte {
	return envelope.Marshal(resp)
}
