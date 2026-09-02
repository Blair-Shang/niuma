package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"niuma/platform/internal/handler"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

func newAPIHistoryDispatcher(t *testing.T) *handler.Dispatcher {
	t.Helper()
	db, err := sql.Open("sqlite", filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	idGen, err := idgen.NewSnowflake(0)
	if err != nil {
		t.Fatal(err)
	}
	return handler.New(handler.Deps{
		Settings:   store.NewSettingStore(db),
		IDs:        idGen,
		APIHistory: store.NewAPIHistoryStore(db),
	})
}

func TestAPIHistoryAppendListDeleteClear(t *testing.T) {
	d := newAPIHistoryDispatcher(t)
	appendResp := invokeMap(t, d, handler.MethodAPIHistoryAppend, map[string]any{
		"requestId":   "req-1",
		"requestName": "List products",
		"httpMethod":  "GET",
		"requestUrl":  "https://api.demo/products",
		"requestJson": map[string]any{"id": "req-1", "name": "List products"},
		"exchangeJson": map[string]any{
			"ok":     true,
			"status": 200,
			"body":   `{"ok":true}`,
		},
		"durationMs": 18,
		"httpStatus": 200,
	})
	if !appendResp.OK {
		t.Fatalf("append: %s", appendResp.Error)
	}
	listResp := invokeMap(t, d, handler.MethodAPIHistoryList, map[string]any{"limit": 20})
	if !listResp.OK {
		t.Fatalf("list: %s", listResp.Error)
	}
	var listed struct {
		Entries []struct {
			HistoryID  string `json:"historyId"`
			HTTPMethod string `json:"httpMethod"`
			RequestID  string `json:"requestId"`
		} `json:"entries"`
	}
	if err := json.Unmarshal([]byte(listResp.Result), &listed); err != nil {
		t.Fatal(err)
	}
	if len(listed.Entries) != 1 || listed.Entries[0].HTTPMethod != "GET" || listed.Entries[0].RequestID != "req-1" {
		t.Fatalf("listed=%+v", listed)
	}
	delResp := invokeMap(t, d, handler.MethodAPIHistoryDelete, map[string]any{"historyId": listed.Entries[0].HistoryID})
	if !delResp.OK {
		t.Fatalf("delete: %s", delResp.Error)
	}
	invokeMap(t, d, handler.MethodAPIHistoryAppend, map[string]any{
		"httpMethod":   "POST",
		"requestName":  "Create",
		"exchangeJson": map[string]any{"ok": false, "status": 401},
		"httpStatus":   401,
	})
	clearResp := invokeMap(t, d, handler.MethodAPIHistoryClear, map[string]any{})
	if !clearResp.OK {
		t.Fatalf("clear: %s", clearResp.Error)
	}
	empty := invokeMap(t, d, handler.MethodAPIHistoryList, map[string]any{})
	var after struct {
		Entries []any `json:"entries"`
	}
	if err := json.Unmarshal([]byte(empty.Result), &after); err != nil {
		t.Fatal(err)
	}
	if len(after.Entries) != 0 {
		t.Fatalf("after clear: %+v", after)
	}
}
