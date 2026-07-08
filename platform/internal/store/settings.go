// Package store 提供 Platform 对本地 SQLite 的仓储访问。
//
// 当前仅实现应用级 KV 配置（nm_app_setting 表）的读写，供
// platform.settings.* Bridge 方法持久化使用。所有业务裁决保持在上层，
// store 只负责数据出入。
package store

import (
	"context"
	"database/sql"
	"fmt"
	"time"
)

// SettingStore 封装对 nm_app_setting 表的键值读写。
type SettingStore struct {
	db *sql.DB
}

// NewSettingStore 基于已打开的 SQLite 连接池创建 SettingStore。
func NewSettingStore(db *sql.DB) *SettingStore {
	return &SettingStore{db: db}
}

// Get 读取指定键的配置值。
//
// key 为配置键，如 workspace.tabs。返回值 value 为存储的 JSON 字符串；
// ok 表示键是否存在（不存在时 value 为空串且 ok 为 false）；err 为底层
// 查询错误。
func (s *SettingStore) Get(ctx context.Context, key string) (value string, ok bool, err error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT setting_value FROM nm_app_setting WHERE setting_key = ?", key)
	switch scanErr := row.Scan(&value); scanErr {
	case nil:
		return value, true, nil
	case sql.ErrNoRows:
		return "", false, nil
	default:
		return "", false, fmt.Errorf("store: get setting %q: %w", key, scanErr)
	}
}

// Set 以 UPSERT 语义写入配置值，并把 updated_at 刷新为当前 UTC 时间。
//
// key 为配置键，value 为要写入的 JSON 字符串。已存在则覆盖 setting_value。
func (s *SettingStore) Set(ctx context.Context, key, value string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `
INSERT INTO nm_app_setting (setting_key, setting_value, updated_at)
VALUES (?, ?, ?)
ON CONFLICT(setting_key) DO UPDATE SET
    setting_value = excluded.setting_value,
    updated_at    = excluded.updated_at`,
		key, value, now)
	if err != nil {
		return fmt.Errorf("store: set setting %q: %w", key, err)
	}
	return nil
}
