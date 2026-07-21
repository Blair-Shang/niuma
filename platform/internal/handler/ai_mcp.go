package handler

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"

	"niuma/platform/internal/ai"
)

// aiMCPList 处理 platform.ai.mcp.list。
func (d *Dispatcher) aiMCPList(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		Status    string `json:"status"`
		WithTools bool   `json:"withTools"`
	}
	if len(req.Params) > 0 {
		if err := json.Unmarshal(req.Params, &params); err != nil {
			return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
		}
	}
	list, err := svc.ListMCPServers(ctx, params.Status, params.WithTools)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"servers": list})
}

// aiMCPGet 处理 platform.ai.mcp.get。
func (d *Dispatcher) aiMCPGet(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ServerID string `json:"serverId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ServerID == "" {
		return errorResponse(req.ID, "serverId required")
	}
	v, err := svc.GetMCPServer(ctx, params.ServerID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"server": v})
}

// aiMCPUpsert 处理 platform.ai.mcp.upsert。
func (d *Dispatcher) aiMCPUpsert(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ServerID      string `json:"serverId"`
		ServerName    string `json:"serverName"`
		TransportKind string `json:"transportKind"`
		EndpointURL   string `json:"endpointUrl"`
		CommandPath   string `json:"commandPath"`
		LaunchOptions string `json:"launchOptions"`
		RecordStatus  string `json:"recordStatus"`
		SortOrder     int64  `json:"sortOrder"`
		RowVersion    int64  `json:"rowVersion"`
		BearerToken   string `json:"bearerToken"`
		ClearToken    bool   `json:"clearToken"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}

	credentialID := ""
	if params.ServerID != "" {
		existing, err := svc.GetMCPServer(ctx, params.ServerID)
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
		if existing != nil && existing.HasCredential {
			// 保留原 credential：需从 store 再取 ID
			raw, getErr := svc.MCP.GetServer(ctx, params.ServerID)
			if getErr != nil {
				return errorResponse(req.ID, getErr.Error())
			}
			if raw != nil {
				credentialID = raw.CredentialID
			}
		}
	}
	if params.ClearToken && credentialID != "" {
		_ = d.deleteCredential(ctx, credentialID)
		credentialID = ""
	}
	if tok := strings.TrimSpace(params.BearerToken); tok != "" {
		id, err := d.storeCredential(ctx, credentialInput{
			CredentialID: credentialID,
			Label:        "ai-mcp-" + strings.TrimSpace(params.ServerName),
			Kind:         credentialKindAPIKey,
			Secret:       tok,
		})
		if err != nil {
			return errorResponse(req.ID, err.Error())
		}
		credentialID = id
	}

	v, err := svc.UpsertMCPServer(ctx, ai.MCPUpsertParams{
		ServerID:      params.ServerID,
		ServerName:    params.ServerName,
		TransportKind: params.TransportKind,
		EndpointURL:   params.EndpointURL,
		CommandPath:   params.CommandPath,
		LaunchOptions: params.LaunchOptions,
		RecordStatus:  params.RecordStatus,
		SortOrder:     params.SortOrder,
		RowVersion:    params.RowVersion,
		CredentialID:  credentialID,
	})
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"server": v})
}

// aiMCPDelete 处理 platform.ai.mcp.delete。
func (d *Dispatcher) aiMCPDelete(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ServerID string `json:"serverId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ServerID == "" {
		return errorResponse(req.ID, "serverId required")
	}
	srv, err := svc.DeleteMCPServer(ctx, params.ServerID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	if srv != nil && srv.CredentialID != "" {
		_ = d.deleteCredential(ctx, srv.CredentialID)
	}
	return okResponse(req.ID, map[string]any{"deleted": true})
}

// aiMCPRefresh 处理 platform.ai.mcp.refresh。
func (d *Dispatcher) aiMCPRefresh(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ServerID string `json:"serverId"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ServerID == "" {
		return errorResponse(req.ID, "serverId required")
	}
	v, err := svc.RefreshMCPTools(ctx, params.ServerID)
	if err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"server": v})
}

// aiMCPSetToolEnabled 处理 platform.ai.mcp.setToolEnabled。
func (d *Dispatcher) aiMCPSetToolEnabled(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ToolID  string `json:"toolId"`
		Enabled bool   `json:"enabled"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ToolID == "" {
		return errorResponse(req.ID, "toolId required")
	}
	if err := svc.SetMCPToolEnabled(ctx, params.ToolID, params.Enabled); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"ok": true})
}

// aiMCPSetToolRisk 处理 platform.ai.mcp.setToolRisk。
func (d *Dispatcher) aiMCPSetToolRisk(ctx context.Context, req Request) Response {
	svc := d.requireAI()
	if svc == nil {
		return errorResponse(req.ID, "ai service unavailable")
	}
	var params struct {
		ToolID    string `json:"toolId"`
		RiskLevel string `json:"riskLevel"`
	}
	if err := json.Unmarshal(req.Params, &params); err != nil {
		return errorResponse(req.ID, fmt.Sprintf("invalid params: %v", err))
	}
	if params.ToolID == "" {
		return errorResponse(req.ID, "toolId required")
	}
	if err := svc.SetMCPToolRiskLevel(ctx, params.ToolID, params.RiskLevel); err != nil {
		return errorResponse(req.ID, err.Error())
	}
	return okResponse(req.ID, map[string]any{"ok": true})
}
