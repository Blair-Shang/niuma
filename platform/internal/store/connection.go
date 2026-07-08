package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// recordStatusActive 表示连接站点处于启用状态。
const recordStatusActive = "active"

// ConnectionProfile 对应 nm_connection_profile 一行连接站点配置（不含明文凭据）。
type ConnectionProfile struct {
	ProfileID         string
	WorkspaceID       string
	ProfileName       string
	ConnectionKind    string
	HostAddress       string
	PortNumber        int
	LoginAccount      string
	ConnectionOptions string
	RecordStatus      string
	RowVersion        int64
	CreatedAt         string
	UpdatedAt         string
	// CredentialIDs 由关联表 nm_profile_credential 装填，非本表列。
	CredentialIDs []string
}

// ConnectionStore 封装对 nm_connection_profile 及关联表 nm_profile_credential 的读写。
type ConnectionStore struct {
	db *sql.DB
}

// NewConnectionStore 基于已打开的 SQLite 连接池创建 ConnectionStore。
func NewConnectionStore(db *sql.DB) *ConnectionStore {
	return &ConnectionStore{db: db}
}

// rowScanner 抽象 *sql.Row 与 *sql.Rows 的 Scan 能力，供扫描函数复用。
type rowScanner interface {
	Scan(dest ...any) error
}

// profileColumns 是连接站点各查询共用的列清单（与 scanProfile 顺序一致）。
const profileColumns = `profile_id, workspace_id, profile_name, connection_kind,
    host_address, port_number, login_account, connection_options,
    record_status, row_version, created_at, updated_at`

// scanProfile 从一行结果扫描出 ConnectionProfile（可空列做零值化处理）。
func scanProfile(sc rowScanner) (ConnectionProfile, error) {
	var (
		p     ConnectionProfile
		host  sql.NullString
		port  sql.NullInt64
		login sql.NullString
	)
	if err := sc.Scan(
		&p.ProfileID, &p.WorkspaceID, &p.ProfileName, &p.ConnectionKind,
		&host, &port, &login, &p.ConnectionOptions,
		&p.RecordStatus, &p.RowVersion, &p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return ConnectionProfile{}, fmt.Errorf("store: scan profile: %w", err)
	}
	p.HostAddress = host.String
	p.PortNumber = int(port.Int64)
	p.LoginAccount = login.String
	return p, nil
}

// statusOrDefault 在 record_status 为空时回退为 active。
func statusOrDefault(status string) string {
	if status == "" {
		return recordStatusActive
	}
	return status
}

// optionsOrDefault 在 connection_options 为空时回退为 JSON 空对象。
func optionsOrDefault(options string) string {
	if strings.TrimSpace(options) == "" {
		return "{}"
	}
	return options
}

// List 返回符合过滤条件的连接站点；workspaceID/kind 为空表示不按该维度过滤。
func (s *ConnectionStore) List(ctx context.Context, workspaceID, kind string) ([]ConnectionProfile, error) {
	var (
		conds []string
		args  []any
	)
	if workspaceID != "" {
		conds = append(conds, "workspace_id = ?")
		args = append(args, workspaceID)
	}
	if kind != "" {
		conds = append(conds, "connection_kind = ?")
		args = append(args, kind)
	}

	query := "SELECT " + profileColumns + " FROM nm_connection_profile"
	if len(conds) > 0 {
		query += " WHERE " + strings.Join(conds, " AND ")
	}
	query += " ORDER BY profile_name"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list profiles: %w", err)
	}
	defer rows.Close()

	var profiles []ConnectionProfile
	for rows.Next() {
		p, scanErr := scanProfile(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		profiles = append(profiles, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate profiles: %w", err)
	}

	for i := range profiles {
		ids, err := s.ListCredentialIDs(ctx, profiles[i].ProfileID)
		if err != nil {
			return nil, err
		}
		profiles[i].CredentialIDs = ids
	}
	return profiles, nil
}

// Get 按 ID 读取连接站点；不存在时返回 (nil, nil)。
func (s *ConnectionStore) Get(ctx context.Context, profileID string) (*ConnectionProfile, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+profileColumns+" FROM nm_connection_profile WHERE profile_id = ?", profileID)
	p, err := scanProfile(row)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	ids, err := s.ListCredentialIDs(ctx, profileID)
	if err != nil {
		return nil, err
	}
	p.CredentialIDs = ids
	return &p, nil
}

// Create 插入一条连接站点；调用方负责生成 ProfileID 与关联凭据。
func (s *ConnectionStore) Create(ctx context.Context, p ConnectionProfile) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_connection_profile
        (profile_id, workspace_id, profile_name, connection_kind, host_address,
         port_number, login_account, connection_options, record_status,
         row_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		p.ProfileID, p.WorkspaceID, p.ProfileName, p.ConnectionKind, p.HostAddress,
		p.PortNumber, p.LoginAccount, optionsOrDefault(p.ConnectionOptions),
		statusOrDefault(p.RecordStatus), now, now)
	if err != nil {
		return fmt.Errorf("store: create profile: %w", err)
	}
	return nil
}

// Update 以乐观锁更新连接站点：仅当 row_version 匹配时生效，成功后版本 +1。
//
// 返回新的 row_version 与是否命中（ok=false 表示站点不存在或版本冲突）。
func (s *ConnectionStore) Update(ctx context.Context, p ConnectionProfile, rowVersion int64) (int64, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	res, err := s.db.ExecContext(ctx, `UPDATE nm_connection_profile SET
        profile_name = ?, connection_kind = ?, host_address = ?, port_number = ?,
        login_account = ?, connection_options = ?, record_status = ?,
        row_version = row_version + 1, updated_at = ?
        WHERE profile_id = ? AND row_version = ?`,
		p.ProfileName, p.ConnectionKind, p.HostAddress, p.PortNumber,
		p.LoginAccount, optionsOrDefault(p.ConnectionOptions), statusOrDefault(p.RecordStatus), now,
		p.ProfileID, rowVersion)
	if err != nil {
		return 0, false, fmt.Errorf("store: update profile: %w", err)
	}
	affected, err := res.RowsAffected()
	if err != nil {
		return 0, false, fmt.Errorf("store: update profile rows: %w", err)
	}
	if affected == 0 {
		return 0, false, nil
	}
	return rowVersion + 1, true, nil
}

// Delete 物理删除连接站点行（关联清理由 Service 层负责）。
func (s *ConnectionStore) Delete(ctx context.Context, profileID string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_connection_profile WHERE profile_id = ?", profileID); err != nil {
		return fmt.Errorf("store: delete profile: %w", err)
	}
	return nil
}

// LinkCredential 建立站点与凭据的关联（幂等）。
func (s *ConnectionStore) LinkCredential(ctx context.Context, profileID, credentialID string) error {
	now := time.Now().UTC().Format(time.RFC3339)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_profile_credential (profile_id, credential_id, created_at)
        VALUES (?, ?, ?) ON CONFLICT(profile_id, credential_id) DO NOTHING`,
		profileID, credentialID, now)
	if err != nil {
		return fmt.Errorf("store: link credential: %w", err)
	}
	return nil
}

// ListCredentialIDs 返回站点关联的全部凭据 ID。
func (s *ConnectionStore) ListCredentialIDs(ctx context.Context, profileID string) ([]string, error) {
	return s.queryIDs(ctx,
		"SELECT credential_id FROM nm_profile_credential WHERE profile_id = ?", profileID)
}

// ListProfileIDsByCredential 返回引用了指定凭据的站点 ID（用于判定孤儿凭据）。
func (s *ConnectionStore) ListProfileIDsByCredential(ctx context.Context, credentialID string) ([]string, error) {
	return s.queryIDs(ctx,
		"SELECT profile_id FROM nm_profile_credential WHERE credential_id = ?", credentialID)
}

// UnlinkByProfile 删除站点的全部凭据关联，返回被解除的凭据 ID（供孤儿回收）。
func (s *ConnectionStore) UnlinkByProfile(ctx context.Context, profileID string) ([]string, error) {
	ids, err := s.ListCredentialIDs(ctx, profileID)
	if err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_profile_credential WHERE profile_id = ?", profileID); err != nil {
		return nil, fmt.Errorf("store: unlink profile credentials: %w", err)
	}
	return ids, nil
}

// UnlinkByCredential 删除某凭据的全部站点关联。
func (s *ConnectionStore) UnlinkByCredential(ctx context.Context, credentialID string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_profile_credential WHERE credential_id = ?", credentialID); err != nil {
		return fmt.Errorf("store: unlink credential: %w", err)
	}
	return nil
}

// queryIDs 执行返回单列 ID 的查询并汇总为切片。
func (s *ConnectionStore) queryIDs(ctx context.Context, query, arg string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, query, arg)
	if err != nil {
		return nil, fmt.Errorf("store: query ids: %w", err)
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("store: scan id: %w", err)
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: iterate ids: %w", err)
	}
	return ids, nil
}
