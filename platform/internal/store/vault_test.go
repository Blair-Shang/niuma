package store_test

import (
	"database/sql"
	"testing"

	"niuma/platform/internal/store"

	_ "modernc.org/sqlite"
)

// openTestDB 创建内存 SQLite 并建好 nm_credential_ref 表（与迁移 000002 对齐）。
func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	db, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	_, err = db.Exec(`CREATE TABLE IF NOT EXISTS nm_credential_ref (
        credential_id     TEXT NOT NULL PRIMARY KEY,
        credential_label  TEXT NOT NULL,
        credential_kind   TEXT NOT NULL,
        cipher_text       TEXT NOT NULL DEFAULT '',
        created_at        TEXT NOT NULL,
        updated_at        TEXT NOT NULL
    )`)
	if err != nil {
		t.Fatalf("create table: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// seedCredentialRow 在 nm_credential_ref 中预插入一行（cipher_text 为空），
// 模拟 CredentialStore.Create 已执行的状态，使 VaultStore.SetSecret 可以 UPDATE。
func seedCredentialRow(t *testing.T, db *sql.DB, credentialID string) {
	t.Helper()
	_, err := db.Exec(`INSERT INTO nm_credential_ref
        (credential_id, credential_label, credential_kind, cipher_text, created_at, updated_at)
        VALUES (?, ?, ?, '', '2024-01-01T00:00:00Z', '2024-01-01T00:00:00Z')`,
		credentialID, "label-"+credentialID, "password")
	if err != nil {
		t.Fatalf("seed credential row: %v", err)
	}
}

func TestVaultStore_SetGetDelete(t *testing.T) {
	db := openTestDB(t)
	keyring := newMemSecretStore()
	v := store.NewVaultStore(db, keyring)

	const credID = "abc123"
	svc := "NiuMa/credential/" + credID

	// 不存在时应返回 not found
	got, ok, err := v.GetSecret(svc, "secret")
	if err != nil || ok || got != "" {
		t.Fatalf("expected not found, got (%q, %v, %v)", got, ok, err)
	}

	// 预建行后写入
	seedCredentialRow(t, db, credID)
	if err := v.SetSecret(svc, "secret", "p@ssw0rd"); err != nil {
		t.Fatalf("SetSecret: %v", err)
	}

	// 读取
	got, ok, err = v.GetSecret(svc, "secret")
	if err != nil || !ok || got != "p@ssw0rd" {
		t.Fatalf("GetSecret: (%q, %v, %v)", got, ok, err)
	}

	// 更新
	if err := v.SetSecret(svc, "secret", "newpass"); err != nil {
		t.Fatalf("SetSecret update: %v", err)
	}
	got, _, _ = v.GetSecret(svc, "secret")
	if got != "newpass" {
		t.Fatalf("expected updated value, got %q", got)
	}

	// DeleteSecret 为空操作，不报错即可
	if err := v.DeleteSecret(svc, "secret"); err != nil {
		t.Fatalf("DeleteSecret: %v", err)
	}
}

func TestVaultStore_MasterKeyPersisted(t *testing.T) {
	db := openTestDB(t)
	keyring := newMemSecretStore()

	const credID = "persist1"
	svc := "NiuMa/credential/" + credID
	seedCredentialRow(t, db, credID)

	v1 := store.NewVaultStore(db, keyring)
	if err := v1.SetSecret(svc, "secret", "val"); err != nil {
		t.Fatalf("v1 set: %v", err)
	}

	// 新实例模拟重启（清空内存缓存），主密钥已持久化在 keyring
	v2 := store.NewVaultStore(db, keyring)
	got, ok, err := v2.GetSecret(svc, "secret")
	if err != nil || !ok || got != "val" {
		t.Fatalf("v2 get after restart: (%q, %v, %v)", got, ok, err)
	}
}

// memSecretStore 是内存版 SecretStore（用于测试，代替 OS Keychain）。
type memSecretStore struct {
	data map[string]string
}

func newMemSecretStore() *memSecretStore {
	return &memSecretStore{data: map[string]string{}}
}

func (m *memSecretStore) SetSecret(service, account, secret string) error {
	m.data[service+":"+account] = secret
	return nil
}

func (m *memSecretStore) GetSecret(service, account string) (string, bool, error) {
	v, ok := m.data[service+":"+account]
	return v, ok, nil
}

func (m *memSecretStore) DeleteSecret(service, account string) error {
	delete(m.data, service+":"+account)
	return nil
}
