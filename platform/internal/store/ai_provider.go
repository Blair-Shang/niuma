package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"time"
)

// AIProvider 对应 nm_ai_provider 一行（不含 API Key 明文）。
type AIProvider struct {
	ProviderID       string
	ProviderName     string
	ProviderKind     string
	BaseURL          string
	CredentialID     string
	DefaultModelCode string
	ProviderOptions  string
	RecordStatus     string
	SortOrder        int64
	RowVersion       int64
	CreatedAt        string
	UpdatedAt        string
}

// AIModel 对应 nm_ai_model 一行。
type AIModel struct {
	ModelID         string
	ProviderID      string
	ModelCode       string
	ModelLabel      string
	ContextWindow   sql.NullInt64
	MaxOutputTokens sql.NullInt64
	ModelOptions    string
	RecordStatus    string
	SortOrder       int64
	RowVersion      int64
	CreatedAt       string
	UpdatedAt       string
}

// AIProviderStore 封装 AI Provider / Model 表读写。
type AIProviderStore struct {
	db *sql.DB
}

// NewAIProviderStore 基于已打开的 SQLite 连接池创建 AIProviderStore。
func NewAIProviderStore(db *sql.DB) *AIProviderStore {
	return &AIProviderStore{db: db}
}

const aiProviderColumns = `provider_id, provider_name, provider_kind, base_url, credential_id,
    default_model_code, provider_options, record_status, sort_order, row_version, created_at, updated_at`

const aiModelColumns = `model_id, provider_id, model_code, model_label, context_window, max_output_tokens,
    model_options, record_status, sort_order, row_version, created_at, updated_at`

// scanAIProvider 从一行结果扫描出 AIProvider。
func scanAIProvider(sc rowScanner) (AIProvider, error) {
	var (
		p          AIProvider
		baseURL    sql.NullString
		credID     sql.NullString
		defaultMod sql.NullString
	)
	if err := sc.Scan(
		&p.ProviderID, &p.ProviderName, &p.ProviderKind, &baseURL, &credID,
		&defaultMod, &p.ProviderOptions, &p.RecordStatus, &p.SortOrder, &p.RowVersion,
		&p.CreatedAt, &p.UpdatedAt,
	); err != nil {
		return AIProvider{}, fmt.Errorf("store: scan ai provider: %w", err)
	}
	p.BaseURL = baseURL.String
	p.CredentialID = credID.String
	p.DefaultModelCode = defaultMod.String
	return p, nil
}

// scanAIModel 从一行结果扫描出 AIModel。
func scanAIModel(sc rowScanner) (AIModel, error) {
	var m AIModel
	if err := sc.Scan(
		&m.ModelID, &m.ProviderID, &m.ModelCode, &m.ModelLabel,
		&m.ContextWindow, &m.MaxOutputTokens, &m.ModelOptions,
		&m.RecordStatus, &m.SortOrder, &m.RowVersion, &m.CreatedAt, &m.UpdatedAt,
	); err != nil {
		return AIModel{}, fmt.Errorf("store: scan ai model: %w", err)
	}
	return m, nil
}

// ListProviders 返回 Provider 列表；status 为空表示不过滤。
func (s *AIProviderStore) ListProviders(ctx context.Context, status string) ([]AIProvider, error) {
	query := "SELECT " + aiProviderColumns + " FROM nm_ai_provider"
	var args []any
	if status != "" {
		query += " WHERE record_status = ?"
		args = append(args, status)
	}
	query += " ORDER BY sort_order, provider_name"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list ai providers: %w", err)
	}
	defer rows.Close()

	var out []AIProvider
	for rows.Next() {
		p, scanErr := scanAIProvider(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list ai providers rows: %w", err)
	}
	return out, nil
}

// GetProvider 按 ID 读取 Provider；不存在时返回 (nil, nil)。
func (s *AIProviderStore) GetProvider(ctx context.Context, providerID string) (*AIProvider, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiProviderColumns+" FROM nm_ai_provider WHERE provider_id = ?", providerID)
	var (
		p          AIProvider
		baseURL    sql.NullString
		credID     sql.NullString
		defaultMod sql.NullString
	)
	err := row.Scan(
		&p.ProviderID, &p.ProviderName, &p.ProviderKind, &baseURL, &credID,
		&defaultMod, &p.ProviderOptions, &p.RecordStatus, &p.SortOrder, &p.RowVersion,
		&p.CreatedAt, &p.UpdatedAt,
	)
	switch {
	case err == nil:
		p.BaseURL = baseURL.String
		p.CredentialID = credID.String
		p.DefaultModelCode = defaultMod.String
		return &p, nil
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	default:
		return nil, fmt.Errorf("store: get ai provider: %w", err)
	}
}

// CreateProvider 插入一条 Provider。
func (s *AIProviderStore) CreateProvider(ctx context.Context, p AIProvider) error {
	now := time.Now().UTC().Format(time.RFC3339)
	status := statusOrDefault(p.RecordStatus)
	options := optionsOrDefault(p.ProviderOptions)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_ai_provider
        (provider_id, provider_name, provider_kind, base_url, credential_id,
         default_model_code, provider_options, record_status, sort_order, row_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		p.ProviderID, p.ProviderName, p.ProviderKind, nullIfEmpty(p.BaseURL), nullIfEmpty(p.CredentialID),
		nullIfEmpty(p.DefaultModelCode), options, status, p.SortOrder, now, now)
	if err != nil {
		return fmt.Errorf("store: create ai provider: %w", err)
	}
	return nil
}

// UpdateProvider 以乐观锁更新 Provider；返回新版本号与是否命中。
func (s *AIProviderStore) UpdateProvider(ctx context.Context, p AIProvider, rowVersion int64) (int64, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	status := statusOrDefault(p.RecordStatus)
	options := optionsOrDefault(p.ProviderOptions)
	newVersion := rowVersion + 1
	res, err := s.db.ExecContext(ctx, `UPDATE nm_ai_provider SET
        provider_name = ?, provider_kind = ?, base_url = ?, credential_id = ?,
        default_model_code = ?, provider_options = ?, record_status = ?, sort_order = ?,
        row_version = ?, updated_at = ?
        WHERE provider_id = ? AND row_version = ?`,
		p.ProviderName, p.ProviderKind, nullIfEmpty(p.BaseURL), nullIfEmpty(p.CredentialID),
		nullIfEmpty(p.DefaultModelCode), options, status, p.SortOrder,
		newVersion, now, p.ProviderID, rowVersion)
	if err != nil {
		return 0, false, fmt.Errorf("store: update ai provider: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, false, fmt.Errorf("store: update ai provider rows: %w", err)
	}
	return newVersion, n > 0, nil
}

// DeleteProvider 物理删除 Provider（调用方需先删模型并清理凭据）。
func (s *AIProviderStore) DeleteProvider(ctx context.Context, providerID string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_ai_provider WHERE provider_id = ?", providerID); err != nil {
		return fmt.Errorf("store: delete ai provider: %w", err)
	}
	return nil
}

// ListModels 列出某 Provider 下的模型；providerID 为空则列出全部。
func (s *AIProviderStore) ListModels(ctx context.Context, providerID string) ([]AIModel, error) {
	query := "SELECT " + aiModelColumns + " FROM nm_ai_model"
	var args []any
	if providerID != "" {
		query += " WHERE provider_id = ?"
		args = append(args, providerID)
	}
	query += " ORDER BY sort_order, model_code"

	rows, err := s.db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("store: list ai models: %w", err)
	}
	defer rows.Close()

	var out []AIModel
	for rows.Next() {
		m, scanErr := scanAIModel(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, m)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list ai models rows: %w", err)
	}
	return out, nil
}

// GetModel 按 ID 读取模型；不存在时返回 (nil, nil)。
func (s *AIProviderStore) GetModel(ctx context.Context, modelID string) (*AIModel, error) {
	row := s.db.QueryRowContext(ctx,
		"SELECT "+aiModelColumns+" FROM nm_ai_model WHERE model_id = ?", modelID)
	var m AIModel
	err := row.Scan(
		&m.ModelID, &m.ProviderID, &m.ModelCode, &m.ModelLabel,
		&m.ContextWindow, &m.MaxOutputTokens, &m.ModelOptions,
		&m.RecordStatus, &m.SortOrder, &m.RowVersion, &m.CreatedAt, &m.UpdatedAt,
	)
	switch {
	case err == nil:
		return &m, nil
	case errors.Is(err, sql.ErrNoRows):
		return nil, nil
	default:
		return nil, fmt.Errorf("store: get ai model: %w", err)
	}
}

// CreateModel 插入一条模型。
func (s *AIProviderStore) CreateModel(ctx context.Context, m AIModel) error {
	now := time.Now().UTC().Format(time.RFC3339)
	status := statusOrDefault(m.RecordStatus)
	options := optionsOrDefault(m.ModelOptions)
	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_ai_model
        (model_id, provider_id, model_code, model_label, context_window, max_output_tokens,
         model_options, record_status, sort_order, row_version, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
		m.ModelID, m.ProviderID, m.ModelCode, m.ModelLabel,
		nullInt64(m.ContextWindow), nullInt64(m.MaxOutputTokens),
		options, status, m.SortOrder, now, now)
	if err != nil {
		return fmt.Errorf("store: create ai model: %w", err)
	}
	return nil
}

// UpdateModel 以乐观锁更新模型。
func (s *AIProviderStore) UpdateModel(ctx context.Context, m AIModel, rowVersion int64) (int64, bool, error) {
	now := time.Now().UTC().Format(time.RFC3339)
	status := statusOrDefault(m.RecordStatus)
	options := optionsOrDefault(m.ModelOptions)
	newVersion := rowVersion + 1
	res, err := s.db.ExecContext(ctx, `UPDATE nm_ai_model SET
        model_code = ?, model_label = ?, context_window = ?, max_output_tokens = ?,
        model_options = ?, record_status = ?, sort_order = ?, row_version = ?, updated_at = ?
        WHERE model_id = ? AND row_version = ?`,
		m.ModelCode, m.ModelLabel, nullInt64(m.ContextWindow), nullInt64(m.MaxOutputTokens),
		options, status, m.SortOrder, newVersion, now, m.ModelID, rowVersion)
	if err != nil {
		return 0, false, fmt.Errorf("store: update ai model: %w", err)
	}
	n, err := res.RowsAffected()
	if err != nil {
		return 0, false, fmt.Errorf("store: update ai model rows: %w", err)
	}
	return newVersion, n > 0, nil
}

// DeleteModel 物理删除一条模型。
func (s *AIProviderStore) DeleteModel(ctx context.Context, modelID string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_ai_model WHERE model_id = ?", modelID); err != nil {
		return fmt.Errorf("store: delete ai model: %w", err)
	}
	return nil
}

// DeleteModelsByProvider 删除某 Provider 下全部模型。
func (s *AIProviderStore) DeleteModelsByProvider(ctx context.Context, providerID string) error {
	if _, err := s.db.ExecContext(ctx,
		"DELETE FROM nm_ai_model WHERE provider_id = ?", providerID); err != nil {
		return fmt.Errorf("store: delete ai models by provider: %w", err)
	}
	return nil
}

// nullIfEmpty 将空字符串转为 SQL NULL。
func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

// nullInt64 将未置位的 NullInt64 转为 SQL NULL。
func nullInt64(v sql.NullInt64) any {
	if !v.Valid {
		return nil
	}
	return v.Int64
}
