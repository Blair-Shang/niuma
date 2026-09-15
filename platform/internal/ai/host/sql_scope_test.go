package host

import (
	"context"
	"encoding/json"
	"testing"
)

type sqlStubRuntime struct {
	kind       string
	lastMethod string
	lastParams map[string]any
}

func (s *sqlStubRuntime) Call(_ context.Context, method string, params map[string]any) (json.RawMessage, error) {
	s.lastMethod = method
	s.lastParams = params
	switch method {
	case "mysql.catalog.tables", "vastbase.catalog.tables":
		return json.RawMessage(`{"tables":[{"name":"t1","type":"table"}],"truncated":false}`), nil
	case "mysql.query.exec", "vastbase.query.exec":
		return json.RawMessage(`{"columns":[{"name":"x"}],"rows":[[1]],"rowCount":1,"truncated":false,"hasMore":false,"durationMs":1}`), nil
	default:
		return json.RawMessage(`{"schemas":[],"truncated":false}`), nil
	}
}

func (s *sqlStubRuntime) KindOf(_ context.Context, _ string) (string, error) {
	if s.kind == "" {
		return "vastbase", nil
	}
	return s.kind, nil
}

func TestUsesDatabaseAsSchema(t *testing.T) {
	if !UsesDatabaseAsSchema("mysql") || !UsesDatabaseAsSchema("mariadb") || !UsesDatabaseAsSchema("clickhouse") {
		t.Fatal("mysql family should use database as schema")
	}
	if UsesDatabaseAsSchema("vastbase") || UsesDatabaseAsSchema("postgres") {
		t.Fatal("pg family should not use database as schema")
	}
}

func TestCallSQLListTablesMySQLUsesCurrentDatabase(t *testing.T) {
	rt := &sqlStubRuntime{kind: "mysql"}
	_, err := CallSQL(context.Background(), rt, ToolListTables, map[string]any{
		"profileId": "p1",
		"moduleId":  "mysql",
		"database":  "ai_coding",
	})
	if err != nil {
		t.Fatal(err)
	}
	if rt.lastMethod != "mysql.catalog.tables" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
	if got, _ := rt.lastParams["schema"].(string); got != "ai_coding" {
		t.Fatalf("schema=%v params=%v", got, rt.lastParams)
	}
}

func TestCallSQLListTablesMySQLOverridesPublic(t *testing.T) {
	rt := &sqlStubRuntime{kind: "mysql"}
	_, err := CallSQL(context.Background(), rt, ToolListTables, map[string]any{
		"profileId": "p1",
		"moduleId":  "mysql",
		"database":  "ai_coding",
		"schema":    "public",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := rt.lastParams["schema"].(string); got != "ai_coding" {
		t.Fatalf("schema=%v", got)
	}
}

func TestCallSQLListTablesVastbaseDefaultsPublic(t *testing.T) {
	rt := &sqlStubRuntime{kind: "vastbase"}
	_, err := CallSQL(context.Background(), rt, ToolListTables, map[string]any{
		"profileId": "p1",
		"moduleId":  "vastbase",
	})
	if err != nil {
		t.Fatal(err)
	}
	if got, _ := rt.lastParams["schema"].(string); got != "public" {
		t.Fatalf("schema=%v", got)
	}
}

func TestCallSQLExecAllowsInsert(t *testing.T) {
	rt := &sqlStubRuntime{kind: "mysql"}
	text, err := CallSQL(context.Background(), rt, ToolExec, map[string]any{
		"sessionId": "s1",
		"moduleId":  "mysql",
		"database":  "ai_coding",
		"sql":       "INSERT INTO t VALUES (1)",
	})
	if err != nil {
		t.Fatal(err)
	}
	if rt.lastMethod != "mysql.query.exec" {
		t.Fatalf("method=%s", rt.lastMethod)
	}
	if !json.Valid([]byte(text)) {
		t.Fatalf("invalid json %s", text)
	}
}

func TestCallSQLReadonlyRejectsInsert(t *testing.T) {
	rt := &sqlStubRuntime{kind: "mysql"}
	_, err := CallSQL(context.Background(), rt, ToolRunReadonly, map[string]any{
		"sessionId": "s1",
		"moduleId":  "mysql",
		"sql":       "INSERT INTO t VALUES (1)",
	})
	if err == nil {
		t.Fatal("expected reject")
	}
}

func TestIsSQLToolIncludesExec(t *testing.T) {
	if !IsSQLTool(ToolExec) || !IsSQLTool(ToolRunReadonly) {
		t.Fatal("sql_exec should be official sql tool")
	}
}
