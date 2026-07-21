package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// AIMCPServer 对应 nm_mcp_server 一行。
type AIMCPServer struct {
	ServerID       string
	ServerName     string
	TransportKind  string // stdio | sse | streamable_http
	EndpointURL    string
	CommandPath    string
	LaunchOptions  string // JSON
	CredentialID   string
	RecordStatus   string
	SortOrder      int64
	RowVersion     int64
	CreatedAt      string
	UpdatedAt      string
}

// AIMCPTool 对应 nm_mcp_tool 一行（发现缓存）。
type AIMCPTool struct {
	ToolID          string
	ServerID        string
	ToolName        string
	ToolTitle       string
	ToolDescription string
	InputSchema     string // JSON
	Enabled         bool
	RiskLevel       string // read | write | dangerous
	DiscoveredAt    string
	CreatedAt       string
	UpdatedAt       string
}

// AIMCPStore 封装 MCP Server / Tool 表读写。
type AIMCPStore struct {
	db *sql.DB
}

// NewAIMCPStore 基于已打开的 SQLite 连接池创建 AIMCPStore。
func NewAIMCPStore(db *sql.DB) *AIMCPStore {
	return &AIMCPStore{db: db}
}

const aiMCPServerColumns = `server_id, server_name, transport_kind, endpoint_url, command_path,
    launch_options, credential_id, record_status, sort_order, row_version, created_at, updated_at`

const aiMCPToolColumns = `tool_id, server_id, tool_name, tool_title, tool_description, input_schema,
    enabled, risk_level, discovered_at, created_at, updated_at`

func scanAIMCPServer(sc rowScanner) (AIMCPServer, error) {
	var (
		s      AIMCPServer
		ep     sql.NullString
		cmd    sql.NullString
		credID sql.NullString
	)
	if err := sc.Scan(
		&s.ServerID, &s.ServerName, &s.TransportKind, &ep, &cmd,
		&s.LaunchOptions, &credID, &s.RecordStatus, &s.SortOrder, &s.RowVersion,
		&s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return AIMCPServer{}, fmt.Errorf("store: scan mcp server: %w", err)
	}
	s.EndpointURL = ep.String
	s.CommandPath = cmd.String
	s.CredentialID = credID.String
	return s, nil
}

func scanAIMCPTool(sc rowScanner) (AIMCPTool, error) {
	var (
		t       AIMCPTool
		title   sql.NullString
		desc    sql.NullString
		enabled int64
	)
	if err := sc.Scan(
		&t.ToolID, &t.ServerID, &t.ToolName, &title, &desc, &t.InputSchema,
		&enabled, &t.RiskLevel, &t.DiscoveredAt, &t.CreatedAt, &t.UpdatedAt,
	); err != nil {
		return AIMCPTool{}, fmt.Errorf("store: scan mcp tool: %w", err)
	}
	t.ToolTitle = title.String
	t.ToolDescription = desc.String
	t.Enabled = enabled != 0
	if t.RiskLevel == "" {
		t.RiskLevel = "read"
	}
	return t, nil
}

// ListServers 返回 MCP Server 列表；status 为空不过滤。
func (s *AIMCPStore) ListServers(ctx context.Context, status string) ([]AIMCPServer, error) {
	query := "SELECT " + aiMCPServerColumns + " FROM nm_mcp_server"
	var args []any
	if status != "" {
		query += " WHERE record_status = ?"
		args = append(args, status)
	}
	query += " ORDER BY sort_order, server_name"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list mcp servers: %w", err)
	}
	defer rows.Close()
	var out []AIMCPServer
	for rows.Next() {
		row, scanErr := scanAIMCPServer(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetServer 按 ID 读取；不存在返回 nil, nil。
func (s *AIMCPStore) GetServer(ctx context.Context, serverID string) (*AIMCPServer, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiMCPServerColumns+" FROM nm_mcp_server WHERE server_id = ?", serverID)
	var (
		srv    AIMCPServer
		ep     sql.NullString
		cmd    sql.NullString
		credID sql.NullString
	)
	err := row.Scan(
		&srv.ServerID, &srv.ServerName, &srv.TransportKind, &ep, &cmd,
		&srv.LaunchOptions, &credID, &srv.RecordStatus, &srv.SortOrder, &srv.RowVersion,
		&srv.CreatedAt, &srv.UpdatedAt,
	)
	switch {
	case err == nil:
		srv.EndpointURL = ep.String
		srv.CommandPath = cmd.String
		srv.CredentialID = credID.String
		return &srv, nil
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	default:
		return nil, fmt.Errorf("store: get mcp server: %w", err)
	}
}

// CreateServer 插入 MCP Server。
func (s *AIMCPStore) CreateServer(ctx context.Context, srv AIMCPServer) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if srv.CreatedAt == "" {
		srv.CreatedAt = now
	}
	if srv.UpdatedAt == "" {
		srv.UpdatedAt = now
	}
	if srv.LaunchOptions == "" {
		srv.LaunchOptions = "{}"
	}
	if srv.RecordStatus == "" {
		srv.RecordStatus = "active"
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO nm_mcp_server (
  server_id, server_name, transport_kind, endpoint_url, command_path,
  launch_options, credential_id, record_status, sort_order, row_version, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		srv.ServerID, srv.ServerName, srv.TransportKind, nullIfEmpty(srv.EndpointURL), nullIfEmpty(srv.CommandPath),
		srv.LaunchOptions, nullIfEmpty(srv.CredentialID), srv.RecordStatus, srv.SortOrder, srv.CreatedAt, srv.UpdatedAt,
	)
	if err != nil {
		return fmt.Errorf("store: create mcp server: %w", err)
	}
	return nil
}

// UpdateServer 乐观锁更新；返回新 row_version、是否命中。
func (s *AIMCPStore) UpdateServer(ctx context.Context, srv AIMCPServer, rowVersion int64) (int64, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	newVer := rowVersion + 1
	if srv.LaunchOptions == "" {
		srv.LaunchOptions = "{}"
	}
	res, err := s.db.ExecContext(ctx, `
UPDATE nm_mcp_server SET
  server_name = ?, transport_kind = ?, endpoint_url = ?, command_path = ?,
  launch_options = ?, credential_id = ?, record_status = ?, sort_order = ?,
  row_version = ?, updated_at = ?
WHERE server_id = ? AND row_version = ?`,
		srv.ServerName, srv.TransportKind, nullIfEmpty(srv.EndpointURL), nullIfEmpty(srv.CommandPath),
		srv.LaunchOptions, nullIfEmpty(srv.CredentialID), srv.RecordStatus, srv.SortOrder,
		newVer, now, srv.ServerID, rowVersion,
	)
	if err != nil {
		return 0, false, fmt.Errorf("store: update mcp server: %w", err)
	}
	n, _ := res.RowsAffected()
	return newVer, n > 0, nil
}

// DeleteServer 删除 Server（调用方需先删 tools）。
func (s *AIMCPStore) DeleteServer(ctx context.Context, serverID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM nm_mcp_server WHERE server_id = ?`, serverID)
	if err != nil {
		return fmt.Errorf("store: delete mcp server: %w", err)
	}
	return nil
}

// ListTools 列出某 Server 下工具；serverID 空则全部。
func (s *AIMCPStore) ListTools(ctx context.Context, serverID string) ([]AIMCPTool, error) {
	query := "SELECT " + aiMCPToolColumns + " FROM nm_mcp_tool"
	var args []any
	if serverID != "" {
		query += " WHERE server_id = ?"
		args = append(args, serverID)
	}
	query += " ORDER BY tool_name"
	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list mcp tools: %w", err)
	}
	defer rows.Close()
	var out []AIMCPTool
	for rows.Next() {
		t, scanErr := scanAIMCPTool(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// ListEnabledTools 返回所有启用工具（供 Agent Loop 暴露给模型）。
func (s *AIMCPStore) ListEnabledTools(ctx context.Context) ([]AIMCPTool, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT `+aiMCPToolColumns+` FROM nm_mcp_tool t
WHERE t.enabled = 1
  AND EXISTS (
    SELECT 1 FROM nm_mcp_server s
    WHERE s.server_id = t.server_id AND s.record_status = 'active'
  )
ORDER BY t.server_id, t.tool_name`)
	if err != nil {
		return nil, fmt.Errorf("store: list enabled mcp tools: %w", err)
	}
	defer rows.Close()
	var out []AIMCPTool
	for rows.Next() {
		t, scanErr := scanAIMCPTool(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// UpsertDiscoveredTool 按 (server_id, tool_name) 写入发现缓存。
// 冲突时保留已有 risk_level（用户覆盖不被刷新覆盖）。
func (s *AIMCPStore) UpsertDiscoveredTool(ctx context.Context, t AIMCPTool) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	if t.DiscoveredAt == "" {
		t.DiscoveredAt = now
	}
	if t.InputSchema == "" {
		t.InputSchema = "{}"
	}
	if t.RiskLevel == "" {
		t.RiskLevel = "read"
	}
	_, err := s.db.ExecContext(ctx, `
INSERT INTO nm_mcp_tool (
  tool_id, server_id, tool_name, tool_title, tool_description, input_schema,
  enabled, risk_level, discovered_at, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(server_id, tool_name) DO UPDATE SET
  tool_title = excluded.tool_title,
  tool_description = excluded.tool_description,
  input_schema = excluded.input_schema,
  discovered_at = excluded.discovered_at,
  updated_at = excluded.updated_at`,
		t.ToolID, t.ServerID, t.ToolName, nullIfEmpty(t.ToolTitle), nullIfEmpty(t.ToolDescription), t.InputSchema,
		boolInt(t.Enabled), t.RiskLevel, t.DiscoveredAt, now, now,
	)
	if err != nil {
		return fmt.Errorf("store: upsert mcp tool: %w", err)
	}
	return nil
}

// SetToolEnabled 更新工具启用开关。
func (s *AIMCPStore) SetToolEnabled(ctx context.Context, toolID string, enabled bool) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.db.ExecContext(ctx,
		`UPDATE nm_mcp_tool SET enabled = ?, updated_at = ? WHERE tool_id = ?`,
		boolInt(enabled), now, toolID)
	if err != nil {
		return fmt.Errorf("store: set mcp tool enabled: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("store: mcp tool not found")
	}
	return nil
}

// SetToolRiskLevel 更新工具风险等级（Policy Gate）。
func (s *AIMCPStore) SetToolRiskLevel(ctx context.Context, toolID, riskLevel string) error {
	now := time.Now().UTC().Format(time.RFC3339Nano)
	res, err := s.db.ExecContext(ctx,
		`UPDATE nm_mcp_tool SET risk_level = ?, updated_at = ? WHERE tool_id = ?`,
		riskLevel, now, toolID)
	if err != nil {
		return fmt.Errorf("store: set mcp tool risk: %w", err)
	}
	n, _ := res.RowsAffected()
	if n == 0 {
		return fmt.Errorf("store: mcp tool not found")
	}
	return nil
}

// DeleteToolsByServer 删除某 Server 下全部工具缓存。
func (s *AIMCPStore) DeleteToolsByServer(ctx context.Context, serverID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM nm_mcp_tool WHERE server_id = ?`, serverID)
	if err != nil {
		return fmt.Errorf("store: delete mcp tools: %w", err)
	}
	return nil
}

// DeleteTool 按 tool_id 删除。
func (s *AIMCPStore) DeleteTool(ctx context.Context, toolID string) error {
	_, err := s.db.ExecContext(ctx, `DELETE FROM nm_mcp_tool WHERE tool_id = ?`, toolID)
	if err != nil {
		return fmt.Errorf("store: delete mcp tool: %w", err)
	}
	return nil
}

// GetToolByID 按 tool_id 读取。
func (s *AIMCPStore) GetToolByID(ctx context.Context, toolID string) (*AIMCPTool, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiMCPToolColumns+" FROM nm_mcp_tool WHERE tool_id = ?", toolID)
	t, err := scanAIMCPTool(row)
	switch {
	case err == nil:
		return &t, nil
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	default:
		return nil, err
	}
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}
