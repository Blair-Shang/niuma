package store

import (
	"errors"
	"fmt"

	"github.com/zalando/go-keyring"
)

// SecretStore 抽象 OS Keychain 的密钥存取，便于在测试中注入替身。
//
// 明文密钥只存于操作系统凭据库（Windows Credential Manager / macOS Keychain /
// Linux Secret Service）；数据库仅保存对其的引用（见 nm_credential_ref），
// 严禁把明文密码写入 SQLite（见 .cursor/rules/database-schema.mdc）。
type SecretStore interface {
	// SetSecret 写入（或覆盖）指定 service+account 下的密钥。
	SetSecret(service, account, secret string) error
	// GetSecret 读取密钥；ok 为 false 表示不存在。
	GetSecret(service, account string) (secret string, ok bool, err error)
	// DeleteSecret 删除密钥；不存在时视为成功（幂等）。
	DeleteSecret(service, account string) error
}

// KeychainStore 是基于 go-keyring 的 SecretStore 实现，对接 OS 凭据库。
type KeychainStore struct{}

// 确保 KeychainStore 满足 SecretStore 接口。
var _ SecretStore = (*KeychainStore)(nil)

// NewKeychainStore 创建 KeychainStore。
func NewKeychainStore() *KeychainStore {
	return &KeychainStore{}
}

// SetSecret 见 SecretStore。
func (k *KeychainStore) SetSecret(service, account, secret string) error {
	if err := keyring.Set(service, account, secret); err != nil {
		return fmt.Errorf("store: keychain set %q: %w", service, err)
	}
	return nil
}

// GetSecret 见 SecretStore。
func (k *KeychainStore) GetSecret(service, account string) (string, bool, error) {
	secret, err := keyring.Get(service, account)
	switch {
	case err == nil:
		return secret, true, nil
	case errors.Is(err, keyring.ErrNotFound):
		return "", false, nil
	default:
		return "", false, fmt.Errorf("store: keychain get %q: %w", service, err)
	}
}

// DeleteSecret 见 SecretStore。
func (k *KeychainStore) DeleteSecret(service, account string) error {
	err := keyring.Delete(service, account)
	if err == nil || errors.Is(err, keyring.ErrNotFound) {
		return nil
	}
	return fmt.Errorf("store: keychain delete %q: %w", service, err)
}
