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
	// Schema 可选：附加库名（P3）；空则 main。
	Schema    string `json:"schema,omitempty"`
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
	RowsAffected *int64       `json:"rowsAffected,omitempty"`
}

// ExecOnDB 在给定 *sql.DB 上执行（无会话游标）；SELECT 一页截断。
func ExecOnDB(ctx context.Context, db *sql.DB, sqlText string, limit int, requestID string) (*QueryExecResult, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, fmt.Errorf("sqlite: sql required")
	}
	if limit <= 0 {
		limit = DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		limit = MaxQueryLimit
	}
	requestID = id.CoalesceID(requestID, "q")

	start := time.Now()
	if !returnsResultSet(sqlText) {
		res, err := db.ExecContext(ctx, sqlText)
		if err != nil {
			return nil, fmt.Errorf("sqlite: exec: %w", err)
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
			return nil, fmt.Errorf("sqlite: query: %w", err)
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
			RequestID:  requestID,
			DurationMS: time.Since(start).Milliseconds(),
			CommandTag: commandTagForSQL(sqlText),
		}, nil
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
		return nil, fmt.Errorf("sqlite: rows: %w", err)
	}
	truncated := false
	if len(outRows) >= limit && rows.Next() {
		truncated = true
	}

	return &QueryExecResult{
		RequestID:    requestID,
		Columns:      columns,
		Rows:         outRows,
		RowCount:     len(outRows),
		FetchedCount: len(outRows),
		Truncated:    truncated,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   commandTagForSQL(sqlText),
	}, nil
}

func columnMetasFromRows(rows *sql.Rows) ([]ColumnMeta, error) {
	names, err := rows.Columns()
	if err != nil {
		return nil, fmt.Errorf("sqlite: columns: %w", err)
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
		return nil, fmt.Errorf("sqlite: scan: %w", err)
	}
	encoded := make([]any, n)
	for i, v := range raw {
		encoded[i] = encodeCell(v)
	}
	return encoded, nil
}
