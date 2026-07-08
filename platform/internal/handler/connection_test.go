package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"path/filepath"
	"sync"
	"testing"

	"niuma/platform/internal/handler"
	"niuma/platform/internal/idgen"
	"niuma/platform/internal/migrate"
	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

// memSecretStore 是 store.SecretStore 的内存替身，避免测试触碰真实 OS Keychain。
type memSecretStore struct {
	mu sync.Mutex
	m  map[string]string
}

func newMemSecretStore() *memSecretStore {
	return &memSecretStore{m: make(map[string]string)}
}

func (s *memSecretStore) key(service, account string) string {
	return service + "\x00" + account
}

func (s *memSecretStore) SetSecret(service, account, secret string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.m[s.key(service, account)] = secret
	return nil
}

func (s *memSecretStore) GetSecret(service, account string) (string, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	v, ok := s.m[s.key(service, account)]
	return v, ok, nil
}

func (s *memSecretStore) DeleteSecret(service, account string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.m, s.key(service, account))
	return nil
}

func (s *memSecretStore) size() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.m)
}

// newTestDispatcher 组装一个基于临时 SQLite 库与内存密钥库的 Dispatcher。
func newTestDispatcher(t *testing.T) (*handler.Dispatcher, *memSecretStore) {
	t.Helper()
	dbPath := filepath.Join(t.TempDir(), "test.db")
	db, err := sql.Open("sqlite", dbPath)
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	t.Cleanup(func() { _ = db.Close() })
	db.SetMaxOpenConns(1)
	if err := migrate.Run(context.Background(), db); err != nil {
		t.Fatalf("migrate: %v", err)
	}

	idGen, err := idgen.NewSnowflake(0)
	if err != nil {
		t.Fatalf("idgen: %v", err)
	}
	secrets := newMemSecretStore()
	d := handler.New(handler.Deps{
		Settings:    store.NewSettingStore(db),
		Connections: store.NewConnectionStore(db),
		Credentials: store.NewCredentialStore(db),
		Secrets:     secrets,
		IDs:         idGen,
	})
	return d, secrets
}

// invokeMap 通过 HandleFrame 发起一次请求（对象入参）并解析响应。
func invokeMap(t *testing.T, d *handler.Dispatcher, method string, params any) handler.Response {
	t.Helper()
	raw, err := json.Marshal(map[string]any{"method": method, "params": params, "id": "test"})
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	var resp handler.Response
	if err := json.Unmarshal(d.HandleFrame(context.Background(), raw), &resp); err != nil {
		t.Fatalf("unmarshal response: %v", err)
	}
	return resp
}

func TestConnectionLifecycle(t *testing.T) {
	d, secrets := newTestDispatcher(t)

	// 新建带凭据的 FTP 站点
	createResp := invokeMap(t, d, handler.MethodConnectionCreate, map[string]any{
		"profile": map[string]any{
			"profileName":       "站点A",
			"connectionKind":    "ftp",
			"hostAddress":       "10.0.0.1",
			"portNumber":        21,
			"loginAccount":      "deploy",
			"connectionOptions": map[string]any{"protocol": "ftp", "passive": true},
		},
		"credential": map[string]any{"label": "站点A密码", "kind": "password", "secret": "s3cr3t"},
	})
	if !createResp.OK {
		t.Fatalf("create failed: %s", createResp.Error)
	}
	var created struct {
		ProfileID string `json:"profileId"`
	}
	mustUnmarshalResult(t, createResp.Result, &created)
	if created.ProfileID == "" {
		t.Fatal("expected profileId")
	}
	if secrets.size() != 1 {
		t.Fatalf("expected 1 secret in keychain, got %d", secrets.size())
	}

	// 列表应含该站点且带 credentialIds
	listResp := invokeMap(t, d, handler.MethodConnectionList, map[string]any{})
	if !listResp.OK {
		t.Fatalf("list failed: %s", listResp.Error)
	}
	var list struct {
		Profiles []struct {
			ProfileID     string   `json:"profileId"`
			ProfileName   string   `json:"profileName"`
			RowVersion    int64    `json:"rowVersion"`
			CredentialIDs []string `json:"credentialIds"`
		} `json:"profiles"`
	}
	mustUnmarshalResult(t, listResp.Result, &list)
	if len(list.Profiles) != 1 {
		t.Fatalf("expected 1 profile, got %d", len(list.Profiles))
	}
	if len(list.Profiles[0].CredentialIDs) != 1 {
		t.Fatalf("expected 1 linked credential, got %d", len(list.Profiles[0].CredentialIDs))
	}

	// 用正确 rowVersion 更新
	updResp := invokeMap(t, d, handler.MethodConnectionUpdate, map[string]any{
		"profileId":  created.ProfileID,
		"rowVersion": 0,
		"profile": map[string]any{
			"profileName":    "站点A改",
			"connectionKind": "ftp",
			"hostAddress":    "10.0.0.2",
			"portNumber":     2121,
			"loginAccount":   "deploy",
		},
	})
	if !updResp.OK {
		t.Fatalf("update failed: %s", updResp.Error)
	}
	var upd struct {
		RowVersion int64 `json:"rowVersion"`
	}
	mustUnmarshalResult(t, updResp.Result, &upd)
	if upd.RowVersion != 1 {
		t.Fatalf("expected rowVersion 1, got %d", upd.RowVersion)
	}

	// 用过期 rowVersion 更新应冲突
	staleResp := invokeMap(t, d, handler.MethodConnectionUpdate, map[string]any{
		"profileId":  created.ProfileID,
		"rowVersion": 0,
		"profile":    map[string]any{"profileName": "x", "connectionKind": "ftp"},
	})
	if staleResp.OK {
		t.Fatal("expected version conflict, got OK")
	}

	// 删除站点应连带回收孤儿凭据密钥
	delResp := invokeMap(t, d, handler.MethodConnectionDelete, map[string]any{"profileId": created.ProfileID})
	if !delResp.OK {
		t.Fatalf("delete failed: %s", delResp.Error)
	}
	if secrets.size() != 0 {
		t.Fatalf("expected keychain emptied after delete, got %d", secrets.size())
	}

	// 再次列表应为空
	listResp2 := invokeMap(t, d, handler.MethodConnectionList, map[string]any{})
	var list2 struct {
		Profiles []json.RawMessage `json:"profiles"`
	}
	mustUnmarshalResult(t, listResp2.Result, &list2)
	if len(list2.Profiles) != 0 {
		t.Fatalf("expected 0 profiles after delete, got %d", len(list2.Profiles))
	}
}

func TestCredentialSetAndDelete(t *testing.T) {
	d, secrets := newTestDispatcher(t)

	setResp := invokeMap(t, d, handler.MethodCredentialSet, map[string]any{
		"label": "独立凭据", "kind": "password", "secret": "abc",
	})
	if !setResp.OK {
		t.Fatalf("credential.set failed: %s", setResp.Error)
	}
	var set struct {
		CredentialID string `json:"credentialId"`
	}
	mustUnmarshalResult(t, setResp.Result, &set)
	if set.CredentialID == "" {
		t.Fatal("expected credentialId")
	}
	if secrets.size() != 1 {
		t.Fatalf("expected 1 secret, got %d", secrets.size())
	}

	delResp := invokeMap(t, d, handler.MethodCredentialDelete, map[string]any{"credentialId": set.CredentialID})
	if !delResp.OK {
		t.Fatalf("credential.delete failed: %s", delResp.Error)
	}
	if secrets.size() != 0 {
		t.Fatalf("expected keychain emptied, got %d", secrets.size())
	}
}

// mustUnmarshalResult 解析响应中被二次编码为字符串的 result。
func mustUnmarshalResult(t *testing.T, result string, dst any) {
	t.Helper()
	if err := json.Unmarshal([]byte(result), dst); err != nil {
		t.Fatalf("unmarshal result %q: %v", result, err)
	}
}
