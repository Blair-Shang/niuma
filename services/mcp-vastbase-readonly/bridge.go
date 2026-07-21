package main

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	ipclient "niuma/pkg/serviceipc/client"
)

func platformAddr() string {
	if v := strings.TrimSpace(os.Getenv("NIUMA_PLATFORM_IPC")); v != "" {
		return v
	}
	if runtime.GOOS == "windows" {
		return `\\.\pipe\niuma.platform`
	}
	return filepath.Join(os.TempDir(), "niuma.platform.sock")
}

func bridge() *ipclient.Client {
	return ipclient.New(platformAddr())
}

func invokeBridge(ctx context.Context, method string, params any, out any) error {
	if ctx == nil {
		ctx = context.Background()
	}
	ctx, cancel := context.WithTimeout(ctx, 45*time.Second)
	defer cancel()
	return bridge().Invoke(ctx, method, params, out)
}

type scopeArgs struct {
	ProfileID string
	SessionID string
	Database  string
	Schema    string
	Table     string
	SQL       string
}

func parseScope(args map[string]any) scopeArgs {
	s := scopeArgs{}
	s.ProfileID, _ = args["profileId"].(string)
	s.SessionID, _ = args["sessionId"].(string)
	s.Database, _ = args["database"].(string)
	s.Schema, _ = args["schema"].(string)
	s.Table, _ = args["table"].(string)
	s.SQL, _ = args["sql"].(string)
	s.ProfileID = strings.TrimSpace(s.ProfileID)
	s.SessionID = strings.TrimSpace(s.SessionID)
	s.Database = strings.TrimSpace(s.Database)
	s.Schema = strings.TrimSpace(s.Schema)
	s.Table = strings.TrimSpace(s.Table)
	s.SQL = strings.TrimSpace(s.SQL)
	if s.Schema == "" {
		s.Schema = "public"
	}
	return s
}

func (s scopeArgs) requireIdentity() error {
	if s.SessionID == "" && s.ProfileID == "" {
		return fmt.Errorf("sessionId or profileId required (bind workspace via Context Pack)")
	}
	return nil
}

// baseParams 构造 Bridge 参数：优先 sessionId，否则 profileId（由 platform 注入凭据）。
func (s scopeArgs) baseParams() map[string]any {
	p := map[string]any{}
	if s.SessionID != "" {
		p["sessionId"] = s.SessionID
	} else {
		p["profileId"] = s.ProfileID
	}
	if s.Database != "" {
		p["database"] = s.Database
	}
	return p
}

func listSchemas(ctx context.Context, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	params := s.baseParams()
	params["limit"] = 500
	params["excludeSystem"] = true
	var result struct {
		Schemas []struct {
			Name string `json:"name"`
		} `json:"schemas"`
		Truncated bool `json:"truncated"`
	}
	if err := invokeBridge(ctx, "vastbase.catalog.schemas", params, &result); err != nil {
		return "", err
	}
	names := make([]string, 0, len(result.Schemas))
	for _, sc := range result.Schemas {
		names = append(names, sc.Name)
	}
	out, _ := json.MarshalIndent(map[string]any{
		"schemas":   names,
		"truncated": result.Truncated,
		"count":     len(names),
	}, "", "  ")
	return string(out), nil
}

func listTables(ctx context.Context, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	params := s.baseParams()
	params["schema"] = s.Schema
	params["limit"] = 500
	params["types"] = []string{"table", "view", "materialized_view", "foreign_table"}
	var result struct {
		Tables []struct {
			Name string `json:"name"`
			Type string `json:"type"`
		} `json:"tables"`
		Truncated bool `json:"truncated"`
	}
	if err := invokeBridge(ctx, "vastbase.catalog.tables", params, &result); err != nil {
		return "", err
	}
	out, _ := json.MarshalIndent(map[string]any{
		"schema":    s.Schema,
		"tables":    result.Tables,
		"truncated": result.Truncated,
		"count":     len(result.Tables),
	}, "", "  ")
	return string(out), nil
}

func describeTable(ctx context.Context, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	if s.Table == "" {
		return "", fmt.Errorf("table required")
	}
	params := s.baseParams()
	params["schema"] = s.Schema
	params["table"] = s.Table
	params["limit"] = 500
	var result struct {
		Columns []struct {
			Name     string `json:"name"`
			DataType string `json:"dataType"`
			Nullable *bool  `json:"nullable"`
		} `json:"columns"`
	}
	if err := invokeBridge(ctx, "vastbase.catalog.columns", params, &result); err != nil {
		return "", err
	}
	out, _ := json.MarshalIndent(map[string]any{
		"schema":  s.Schema,
		"table":   s.Table,
		"columns": result.Columns,
		"count":   len(result.Columns),
	}, "", "  ")
	return string(out), nil
}

func runReadonlySQL(ctx context.Context, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	if err := assertReadonlySQL(s.SQL); err != nil {
		return "", err
	}

	sessionID := s.SessionID
	ephemeral := false
	if sessionID == "" {
		var opened struct {
			SessionID string `json:"sessionId"`
		}
		if err := invokeBridge(ctx, "vastbase.session.open", map[string]any{
			"profileId": s.ProfileID,
		}, &opened); err != nil {
			return "", fmt.Errorf("open session: %w", err)
		}
		sessionID = opened.SessionID
		ephemeral = true
		defer func() {
			_ = invokeBridge(context.Background(), "vastbase.session.close", map[string]any{
				"sessionId": sessionID,
			}, nil)
		}()
	}

	params := map[string]any{
		"sessionId": sessionID,
		"sql":       s.SQL,
		"limit":     200,
		"timeoutMs": 30000,
	}
	if s.Database != "" {
		params["database"] = s.Database
	}
	var result struct {
		Columns    []struct{ Name string `json:"name"` } `json:"columns"`
		Rows       [][]any `json:"rows"`
		RowCount   int     `json:"rowCount"`
		Truncated  bool    `json:"truncated"`
		HasMore    bool    `json:"hasMore"`
		DurationMS int64   `json:"durationMs"`
	}
	if err := invokeBridge(ctx, "vastbase.query.exec", params, &result); err != nil {
		return "", err
	}
	colNames := make([]string, 0, len(result.Columns))
	for _, c := range result.Columns {
		colNames = append(colNames, c.Name)
	}
	payload := map[string]any{
		"columns":    colNames,
		"rows":       result.Rows,
		"rowCount":   result.RowCount,
		"truncated":  result.Truncated,
		"hasMore":    result.HasMore,
		"durationMs": result.DurationMS,
		"ephemeral":  ephemeral,
	}
	out, _ := json.MarshalIndent(payload, "", "  ")
	return string(out), nil
}
