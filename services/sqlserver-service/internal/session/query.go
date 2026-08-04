package session

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
)

const (
	// DefaultQueryLimit 是默认页大小。
	DefaultQueryLimit = 1000
	// MaxQueryLimit 是单次 fetch / 一页最大行数。
	MaxQueryLimit = 10000
)

// QueryExecParams 是 query.exec 入参。
type QueryExecParams struct {
	SessionID string `json:"sessionId"`
	// Database 可选：目标库；会话连接上通过 USE 切换。
	Database  string `json:"database,omitempty"`
	SQL       string `json:"sql"`
	Limit     int    `json:"limit"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

// ColumnMeta 描述结果集列。
type ColumnMeta struct {
	Name      string `json:"name"`
	DataType  string `json:"dataType,omitempty"`
	Nullable  *bool  `json:"nullable,omitempty"`
	Length    *int64 `json:"length,omitempty"`
	Precision *int64 `json:"precision,omitempty"`
	Scale     *int64 `json:"scale,omitempty"`
}

// QueryExecResult 是 query.exec 返回。
type QueryExecResult struct {
	RequestID    string       `json:"requestId"`
	ResultSetID  string       `json:"resultSetId,omitempty"`
	Columns      []ColumnMeta `json:"columns"`
	Rows         [][]any      `json:"rows"`
	RowCount     int          `json:"rowCount"`
	FetchedCount int          `json:"fetchedCount,omitempty"`
	HasMore      bool         `json:"hasMore,omitempty"`
	Truncated    bool         `json:"truncated,omitempty"`
	DurationMS   int64        `json:"durationMs"`
	CommandTag   string       `json:"commandTag,omitempty"`
	RowsAffected *int64       `json:"rowsAffected,omitempty"`
}

func clampPageSize(limit int) int {
	if limit <= 0 {
		return DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		return MaxQueryLimit
	}
	return limit
}

func int64Ptr(n int64) *int64 { return &n }

// ExecOnDB 在给定 *sql.DB 上执行查询（短连 / 无会话取消注册）。
func ExecOnDB(ctx context.Context, db *sql.DB, sqlText string, limit int, requestID string) (*QueryExecResult, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, fmt.Errorf("sqlserver: sql required")
	}
	pageSize := clampPageSize(limit)
	requestID = id.CoalesceID(requestID, "q")

	start := time.Now()
	if !returnsResultSet(sqlText) {
		res, err := db.ExecContext(ctx, sqlText)
		if err != nil {
			return nil, fmt.Errorf("sqlserver: exec: %w", err)
		}
		affected, _ := res.RowsAffected()
		return &QueryExecResult{
			RequestID:    requestID,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   commandTagForSQL(sqlText),
			RowsAffected: int64Ptr(affected),
		}, nil
	}

	rows, err := db.QueryContext(ctx, sqlText)
	if err != nil {
		res, eerr := db.ExecContext(ctx, sqlText)
		if eerr != nil {
			return nil, fmt.Errorf("sqlserver: query: %w", err)
		}
		affected, _ := res.RowsAffected()
		return &QueryExecResult{
			RequestID:    requestID,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   commandTagForSQL(sqlText),
			RowsAffected: int64Ptr(affected),
		}, nil
	}
	defer rows.Close()

	columns, err := columnMetasFromRows(rows)
	if err != nil {
		return nil, err
	}
	if len(columns) == 0 {
		return &QueryExecResult{
			RequestID:    requestID,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   commandTagForSQL(sqlText),
			RowsAffected: int64Ptr(0),
		}, nil
	}

	outRows := make([][]any, 0, pageSize)
	for len(outRows) < pageSize && rows.Next() {
		encoded, serr := scanEncodedRow(rows, columns)
		if serr != nil {
			return nil, serr
		}
		outRows = append(outRows, encoded)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlserver: rows: %w", err)
	}
	truncated := false
	if len(outRows) >= pageSize && rows.Next() {
		truncated = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlserver: rows: %w", err)
	}

	return &QueryExecResult{
		RequestID:    requestID,
		Columns:      columns,
		Rows:         outRows,
		RowCount:     len(outRows),
		FetchedCount: len(outRows),
		HasMore:      false,
		Truncated:    truncated,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   commandTagForSQL(sqlText),
	}, nil
}

// ProbeVersion 执行 SELECT @@VERSION，用于 session.test 展示。
func ProbeVersion(ctx context.Context, db *sql.DB) (string, error) {
	var version string
	if err := db.QueryRowContext(ctx, "SELECT @@VERSION").Scan(&version); err != nil {
		return "", err
	}
	return strings.TrimSpace(version), nil
}

func columnMetasFromRows(rows *sql.Rows) ([]ColumnMeta, error) {
	names, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("sqlserver: columns: %w", err)
	}
	types, _ := rows.ColumnTypes()
	out := make([]ColumnMeta, len(names))
	for i, name := range names {
		out[i] = ColumnMeta{Name: name}
		if types == nil || i >= len(types) || types[i] == nil {
			continue
		}
		ct := types[i]
		out[i].DataType = ct.DatabaseTypeName()
		if nullable, ok := ct.Nullable(); ok {
			v := nullable
			out[i].Nullable = &v
		}
		if length, ok := ct.Length(); ok && length >= 0 {
			v := length
			out[i].Length = &v
		}
		if precision, scale, ok := ct.DecimalSize(); ok {
			p, s := precision, scale
			out[i].Precision = &p
			out[i].Scale = &s
		}
	}
	return out, nil
}

func scanEncodedRow(rows *sql.Rows, columns []ColumnMeta) ([]any, error) {
	n := len(columns)
	raw := make([]any, n)
	dest := make([]any, n)
	for i := range raw {
		dest[i] = &raw[i]
	}
	if err := rows.Scan(dest...); err != nil {
		return nil, fmt.Errorf("sqlserver: scan: %w", err)
	}
	encoded := make([]any, n)
	for i, v := range raw {
		col := ColumnMeta{}
		if i < len(columns) {
			col = columns[i]
		}
		encoded[i] = encodeCell(v, col)
	}
	return encoded, nil
}

// ensureConnDatabase 在连接上 USE 到目标库。
func (s *Session) ensureConnDatabase(ctx context.Context, conn *sql.Conn, database string) error {
	database = strings.TrimSpace(database)
	if database == "" || conn == nil {
		return nil
	}
	if !IsSafeDatabaseName(database) {
		return fmt.Errorf("sqlserver: unsafe database name %q", database)
	}
	s.mu.Lock()
	current := s.currentDB
	s.mu.Unlock()
	if strings.EqualFold(current, database) {
		return nil
	}
	ident, err := QuoteIdent(database)
	if err != nil {
		return err
	}
	if _, err := conn.ExecContext(ctx, "USE "+ident); err != nil {
		return fmt.Errorf("sqlserver: use database: %w", err)
	}
	s.mu.Lock()
	s.currentDB = database
	s.mu.Unlock()
	return nil
}
