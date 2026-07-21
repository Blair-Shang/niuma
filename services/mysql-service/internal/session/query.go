package session

import (
	"context"
	"database/sql"
	"encoding/base64"
	"fmt"
	"math"
	"strings"
	"time"
	"unicode/utf8"
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
	// Database 可选：与会话默认库不同时，在目标库短连上执行。
	Database  string `json:"database,omitempty"`
	SQL       string `json:"sql"`
	Limit     int    `json:"limit"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

// ColumnMeta 描述结果集列。
type ColumnMeta struct {
	Name     string `json:"name"`
	DataType string `json:"dataType,omitempty"`
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
	RowsAffected int64        `json:"rowsAffected,omitempty"`
}

// ExecOnDB 在给定 *sql.DB 上执行查询（短连 / 无会话取消注册）；SELECT 一页截断且不保留游标。
func ExecOnDB(ctx context.Context, db *sql.DB, sqlText string, limit int, requestID string) (*QueryExecResult, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, fmt.Errorf("mysql: sql required")
	}
	if limit <= 0 {
		limit = DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		limit = MaxQueryLimit
	}
	if strings.TrimSpace(requestID) == "" {
		requestID = fmt.Sprintf("q-%d", time.Now().UnixNano())
	}

	start := time.Now()
	rows, err := db.QueryContext(ctx, sqlText)
	if err != nil {
		// 非查询语句（INSERT/UPDATE/DDL）走 Exec。
		res, eerr := db.ExecContext(ctx, sqlText)
		if eerr != nil {
			return nil, fmt.Errorf("mysql: query: %w", err)
		}
		affected, _ := res.RowsAffected()
		return &QueryExecResult{
			RequestID:    requestID,
			Columns:      nil,
			Rows:         nil,
			RowCount:     0,
			DurationMS:   time.Since(start).Milliseconds(),
			CommandTag:   "OK",
			RowsAffected: affected,
		}, nil
	}
	defer rows.Close()

	columns, err := columnMetasFromRows(rows)
	if err != nil {
		return nil, err
	}

	outRows := make([][]any, 0, limit)
	for len(outRows) < limit && rows.Next() {
		encoded, serr := scanEncodedRow(rows, len(columns))
		if serr != nil {
			return nil, serr
		}
		outRows = append(outRows, encoded)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: rows: %w", err)
	}
	truncated := false
	if len(outRows) >= limit && rows.Next() {
		truncated = true
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: rows: %w", err)
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
		CommandTag:   "SELECT",
	}, nil
}

// ProbeVersion 执行 SELECT VERSION()，用于 session.test 展示。
func ProbeVersion(ctx context.Context, db *sql.DB) (string, error) {
	var version string
	if err := db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&version); err != nil {
		return "", err
	}
	return strings.TrimSpace(version), nil
}

func columnMetasFromRows(rows *sql.Rows) ([]ColumnMeta, error) {
	names, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("mysql: columns: %w", err)
	}
	types, _ := rows.ColumnTypes()
	out := make([]ColumnMeta, len(names))
	for i, name := range names {
		out[i] = ColumnMeta{Name: name}
		if types != nil && i < len(types) && types[i] != nil {
			out[i].DataType = types[i].DatabaseTypeName()
		}
	}
	return out, nil
}

func scanEncodedRow(rows *sql.Rows, n int) ([]any, error) {
	raw := make([]any, n)
	dest := make([]any, n)
	for i := range raw {
		dest[i] = &raw[i]
	}
	if err := rows.Scan(dest...); err != nil {
		return nil, fmt.Errorf("mysql: scan: %w", err)
	}
	encoded := make([]any, n)
	for i, v := range raw {
		encoded[i] = encodeCell(v)
	}
	return encoded, nil
}

func encodeCell(v any) any {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case bool, string:
		return t
	case int64:
		return t
	case int32:
		return t
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case float32:
		f := float64(t)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case []byte:
		if utf8.Valid(t) && isMostlyPrintable(t) {
			return string(t)
		}
		return map[string]any{
			"$binary": base64.StdEncoding.EncodeToString(t),
		}
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func isMostlyPrintable(b []byte) bool {
	if len(b) == 0 {
		return true
	}
	printable := 0
	for _, c := range b {
		if c == '\t' || c == '\n' || c == '\r' || (c >= 32 && c < 127) {
			printable++
		}
	}
	return printable*10 >= len(b)*8
}
