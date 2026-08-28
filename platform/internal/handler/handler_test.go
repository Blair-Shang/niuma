package handler_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"testing"

	"niuma/platform/internal/handler"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/protocol"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

// newDispatcher 打开一个临时 SQLite 库、执行迁移并返回可用的 Dispatcher。
func newDispatcher(t *testing.T) *handler.Dispatcher {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	db.SetMaxOpenConns(1)

	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	// 幂等性：再跑一次不应报错。
	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatalf("migrate (2nd run): %v", err)
	}
	return handler.New(handler.Deps{Settings: store.NewSettingStore(db)})
}

// invoke 把请求经分帧写入、再读回，模拟壳层的一次往返，返回解析后的响应。
func invoke(t *testing.T, d *handler.Dispatcher, method, params, id string) handler.Response {
	t.Helper()
	reqJSON := []byte(`{"method":"` + method + `","params":` + params + `,"id":"` + id + `"}`)

	var buf bytes.Buffer
	if err := protocol.WriteFrame(&buf, reqJSON); err != nil {
		t.Fatalf("write frame: %v", err)
	}
	frame, err := protocol.ReadFrame(&buf)
	if err != nil {
		t.Fatalf("read frame: %v", err)
	}

	respJSON := d.HandleFrame(context.Background(), frame)
	var resp handler.Response
	if err := json.Unmarshal(respJSON, &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return resp
}

func TestSettingsSetThenGet(t *testing.T) {
	d := newDispatcher(t)

	setResp := invoke(t, d, handler.MethodSettingsSet, `{"key":"workspace.tabs","value":"[1,2,3]"}`, "req-1")
	if !setResp.OK || setResp.Result != `{"updated":true}` {
		t.Fatalf("set: ok=%v result=%q err=%q", setResp.OK, setResp.Result, setResp.Error)
	}

	getResp := invoke(t, d, handler.MethodSettingsGet, `{"key":"workspace.tabs"}`, "req-2")
	if !getResp.OK || getResp.Result != `{"value":"[1,2,3]"}` {
		t.Fatalf("get: ok=%v result=%q err=%q", getResp.OK, getResp.Result, getResp.Error)
	}

	// UPSERT：覆盖同一键。
	invoke(t, d, handler.MethodSettingsSet, `{"key":"workspace.tabs","value":"[9]"}`, "req-3")
	getResp2 := invoke(t, d, handler.MethodSettingsGet, `{"key":"workspace.tabs"}`, "req-4")
	if getResp2.Result != `{"value":"[9]"}` {
		t.Fatalf("upsert get: result=%q", getResp2.Result)
	}
}

func TestSettingsGetMissingReturnsNull(t *testing.T) {
	d := newDispatcher(t)
	resp := invoke(t, d, handler.MethodSettingsGet, `{"key":"nope"}`, "req-1")
	if !resp.OK || resp.Result != `{"value":null}` {
		t.Fatalf("missing key: ok=%v result=%q", resp.OK, resp.Result)
	}
}

func TestUnknownMethod(t *testing.T) {
	d := newDispatcher(t)
	resp := invoke(t, d, "platform.settings.delete", `{}`, "req-1")
	if resp.OK || resp.Error != "method not found: platform.settings.delete" {
		t.Fatalf("unknown method: ok=%v err=%q", resp.OK, resp.Error)
	}
	if resp.V != 1 || resp.ErrorCode != "method_not_found" || resp.TraceID != "req-1" {
		t.Fatalf("envelope: v=%d code=%q trace=%q", resp.V, resp.ErrorCode, resp.TraceID)
	}
}

// TestResultIsJSONEncodedString 校验线路上 result 被再编码为字符串，
// 以便 C++ 壳层用 JsonGetString 直接取出内层 JSON。
func TestResultIsJSONEncodedString(t *testing.T) {
	d := newDispatcher(t)
	invoke(t, d, handler.MethodSettingsSet, `{"key":"theme","value":"dark"}`, "s")

	reqJSON := []byte(`{"method":"platform.settings.get","params":{"key":"theme"},"id":"g"}`)
	respJSON := d.HandleFrame(context.Background(), reqJSON)

	// 线路 JSON 中 result 必须是被转义的字符串字面量。
	if !bytes.Contains(respJSON, []byte(`"result":"{\"value\":\"dark\"}"`)) {
		t.Fatalf("wire result not a JSON-encoded string: %s", respJSON)
	}
}
