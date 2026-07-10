package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

// CredentialRef 对应 nm_credential_ref 一行凭据引用（不含明文密钥）。
// 密文以 AES-256-GCM 形式存于 CipherText；明文仅在内存中短暂存在。
type CredentialRef struct {
	CredentialID    string
	CredentialLabel string
	CredentialKind  string
	CipherText      string // base64(nonce || AES-256-GCM 密文+Tag)，空表示尚未设置
	CreatedAt       string
	UpdatedAt       string
}

// CredentialStore 封装对 nm_credential_ref 的读写。
type CredentialStore struct {
	db *sql.DB
}

// NewCredentialStore 基于已打开的 SQLite 连接池创建 CredentialStore。
func NewCredentialStore(db *sql.DB) *CredentialStore {
	return &CredentialStore{db: db}
}

// Create 插入一条凭据引用（cipher_text 初始可为空，由调用方随后通过 SecretStore.SetSecret 填充）。
func (s *CredentialStore) Create(ctx context.Context, ref CredentialRef) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_credential_ref
        (credential_id, credential_label, credential_kind, cipher_text, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)`,
		ref.CredentialID, ref.CredentialLabel, ref.CredentialKind,
		ref.CipherText, now, now)
	if err != nil {
		return fmt.Errorf("store: create credential: %w", err)
	}
	return nil
}

// Get 按 ID 读取凭据引用；不存在时返回 (nil, nil)。
func (s *CredentialStore) Get(ctx context.Context, credentialID string) (*CredentialRef, error) {
	row := s.db.QueryRowContext(ctx, `SELECT credential_id, credential_label, credential_kind,
        cipher_text, created_at, updated_at
        FROM nm_credential_ref WHERE credential_id = ?`, credentialID)

	var ref CredentialRef
	err := row.Scan(&ref.CredentialID, &ref.CredentialLabel, &ref.CredentialKind,
		&ref.CipherText, &ref.CreatedAt, &ref.UpdatedAt)
	switch {
	case err == nil:
		return &ref, nil
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	default:
		return nil, fmt.Errorf("store: get credential: %w", err)
	}
}

// UpdateLabel 更新凭据显示名。
func (s *CredentialStore) UpdateLabel(ctx context.Context, credentialID, label string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	if _, err := s.db.ExecContext(ctx,
		"UPDATE nm_credential_ref SET credential_label = ?, updated_at = ? WHERE credential_id = ?",
		label, now, credentialID); err != nil {
		return fmt.Errorf("store: update credential label: %w", err)
	}
	return nil
}

// Delete 物理删除凭据引用（含密文）。
func (s *CredentialStore) Delete(ctx context.Context, credentialID string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_credential_ref WHERE credential_id = ?", credentialID); err != nil {
		return fmt.Errorf("store: delete credential: %w", err)
	}
	return nil
}
