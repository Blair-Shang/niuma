// 本文件实现连接站点（nm_connection_profile）与凭据（nm_credential_ref）相关的 Bridge 方法。
// 明文密钥经 VaultStore（AES-256-GCM）加密后存入 nm_credential_ref.cipher_text，
// 绝不以明文回传 Web（见 docs/12-ftp-module.md 安全一节）。
package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"niuma/platform/internal/store"
)

// 连接导入导出包版本（与 Web 约定一致；不含凭据明文）。
const connectionBundleVersion = 1

// connectionExportProfile 是导出包中的单条连接（exportId 供前端组织层映射）。
type connectionExportProfile struct {
	ExportID          string          `json:"exportId"`
	ProfileName       string          `json:"profileName"`
	ConnectionKind    string          `json:"connectionKind"`
	HostAddress       string          `json:"hostAddress"`
	PortNumber        int             `json:"portNumber"`
	LoginAccount      string          `json:"loginAccount"`
	ConnectionOptions json.RawMessage `json:"connectionOptions"`
}

// connectionExportBundle 是 platform.connection.export / import 的文件格式。
// organization 为前端文件夹结构（opaque 透传）；platform 只负责 profiles 落地。
// secrets 为可选的口令加密凭据信封；无此字段则导入后不含密码。
type connectionExportBundle struct {
	Version      int                       `json:"version"`
	ExportedAt   string                    `json:"exportedAt"`
	Profiles     []connectionExportProfile `json:"profiles"`
	Organization json.RawMessage           `json:"organization,omitempty"`
	Secrets      *connectionBundleSecrets  `json:"secrets,omitempty"`
}

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

// connectionExport 处理 platform.connection.export：
// 将指定（或全部）连接配置写入本机 JSON 文件。
// includeSecrets=true 时用 passphrase 加密凭据写入 secrets 信封（明文不落盘）。
// organization 由前端传入（文件夹结构），platform 原样写入文件。
func (d *Dispatcher) connectionExport(ctx context.Context, req Request) Response {
	var params struct {
		Path           string          `json:"path"`
		ProfileIDs     []string        `json:"profileIds"`
		Organization   json.RawMessage `json:"organization"`
		IncludeSecrets bool            `json:"includeSecrets"`
		Passphrase     string          `json:"passphrase"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		slog.Warn("connection.export invalid params", "err", err)
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Path == "" {
		return errorResponse(req.ID, "path required")
	}
	if params.IncludeSecrets && strings.TrimSpace(params.Passphrase) == "" {
		return errorResponse(req.ID, "passphrase required when includeSecrets")
	}

	slog.Info("connection.export start",
		"path", params.Path,
		"requestedIds", len(params.ProfileIDs),
		"includeSecrets", params.IncludeSecrets,
	)

	var profiles []store.ConnectionProfile
	if len(params.ProfileIDs) == 0 {
		listed, err := d.connections.List(ctx, "", "")
		if err != nil {
			slog.Error("connection.export list failed", "err", err)
			return errorResponse(req.ID, err.Error())
		}
		profiles = listed
	} else {
		seen := make(map[string]struct{}, len(params.ProfileIDs))
		for _, id := range params.ProfileIDs {
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			p, err := d.connections.Get(ctx, id)
			if err != nil {
				slog.Error("connection.export get failed", "profileId", id, "err", err)
				return errorResponse(req.ID, err.Error())
			}
			if p != nil {
				profiles = append(profiles, *p)
			} else {
				slog.Warn("connection.export profile missing", "profileId", id)
			}
		}
	}

	if len(profiles) == 0 {
		slog.Warn("connection.export empty", "path", params.Path)
		return errorResponse(req.ID, "no profiles to export")
	}

	exportProfiles := make([]connectionExportProfile, 0, len(profiles))
	for _, p := range profiles {
		opts, err := sanitizeConnectionOptionsJSON(p.ConnectionOptions)
		if err != nil {
			slog.Error("connection.export sanitize failed", "profileId", p.ProfileID, "err", err)
			return errorResponse(req.ID, fmt.Sprintf("sanitize options: %v", err))
		}
		exportProfiles = append(exportProfiles, connectionExportProfile{
			ExportID:          p.ProfileID,
			ProfileName:       p.ProfileName,
			ConnectionKind:    p.ConnectionKind,
			HostAddress:       p.HostAddress,
			PortNumber:        p.PortNumber,
			LoginAccount:      p.LoginAccount,
			ConnectionOptions: opts,
		})
	}

	bundle := connectionExportBundle{
		Version:      connectionBundleVersion,
		ExportedAt:   time.Now().UTC().Format(time.RFC3339),
		Profiles:     exportProfiles,
		Organization: normalizeOrganizationJSON(params.Organization),
	}

	secretCount := 0
	if params.IncludeSecrets {
		payload := connectionSecretsPayload{ByExportID: map[string]connectionSecretEntry{}}
		for _, p := range profiles {
			entry, err := d.loadProfileSecretEntry(ctx, p)
			if err != nil {
				slog.Error("connection.export load secret failed", "profileId", p.ProfileID, "err", err)
				return errorResponse(req.ID, err.Error())
			}
			if entry != nil {
				payload.ByExportID[p.ProfileID] = *entry
				secretCount++
			}
		}
		env, err := encryptBundleSecrets(params.Passphrase, payload)
		if err != nil {
			slog.Error("connection.export encrypt secrets failed", "err", err)
			return errorResponse(req.ID, err.Error())
		}
		bundle.Secrets = env
	}

	raw, err := json.MarshalIndent(bundle, "", "  ")
	if err != nil {
		slog.Error("connection.export marshal failed", "err", err)
		return errorResponse(req.ID, err.Error())
	}
	raw = append(raw, '\n')
	if err := os.WriteFile(params.Path, raw, 0o644); err != nil {
		slog.Error("connection.export write failed", "path", params.Path, "err", err)
		return errorResponse(req.ID, fmt.Sprintf("write file: %v", err))
	}

	slog.Info("connection.export done",
		"path", params.Path,
		"exported", len(exportProfiles),
		"includeSecrets", params.IncludeSecrets,
		"secretCount", secretCount,
	)
	return okResponse(req.ID, map[string]any{
		"exported":       len(exportProfiles),
		"path":           params.Path,
		"includeSecrets": params.IncludeSecrets,
	})
}

// connectionImport 处理 platform.connection.import：
// 从本机 JSON 读取连接配置并新建站点（追加，不覆盖已有）。
// 同名站点自动加后缀，避免 uk_nm_conn_profile_name 冲突导致全部跳过。
// 若文件含 secrets 信封，须提供正确 passphrase，解密后写入本机 Vault。
// 返回 idMap（exportId → newProfileId）与 organization，供前端还原文件夹。
func (d *Dispatcher) connectionImport(ctx context.Context, req Request) Response {
	var params struct {
		Path       string `json:"path"`
		Passphrase string `json:"passphrase"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		slog.Warn("connection.import invalid params", "err", err)
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.Path == "" {
		return errorResponse(req.ID, "path required")
	}

	slog.Info("connection.import start", "path", params.Path, "hasPassphrase", strings.TrimSpace(params.Passphrase) != "")

	raw, err := os.ReadFile(params.Path)
	if err != nil {
		slog.Error("connection.import read failed", "path", params.Path, "err", err)
		return errorResponse(req.ID, fmt.Sprintf("read file: %v", err))
	}

	var bundle connectionExportBundle
	if err := json.Unmarshal(raw, &bundle); err != nil {
		slog.Warn("connection.import invalid json", "path", params.Path, "err", err)
		return errorResponse(req.ID, "invalid connection bundle json")
	}
	if bundle.Version != connectionBundleVersion {
		slog.Warn("connection.import unsupported version", "version", bundle.Version)
		return errorResponse(req.ID, "unsupported connection bundle version")
	}
	if len(bundle.Profiles) == 0 {
		slog.Warn("connection.import empty bundle", "path", params.Path)
		return errorResponse(req.ID, "no profiles in bundle")
	}

	var secretsMap map[string]connectionSecretEntry
	if bundle.Secrets != nil {
		payload, decErr := decryptBundleSecrets(params.Passphrase, bundle.Secrets)
		if decErr != nil {
			slog.Warn("connection.import decrypt secrets failed", "err", decErr)
			return errorResponse(req.ID, decErr.Error())
		}
		secretsMap = payload.ByExportID
		slog.Info("connection.import secrets decrypted", "secretCount", len(secretsMap))
	}

	idMap := make(map[string]string, len(bundle.Profiles))
	imported := 0
	skipped := 0
	withSecrets := 0
	renamed := 0

	for _, item := range bundle.Profiles {
		name := strings.TrimSpace(item.ProfileName)
		kind := strings.TrimSpace(item.ConnectionKind)
		if name == "" || kind == "" {
			skipped++
			slog.Warn("connection.import skip invalid profile", "exportId", item.ExportID, "name", name, "kind", kind)
			continue
		}
		opts, err := sanitizeConnectionOptionsJSON(string(item.ConnectionOptions))
		if err != nil {
			skipped++
			slog.Warn("connection.import skip sanitize", "name", name, "err", err)
			continue
		}

		finalName, renameErr := d.resolveUniqueProfileName(ctx, defaultWorkspaceID, name)
		if renameErr != nil {
			slog.Error("connection.import resolve name failed", "name", name, "err", renameErr)
			return errorResponse(req.ID, renameErr.Error())
		}
		if finalName != name {
			renamed++
			slog.Info("connection.import renamed for uniqueness", "from", name, "to", finalName)
		}

		profileID, err := d.ids.NextString()
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
		if err := d.connections.Create(ctx, store.ConnectionProfile{
			ProfileID:         profileID,
			WorkspaceID:       defaultWorkspaceID,
			ProfileName:       finalName,
			ConnectionKind:    kind,
			HostAddress:       item.HostAddress,
			PortNumber:        item.PortNumber,
			LoginAccount:      item.LoginAccount,
			ConnectionOptions: string(opts),
		}); err != nil {
			skipped++
			slog.Warn("connection.import create failed", "name", finalName, "kind", kind, "err", err)
			continue
		}

		if entry, ok := secretsMap[item.ExportID]; ok && strings.TrimSpace(entry.Secret) != "" {
			credKind := strings.TrimSpace(entry.Kind)
			if credKind == "" {
				credKind = credentialKindPassword
			}
			// 凭据标签全局唯一：留空由 storeCredential 生成 credential-{id}，避免与已有标签冲突。
			credID, credErr := d.storeCredential(ctx, credentialInput{
				Label:  "",
				Kind:   credKind,
				Secret: entry.Secret,
			})
			if credErr != nil {
				slog.Error("connection.import store credential failed", "profileId", profileID, "err", credErr)
				return errorResponse(req.ID, credErr.Error())
			}
			if linkErr := d.connections.LinkCredential(ctx, profileID, credID); linkErr != nil {
				slog.Error("connection.import link credential failed", "profileId", profileID, "err", linkErr)
				return errorResponse(req.ID, linkErr.Error())
			}
			withSecrets++
		}

		if item.ExportID != "" {
			idMap[item.ExportID] = profileID
		}
		imported++
	}

	if imported == 0 {
		slog.Warn("connection.import none imported",
			"path", params.Path,
			"bundleCount", len(bundle.Profiles),
			"skipped", skipped,
		)
		return errorResponse(req.ID, "no profiles imported")
	}

	slog.Info("connection.import done",
		"path", params.Path,
		"imported", imported,
		"skipped", skipped,
		"renamed", renamed,
		"withSecrets", withSecrets,
		"hasSecrets", bundle.Secrets != nil,
	)
	return okResponse(req.ID, map[string]any{
		"imported":     imported,
		"skipped":      skipped,
		"renamed":      renamed,
		"withSecrets":  withSecrets,
		"idMap":        idMap,
		"organization": normalizeOrganizationJSON(bundle.Organization),
		"hasSecrets":   bundle.Secrets != nil,
	})
}

// resolveUniqueProfileName 在工作区内生成不冲突的站点名（同名追加 " (2)"…）。
func (d *Dispatcher) resolveUniqueProfileName(ctx context.Context, workspaceID, base string) (string, error) {
	candidate := base
	for i := 2; i <= 999; i++ {
		exists, err := d.connections.ExistsByName(ctx, workspaceID, candidate)
		if err != nil {
			return "", err
		}
		if !exists {
			return candidate, nil
		}
		candidate = fmt.Sprintf("%s (%d)", base, i)
	}
	return "", fmt.Errorf("too many name conflicts for profile %q", base)
}

// loadProfileSecretEntry 从本机 Vault 读取站点首个凭据明文（仅导出加密用，短暂驻留内存）。
func (d *Dispatcher) loadProfileSecretEntry(ctx context.Context, p store.ConnectionProfile) (*connectionSecretEntry, error) {
	if len(p.CredentialIDs) == 0 {
		return nil, nil
	}
	ref, err := d.credentials.Get(ctx, p.CredentialIDs[0])
	if err != nil {
		return nil, err
	}
	if ref == nil {
		return nil, nil
	}
	secret, ok, err := d.secrets.GetSecret(credentialServicePrefix+ref.CredentialID, credentialSecretAccount)
	if err != nil {
		return nil, fmt.Errorf("vault: %v", err)
	}
	if !ok || secret == "" {
		return nil, nil
	}
	kind := ref.CredentialKind
	if kind == "" {
		kind = credentialKindPassword
	}
	return &connectionSecretEntry{Kind: kind, Secret: secret}, nil
}

// sanitizeConnectionOptionsJSON 去掉 options 中可能残留的明文敏感字段。
func sanitizeConnectionOptionsJSON(raw string) (json.RawMessage, error) {
	if raw == "" {
		return json.RawMessage("{}"), nil
	}
	var obj map[string]any
	if err := json.Unmarshal([]byte(raw), &obj); err != nil {
		// 非法 JSON 回退为空对象，避免阻断导出
		return json.RawMessage("{}"), nil
	}
	if proxy, ok := obj["proxy"].(map[string]any); ok {
		delete(proxy, "password")
		obj["proxy"] = proxy
	}
	if tunnel, ok := obj["tunnel"].(map[string]any); ok {
		delete(tunnel, "sshProfile")
		obj["tunnel"] = tunnel
	}
	// Oracle Wallet 等可能把口令误存进 options；导出时剥离。
	delete(obj, "wallet_password")
	delete(obj, "walletPassword")
	out, err := json.Marshal(obj)
	if err != nil {
		return nil, err
	}
	return json.RawMessage(out), nil
}

func normalizeOrganizationJSON(raw json.RawMessage) json.RawMessage {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	return raw
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
