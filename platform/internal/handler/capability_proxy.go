// 本文件实现 manifest 驱动的能力服务通用代理（ftp.*、ssh.*、插件 namespace 等）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/pkg/tunnel"
)

// 连接类能力统一的 session 方法名（Web 与 service 内部一致，经 namespace 前缀区分）。
const (
	// capabilityMethodSessionOpen 打开能力会话（platform 可注入凭据）。
	capabilityMethodSessionOpen = "session.open"
	// capabilityMethodSessionClose 关闭能力会话。
	capabilityMethodSessionClose = "session.close"
	// capabilityMethodSessionTest 探测连接是否可用。
	capabilityMethodSessionTest = "session.test"
)

// FTP Bridge 方法名（与 web/src/api/ftp.ts 契约一致）。
const (
	// MethodFTPSessionOpen 打开 FTP 会话。
	MethodFTPSessionOpen = "ftp.session.open"
	// MethodFTPSessionClose 关闭 FTP 会话。
	MethodFTPSessionClose = "ftp.session.close"
	// MethodFTPSessionTest 探测 FTP 连通性。
	MethodFTPSessionTest = "ftp.session.test"
	// MethodFTPDirList 列出远程目录。
	MethodFTPDirList = "ftp.dir.list"
	// MethodFTPDirMake 创建远程目录。
	MethodFTPDirMake = "ftp.dir.make"
	// MethodFTPEntryDelete 删除远程文件或目录。
	MethodFTPEntryDelete = "ftp.entry.delete"
	// MethodFTPEntryRename 重命名远程条目。
	MethodFTPEntryRename = "ftp.entry.rename"
)

// connectBridgeParams 是 Web 发过来的原始连接请求参数。
// Secret 承载认证凭据；兼容历史字段 `password`（通过 UnmarshalJSON 回退）。
type connectBridgeParams struct {
	ProfileID         string          `json:"profileId"`
	HostAddress       string          `json:"hostAddress"`
	PortNumber        int             `json:"portNumber"`
	LoginAccount      string          `json:"loginAccount"`
	Secret            string          `json:"secret"`
	Options           json.RawMessage `json:"options"`
	ConnectionOptions json.RawMessage `json:"connectionOptions"`
	// Database 可选：覆盖连接 options.database（MySQL / Kingbase 按 Tab 目标库建连）。
	Database string `json:"database"`
}

// UnmarshalJSON 兼容历史 `password` 字段（Web 旧版仍可能发送 password）。
func (p *connectBridgeParams) UnmarshalJSON(data []byte) error {
	type alias connectBridgeParams
	var raw struct {
		alias
		Password string `json:"password"`
	}
	if err := json.Unmarshal(data, &raw); err != nil {
		return err
	}
	*p = connectBridgeParams(raw.alias)
	if p.Secret == "" && raw.Password != "" {
		p.Secret = raw.Password
	}
	return nil
}

// injectedConnectParams 是 platform 注入凭据后发送给能力服务的参数。
type injectedConnectParams struct {
	HostAddress  string          `json:"hostAddress"`
	PortNumber   int             `json:"portNumber"`
	LoginAccount string          `json:"loginAccount"`
	Secret       string          `json:"secret"`
	Options      json.RawMessage `json:"options"`
}

// Dispatch 将已注册 namespace 下的 Bridge 方法转发到对应能力服务。
func (r *CapabilityRegistry) Dispatch(ctx context.Context, d *Dispatcher, req Request) (Response, bool) {
	route, action, ok := r.resolve(req.Method)
	if !ok {
		return Response{}, false
	}
	// 凭据注入仅在尚未建立 session 时执行：参数中若已包含有效 sessionId，
	// 说明服务端 session 已存在，可直接透传，无需再从 profileId 注入凭据。
	if route.manifest.NeedsCredentialInjection(action) && !paramsHaveSessionID(req.Params) {
		return r.dispatchWithCredentials(ctx, d, req, route, action), true
	}
	return r.forward(ctx, req, route, action), true
}

// paramsHaveSessionID 检查请求参数中是否携带了非空的 sessionId 字段。
func paramsHaveSessionID(params json.RawMessage) bool {
	var p struct {
		SessionID string `json:"sessionId"`
	}
	if err := json.Unmarshal(params, &p); err != nil {
		return false
	}
	return p.SessionID != ""
}

// mergeWithCredentials 将注入的连接凭据合并进原始请求参数。
// 凭据字段（hostAddress / portNumber / loginAccount / secret / options）会覆盖原始值，
// 其余业务字段（如 database、collection 等）保留自原始参数，确保不被凭据注入丢弃。
//
// 注意：业务参数禁止再使用顶层 options（会被连接 options 覆盖）。
// CSV 用 csvOptions，执行 SQL 用 execOptions，工具用 dumpOptions / restoreOptions，
// Dump SQL 已嵌套在 dump 下。
func mergeWithCredentials(original json.RawMessage, cred injectedConnectParams) (json.RawMessage, error) {
	var base map[string]json.RawMessage
	if err := json.Unmarshal(original, &base); err != nil {
		return nil, err
	}
	credBytes, err := json.Marshal(cred)
	if err != nil {
		return nil, err
	}
	var credMap map[string]json.RawMessage
	if err := json.Unmarshal(credBytes, &credMap); err != nil {
		return nil, err
	}
	for k, v := range credMap {
		base[k] = v
	}
	return json.Marshal(base)
}

// dispatchWithCredentials 在转发前从 profile 注入凭据，再调用能力服务。
func (r *CapabilityRegistry) dispatchWithCredentials(
	ctx context.Context,
	d *Dispatcher,
	req Request,
	route *capabilityRoute,
	action string,
) Response {
	connect, err := d.resolveConnectParams(ctx, req.Params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if err := r.supervisor.Ensure(ctx, route.manifest.ID); err != nil {
		return errorResponse(req.ID, err.Error())
	}

	switch action {
	case capabilityMethodSessionOpen, capabilityMethodSessionTest:
		// 透传服务端完整结果（含 dialect / version / capabilities），
		// 禁止再裁剪为仅 sessionId 或 ok/message，否则前端 Capability 模型失效。
		// SSH 隧道由各能力服务自行消费 options.tunnel（platform 仅 InjectSSHProfile）。
		var result json.RawMessage
		if err := route.client.Invoke(ctx, action, connect, &result); err != nil {
			return errorResponse(req.ID, err.Error())
		}
		if len(result) == 0 {
			return okResponse(req.ID, map[string]any{})
		}
		var out any
		if err := json.Unmarshal(result, &out); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid service result: %v", err))
		}
		return okResponse(req.ID, out)
	default:
		// 非 session.open/test 方法可能携带业务字段（如 database），
		// 需将原始参数与注入凭据合并，确保业务字段不被丢失。
		merged, mergeErr := mergeWithCredentials(req.Params, connect)
		if mergeErr != nil {
			return errorResponse(req.ID, fmt.Sprintf("merge params: %v", mergeErr))
		}
		var result json.RawMessage
		if err := route.client.Invoke(ctx, action, merged, &result); err != nil {
			return errorResponse(req.ID, err.Error())
		}
		if len(result) == 0 {
			return okResponse(req.ID, map[string]any{})
		}
		var out any
		if err := json.Unmarshal(result, &out); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid service result: %v", err))
		}
		return okResponse(req.ID, out)
	}
}

// forward 不注入凭据，将参数原样转到能力服务（已有 sessionId 时走此路径）。
func (r *CapabilityRegistry) forward(
	ctx context.Context,
	req Request,
	route *capabilityRoute,
	action string,
) Response {
	if err := r.supervisor.Ensure(ctx, route.manifest.ID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	var params any
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	var result json.RawMessage
	if err := route.client.Invoke(ctx, action, params, &result); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if len(result) == 0 {
		return okResponse(req.ID, map[string]any{})
	}
	var out any
	if err := json.Unmarshal(result, &out); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid service result: %v", err))
	}
	return okResponse(req.ID, out)
}

// connectStoresAvailable 判断连接/凭据/密钥仓储是否已装配。
func (d *Dispatcher) connectStoresAvailable() bool {
	return d.connections != nil && d.credentials != nil && d.secrets != nil
}

// profileOptionsJSON 将 SQLite 中的 connection_options 转为下发给能力服务的 JSON。
func profileOptionsJSON(connectionOptions string) json.RawMessage {
	if connectionOptions == "" {
		return json.RawMessage("null")
	}
	return json.RawMessage(connectionOptions)
}

// profilePassword 解析站点密码：表单覆盖值优先，否则从 Vault 解密首个关联凭据。
func (d *Dispatcher) profilePassword(ctx context.Context, credentialIDs []string, override string) (string, error) {
	if override != "" {
		return override, nil
	}
	if len(credentialIDs) == 0 {
		return "", nil
	}
	ref, err := d.credentials.Get(ctx, credentialIDs[0])
	if err != nil {
		return "", err
	}
	if ref == nil {
		return "", nil
	}
	secret, ok, err := d.secrets.GetSecret(credentialServicePrefix+ref.CredentialID, credentialSecretAccount)
	if err != nil {
		return "", err
	}
	if !ok {
		return "", nil
	}
	return secret, nil
}

// inlineConnectOptions 合并 Bridge 入参中的 options / connectionOptions，缺省为 {}。
func inlineConnectOptions(opts, connectionOptions json.RawMessage) json.RawMessage {
	if len(opts) > 0 {
		return opts
	}
	if len(connectionOptions) > 0 {
		return connectionOptions
	}
	return json.RawMessage("{}")
}

// injectTunnelOptions 把 SSH 隧道站点信息写入连接 options，供能力服务建连。
func (d *Dispatcher) injectTunnelOptions(ctx context.Context, opts json.RawMessage) (json.RawMessage, error) {
	return tunnel.InjectSSHProfile(ctx, opts, tunnel.ProfileResolverFunc(d.resolveTunnelSSHProfile))
}

// resolveTunnelSSHProfile 按 profileId 读取 SSH 隧道站点（含解密后的密钥）。
func (d *Dispatcher) resolveTunnelSSHProfile(ctx context.Context, profileID string) (tunnel.SSHProfile, error) {
	if !d.connectStoresAvailable() {
		return tunnel.SSHProfile{}, fmt.Errorf("connection store unavailable")
	}
	profile, err := d.connections.Get(ctx, profileID)
	if err != nil {
		return tunnel.SSHProfile{}, err
	}
	if profile == nil {
		return tunnel.SSHProfile{}, fmt.Errorf("ssh tunnel profile not found: %s", profileID)
	}
	if profile.ConnectionKind != tunnel.ConnectionKindSSH {
		return tunnel.SSHProfile{}, fmt.Errorf("ssh tunnel profile must be ssh: %s", profileID)
	}
	password, err := d.profilePassword(ctx, profile.CredentialIDs, "")
	if err != nil {
		return tunnel.SSHProfile{}, err
	}
	return tunnel.SSHProfile{
		HostAddress:  profile.HostAddress,
		PortNumber:   profile.PortNumber,
		LoginAccount: profile.LoginAccount,
		Secret:       password,
		Options:      profileOptionsJSON(profile.ConnectionOptions),
	}, nil
}

// normalizeInlinePort 合并内联覆盖端口：显式端口优先，否则保留 profile 端口；
// 仍为 0 时留给各能力服务按 connection_kind 取默认（FTP 21、SSH 22、Redis 6379）。
func normalizeInlinePort(overridePort, profilePort int) int {
	if overridePort > 0 {
		return overridePort
	}
	if profilePort > 0 {
		return profilePort
	}
	return 0
}

// resolveProfileConnectParams 以已存站点为主，允许 Web 内联覆盖主机/端口/账号。
func (d *Dispatcher) resolveProfileConnectParams(
	ctx context.Context,
	params connectBridgeParams,
) (injectedConnectParams, error) {
	connect, err := d.resolveConnectParamsFromProfile(ctx, params.ProfileID, params.Secret)
	if err != nil {
		return injectedConnectParams{}, err
	}
	if params.HostAddress != "" {
		connect.HostAddress = params.HostAddress
		connect.PortNumber = normalizeInlinePort(params.PortNumber, connect.PortNumber)
		connect.LoginAccount = params.LoginAccount
		if params.Secret != "" {
			connect.Secret = params.Secret
		}
		opts := inlineConnectOptions(params.Options, params.ConnectionOptions)
		if len(opts) > 0 && string(opts) != "null" {
			connect.Options = opts
		}
	}
	connect.Options, err = d.injectTunnelOptions(ctx, connect.Options)
	if err != nil {
		return injectedConnectParams{}, err
	}
	return connect, nil
}

// resolveInlineConnectParams 在无 profileId 时用请求内联主机信息建连参数。
func (d *Dispatcher) resolveInlineConnectParams(
	ctx context.Context,
	params connectBridgeParams,
) (injectedConnectParams, error) {
	if params.HostAddress == "" {
		return injectedConnectParams{}, fmt.Errorf("profileId or hostAddress required")
	}
	opts, err := d.injectTunnelOptions(ctx, inlineConnectOptions(params.Options, params.ConnectionOptions))
	if err != nil {
		return injectedConnectParams{}, err
	}
	return injectedConnectParams{
		HostAddress:  params.HostAddress,
		PortNumber:   normalizeInlinePort(params.PortNumber, 0),
		LoginAccount: params.LoginAccount,
		Secret:       params.Secret,
		Options:      opts,
	}, nil
}

// overrideOptionsDatabase 将顶层 database 合并进 connection options（session.open 按 Tab 目标库建连）。
func overrideOptionsDatabase(opts json.RawMessage, database string) (json.RawMessage, error) {
	database = strings.TrimSpace(database)
	if database == "" {
		return opts, nil
	}
	var m map[string]any
	if len(opts) > 0 && string(opts) != "null" {
		if err := json.Unmarshal(opts, &m); err != nil {
			return nil, err
		}
	}
	if m == nil {
		m = map[string]any{}
	}
	m["database"] = database
	return json.Marshal(m)
}

// resolveConnectParams 解析 Bridge 入参：优先 profileId 查库注入凭据，否则使用内联连接参数（新建站点测试场景）。
func (d *Dispatcher) resolveConnectParams(ctx context.Context, raw json.RawMessage) (injectedConnectParams, error) {
	var params connectBridgeParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return injectedConnectParams{}, fmt.Errorf("invalid params: %v", err)
	}
	var connect injectedConnectParams
	var err error
	if params.ProfileID != "" {
		connect, err = d.resolveProfileConnectParams(ctx, params)
	} else {
		connect, err = d.resolveInlineConnectParams(ctx, params)
	}
	if err != nil {
		return injectedConnectParams{}, err
	}
	connect.Options, err = overrideOptionsDatabase(connect.Options, params.Database)
	if err != nil {
		return injectedConnectParams{}, fmt.Errorf("override database: %v", err)
	}
	return connect, nil
}

// resolveConnectParamsFromProfile 按 profileId 从 SQLite 读取站点，并注入 Vault 解密后的密码后转发给能力服务。
func (d *Dispatcher) resolveConnectParamsFromProfile(
	ctx context.Context,
	profileID string,
	overridePassword string,
) (injectedConnectParams, error) {
	if profileID == "" {
		return injectedConnectParams{}, fmt.Errorf("profileId required")
	}
	if !d.connectStoresAvailable() {
		return injectedConnectParams{}, fmt.Errorf("connection store unavailable")
	}

	profile, err := d.connections.Get(ctx, profileID)
	if err != nil {
		return injectedConnectParams{}, err
	}
	if profile == nil {
		return injectedConnectParams{}, fmt.Errorf("profile not found: %s", profileID)
	}

	password, err := d.profilePassword(ctx, profile.CredentialIDs, overridePassword)
	if err != nil {
		return injectedConnectParams{}, err
	}

	opts, err := d.injectTunnelOptions(ctx, profileOptionsJSON(profile.ConnectionOptions))
	if err != nil {
		return injectedConnectParams{}, err
	}
	return injectedConnectParams{
		HostAddress:  profile.HostAddress,
		PortNumber:   profile.PortNumber,
		LoginAccount: profile.LoginAccount,
		Secret:       password,
		Options:      opts,
	}, nil
}
