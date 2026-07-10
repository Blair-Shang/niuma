// 本文件实现连接站点（nm_connection_profile）与凭据（nm_credential_ref）相关的 Bridge 方法。
// 明文密钥经 VaultStore（AES-256-GCM）加密后存入 nm_credential_ref.cipher_text，
// 绝不以明文回传 Web（见 docs/12-ftp-module.md 安全一节）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"

	"niuma/platform/internal/store"
)

const (
	// credentialServicePrefix 是凭据在 VaultStore 中的 service 前缀，与 store.credentialServicePrefix 保持一致。
	credentialServicePrefix = "NiuMa/credential/"
	// credentialSecretAccount 是凭据 service 下固定的 account 名。
	credentialSecretAccount = "secret"
	// credentialKindPassword 表示密码类凭据。
	credentialKindPassword = "password"
	// connectionKindFTP 表示 FTP/FTPS 连接（是否加密由 connection_options 区分）。
	connectionKindFTP = "ftp"
	// defaultWorkspaceID 是本地单工作区的默认 ID。
	defaultWorkspaceID = "default"
)

// connectionProfileInput 是新建/更新连接站点的入参（不含 ID 与审计字段）。
type connectionProfileInput struct {
	WorkspaceID       string          `json:"workspaceId"`
	ProfileName       string          `json:"profileName"`
	ConnectionKind    string          `json:"connectionKind"`
	HostAddress       string          `json:"hostAddress"`
	PortNumber        int             `json:"portNumber"`
	LoginAccount      string          `json:"loginAccount"`
	ConnectionOptions json.RawMessage `json:"connectionOptions"`
}

// credentialInput 是写入/更新凭据的入参；CredentialID 为空表示新建。
type credentialInput struct {
	CredentialID string `json:"credentialId"`
	Label        string `json:"label"`
	Kind         string `json:"kind"`
	Secret       string `json:"secret"`
}

// connectionProfileView 是回传 Web 的连接站点视图（camelCase，不含密码）。
type connectionProfileView struct {
	ProfileID         string          `json:"profileId"`
	WorkspaceID       string          `json:"workspaceId"`
	ProfileName       string          `json:"profileName"`
	ConnectionKind    string          `json:"connectionKind"`
	HostAddress       string          `json:"hostAddress"`
	PortNumber        int             `json:"portNumber"`
	LoginAccount      string          `json:"loginAccount"`
	ConnectionOptions json.RawMessage `json:"connectionOptions"`
	RecordStatus      string          `json:"recordStatus"`
	RowVersion        int64           `json:"rowVersion"`
	CreatedAt         string          `json:"createdAt"`
	UpdatedAt         string          `json:"updatedAt"`
	CredentialIDs     []string        `json:"credentialIds"`
}

// toProfileView 把 store 层实体转换为回传视图。
func toProfileView(p store.ConnectionProfile) connectionProfileView {
	options := p.ConnectionOptions
	if options == "" {
		options = "{}"
	}
	ids := p.CredentialIDs
	if ids == nil {
		ids = []string{}
	}
	return connectionProfileView{
		ProfileID:         p.ProfileID,
		WorkspaceID:       p.WorkspaceID,
		ProfileName:       p.ProfileName,
		ConnectionKind:    p.ConnectionKind,
		HostAddress:       p.HostAddress,
		PortNumber:        p.PortNumber,
		LoginAccount:      p.LoginAccount,
		ConnectionOptions: json.RawMessage(options),
		RecordStatus:      p.RecordStatus,
		RowVersion:        p.RowVersion,
		CreatedAt:         p.CreatedAt,
		UpdatedAt:         p.UpdatedAt,
		CredentialIDs:     ids,
	}
}

// connectionList 处理 platform.connection.list。
func (d *Dispatcher) connectionList(ctx context.Context, req Request) Response {
	var params struct {
		WorkspaceID string `json:"workspaceId"`
		Kind        string `json:"kind"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}

	profiles, err := d.connections.List(ctx, params.WorkspaceID, params.Kind)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	views := make([]connectionProfileView, 0, len(profiles))
	for _, p := range profiles {
		views = append(views, toProfileView(p))
	}
	return okResponse(req.ID, map[string]any{"profiles": views})
}

// connectionGet 处理 platform.connection.get；不存在时 profile 为 null。
func (d *Dispatcher) connectionGet(ctx context.Context, req Request) Response {
	var params struct {
		ProfileID string `json:"profileId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ProfileID == "" {
		return errorResponse(req.ID, "profileId required")
	}

	p, err := d.connections.Get(ctx, params.ProfileID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if p == nil {
		return okResponse(req.ID, map[string]any{"profile": nil})
	}
	return okResponse(req.ID, map[string]any{"profile": toProfileView(*p)})
}

// connectionCreate 处理 platform.connection.create：可携带凭据一并落地。
func (d *Dispatcher) connectionCreate(ctx context.Context, req Request) Response {
	var params struct {
		Profile    connectionProfileInput `json:"profile"`
		Credential *credentialInput       `json:"credential"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Profile.ProfileName == "" {
		return errorResponse(req.ID, "profileName required")
	}

	profileID, err := d.ids.NextString()
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}

	var credentialID string
	if params.Credential != nil && params.Credential.Secret != "" {
		id, credErr := d.storeCredential(ctx, *params.Credential)
		if credErr != nil {
			return errorResponse(req.ID, credErr.Error())
		}
		credentialID = id
	}

	workspaceID := params.Profile.WorkspaceID
	if workspaceID == "" {
		workspaceID = defaultWorkspaceID
	}
	kind := params.Profile.ConnectionKind
	if kind == "" {
		kind = connectionKindFTP
	}

	if err := d.connections.Create(ctx, store.ConnectionProfile{
		ProfileID:         profileID,
		WorkspaceID:       workspaceID,
		ProfileName:       params.Profile.ProfileName,
		ConnectionKind:    kind,
		HostAddress:       params.Profile.HostAddress,
		PortNumber:        params.Profile.PortNumber,
		LoginAccount:      params.Profile.LoginAccount,
		ConnectionOptions: string(params.Profile.ConnectionOptions),
	}); err != nil {
		return errorResponse(req.ID, err.Error())
	}

	if credentialID != "" {
		if err := d.connections.LinkCredential(ctx, profileID, credentialID); err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	return okResponse(req.ID, map[string]any{"profileId": profileID})
}

// connectionUpdate 处理 platform.connection.update（乐观锁）；可携带凭据更新密码。
func (d *Dispatcher) connectionUpdate(ctx context.Context, req Request) Response {
	var params struct {
		ProfileID  string                 `json:"profileId"`
		Profile    connectionProfileInput `json:"profile"`
		RowVersion int64                  `json:"rowVersion"`
		Credential *credentialInput       `json:"credential"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ProfileID == "" {
		return errorResponse(req.ID, "profileId required")
	}

	kind := params.Profile.ConnectionKind
	if kind == "" {
		kind = connectionKindFTP
	}

	newVersion, ok, err := d.connections.Update(ctx, store.ConnectionProfile{
		ProfileID:         params.ProfileID,
		ProfileName:       params.Profile.ProfileName,
		ConnectionKind:    kind,
		HostAddress:       params.Profile.HostAddress,
		PortNumber:        params.Profile.PortNumber,
		LoginAccount:      params.Profile.LoginAccount,
		ConnectionOptions: string(params.Profile.ConnectionOptions),
	}, params.RowVersion)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if !ok {
		return errorResponse(req.ID, "profile not found or version conflict")
	}

	if params.Credential != nil && params.Credential.Secret != "" {
		if err := d.applyCredentialToProfile(ctx, params.ProfileID, *params.Credential); err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	return okResponse(req.ID, map[string]any{"updated": true, "rowVersion": newVersion})
}

// connectionDelete 处理 platform.connection.delete：删站点并回收孤儿凭据。
func (d *Dispatcher) connectionDelete(ctx context.Context, req Request) Response {
	var params struct {
		ProfileID string `json:"profileId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ProfileID == "" {
		return errorResponse(req.ID, "profileId required")
	}

	credentialIDs, err := d.connections.UnlinkByProfile(ctx, params.ProfileID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if err := d.connections.Delete(ctx, params.ProfileID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	for _, credentialID := range credentialIDs {
		if err := d.deleteCredentialIfOrphan(ctx, credentialID); err != nil {
			return errorResponse(req.ID, err.Error())
		}
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// credentialGet 处理 platform.credential.get：按 profileId 找到关联的首个凭据并解密，
// 供本地编辑表单回填。
//
// 此接口仅供本地 IPC 调用（Named Pipe / Unix Socket），不走网络。
// 若站点无凭据或解密失败，secret 返回空字符串、found 为 false。
func (d *Dispatcher) credentialGet(ctx context.Context, req Request) Response {
	var params struct {
		ProfileID string `json:"profileId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ProfileID == "" {
		return errorResponse(req.ID, "profileId required")
	}

	p, err := d.connections.Get(ctx, params.ProfileID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if p == nil || len(p.CredentialIDs) == 0 {
		return okResponse(req.ID, map[string]any{"secret": "", "found": false})
	}

	ref, err := d.credentials.Get(ctx, p.CredentialIDs[0])
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if ref == nil {
		return okResponse(req.ID, map[string]any{"secret": "", "found": false})
	}

	secret, ok, err := d.secrets.GetSecret(credentialServicePrefix+ref.CredentialID, credentialSecretAccount)
	if err != nil {
		return errorResponse(req.ID, fmt.Sprintf("vault: %v", err))
	}
	if !ok {
		return okResponse(req.ID, map[string]any{"secret": "", "found": false})
	}
	return okResponse(req.ID, map[string]any{"secret": secret, "found": true})
}

// credentialSet 处理 platform.credential.set。
func (d *Dispatcher) credentialSet(ctx context.Context, req Request) Response {
	var params credentialInput
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Secret == "" {
		return errorResponse(req.ID, "secret required")
	}

	credentialID, err := d.storeCredential(ctx, params)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"credentialId": credentialID})
}

// credentialDelete 处理 platform.credential.delete：删关联、密钥与引用行。
func (d *Dispatcher) credentialDelete(ctx context.Context, req Request) Response {
	var params struct {
		CredentialID string `json:"credentialId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.CredentialID == "" {
		return errorResponse(req.ID, "credentialId required")
	}

	if err := d.connections.UnlinkByCredential(ctx, params.CredentialID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if err := d.deleteCredential(ctx, params.CredentialID); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// applyCredentialToProfile 为站点写入或更新凭据并建立关联。
func (d *Dispatcher) applyCredentialToProfile(ctx context.Context, profileID string, input credentialInput) error {
	p, err := d.connections.Get(ctx, profileID)
	if err != nil {
		return err
	}
	if p == nil {
		return fmt.Errorf("handler: profile not found: %s", profileID)
	}
	if len(p.CredentialIDs) > 0 {
		input.CredentialID = p.CredentialIDs[0]
	}
	credentialID, err := d.storeCredential(ctx, input)
	if err != nil {
		return err
	}
	return d.connections.LinkCredential(ctx, profileID, credentialID)
}

// storeCredential 写入（或更新）凭据并维护 nm_credential_ref，返回凭据 ID。
// input.CredentialID 为空则新建；新建时先插入引用行，再加密写入密文。
func (d *Dispatcher) storeCredential(ctx context.Context, input credentialInput) (string, error) {
	kind := input.Kind
	if kind == "" {
		kind = credentialKindPassword
	}

	if input.CredentialID == "" {
		credentialID, err := d.ids.NextString()
		if err != nil {
			return "", err
		}
		label := input.Label
		if label == "" {
			// credential_label 有唯一索引，空标签会冲突，故回退为按 ID 生成的唯一名。
			label = "credential-" + credentialID
		}
		// 先建引用行（cipher_text 为空），再加密写入密文（UPDATE）。
		if err := d.credentials.Create(ctx, store.CredentialRef{
			CredentialID:    credentialID,
			CredentialLabel: label,
			CredentialKind:  kind,
		}); err != nil {
			return "", err
		}
		if err := d.secrets.SetSecret(credentialServicePrefix+credentialID, credentialSecretAccount, input.Secret); err != nil {
			return "", err
		}
		return credentialID, nil
	}

	ref, err := d.credentials.Get(ctx, input.CredentialID)
	if err != nil {
		return "", err
	}
	if ref == nil {
		return "", fmt.Errorf("handler: credential not found: %s", input.CredentialID)
	}
	if err := d.secrets.SetSecret(credentialServicePrefix+input.CredentialID, credentialSecretAccount, input.Secret); err != nil {
		return "", err
	}
	if input.Label != "" && input.Label != ref.CredentialLabel {
		if err := d.credentials.UpdateLabel(ctx, input.CredentialID, input.Label); err != nil {
			return "", err
		}
	}
	return input.CredentialID, nil
}

// deleteCredentialIfOrphan 在凭据不再被任何站点引用时删除它。
func (d *Dispatcher) deleteCredentialIfOrphan(ctx context.Context, credentialID string) error {
	profileIDs, err := d.connections.ListProfileIDsByCredential(ctx, credentialID)
	if err != nil {
		return err
	}
	if len(profileIDs) > 0 {
		return nil
	}
	return d.deleteCredential(ctx, credentialID)
}

// deleteCredential 删除凭据引用行（cipher_text 随行一起消失）。
func (d *Dispatcher) deleteCredential(ctx context.Context, credentialID string) error {
	// DeleteSecret 在 VaultStore 下为幂等空操作；在测试替身（memSecretStore）下会清除内存条目。
	_ = d.secrets.DeleteSecret(credentialServicePrefix+credentialID, credentialSecretAccount)
	return d.credentials.Delete(ctx, credentialID)
}
