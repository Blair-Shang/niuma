package store

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"database/sql"
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"strings"
	"sync"
	"time"
)

// masterVaultService / masterVaultAccount 是主密钥在 OS Keychain 中的唯一条目。
// 无论管理多少连接凭据，Keychain 条目数始终为 1。
const (
	masterVaultService = "NiuMa/master-vault"
	masterVaultAccount = "key"

	// credentialServicePrefix 是凭据 service 名的固定前缀，用于从 service 中解析 credential_id。
	credentialServicePrefix = "NiuMa/credential/"
)

// VaultStore 是 SecretStore 的本地加密库实现。
//
// 密文用 AES-256-GCM 加密后直接存入 nm_credential_ref.cipher_text；
// 主密钥（32 字节随机密钥）存于 OS Keychain 单条条目（NiuMa/master-vault）。
//
// 调用约定：
//   - SetSecret 须在 CredentialStore.Create 之后调用（行已存在才能 UPDATE）。
//   - DeleteSecret 为幂等空操作：实际删除由 CredentialStore.Delete 负责。
type VaultStore struct {
	db      *sql.DB
	keyring SecretStore // 仅用于主密钥的 Keychain 存取

	mu     sync.Mutex
	cached []byte // 内存缓存的主密钥，避免重复访问 Keychain
}

// 确保 VaultStore 满足 SecretStore 接口。
var _ SecretStore = (*VaultStore)(nil)

// NewVaultStore 创建 VaultStore。db 须包含 nm_credential_ref 表；keyring 用于主密钥存取。
func NewVaultStore(db *sql.DB, keyring SecretStore) *VaultStore {
	return &VaultStore{db: db, keyring: keyring}
}

// SetSecret 加密 secret 并写入对应的 nm_credential_ref.cipher_text。
// service 须为 "NiuMa/credential/{credential_id}" 格式。
func (v *VaultStore) SetSecret(service, _ string, secret string) error {
	key, err := v.masterKey()
	if err != nil {
		return fmt.Errorf("store: vault set %q: %w", service, err)
	}
	ct, err := aesgcmEncrypt(key, []byte(secret))
	if err != nil {
		return fmt.Errorf("store: vault set %q: %w", service, err)
	}
	credID := credentialIDFrom(service)
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := v.db.Exec(
		`UPDATE nm_credential_ref SET cipher_text=?, updated_at=? WHERE credential_id=?`,
		ct, now, credID,
	)
	if err != nil {
		return fmt.Errorf("store: vault set %q: %w", service, err)
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return fmt.Errorf("store: vault set: credential %q not found", credID)
	}
	return nil
}

// GetSecret 从 nm_credential_ref 读取并解密密文。
// service 须为 "NiuMa/credential/{credential_id}" 格式。
func (v *VaultStore) GetSecret(service, _ string) (string, bool, error) {
	key, err := v.masterKey()
	if err != nil {
		return "", false, fmt.Errorf("store: vault get %q: %w", service, err)
	}
	credID := credentialIDFrom(service)
	var ct string
	err = v.db.QueryRow(
		`SELECT cipher_text FROM nm_credential_ref WHERE credential_id=?`, credID,
	).Scan(&ct)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return "", false, nil
	case err != nil:
		return "", false, fmt.Errorf("store: vault get %q: %w", service, err)
	case ct == "":
		return "", false, nil
	}
	pt, err := aesgcmDecrypt(key, ct)
	if err != nil {
		return "", false, fmt.Errorf("store: vault get %q: %w", service, err)
	}
	return string(pt), true, nil
}

// DeleteSecret 为空操作：行由 CredentialStore.Delete 删除，密文随行一起消失。
func (v *VaultStore) DeleteSecret(_, _ string) error {
	return nil
}

// masterKey 返回内存缓存的主密钥；首次调用时从 Keychain 加载或生成。
func (v *VaultStore) masterKey() ([]byte, error) {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.cached != nil {
		return v.cached, nil
	}

	b64, ok, err := v.keyring.GetSecret(masterVaultService, masterVaultAccount)
	if err != nil {
		return nil, fmt.Errorf("store: vault: load master key: %w", err)
	}
	if ok {
		key, decErr := base64.StdEncoding.DecodeString(b64)
		if decErr != nil {
			return nil, fmt.Errorf("store: vault: decode master key: %w", decErr)
		}
		if len(key) != 32 {
			return nil, fmt.Errorf("store: vault: invalid master key length %d", len(key))
		}
		v.cached = key
		return key, nil
	}

	// 首次初始化：生成 256 位随机主密钥并持久化到 Keychain。
	key := make([]byte, 32)
	if _, err := io.ReadFull(rand.Reader, key); err != nil {
		return nil, fmt.Errorf("store: vault: generate master key: %w", err)
	}
	b64 = base64.StdEncoding.EncodeToString(key)
	if err := v.keyring.SetSecret(masterVaultService, masterVaultAccount, b64); err != nil {
		return nil, fmt.Errorf("store: vault: persist master key: %w", err)
	}
	v.cached = key
	return key, nil
}

// credentialIDFrom 从 "NiuMa/credential/{id}" 格式的 service 名中提取 credential_id。
func credentialIDFrom(service string) string {
	return strings.TrimPrefix(service, credentialServicePrefix)
}

// aesgcmEncrypt 用 AES-256-GCM 加密 plaintext，返回 base64(nonce || ciphertext+tag)。
func aesgcmEncrypt(key, plaintext []byte) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, plaintext, nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// aesgcmDecrypt 解密 aesgcmEncrypt 产生的 base64 密文。
func aesgcmDecrypt(key []byte, cipherB64 string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(cipherB64)
	if err != nil {
		return nil, fmt.Errorf("base64 decode: %w", err)
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(data) < gcm.NonceSize() {
		return nil, errors.New("ciphertext too short")
	}
	nonce, ct := data[:gcm.NonceSize()], data[gcm.NonceSize():]
	return gcm.Open(nil, nonce, ct, nil)
}
