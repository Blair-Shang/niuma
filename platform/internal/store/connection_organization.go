package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
	"time"
)

const (
	// connTreeKeyPrefix 与 web conn-tree/keys.ts 的 conn: 前缀一致。
	connTreeKeyPrefix = "conn:"
	// defaultOrganizationWorkspaceID 与连接站点默认工作区一致。
	defaultOrganizationWorkspaceID = "default"
)

// ConnectionFolderRecord 是连接树中的一个文件夹节点（存于 organization JSON）。
type ConnectionFolderRecord struct {
	ID          string   `json:"id"`
	Name        string   `json:"name"`
	ParentID    *string  `json:"parentId"`
	ProfileIDs  []string `json:"profileIds"`
	AccentColor string   `json:"accentColor,omitempty"`
	Expanded    bool     `json:"expanded"`
}

// ConnectionOrganization 是一个工作区的连接树组织层。
type ConnectionOrganization struct {
	Folders   []ConnectionFolderRecord `json:"folders"`
	RootOrder []string                 `json:"rootOrder"`
}

// OrganizationStore 读写 nm_connection_organization。
type OrganizationStore struct {
	db *sql.DB
}

// NewOrganizationStore 基于已打开的 SQLite 连接池创建 OrganizationStore。
func NewOrganizationStore(db *sql.DB) *OrganizationStore {
	return &OrganizationStore{db: db}
}

// Get 读取工作区组织层。不存在时返回空结构（folders/rootOrder 为空切片）。
func (s *OrganizationStore) Get(ctx context.Context, workspaceID string) (ConnectionOrganization, error) {
	workspaceID = workspaceOrDefault(workspaceID)
	row := s.db.QueryRowContext(ctx,
		`SELECT organization_json FROM nm_connection_organization WHERE workspace_id = ?`,
		workspaceID)
	var raw string
	switch err := row.Scan(&raw); err {
	case nil:
		org, decodeErr := decodeOrganization(raw)
		if decodeErr != nil {
			return ConnectionOrganization{}, decodeErr
		}
		return normalizeOrganization(org), nil
	case sql.ErrNoRows:
		return emptyOrganization(), nil
	default:
		return ConnectionOrganization{}, fmt.Errorf("store: get connection organization: %w", err)
	}
}

// Put 以 UPSERT 写入工作区组织层，并递增 row_version。
func (s *OrganizationStore) Put(ctx context.Context, workspaceID string, org ConnectionOrganization) error {
	workspaceID = workspaceOrDefault(workspaceID)
	org = normalizeOrganization(org)
	payload, err := json.Marshal(org)
	if err != nil {
		return fmt.Errorf("store: marshal connection organization: %w", err)
	}
	now := time.Now().UTC().Format(time.RFC3339)
	_, err = s.db.ExecContext(ctx, `
INSERT INTO nm_connection_organization (workspace_id, organization_json, row_version, created_at, updated_at)
VALUES (?, ?, 0, ?, ?)
ON CONFLICT(workspace_id) DO UPDATE SET
    organization_json = excluded.organization_json,
    row_version       = nm_connection_organization.row_version + 1,
    updated_at        = excluded.updated_at`,
		workspaceID, string(payload), now, now)
	if err != nil {
		return fmt.Errorf("store: put connection organization: %w", err)
	}
	return nil
}

// UnlinkProfile 从所有文件夹与根排序中移除指定站点。
func (s *OrganizationStore) UnlinkProfile(ctx context.Context, workspaceID, profileID string) error {
	if profileID == "" {
		return nil
	}
	org, err := s.Get(ctx, workspaceID)
	if err != nil {
		return err
	}
	changed := false
	for i := range org.Folders {
		filtered := org.Folders[i].ProfileIDs[:0]
		for _, id := range org.Folders[i].ProfileIDs {
			if id == profileID {
				changed = true
				continue
			}
			filtered = append(filtered, id)
		}
		org.Folders[i].ProfileIDs = append([]string(nil), filtered...)
	}
	key := connTreeKeyPrefix + profileID
	kept := org.RootOrder[:0]
	for _, item := range org.RootOrder {
		if item == key {
			changed = true
			continue
		}
		kept = append(kept, item)
	}
	org.RootOrder = append([]string(nil), kept...)
	if !changed {
		return nil
	}
	return s.Put(ctx, workspaceID, org)
}

func workspaceOrDefault(workspaceID string) string {
	if strings.TrimSpace(workspaceID) == "" {
		return defaultOrganizationWorkspaceID
	}
	return workspaceID
}

func emptyOrganization() ConnectionOrganization {
	return ConnectionOrganization{
		Folders:   []ConnectionFolderRecord{},
		RootOrder: []string{},
	}
}

func decodeOrganization(raw string) (ConnectionOrganization, error) {
	if strings.TrimSpace(raw) == "" || raw == "{}" {
		return emptyOrganization(), nil
	}
	var org ConnectionOrganization
	if err := json.Unmarshal([]byte(raw), &org); err != nil {
		return ConnectionOrganization{}, fmt.Errorf("store: decode connection organization: %w", err)
	}
	return org, nil
}

func normalizeOrganization(org ConnectionOrganization) ConnectionOrganization {
	if org.Folders == nil {
		org.Folders = []ConnectionFolderRecord{}
	}
	if org.RootOrder == nil {
		org.RootOrder = []string{}
	}
	for i := range org.Folders {
		if org.Folders[i].ProfileIDs == nil {
			org.Folders[i].ProfileIDs = []string{}
		}
	}
	return org
}
