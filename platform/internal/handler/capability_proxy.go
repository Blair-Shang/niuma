// 本文件实现 manifest 驱动的能力服务通用代理（ftp.*、ssh.*、插件 namespace 等）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
)

// 连接类能力统一的 session 方法名（Web 与 service 内部一致，经 namespace 前缀区分）。
const (
	capabilityMethodSessionOpen  = "session.open"
	capabilityMethodSessionClose = "session.close"
	capabilityMethodSessionTest  = "session.test"
)

// FTP Bridge 方法名（与 web/src/api/ftp.ts 契约一致）。
const (
	MethodFTPSessionOpen  = "ftp.session.open"
	MethodFTPSessionClose = "ftp.session.close"
	MethodFTPSessionTest  = "ftp.session.test"
	MethodFTPDirList      = "ftp.dir.list"
	MethodFTPDirMake      = "ftp.dir.make"
	MethodFTPEntryDelete  = "ftp.entry.delete"
	MethodFTPEntryRename  = "ftp.entry.rename"
)

type connectBridgeParams struct {
	ProfileID         string          `json:"profileId"`
	HostAddress       string          `json:"hostAddress"`
	PortNumber        int             `json:"portNumber"`
	LoginAccount      string          `json:"loginAccount"`
	Password          string          `json:"password"`
	Options           json.RawMessage `json:"options"`
	ConnectionOptions json.RawMessage `json:"connectionOptions"`
}

type injectedConnectParams struct {
	HostAddress  string          `json:"hostAddress"`
	PortNumber   int             `json:"portNumber"`
	LoginAccount string          `json:"loginAccount"`
	Password     string          `json:"password"`
	Options      json.RawMessage `json:"options"`
}

// Dispatch 将已注册 namespace 下的 Bridge 方法转发到对应能力服务。
func (r *CapabilityRegistry) Dispatch(ctx context.Context, d *Dispatcher, req Request) (Response, bool) {
	route, action, ok := r.resolve(req.Method)
	if !ok {
		return Response{}, false
	}
	if route.manifest.NeedsCredentialInjection(action) {
		return r.dispatchWithCredentials(ctx, d, req, route, action), true
	}
	return r.forward(ctx, req, route, action), true
}

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
	case capabilityMethodSessionOpen:
		var result struct {
			SessionID string `json:"sessionId"`
		}
		if err := route.client.Invoke(ctx, action, connect, &result); err != nil {
			return errorResponse(req.ID, err.Error())
		}
		return okResponse(req.ID, map[string]any{"sessionId": result.SessionID})
	case capabilityMethodSessionTest:
		var result struct {
			OK      bool   `json:"ok"`
			Message string `json:"message"`
		}
		if err := route.client.Invoke(ctx, action, connect, &result); err != nil {
			return errorResponse(req.ID, err.Error())
		}
		return okResponse(req.ID, result)
	default:
		return errorResponse(req.ID, "method not found: "+req.Method)
	}
}

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

// profilePassword 解析站点密码：表单覆盖值优先，否则从 Keychain 读取首个关联凭据。
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
	secret, ok, err := d.secrets.GetSecret(ref.KeychainService, ref.KeychainAccount)
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

// normalizeFTPPort 内联测试未填端口时回退 FTP 默认 21。
func normalizeFTPPort(port int) int {
	if port <= 0 {
		return 21
	}
	return port
}

// resolveConnectParams 解析 Bridge 入参：优先 profileId 查库注入凭据，否则使用内联连接参数（新建站点测试场景）。
func (d *Dispatcher) resolveConnectParams(ctx context.Context, raw json.RawMessage) (injectedConnectParams, error) {
	var params connectBridgeParams
	if err := json.Unmarshal(raw, &params); err != nil {
		return injectedConnectParams{}, fmt.Errorf("invalid params: %v", err)
	}
	if params.ProfileID != "" {
		connect, err := d.resolveConnectParamsFromProfile(ctx, params.ProfileID, params.Password)
		if err != nil {
			return injectedConnectParams{}, err
		}
		if params.HostAddress != "" {
			connect.HostAddress = params.HostAddress
			connect.PortNumber = normalizeFTPPort(params.PortNumber)
			connect.LoginAccount = params.LoginAccount
			if params.Password != "" {
				connect.Password = params.Password
			}
			opts := inlineConnectOptions(params.Options, params.ConnectionOptions)
			if len(opts) > 0 && string(opts) != "null" {
				connect.Options = opts
			}
		}
		return connect, nil
	}
	if params.HostAddress == "" {
		return injectedConnectParams{}, fmt.Errorf("profileId or hostAddress required")
	}
	return injectedConnectParams{
		HostAddress:  params.HostAddress,
		PortNumber:   normalizeFTPPort(params.PortNumber),
		LoginAccount: params.LoginAccount,
		Password:     params.Password,
		Options:      inlineConnectOptions(params.Options, params.ConnectionOptions),
	}, nil
}

// resolveConnectParamsFromProfile 按 profileId 从 SQLite 读取站点，并注入 Keychain 密码后转发给能力服务。
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

	return injectedConnectParams{
		HostAddress:  profile.HostAddress,
		PortNumber:   profile.PortNumber,
		LoginAccount: profile.LoginAccount,
		Password:     password,
		Options:      profileOptionsJSON(profile.ConnectionOptions),
	}, nil
}
