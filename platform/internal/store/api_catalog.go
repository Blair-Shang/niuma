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
	// DefaultAPICatalogWorkspace 与 API 历史默认工作区一致。
	DefaultAPICatalogWorkspace = DefaultAPIHistoryWorkspace

	// APIVariableScopeGlobal 工作区级全局变量。
	APIVariableScopeGlobal = "global"
	// APIVariableScopeEnvironment 环境级变量。
	APIVariableScopeEnvironment = "environment"
	// APIVariableScopeFolder 文件夹级变量。
	APIVariableScopeFolder = "folder"

	// APIVariableKindString 普通字符串变量。
	APIVariableKindString = "string"
	// APIVariableKindSecret 敏感字符串（UI 掩码；后续可挂 credential_id）。
	APIVariableKindSecret = "secret"
	// APIVariableKindNumber 数字变量，后端按数值解析。
	APIVariableKindNumber = "number"
	// APIVariableKindBoolean 布尔变量，值为 true / false。
	APIVariableKindBoolean = "boolean"
	// APIVariableKindJSON JSON 文本变量，后端按结构化数据解析。
	APIVariableKindJSON = "json"
	// APIVariableKindUUID UUID 变量，可按需生成。
	APIVariableKindUUID = "uuid"
	// APIVariableKindCounter 计数器变量（meta_json 存 step 等）。
	APIVariableKindCounter = "counter"
	// APIVariableKindDatetime 时间变量（meta_json 存 format 等）。
	APIVariableKindDatetime = "datetime"
	// APIVariableKindFileRef 文件引用变量（meta_json 存 path/hash）。
	APIVariableKindFileRef = "file_ref"
)

// APIEnvironmentRecord 对应 nm_api_environment 一行。
type APIEnvironmentRecord struct {
	EnvironmentID   string
	WorkspaceID     string
	EnvironmentName string
	BaseURL         string
	RowVersion      int64
	CreatedAt       string
	UpdatedAt       string
}

// APIVariableRecord 对应 nm_api_variable 一行。
type APIVariableRecord struct {
	VariableID    string
	WorkspaceID   string
	VariableScope string
	ScopeRefID    string
	VariableName  string
	VariableKind  string
	InitialValue  string
	CurrentValue  string
	MetaJSON      string
	SortOrder     int64
	RowVersion    int64
	CreatedAt     string
	UpdatedAt     string
}

// APICatalogStore 读写 nm_api_environment 与 nm_api_variable。
type APICatalogStore struct {
	db *sql.DB
}

// NewAPICatalogStore 基于已打开的 SQLite 连接池创建 APICatalogStore。
func NewAPICatalogStore(db *sql.DB) *APICatalogStore {
	return &APICatalogStore{db: db}
}

const apiEnvironmentColumns = `environment_id, workspace_id, environment_name, base_url, row_version, created_at, updated_at`

const apiVariableColumns = `variable_id, workspace_id, variable_scope, scope_ref_id, variable_name, variable_kind,
    initial_value, current_value, meta_json, sort_order, row_version, created_at, updated_at`

func workspaceOrCatalogDefault(workspaceID string) string {
	if workspaceID == "" {
		return DefaultAPICatalogWorkspace
	}
	return workspaceID
}

func normalizeVariableScope(scope string) (string, error) {
	switch strings.TrimSpace(scope) {
	case APIVariableScopeGlobal, APIVariableScopeEnvironment, APIVariableScopeFolder:
		return strings.TrimSpace(scope), nil
	default:
		return "", fmt.Errorf("store: invalid variable scope %q", scope)
	}
}

func normalizeVariableKind(kind string) string {
	switch strings.TrimSpace(kind) {
	case APIVariableKindSecret,
		APIVariableKindNumber,
		APIVariableKindBoolean,
		APIVariableKindJSON,
		APIVariableKindUUID,
		APIVariableKindCounter,
		APIVariableKindDatetime,
		APIVariableKindFileRef:
		return strings.TrimSpace(kind)
	default:
		return APIVariableKindString
	}
}

func normalizeMetaJSON(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return "{}"
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(trimmed), &payload); err != nil {
		return "{}"
	}
	out, err := json.Marshal(payload)
	if err != nil {
		return "{}"
	}
	return string(out)
}

func nowRFC3339() string {
	return time.Now().UTC().Format(time.RFC3339)
}

func scanAPIEnvironment(scanner interface{ Scan(dest ...any) error }) (APIEnvironmentRecord, error) {
	var rec APIEnvironmentRecord
	err := scanner.Scan(
		&rec.EnvironmentID, &rec.WorkspaceID, &rec.EnvironmentName, &rec.BaseURL,
		&rec.RowVersion, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return APIEnvironmentRecord{}, fmt.Errorf("store: scan api environment: %w", err)
	}
	return rec, nil
}

func scanAPIVariable(scanner interface{ Scan(dest ...any) error }) (APIVariableRecord, error) {
	var rec APIVariableRecord
	err := scanner.Scan(
		&rec.VariableID, &rec.WorkspaceID, &rec.VariableScope, &rec.ScopeRefID, &rec.VariableName, &rec.VariableKind,
		&rec.InitialValue, &rec.CurrentValue, &rec.MetaJSON, &rec.SortOrder, &rec.RowVersion, &rec.CreatedAt, &rec.UpdatedAt,
	)
	if err != nil {
		return APIVariableRecord{}, fmt.Errorf("store: scan api variable: %w", err)
	}
	return rec, nil
}

// ListEnvironments 按名称排序返回工作区全部环境。
func (s *APICatalogStore) ListEnvironments(ctx context.Context, workspaceID string) ([]APIEnvironmentRecord, error) {
	workspaceID = workspaceOrCatalogDefault(workspaceID)
	rows, err := s.db.QueryContext(ctx,
		"SELECT "+apiEnvironmentColumns+" FROM nm_api_environment WHERE workspace_id = ? ORDER BY environment_name ASC, environment_id ASC",
		workspaceID)
	if err != nil {
		return nil, fmt.Errorf("store: list api environments: %w", err)
	}
	defer rows.Close()

	out := make([]APIEnvironmentRecord, 0)
	for rows.Next() {
		rec, scanErr := scanAPIEnvironment(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list api environments rows: %w", err)
	}
	return out, nil
}

// GetEnvironment 按 environment_id 读取环境。
func (s *APICatalogStore) GetEnvironment(ctx context.Context, environmentID string) (APIEnvironmentRecord, error) {
	if strings.TrimSpace(environmentID) == "" {
		return APIEnvironmentRecord{}, fmt.Errorf("store: get api environment: environment_id required")
	}
	row := s.db.QueryRowContext(ctx, "SELECT "+apiEnvironmentColumns+" FROM nm_api_environment WHERE environment_id = ?", environmentID)
	rec, err := scanAPIEnvironment(row)
	if err != nil {
		return APIEnvironmentRecord{}, err
	}
	return rec, nil
}

// CreateEnvironment 新建环境；environmentID 非空时保留（v2 迁移）。
func (s *APICatalogStore) CreateEnvironment(ctx context.Context, rec APIEnvironmentRecord) (APIEnvironmentRecord, error) {
	if strings.TrimSpace(rec.EnvironmentID) == "" {
		return APIEnvironmentRecord{}, fmt.Errorf("store: create api environment: environment_id required")
	}
	rec.WorkspaceID = workspaceOrCatalogDefault(rec.WorkspaceID)
	rec.EnvironmentName = strings.TrimSpace(rec.EnvironmentName)
	if rec.EnvironmentName == "" {
		return APIEnvironmentRecord{}, fmt.Errorf("store: create api environment: environment_name required")
	}
	now := nowRFC3339()
	if rec.CreatedAt == "" {
		rec.CreatedAt = now
	}
	if rec.UpdatedAt == "" {
		rec.UpdatedAt = now
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_api_environment (
        environment_id, workspace_id, environment_name, base_url, row_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		rec.EnvironmentID, rec.WorkspaceID, rec.EnvironmentName, rec.BaseURL, rec.RowVersion, rec.CreatedAt, rec.UpdatedAt)
	if err != nil {
		return APIEnvironmentRecord{}, fmt.Errorf("store: create api environment: %w", err)
	}
	return rec, nil
}

// UpdateEnvironment 更新环境名称与 base_url。
func (s *APICatalogStore) UpdateEnvironment(ctx context.Context, rec APIEnvironmentRecord) (APIEnvironmentRecord, error) {
	if strings.TrimSpace(rec.EnvironmentID) == "" {
		return APIEnvironmentRecord{}, fmt.Errorf("store: update api environment: environment_id required")
	}
	rec.EnvironmentName = strings.TrimSpace(rec.EnvironmentName)
	if rec.EnvironmentName == "" {
		return APIEnvironmentRecord{}, fmt.Errorf("store: update api environment: environment_name required")
	}
	rec.UpdatedAt = nowRFC3339()
	result, err := s.db.ExecContext(ctx, `UPDATE nm_api_environment SET
        environment_name = ?, base_url = ?, row_version = row_version + 1, updated_at = ?
    WHERE environment_id = ?`,
		rec.EnvironmentName, rec.BaseURL, rec.UpdatedAt, rec.EnvironmentID)
	if err != nil {
		return APIEnvironmentRecord{}, fmt.Errorf("store: update api environment: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return APIEnvironmentRecord{}, fmt.Errorf("store: update api environment: not found")
	}
	return s.GetEnvironment(ctx, rec.EnvironmentID)
}

// DeleteEnvironment 删除环境及其环境级变量。
func (s *APICatalogStore) DeleteEnvironment(ctx context.Context, environmentID string) error {
	if strings.TrimSpace(environmentID) == "" {
		return fmt.Errorf("store: delete api environment: environment_id required")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("store: delete api environment begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		"DELETE FROM nm_api_variable WHERE variable_scope = ? AND scope_ref_id = ?",
		APIVariableScopeEnvironment, environmentID); err != nil {
		return fmt.Errorf("store: delete api environment vars: %w", err)
	}
	result, err := tx.ExecContext(ctx, "DELETE FROM nm_api_environment WHERE environment_id = ?", environmentID)
	if err != nil {
		return fmt.Errorf("store: delete api environment: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("store: delete api environment: not found")
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("store: delete api environment commit: %w", err)
	}
	return nil
}

// ListVariables 按 scope 列出变量；scope 为空时返回工作区全部变量。
func (s *APICatalogStore) ListVariables(ctx context.Context, workspaceID, scope, scopeRefID string) ([]APIVariableRecord, error) {
	workspaceID = workspaceOrCatalogDefault(workspaceID)
	scope = strings.TrimSpace(scope)
	scopeRefID = strings.TrimSpace(scopeRefID)

	var (
		rows *sql.Rows
		err  error
	)
	switch {
	case scope == "":
		rows, err = s.db.QueryContext(ctx,
			"SELECT "+apiVariableColumns+" FROM nm_api_variable WHERE workspace_id = ? ORDER BY variable_scope ASC, scope_ref_id ASC, sort_order ASC, variable_name ASC",
			workspaceID)
	case scope == APIVariableScopeGlobal:
		rows, err = s.db.QueryContext(ctx,
			"SELECT "+apiVariableColumns+" FROM nm_api_variable WHERE workspace_id = ? AND variable_scope = ? AND scope_ref_id = '' ORDER BY sort_order ASC, variable_name ASC",
			workspaceID, scope)
	default:
		if scopeRefID == "" {
			return nil, fmt.Errorf("store: list api variables: scopeRefId required for scope %q", scope)
		}
		rows, err = s.db.QueryContext(ctx,
			"SELECT "+apiVariableColumns+" FROM nm_api_variable WHERE workspace_id = ? AND variable_scope = ? AND scope_ref_id = ? ORDER BY sort_order ASC, variable_name ASC",
			workspaceID, scope, scopeRefID)
	}
	if err != nil {
		return nil, fmt.Errorf("store: list api variables: %w", err)
	}
	defer rows.Close()

	out := make([]APIVariableRecord, 0)
	for rows.Next() {
		rec, scanErr := scanAPIVariable(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list api variables rows: %w", err)
	}
	return out, nil
}

// UpsertVariable 按 variable_id 插入或更新变量。
func (s *APICatalogStore) UpsertVariable(ctx context.Context, rec APIVariableRecord) (APIVariableRecord, error) {
	if strings.TrimSpace(rec.VariableID) == "" {
		return APIVariableRecord{}, fmt.Errorf("store: upsert api variable: variable_id required")
	}
	scope, err := normalizeVariableScope(rec.VariableScope)
	if err != nil {
		return APIVariableRecord{}, err
	}
	rec.VariableScope = scope
	rec.WorkspaceID = workspaceOrCatalogDefault(rec.WorkspaceID)
	rec.VariableName = strings.TrimSpace(rec.VariableName)
	if rec.VariableName == "" {
		return APIVariableRecord{}, fmt.Errorf("store: upsert api variable: variable_name required")
	}
	rec.ScopeRefID = strings.TrimSpace(rec.ScopeRefID)
	if rec.VariableScope == APIVariableScopeGlobal {
		rec.ScopeRefID = ""
	} else if rec.ScopeRefID == "" {
		return APIVariableRecord{}, fmt.Errorf("store: upsert api variable: scope_ref_id required")
	}
	rec.VariableKind = normalizeVariableKind(rec.VariableKind)
	rec.MetaJSON = normalizeMetaJSON(rec.MetaJSON)
	now := nowRFC3339()
	if rec.CreatedAt == "" {
		rec.CreatedAt = now
	}
	rec.UpdatedAt = now

	_, err = s.db.ExecContext(ctx, `INSERT INTO nm_api_variable (
        variable_id, workspace_id, variable_scope, scope_ref_id, variable_name, variable_kind,
        initial_value, current_value, meta_json, sort_order, row_version, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(variable_id) DO UPDATE SET
        variable_name = excluded.variable_name,
        variable_kind = excluded.variable_kind,
        initial_value = excluded.initial_value,
        current_value = excluded.current_value,
        meta_json = excluded.meta_json,
        sort_order = excluded.sort_order,
        row_version = row_version + 1,
        updated_at = excluded.updated_at`,
		rec.VariableID, rec.WorkspaceID, rec.VariableScope, rec.ScopeRefID, rec.VariableName, rec.VariableKind,
		rec.InitialValue, rec.CurrentValue, rec.MetaJSON, rec.SortOrder, rec.RowVersion, rec.CreatedAt, rec.UpdatedAt)
	if err != nil {
		return APIVariableRecord{}, fmt.Errorf("store: upsert api variable: %w", err)
	}
	return rec, nil
}

// DeleteVariable 按 variable_id 物理删除。
func (s *APICatalogStore) DeleteVariable(ctx context.Context, variableID string) error {
	if strings.TrimSpace(variableID) == "" {
		return fmt.Errorf("store: delete api variable: variable_id required")
	}
	result, err := s.db.ExecContext(ctx, "DELETE FROM nm_api_variable WHERE variable_id = ?", variableID)
	if err != nil {
		return fmt.Errorf("store: delete api variable: %w", err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return fmt.Errorf("store: delete api variable: not found")
	}
	return nil
}

// ReplaceScopeVariables 替换某 scope 下全部变量（先删后插）。
func (s *APICatalogStore) ReplaceScopeVariables(ctx context.Context, workspaceID, scope, scopeRefID string, rows []APIVariableRecord, idNext func() (string, error)) ([]APIVariableRecord, error) {
	scope, err := normalizeVariableScope(scope)
	if err != nil {
		return nil, err
	}
	workspaceID = workspaceOrCatalogDefault(workspaceID)
	scopeRefID = strings.TrimSpace(scopeRefID)
	if scope == APIVariableScopeGlobal {
		scopeRefID = ""
	} else if scopeRefID == "" {
		return nil, fmt.Errorf("store: replace api variables: scope_ref_id required")
	}
	if idNext == nil {
		return nil, fmt.Errorf("store: replace api variables: id generator required")
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, fmt.Errorf("store: replace api variables begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	if _, err := tx.ExecContext(ctx,
		"DELETE FROM nm_api_variable WHERE workspace_id = ? AND variable_scope = ? AND scope_ref_id = ?",
		workspaceID, scope, scopeRefID); err != nil {
		return nil, fmt.Errorf("store: replace api variables delete: %w", err)
	}

	now := nowRFC3339()
	out := make([]APIVariableRecord, 0, len(rows))
	for index, row := range rows {
		name := strings.TrimSpace(row.VariableName)
		if name == "" {
			continue
		}
		variableID := strings.TrimSpace(row.VariableID)
		if variableID == "" {
			variableID, err = idNext()
			if err != nil {
				return nil, err
			}
		}
		rec := APIVariableRecord{
			VariableID:    variableID,
			WorkspaceID:   workspaceID,
			VariableScope: scope,
			ScopeRefID:    scopeRefID,
			VariableName:  name,
			VariableKind:  normalizeVariableKind(row.VariableKind),
			InitialValue:  row.InitialValue,
			CurrentValue:  row.CurrentValue,
			MetaJSON:      normalizeMetaJSON(row.MetaJSON),
			SortOrder:     int64(index),
			CreatedAt:     now,
			UpdatedAt:     now,
		}
		if rec.CurrentValue == "" {
			rec.CurrentValue = rec.InitialValue
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO nm_api_variable (
            variable_id, workspace_id, variable_scope, scope_ref_id, variable_name, variable_kind,
            initial_value, current_value, meta_json, sort_order, row_version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
			rec.VariableID, rec.WorkspaceID, rec.VariableScope, rec.ScopeRefID, rec.VariableName, rec.VariableKind,
			rec.InitialValue, rec.CurrentValue, rec.MetaJSON, rec.SortOrder, rec.CreatedAt, rec.UpdatedAt); err != nil {
			return nil, fmt.Errorf("store: replace api variables insert: %w", err)
		}
		out = append(out, rec)
	}
	if err := tx.Commit(); err != nil {
		return nil, fmt.Errorf("store: replace api variables commit: %w", err)
	}
	return out, nil
}
