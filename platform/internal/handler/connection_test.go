package handler_test

import (
	"context"
	"database/sql"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
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
		Settings:     store.NewSettingStore(db),
		Connections:  store.NewConnectionStore(db),
		Organization: store.NewOrganizationStore(db),
		Credentials:  store.NewCredentialStore(db),
		Secrets:      secrets,
		IDs:          idGen,
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

func TestConnectionExportImport(t *testing.T) {
	d, _ := newTestDispatcher(t)

	createResp := invokeMap(t, d, handler.MethodConnectionCreate, map[string]any{
		"profile": map[string]any{
			"profileName":    "导出站点",
			"connectionKind": "mysql",
			"hostAddress":    "127.0.0.1",
			"portNumber":     3306,
			"loginAccount":   "root",
			"connectionOptions": map[string]any{
				"proxy":  map[string]any{"type": "socks5", "host": "1.1.1.1", "port": 1080, "password": "secret-proxy"},
				"tunnel": map[string]any{"type": "ssh", "sshProfileId": "ssh-1", "sshProfile": map[string]any{"secret": "x"}},
			},
		},
		"credential": map[string]any{"label": "pwd", "kind": "password", "secret": "db-pass"},
	})
	if !createResp.OK {
		t.Fatalf("create failed: %s", createResp.Error)
	}
	var created struct {
		ProfileID string `json:"profileId"`
	}
	mustUnmarshalResult(t, createResp.Result, &created)

	outPath := filepath.Join(t.TempDir(), "connections.json")
	exportResp := invokeMap(t, d, handler.MethodConnectionExport, map[string]any{
		"path":       outPath,
		"profileIds": []string{created.ProfileID},
		"organization": map[string]any{
			"folders":   []map[string]any{{"id": "f1", "name": "组", "parentId": nil, "profileIds": []string{created.ProfileID}}},
			"rootOrder": []string{"folder:f1"},
		},
	})
	if !exportResp.OK {
		t.Fatalf("export failed: %s", exportResp.Error)
	}

	raw, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read export: %v", err)
	}
	var file map[string]any
	if err := json.Unmarshal(raw, &file); err != nil {
		t.Fatalf("parse export: %v", err)
	}
	profiles, _ := file["profiles"].([]any)
	if len(profiles) != 1 {
		t.Fatalf("expected 1 profile in file, got %d", len(profiles))
	}
	p0, _ := profiles[0].(map[string]any)
	opts, _ := p0["connectionOptions"].(map[string]any)
	proxy, _ := opts["proxy"].(map[string]any)
	if _, ok := proxy["password"]; ok {
		t.Fatal("proxy.password must not be exported")
	}
	tunnel, _ := opts["tunnel"].(map[string]any)
	if _, ok := tunnel["sshProfile"]; ok {
		t.Fatal("tunnel.sshProfile must not be exported")
	}

	// 清空后再导入
	delResp := invokeMap(t, d, handler.MethodConnectionDelete, map[string]any{"profileId": created.ProfileID})
	if !delResp.OK {
		t.Fatalf("delete failed: %s", delResp.Error)
	}

	importResp := invokeMap(t, d, handler.MethodConnectionImport, map[string]any{"path": outPath})
	if !importResp.OK {
		t.Fatalf("import failed: %s", importResp.Error)
	}
	var imported struct {
		Imported     int               `json:"imported"`
		IDMap        map[string]string `json:"idMap"`
		Organization json.RawMessage   `json:"organization"`
	}
	mustUnmarshalResult(t, importResp.Result, &imported)
	if imported.Imported != 1 {
		t.Fatalf("expected imported=1, got %d", imported.Imported)
	}
	if imported.IDMap[created.ProfileID] == "" {
		t.Fatal("expected idMap entry for exportId")
	}
	if len(imported.Organization) == 0 {
		t.Fatal("expected organization echoed back")
	}

	listResp := invokeMap(t, d, handler.MethodConnectionList, map[string]any{})
	var list struct {
		Profiles []struct {
			ProfileName   string   `json:"profileName"`
			CredentialIDs []string `json:"credentialIds"`
		} `json:"profiles"`
	}
	mustUnmarshalResult(t, listResp.Result, &list)
	if len(list.Profiles) != 1 || list.Profiles[0].ProfileName != "导出站点" {
		t.Fatalf("unexpected profiles after import: %+v", list.Profiles)
	}
	if len(list.Profiles[0].CredentialIDs) != 0 {
		t.Fatal("import must not restore credentials")
	}
}

func TestConnectionExportImportWithSecrets(t *testing.T) {
	d, secrets := newTestDispatcher(t)

	createResp := invokeMap(t, d, handler.MethodConnectionCreate, map[string]any{
		"profile": map[string]any{
			"profileName":       "带密导出",
			"connectionKind":    "mysql",
			"hostAddress":       "10.0.0.9",
			"portNumber":        3306,
			"loginAccount":      "root",
			"connectionOptions": map[string]any{},
		},
		"credential": map[string]any{"label": "pwd", "kind": "password", "secret": "s3cret-db"},
	})
	if !createResp.OK {
		t.Fatalf("create failed: %s", createResp.Error)
	}
	var created struct {
		ProfileID string `json:"profileId"`
	}
	mustUnmarshalResult(t, createResp.Result, &created)

	outPath := filepath.Join(t.TempDir(), "secure.json")
	exportResp := invokeMap(t, d, handler.MethodConnectionExport, map[string]any{
		"path":           outPath,
		"profileIds":     []string{created.ProfileID},
		"includeSecrets": true,
		"passphrase":     "Share-Me-2026!",
	})
	if !exportResp.OK {
		t.Fatalf("export failed: %s", exportResp.Error)
	}

	raw, err := os.ReadFile(outPath)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if strings.Contains(string(raw), "s3cret-db") {
		t.Fatal("plaintext secret must not appear in export file")
	}

	delResp := invokeMap(t, d, handler.MethodConnectionDelete, map[string]any{"profileId": created.ProfileID})
	if !delResp.OK {
		t.Fatalf("delete: %s", delResp.Error)
	}
	if secrets.size() != 0 {
		t.Fatalf("expected empty vault after delete, got %d", secrets.size())
	}

	noPass := invokeMap(t, d, handler.MethodConnectionImport, map[string]any{"path": outPath})
	if noPass.OK {
		t.Fatal("expected passphrase required")
	}
	if !strings.Contains(noPass.Error, "passphrase required") {
		t.Fatalf("unexpected error: %s", noPass.Error)
	}

	badPass := invokeMap(t, d, handler.MethodConnectionImport, map[string]any{
		"path": outPath, "passphrase": "wrong",
	})
	if badPass.OK {
		t.Fatal("expected invalid passphrase")
	}

	okImport := invokeMap(t, d, handler.MethodConnectionImport, map[string]any{
		"path": outPath, "passphrase": "Share-Me-2026!",
	})
	if !okImport.OK {
		t.Fatalf("import failed: %s", okImport.Error)
	}
	var imported struct {
		Imported    int               `json:"imported"`
		WithSecrets int               `json:"withSecrets"`
		IDMap       map[string]string `json:"idMap"`
	}
	mustUnmarshalResult(t, okImport.Result, &imported)
	if imported.Imported != 1 || imported.WithSecrets != 1 {
		t.Fatalf("unexpected import result: %+v", imported)
	}
	newID := imported.IDMap[created.ProfileID]
	if newID == "" {
		t.Fatal("missing idMap")
	}

	credResp := invokeMap(t, d, handler.MethodCredentialGet, map[string]any{"profileId": newID})
	if !credResp.OK {
		t.Fatalf("credential.get: %s", credResp.Error)
	}
	var cred struct {
		Secret string `json:"secret"`
		Found  bool   `json:"found"`
	}
	mustUnmarshalResult(t, credResp.Result, &cred)
	if !cred.Found || cred.Secret != "s3cret-db" {
		t.Fatalf("expected restored secret, got %+v", cred)
	}
}

func TestConnectionImportRenamesOnConflict(t *testing.T) {
	d, _ := newTestDispatcher(t)

	createResp := invokeMap(t, d, handler.MethodConnectionCreate, map[string]any{
		"profile": map[string]any{
			"profileName":    "同名站点",
			"connectionKind": "mysql",
			"hostAddress":    "127.0.0.1",
			"portNumber":     3306,
			"loginAccount":   "root",
		},
	})
	if !createResp.OK {
		t.Fatalf("create: %s", createResp.Error)
	}
	var created struct {
		ProfileID string `json:"profileId"`
	}
	mustUnmarshalResult(t, createResp.Result, &created)

	outPath := filepath.Join(t.TempDir(), "dup.json")
	exportResp := invokeMap(t, d, handler.MethodConnectionExport, map[string]any{
		"path": outPath, "profileIds": []string{created.ProfileID},
	})
	if !exportResp.OK {
		t.Fatalf("export: %s", exportResp.Error)
	}

	importResp := invokeMap(t, d, handler.MethodConnectionImport, map[string]any{"path": outPath})
	if !importResp.OK {
		t.Fatalf("import: %s", importResp.Error)
	}
	var imported struct {
		Imported int `json:"imported"`
		Renamed  int `json:"renamed"`
	}
	mustUnmarshalResult(t, importResp.Result, &imported)
	if imported.Imported != 1 || imported.Renamed != 1 {
		t.Fatalf("want imported=1 renamed=1, got %+v", imported)
	}

	listResp := invokeMap(t, d, handler.MethodConnectionList, map[string]any{})
	var list struct {
		Profiles []struct {
			ProfileName string `json:"profileName"`
		} `json:"profiles"`
	}
	mustUnmarshalResult(t, listResp.Result, &list)
	names := map[string]bool{}
	for _, p := range list.Profiles {
		names[p.ProfileName] = true
	}
	if !names["同名站点"] || !names["同名站点 (2)"] {
		t.Fatalf("expected original + renamed, got %+v", names)
	}
}

func TestConnectionOrganizationRoundTrip(t *testing.T) {
	d, _ := newTestDispatcher(t)

	parentID := "folder-root"
	childID := "folder-child"
	setResp := invokeMap(t, d, handler.MethodConnectionOrganizationSet, map[string]any{
		"organization": map[string]any{
			"folders": []map[string]any{
				{
					"id": parentID, "name": "生产", "parentId": nil,
					"profileIds": []string{"p1"}, "accentColor": "blue", "expanded": true,
				},
				{
					"id": childID, "name": "从库", "parentId": parentID,
					"profileIds": []string{}, "expanded": false,
				},
			},
			"rootOrder": []string{"folder:" + parentID, "conn:p2"},
		},
	})
	if setResp.Error != "" {
		t.Fatalf("set organization: %s", setResp.Error)
	}

	getResp := invokeMap(t, d, handler.MethodConnectionOrganizationGet, map[string]any{})
	if getResp.Error != "" {
		t.Fatalf("get organization: %s", getResp.Error)
	}
	var got struct {
		Organization struct {
			Folders []struct {
				ID         string   `json:"id"`
				Name       string   `json:"name"`
				ParentID   *string  `json:"parentId"`
				ProfileIDs []string `json:"profileIds"`
				Expanded   bool     `json:"expanded"`
			} `json:"folders"`
			RootOrder []string `json:"rootOrder"`
		} `json:"organization"`
	}
	mustUnmarshalResult(t, getResp.Result, &got)
	if len(got.Organization.Folders) != 2 {
		t.Fatalf("folders: %+v", got.Organization.Folders)
	}
	if got.Organization.Folders[0].Name != "生产" || got.Organization.Folders[1].ParentID == nil || *got.Organization.Folders[1].ParentID != parentID {
		t.Fatalf("unexpected folders: %+v", got.Organization.Folders)
	}
	if len(got.Organization.RootOrder) != 2 || got.Organization.RootOrder[1] != "conn:p2" {
		t.Fatalf("rootOrder: %+v", got.Organization.RootOrder)
	}
}

func TestConnectionDeletePrunesOrganization(t *testing.T) {
	d, _ := newTestDispatcher(t)

	createResp := invokeMap(t, d, handler.MethodConnectionCreate, map[string]any{
		"profile": map[string]any{
			"profileName": "待删站点", "connectionKind": "ftp",
			"hostAddress": "127.0.0.1", "portNumber": 21, "loginAccount": "u",
			"connectionOptions": map[string]any{},
		},
	})
	if createResp.Error != "" {
		t.Fatalf("create: %s", createResp.Error)
	}
	var created struct {
		ProfileID string `json:"profileId"`
	}
	mustUnmarshalResult(t, createResp.Result, &created)

	setResp := invokeMap(t, d, handler.MethodConnectionOrganizationSet, map[string]any{
		"organization": map[string]any{
			"folders": []map[string]any{
				{"id": "f1", "name": "组", "parentId": nil, "profileIds": []string{created.ProfileID}, "expanded": true},
			},
			"rootOrder": []string{"folder:f1", "conn:" + created.ProfileID},
		},
	})
	if setResp.Error != "" {
		t.Fatalf("set organization: %s", setResp.Error)
	}

	delResp := invokeMap(t, d, handler.MethodConnectionDelete, map[string]any{"profileId": created.ProfileID})
	if delResp.Error != "" {
		t.Fatalf("delete: %s", delResp.Error)
	}

	getResp := invokeMap(t, d, handler.MethodConnectionOrganizationGet, map[string]any{})
	var got struct {
		Organization struct {
			Folders []struct {
				ProfileIDs []string `json:"profileIds"`
			} `json:"folders"`
			RootOrder []string `json:"rootOrder"`
		} `json:"organization"`
	}
	mustUnmarshalResult(t, getResp.Result, &got)
	if len(got.Organization.Folders) != 1 || len(got.Organization.Folders[0].ProfileIDs) != 0 {
		t.Fatalf("expected profile unlinked, folders=%+v", got.Organization.Folders)
	}
	for _, key := range got.Organization.RootOrder {
		if key == "conn:"+created.ProfileID {
			t.Fatalf("rootOrder still has deleted conn: %+v", got.Organization.RootOrder)
		}
	}
}

// mustUnmarshalResult 解析响应中被二次编码为字符串的 result。
func mustUnmarshalResult(t *testing.T, result string, dst any) {
	t.Helper()
	if err := json.Unmarshal([]byte(result), dst); err != nil {
		t.Fatalf("unmarshal result %q: %v", result, err)
	}
}
