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

	"niuma/platform/internal/idgen"
	"niuma/platform/internal/components"
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
	// MethodCredentialSet 写入或更新凭据（密钥落 OS Keychain）。
	MethodCredentialSet = "platform.credential.set"
	// MethodCredentialDelete 删除凭据（连同 Keychain 密钥与关联）。
	MethodCredentialDelete = "platform.credential.delete"
	// MethodCredentialGet 按站点 ID 从 OS Keychain 读取凭据明文（仅供本地 IPC 使用）。
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
)

// Request 是 Shell 透传过来的原始请求（cefQuery 请求体）。
type Request struct {
	// Method 为完整方法名，如 platform.settings.get。
	Method string `json:"method"`
	// Params 为原始参数对象，按具体方法二次解析。
	Params json.RawMessage `json:"params"`
	// ID 为请求关联 id，原样回填到响应。
	ID string `json:"id"`
}

// Response 是回写给 Shell 的响应帧结构。
//
// Result 存放业务结果对象“序列化后的 JSON 字符串”（而非对象本身），因此在
// 线路上会被再编码一层，例如 {"result":"{\"value\":\"dark\"}"}。
type Response struct {
	ID     string `json:"id"`
	OK     bool   `json:"ok"`
	Error  string `json:"error,omitempty"`
	Result string `json:"result"`
}

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
	Settings    *store.SettingStore
	Connections *store.ConnectionStore
	Credentials *store.CredentialStore
	Secrets     store.SecretStore
	IDs         idgen.Generator
	Capabilities *CapabilityRegistry
	FileEditor  *FileEditorCoordinator
	Components  *components.Registry
}

// Dispatcher 持有各处理逻辑所需的依赖并执行方法分发。
type Dispatcher struct {
	settings     *store.SettingStore
	connections  *store.ConnectionStore
	credentials  *store.CredentialStore
	secrets      store.SecretStore
	ids          idgen.Generator
	capabilities *CapabilityRegistry
	fileEditor   *FileEditorCoordinator
	components   *components.Registry
}

// New 依据 deps 创建 Dispatcher。
func New(deps Deps) *Dispatcher {
	return &Dispatcher{
		settings:    deps.Settings,
		connections: deps.Connections,
		credentials: deps.Credentials,
		secrets:     deps.Secrets,
		ids:          deps.IDs,
		capabilities: deps.Capabilities,
		fileEditor:   deps.FileEditor,
		components:   deps.Components,
	}
}

// HandleFrame 解析一帧请求 JSON，分发处理，并返回一帧响应 JSON 字节。
//
// raw 为请求帧载荷。即使解析失败或方法未知，也总是返回结构化的错误响应
// 而非 error，以保证壳层能拿到可读的失败信息（Web 端据此回退本地缓存）。
func (d *Dispatcher) HandleFrame(ctx context.Context, raw []byte) []byte {
	var req Request
	if err := json.Unmarshal(raw, &req); err != nil {
		return marshalResponse(Response{
			ID:    "",
			OK:    false,
			Error: fmt.Sprintf("invalid request json: %v", err),
		})
	}
	return marshalResponse(d.dispatch(ctx, req))
}

// dispatch 按 method 路由到具体处理逻辑并返回响应。
func (d *Dispatcher) dispatch(ctx context.Context, req Request) Response {
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
		return Response{
			ID:    req.ID,
			OK:    false,
			Error: "method not found: " + req.Method,
		}
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
	encoded, err := json.Marshal(result)
	if err != nil {
		return errorResponse(id, fmt.Sprintf("marshal result: %v", err))
	}
	return Response{ID: id, OK: true, Result: string(encoded)}
}

// errorResponse 构造失败响应。
func errorResponse(id, message string) Response {
	return Response{ID: id, OK: false, Error: message}
}

// marshalResponse 序列化响应；理论上不会失败，兜底返回一个最小错误帧。
func marshalResponse(resp Response) []byte {
	out, err := json.Marshal(resp)
	if err != nil {
		return []byte(`{"ok":false,"error":"internal marshal error","result":""}`)
	}
	return out
}
