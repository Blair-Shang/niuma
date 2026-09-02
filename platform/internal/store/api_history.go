package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"time"
	"unicode/utf8"
)

const (
	// DefaultAPIHistoryWorkspace 与连接站点默认工作区一致。
	DefaultAPIHistoryWorkspace = "default"
	// APIHistoryRetain 每个工作区最多保留的历史条数，超出则物理删除最旧行。
	APIHistoryRetain = 200
	// maxAPIHistoryList 列表接口允许的最大条数。
	maxAPIHistoryList = 200
	// defaultAPIHistoryList 未指定 limit 时的默认条数。
	defaultAPIHistoryList = 80
	// maxAPIExchangeBodyRunes 响应体写入库前的最大 rune 数（约 64KiB 量级）。
	maxAPIExchangeBodyRunes = 64 * 1024
)

// APIHistoryRecord 对应 nm_api_history 一行发送快照。
type APIHistoryRecord struct {
	HistoryID       string
	WorkspaceID     string
	RequestID       string
	RequestName     string
	HTTPMethod      string
	RequestURL      string
	EnvironmentID   string
	EnvironmentName string
	RequestJSON     string
	ExchangeJSON    string
	DurationMS      int64
	HTTPStatus      sql.NullInt64
	CreatedAt       string
}

// APIHistoryStore 读写 nm_api_history。
type APIHistoryStore struct {
	db *sql.DB
}

// NewAPIHistoryStore 基于已打开的 SQLite 连接池创建 APIHistoryStore。
func NewAPIHistoryStore(db *sql.DB) *APIHistoryStore {
	return &APIHistoryStore{db: db}
}

const apiHistoryColumns = `history_id, workspace_id, request_id, request_name, http_method, request_url,
    environment_id, environment_name, request_json, exchange_json, duration_ms, http_status, created_at`

func workspaceOrAPIDefault(workspaceID string) string {
	if workspaceID == "" {
		return DefaultAPIHistoryWorkspace
	}
	return workspaceID
}

func clipExchangeJSON(raw string) string {
	if raw == "" {
		return "{}"
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(raw), &payload); err != nil {
		if utf8.RuneCountInString(raw) <= maxAPIExchangeBodyRunes {
			return raw
		}
		return string([]rune(raw)[:maxAPIExchangeBodyRunes])
	}
	body, _ := payload["body"].(string)
	if utf8.RuneCountInString(body) > maxAPIExchangeBodyRunes {
		payload["body"] = string([]rune(body)[:maxAPIExchangeBodyRunes])
	}
	clipped, err := json.Marshal(payload)
	if err != nil {
		return raw
	}
	return string(clipped)
}

func scanAPIHistory(scanner interface{ Scan(dest ...any) error }) (APIHistoryRecord, error) {
	var (
		rec    APIHistoryRecord
		reqID  sql.NullString
		envID  sql.NullString
		status sql.NullInt64
	)
	err := scanner.Scan(
		&rec.HistoryID, &rec.WorkspaceID, &reqID, &rec.RequestName, &rec.HTTPMethod, &rec.RequestURL,
		&envID, &rec.EnvironmentName, &rec.RequestJSON, &rec.ExchangeJSON, &rec.DurationMS, &status, &rec.CreatedAt,
	)
	if err != nil {
		return APIHistoryRecord{}, fmt.Errorf("store: scan api history: %w", err)
	}
	rec.RequestID = reqID.String
	rec.EnvironmentID = envID.String
	rec.HTTPStatus = status
	return rec, nil
}

// List 按创建时间倒序返回历史；requestID 非空时只看该请求。
func (s *APIHistoryStore) List(ctx context.Context, workspaceID, requestID string, limit int) ([]APIHistoryRecord, error) {
	workspaceID = workspaceOrAPIDefault(workspaceID)
	if limit <= 0 {
		limit = defaultAPIHistoryList
	}
	if limit > maxAPIHistoryList {
		limit = maxAPIHistoryList
	}

	var (
		rows *sql.Rows
		err  error
	)
	if requestID != "" {
		rows, err = s.db.QueryContext(ctx,
			"SELECT "+apiHistoryColumns+" FROM nm_api_history WHERE workspace_id = ? AND request_id = ? ORDER BY created_at DESC LIMIT ?",
			workspaceID, requestID, limit)
	} else {
		rows, err = s.db.QueryContext(ctx,
			"SELECT "+apiHistoryColumns+" FROM nm_api_history WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?",
			workspaceID, limit)
	}
	if err != nil {
		return nil, fmt.Errorf("store: list api history: %w", err)
	}
	defer rows.Close()

	out := make([]APIHistoryRecord, 0)
	for rows.Next() {
		rec, scanErr := scanAPIHistory(rows)
		if scanErr != nil {
			return nil, scanErr
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("store: list api history rows: %w", err)
	}
	return out, nil
}

// Append 写入一条发送快照，并裁掉该工作区超出上限的旧行。
func (s *APIHistoryStore) Append(ctx context.Context, rec APIHistoryRecord) error {
	if rec.HistoryID == "" {
		return fmt.Errorf("store: append api history: history_id required")
	}
	rec.WorkspaceID = workspaceOrAPIDefault(rec.WorkspaceID)
	if rec.CreatedAt == "" {
		rec.CreatedAt = time.Now().UTC().Format(time.RFC3339)
	}
	if rec.RequestJSON == "" {
		rec.RequestJSON = "{}"
	}
	rec.ExchangeJSON = clipExchangeJSON(rec.ExchangeJSON)

	var reqID, envID any
	if rec.RequestID != "" {
		reqID = rec.RequestID
	}
	if rec.EnvironmentID != "" {
		envID = rec.EnvironmentID
	}
	var status any
	if rec.HTTPStatus.Valid {
		status = rec.HTTPStatus.Int64
	}

	_, err := s.db.ExecContext(ctx, `INSERT INTO nm_api_history (
        history_id, workspace_id, request_id, request_name, http_method, request_url,
        environment_id, environment_name, request_json, exchange_json, duration_ms, http_status, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		rec.HistoryID, rec.WorkspaceID, reqID, rec.RequestName, rec.HTTPMethod, rec.RequestURL,
		envID, rec.EnvironmentName, rec.RequestJSON, rec.ExchangeJSON, rec.DurationMS, status, rec.CreatedAt)
	if err != nil {
		return fmt.Errorf("store: append api history: %w", err)
	}
	if err := s.prune(ctx, rec.WorkspaceID); err != nil {
		return err
	}
	return nil
}

func (s *APIHistoryStore) prune(ctx context.Context, workspaceID string) error {
	_, err := s.db.ExecContext(ctx, `
DELETE FROM nm_api_history
WHERE workspace_id = ?
  AND history_id NOT IN (
    SELECT history_id FROM nm_api_history
    WHERE workspace_id = ?
    ORDER BY created_at DESC, history_id DESC
    LIMIT ?
  )`, workspaceID, workspaceID, APIHistoryRetain)
	if err != nil {
		return fmt.Errorf("store: prune api history: %w", err)
	}
	return nil
}

// Delete 按 history_id 物理删除一行。
func (s *APIHistoryStore) Delete(ctx context.Context, historyID string) error {
	if historyID == "" {
		return fmt.Errorf("store: delete api history: history_id required")
	}
	_, err := s.db.ExecContext(ctx, "DELETE FROM nm_api_history WHERE history_id = ?", historyID)
	if err != nil {
		return fmt.Errorf("store: delete api history: %w", err)
	}
	return nil
}

// Clear 物理删除某工作区全部历史。
func (s *APIHistoryStore) Clear(ctx context.Context, workspaceID string) error {
	workspaceID = workspaceOrAPIDefault(workspaceID)
	_, err := s.db.ExecContext(ctx, "DELETE FROM nm_api_history WHERE workspace_id = ?", workspaceID)
	if err != nil {
		return fmt.Errorf("store: clear api history: %w", err)
	}
	return nil
}
