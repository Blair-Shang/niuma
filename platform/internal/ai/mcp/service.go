package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"strings"

	"niuma/platform/internal/store"
)

// MCPServerView 是 Bridge 回传的 Server 视图。
type MCPServerView struct {
	ServerID      string `json:"serverId"`
	ServerName    string `json:"serverName"`
	TransportKind string `json:"transportKind"`
	EndpointURL   string `json:"endpointUrl,omitempty"`
	CommandPath   string `json:"commandPath,omitempty"`
	LaunchOptions string `json:"launchOptions"`
	HasCredential bool   `json:"hasCredential"`
	RecordStatus  string `json:"recordStatus"`
	SortOrder     int64  `json:"sortOrder"`
	RowVersion    int64  `json:"rowVersion"`
	CreatedAt     string `json:"createdAt"`
	UpdatedAt     string `json:"updatedAt"`
	Tools         []MCPToolView `json:"tools,omitempty"`
}

// MCPToolView 是 Bridge 回传的 Tool 视图。
type MCPToolView struct {
	ToolID          string `json:"toolId"`
	ServerID        string `json:"serverId"`
	ToolName        string `json:"toolName"`
	ToolTitle       string `json:"toolTitle,omitempty"`
	ToolDescription string `json:"toolDescription,omitempty"`
	InputSchema     string `json:"inputSchema"`
	Enabled         bool   `json:"enabled"`
	RiskLevel       string `json:"riskLevel"`
	DiscoveredAt    string `json:"discoveredAt"`
}

// MCPUpsertParams 新建或更新 MCP Server。
type MCPUpsertParams struct {
	ServerID      string
	ServerName    string
	TransportKind string
	EndpointURL   string
	CommandPath   string
	LaunchOptions string
	RecordStatus  string
	SortOrder     int64
	RowVersion    int64
	CredentialID  string // 已由 handler 经 Vault 写入后的引用；可空
}

func toMCPServerView(s store.AIMCPServer, tools []store.AIMCPTool) MCPServerView {
	v := MCPServerView{
		ServerID:      s.ServerID,
		ServerName:    s.ServerName,
		TransportKind: s.TransportKind,
		EndpointURL:   s.EndpointURL,
		CommandPath:   s.CommandPath,
		LaunchOptions: s.LaunchOptions,
		HasCredential: s.CredentialID != "",
		RecordStatus:  s.RecordStatus,
		SortOrder:     s.SortOrder,
		RowVersion:    s.RowVersion,
		CreatedAt:     s.CreatedAt,
		UpdatedAt:     s.UpdatedAt,
	}
	if len(tools) > 0 {
		v.Tools = make([]MCPToolView, 0, len(tools))
		for _, t := range tools {
			v.Tools = append(v.Tools, toMCPToolView(t))
		}
	}
	return v
}

func toMCPToolView(t store.AIMCPTool) MCPToolView {
	risk := t.RiskLevel
	if risk == "" {
		risk = InferToolRisk(t.ToolName)
	}
	return MCPToolView{
		ToolID:          t.ToolID,
		ServerID:        t.ServerID,
		ToolName:        t.ToolName,
		ToolTitle:       t.ToolTitle,
		ToolDescription: t.ToolDescription,
		InputSchema:     t.InputSchema,
		Enabled:         t.Enabled,
		RiskLevel:       NormalizeRiskLevel(risk),
		DiscoveredAt:    t.DiscoveredAt,
	}
}

// ListMCPServers 列出 MCP Server（可选附带 tools）。
func (s *Service) ListMCPServers(ctx context.Context, status string, withTools bool) ([]MCPServerView, error) {
	if s == nil || s.MCP == nil {
		return nil, fmt.Errorf("ai: mcp store unavailable")
	}
	list, err := s.MCP.ListServers(ctx, status)
	if err != nil {
		return nil, err
	}
	out := make([]MCPServerView, 0, len(list))
	for _, srv := range list {
		var tools []store.AIMCPTool
		if withTools {
			tools, err = s.MCP.ListTools(ctx, srv.ServerID)
			if err != nil {
				return nil, err
			}
		}
		out = append(out, toMCPServerView(srv, tools))
	}
	return out, nil
}

// GetMCPServer 读取单个 Server + tools。
func (s *Service) GetMCPServer(ctx context.Context, serverID string) (*MCPServerView, error) {
	if s == nil || s.MCP == nil {
		return nil, fmt.Errorf("ai: mcp store unavailable")
	}
	srv, err := s.MCP.GetServer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if srv == nil {
		return nil, nil
	}
	tools, err := s.MCP.ListTools(ctx, serverID)
	if err != nil {
		return nil, err
	}
	v := toMCPServerView(*srv, tools)
	return &v, nil
}

// UpsertMCPServer 新建或更新 MCP Server。
func (s *Service) UpsertMCPServer(ctx context.Context, params MCPUpsertParams) (*MCPServerView, error) {
	if s == nil || s.MCP == nil || s.ids == nil {
		return nil, fmt.Errorf("ai: mcp store unavailable")
	}
	name := strings.TrimSpace(params.ServerName)
	if name == "" {
		return nil, fmt.Errorf("ai: serverName required")
	}
	kind := strings.TrimSpace(params.TransportKind)
	if kind == "" {
		kind = "stdio"
	}
	switch kind {
	case "stdio", "sse", "streamable_http":
	default:
		return nil, fmt.Errorf("ai: unsupported transportKind %q", kind)
	}
	launch := strings.TrimSpace(params.LaunchOptions)
	if launch == "" {
		launch = "{}"
	}
	if !json.Valid([]byte(launch)) {
		return nil, fmt.Errorf("ai: launchOptions must be JSON")
	}
	status := strings.TrimSpace(params.RecordStatus)
	if status == "" {
		status = "active"
	}

	serverID := strings.TrimSpace(params.ServerID)
	var existing *store.AIMCPServer
	var err error
	if serverID != "" {
		existing, err = s.MCP.GetServer(ctx, serverID)
		if err != nil {
			return nil, err
		}
	}

	row := store.AIMCPServer{
		ServerName:    name,
		TransportKind: kind,
		EndpointURL:   strings.TrimSpace(params.EndpointURL),
		CommandPath:   strings.TrimSpace(params.CommandPath),
		LaunchOptions: launch,
		CredentialID:  strings.TrimSpace(params.CredentialID),
		RecordStatus:  status,
		SortOrder:     params.SortOrder,
	}

	if existing == nil {
		if serverID == "" {
			serverID, err = s.ids.NextString()
			if err != nil {
				return nil, err
			}
		}
		row.ServerID = serverID
		if err := s.MCP.CreateServer(ctx, row); err != nil {
			return nil, err
		}
	} else {
		row.ServerID = existing.ServerID
		_, ok, err := s.MCP.UpdateServer(ctx, row, params.RowVersion)
		if err != nil {
			return nil, err
		}
		if !ok {
			return nil, fmt.Errorf("ai: mcp server conflict (rowVersion)")
		}
		serverID = existing.ServerID
	}
	return s.GetMCPServer(ctx, serverID)
}

// DeleteMCPServer 删除 Server 及其工具缓存（凭据由 handler 清理）。
func (s *Service) DeleteMCPServer(ctx context.Context, serverID string) (*store.AIMCPServer, error) {
	if s == nil || s.MCP == nil {
		return nil, fmt.Errorf("ai: mcp store unavailable")
	}
	srv, err := s.MCP.GetServer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if srv == nil {
		return nil, nil
	}
	if err := s.MCP.DeleteToolsByServer(ctx, serverID); err != nil {
		return nil, err
	}
	if err := s.MCP.DeleteServer(ctx, serverID); err != nil {
		return nil, err
	}
	return srv, nil
}

// RefreshMCPTools 发现工具并写入缓存。
func (s *Service) RefreshMCPTools(ctx context.Context, serverID string) (*MCPServerView, error) {
	if s == nil || s.MCP == nil || s.ids == nil {
		return nil, fmt.Errorf("ai: mcp store unavailable")
	}
	srv, err := s.MCP.GetServer(ctx, serverID)
	if err != nil {
		return nil, err
	}
	if srv == nil {
		return nil, fmt.Errorf("ai: mcp server not found")
	}

	var discovered []DiscoveredTool
	bearer := s.mcpBearerToken(srv.CredentialID)
	switch srv.TransportKind {
	case "stdio":
		discovered, err = ListMCPToolsStdio(ctx, srv.CommandPath, srv.LaunchOptions)
	case "streamable_http":
		discovered, err = ListMCPToolsHTTP(ctx, srv.EndpointURL, srv.LaunchOptions, bearer)
	default:
		return nil, fmt.Errorf("ai: mcp refresh not implemented for transport %q", srv.TransportKind)
	}
	if err != nil {
		return nil, err
	}

	existing, err := s.MCP.ListTools(ctx, serverID)
	if err != nil {
		return nil, err
	}
	byName := make(map[string]store.AIMCPTool, len(existing))
	for _, t := range existing {
		byName[t.ToolName] = t
	}
	seen := make(map[string]struct{}, len(discovered))
	for _, d := range discovered {
		seen[d.Name] = struct{}{}
		toolID := ""
		enabled := true
		if old, ok := byName[d.Name]; ok {
			toolID = old.ToolID
			enabled = old.Enabled
		} else {
			toolID, err = s.ids.NextString()
			if err != nil {
				return nil, err
			}
		}
		schema := string(d.InputSchema)
		if schema == "" {
			schema = "{}"
		}
		risk := InferToolRisk(d.Name)
		if old, ok := byName[d.Name]; ok && old.RiskLevel != "" {
			risk = old.RiskLevel
		}
		if err := s.MCP.UpsertDiscoveredTool(ctx, store.AIMCPTool{
			ToolID:          toolID,
			ServerID:        serverID,
			ToolName:        d.Name,
			ToolTitle:       d.Title,
			ToolDescription: d.Description,
			InputSchema:     schema,
			Enabled:         enabled,
			RiskLevel:       risk,
		}); err != nil {
			return nil, err
		}
	}
	// 删除本次未发现的旧工具
	for name, old := range byName {
		if _, ok := seen[name]; ok {
			continue
		}
		_ = s.MCP.DeleteTool(ctx, old.ToolID)
		_ = name
	}

	return s.GetMCPServer(ctx, serverID)
}

// SetMCPToolEnabled 启用/禁用工具。
func (s *Service) SetMCPToolEnabled(ctx context.Context, toolID string, enabled bool) error {
	if s == nil || s.MCP == nil {
		return fmt.Errorf("ai: mcp store unavailable")
	}
	return s.MCP.SetToolEnabled(ctx, toolID, enabled)
}

// SetMCPToolRiskLevel 设置工具风险等级（Policy Gate）。
func (s *Service) SetMCPToolRiskLevel(ctx context.Context, toolID, riskLevel string) error {
	if s == nil || s.MCP == nil {
		return fmt.Errorf("ai: mcp store unavailable")
	}
	risk := strings.ToLower(strings.TrimSpace(riskLevel))
	switch risk {
	case RiskRead, RiskWrite, RiskDangerous:
	default:
		return fmt.Errorf("ai: riskLevel must be read, write, or dangerous")
	}
	return s.MCP.SetToolRiskLevel(ctx, toolID, risk)
}

// SoftDiscoverBuiltinMCP 后台尝试发现内置 Vastbase 只读 MCP 工具缓存。
// 二进制缺失时静默跳过，不阻塞启动；不把工具逻辑编进 platform。
func (s *Service) SoftDiscoverBuiltinMCP(ctx context.Context) {
	if s == nil || s.MCP == nil {
		return
	}
	srv, err := s.MCP.GetServer(ctx, BuiltinMCPVastbaseReadonlyID)
	if err != nil || srv == nil {
		return
	}
	tools, err := s.MCP.ListTools(ctx, BuiltinMCPVastbaseReadonlyID)
	if err != nil {
		return
	}
	if len(tools) > 0 {
		return
	}
	resolved, err := resolveMCPCommandPath(srv.CommandPath)
	if err != nil {
		slog.Info("ai: builtin vastbase MCP binary not found yet", "command", srv.CommandPath, "err", err)
		return
	}
	if _, err := s.RefreshMCPTools(ctx, BuiltinMCPVastbaseReadonlyID); err != nil {
		slog.Warn("ai: builtin vastbase MCP refresh failed", "path", resolved, "err", err)
		return
	}
	slog.Info("ai: builtin vastbase MCP tools discovered", "path", resolved)
}

func (s *Service) mcpBearerToken(credentialID string) string {
	if s == nil || s.secrets == nil || strings.TrimSpace(credentialID) == "" {
		return ""
	}
	secret, ok, err := s.secrets.GetSecret(credentialServicePrefix+credentialID, credentialSecretAccount)
	if err != nil || !ok {
		return ""
	}
	return strings.TrimSpace(secret)
}
