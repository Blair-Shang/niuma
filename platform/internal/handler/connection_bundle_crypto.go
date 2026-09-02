// 本文件实现连接导出包中的凭据信封（Argon2id + AES-256-GCM），不含明文密码。
package handler

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"strings"

	"golang.org/x/crypto/argon2"
)

const (
	// bundleSecretsKDF 是导出包 secrets 信封使用的口令派生算法名。
	bundleSecretsKDF = "argon2id"
	// argonTime 是 Argon2id 迭代次数。
	argonTime = 3
	// argonMemory 是 Argon2id 内存参数，单位 KiB（64 MiB）。
	argonMemory = 64 * 1024
	// argonThreads 是 Argon2id 并行度。
	argonThreads = 4
	// argonKeyLen 是派生密钥字节数（AES-256）。
	argonKeyLen = 32
	// argonSaltLen 是随机盐字节数。
	argonSaltLen = 16
)

// connectionBundleSecrets 是导出包中的加密凭据信封（不含明文）。
type connectionBundleSecrets struct {
	KDF        string `json:"kdf"`
	Time       uint32 `json:"time"`
	Memory     uint32 `json:"memory"`
	Threads    uint8  `json:"threads"`
	KeyLen     uint32 `json:"keyLen"`
	Salt       string `json:"salt"`
	Ciphertext string `json:"ciphertext"`
}

// connectionSecretEntry 是解密后单条凭据。
type connectionSecretEntry struct {
	Kind   string `json:"kind"`
	Secret string `json:"secret"`
}

// connectionSecretsPayload 是加密前的凭据明文载荷。
type connectionSecretsPayload struct {
	ByExportID map[string]connectionSecretEntry `json:"byExportId"`
}

// deriveBundleKey 用 Argon2id 从口令派生对称密钥。
func deriveBundleKey(passphrase string, salt []byte, time, memory uint32, threads uint8, keyLen uint32) []byte {
	return argon2.IDKey([]byte(passphrase), salt, time, memory, threads, keyLen)
}

// encryptBundleSecrets 将凭据明文载荷封入导出包 secrets 信封。
func encryptBundleSecrets(passphrase string, payload connectionSecretsPayload) (*connectionBundleSecrets, error) {
	if strings.TrimSpace(passphrase) == "" {
		return nil, errors.New("passphrase required when includeSecrets")
	}
	plain, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	salt := make([]byte, argonSaltLen)
	if _, err := io.ReadFull(rand.Reader, salt); err != nil {
		return nil, err
	}
	key := deriveBundleKey(passphrase, salt, argonTime, argonMemory, argonThreads, argonKeyLen)
	ct, err := aesgcmSeal(key, plain)
	if err != nil {
		return nil, err
	}
	return &connectionBundleSecrets{
		KDF:        bundleSecretsKDF,
		Time:       argonTime,
		Memory:     argonMemory,
		Threads:    argonThreads,
		KeyLen:     argonKeyLen,
		Salt:       base64.StdEncoding.EncodeToString(salt),
		Ciphertext: ct,
	}, nil
}

// decryptBundleSecrets 用口令解开导出包 secrets 信封。
func decryptBundleSecrets(passphrase string, env *connectionBundleSecrets) (connectionSecretsPayload, error) {
	var empty connectionSecretsPayload
	if env == nil {
		return empty, nil
	}
	if strings.TrimSpace(passphrase) == "" {
		return empty, errors.New("passphrase required")
	}
	if env.KDF != "" && env.KDF != bundleSecretsKDF {
		return empty, fmt.Errorf("unsupported secrets kdf: %s", env.KDF)
	}
	salt, err := base64.StdEncoding.DecodeString(env.Salt)
	if err != nil {
		return empty, errors.New("invalid passphrase")
	}
	timeCost := env.Time
	if timeCost == 0 {
		timeCost = argonTime
	}
	memory := env.Memory
	if memory == 0 {
		memory = argonMemory
	}
	threads := env.Threads
	if threads == 0 {
		threads = argonThreads
	}
	keyLen := env.KeyLen
	if keyLen == 0 {
		keyLen = argonKeyLen
	}
	key := deriveBundleKey(passphrase, salt, timeCost, memory, threads, keyLen)
	plain, err := aesgcmOpen(key, env.Ciphertext)
	if err != nil {
		return empty, errors.New("invalid passphrase")
	}
	var payload connectionSecretsPayload
	if err := json.Unmarshal(plain, &payload); err != nil {
		return empty, errors.New("invalid passphrase")
	}
	if payload.ByExportID == nil {
		payload.ByExportID = map[string]connectionSecretEntry{}
	}
	return payload, nil
}

// aesgcmSeal 用 AES-256-GCM 加密并返回 base64 密文（含 nonce）。
func aesgcmSeal(key, plaintext []byte) (string, error) {
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

// aesgcmOpen 解密 aesgcmSeal 产出的 base64 密文。
func aesgcmOpen(key []byte, cipherB64 string) ([]byte, error) {
	data, err := base64.StdEncoding.DecodeString(cipherB64)
	if err != nil {
		return nil, err
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
