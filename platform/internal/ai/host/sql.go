package host

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
)

type scopeArgs struct {
	ProfileID string
	SessionID string
	Database  string
	Schema    string
	Table     string
	SQL       string
	ModuleID  string
}

func parseScope(args map[string]any) scopeArgs {
	s := scopeArgs{}
	s.ProfileID, _ = args["profileId"].(string)
	s.SessionID, _ = args["sessionId"].(string)
	s.Database, _ = args["database"].(string)
	s.Schema, _ = args["schema"].(string)
	s.Table, _ = args["table"].(string)
	s.SQL, _ = args["sql"].(string)
	s.ModuleID, _ = args["moduleId"].(string)
	s.ProfileID = strings.TrimSpace(s.ProfileID)
	s.SessionID = strings.TrimSpace(s.SessionID)
	s.Database = strings.TrimSpace(s.Database)
	s.Schema = strings.TrimSpace(s.Schema)
	s.Table = strings.TrimSpace(s.Table)
	s.SQL = strings.TrimSpace(s.SQL)
	s.ModuleID = strings.TrimSpace(s.ModuleID)
	if s.Schema == "" {
		s.Schema = "public"
	}
	return s
}

func (s scopeArgs) requireIdentity() error {
	if s.SessionID == "" && s.ProfileID == "" {
		return fmt.Errorf("sessionId or profileId required (open a database connection)")
	}
	return nil
}

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

func resolveNS(ctx context.Context, rt Runtime, s scopeArgs) (string, error) {
	kind := s.ModuleID
	if kind == "" && rt != nil && s.ProfileID != "" {
		k, err := rt.KindOf(ctx, s.ProfileID)
		if err != nil {
			return "", err
		}
		kind = k
	}
	return NamespaceForKind(kind)
}

func invokeJSON(ctx context.Context, rt Runtime, method string, params map[string]any, out any) error {
	if rt == nil {
		return fmt.Errorf("host: capability runtime not bound")
	}
	raw, err := rt.Call(ctx, method, params)
	if err != nil {
		return err
	}
	if out == nil || len(raw) == 0 {
		return nil
	}
	return json.Unmarshal(raw, out)
}

// CallSQL 执行官方 sql_* 工具，结果为给模型看的 JSON 文本。
func CallSQL(ctx context.Context, rt Runtime, name string, args map[string]any) (string, error) {
	if args == nil {
		args = map[string]any{}
	}
	s := parseScope(args)
	switch name {
	case ToolListSchemas:
		return listSchemas(ctx, rt, s)
	case ToolListTables:
		return listTables(ctx, rt, s)
	case ToolDescribeTable:
		return describeTable(ctx, rt, s)
	case ToolRunReadonly:
		return runReadonlySQL(ctx, rt, s)
	default:
		return "", fmt.Errorf("unknown host tool: %s", name)
	}
}

func listSchemas(ctx context.Context, rt Runtime, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	ns, err := resolveNS(ctx, rt, s)
	if err != nil {
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
	if err := invokeJSON(ctx, rt, ns+".catalog.schemas", params, &result); err != nil {
		return "", err
	}
	names := make([]string, 0, len(result.Schemas))
	for _, sc := range result.Schemas {
		names = append(names, sc.Name)
	}
	return indentJSON(map[string]any{
		"schemas":   names,
		"truncated": result.Truncated,
		"count":     len(names),
	})
}

func listTables(ctx context.Context, rt Runtime, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	ns, err := resolveNS(ctx, rt, s)
	if err != nil {
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
	if err := invokeJSON(ctx, rt, ns+".catalog.tables", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"schema":    s.Schema,
		"tables":    result.Tables,
		"truncated": result.Truncated,
		"count":     len(result.Tables),
	})
}

func describeTable(ctx context.Context, rt Runtime, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	if s.Table == "" {
		return "", fmt.Errorf("table required")
	}
	ns, err := resolveNS(ctx, rt, s)
	if err != nil {
		return "", err
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
	if err := invokeJSON(ctx, rt, ns+".catalog.columns", params, &result); err != nil {
		return "", err
	}
	return indentJSON(map[string]any{
		"schema":  s.Schema,
		"table":   s.Table,
		"columns": result.Columns,
		"count":   len(result.Columns),
	})
}

func runReadonlySQL(ctx context.Context, rt Runtime, s scopeArgs) (string, error) {
	if err := s.requireIdentity(); err != nil {
		return "", err
	}
	if err := AssertReadonlySQL(s.SQL); err != nil {
		return "", err
	}
	ns, err := resolveNS(ctx, rt, s)
	if err != nil {
		return "", err
	}

	sessionID := s.SessionID
	ephemeral := false
	if sessionID == "" {
		var opened struct {
			SessionID string `json:"sessionId"`
		}
		if err := invokeJSON(ctx, rt, ns+".session.open", map[string]any{
			"profileId": s.ProfileID,
		}, &opened); err != nil {
			return "", fmt.Errorf("open session: %w", err)
		}
		sessionID = opened.SessionID
		ephemeral = true
		defer func() {
			_ = invokeJSON(context.Background(), rt, ns+".session.close", map[string]any{
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
		Columns []struct {
			Name string `json:"name"`
		} `json:"columns"`
		Rows       [][]any `json:"rows"`
		RowCount   int     `json:"rowCount"`
		Truncated  bool    `json:"truncated"`
		HasMore    bool    `json:"hasMore"`
		DurationMS int64   `json:"durationMs"`
	}
	if err := invokeJSON(ctx, rt, ns+".query.exec", params, &result); err != nil {
		return "", err
	}
	colNames := make([]string, 0, len(result.Columns))
	for _, c := range result.Columns {
		colNames = append(colNames, c.Name)
	}
	return indentJSON(map[string]any{
		"columns":    colNames,
		"rows":       result.Rows,
		"rowCount":   result.RowCount,
		"truncated":  result.Truncated,
		"hasMore":    result.HasMore,
		"durationMs": result.DurationMS,
		"ephemeral":  ephemeral,
	})
}

func indentJSON(v any) (string, error) {
	out, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return "", err
	}
	return string(out), nil
}
