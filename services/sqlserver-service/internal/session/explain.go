package session

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"

	"niuma/pkg/common/id"
)

// Explain 在同一物理连接上取估计计划（SHOWPLAN_TEXT）或实际计划（STATISTICS XML）。
// 实际计划会真正执行语句。
func Explain(ctx context.Context, db *sql.DB, sqlText string, analyze bool, limit int, requestID string) (*QueryExecResult, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, fmt.Errorf("sqlserver: sql required")
	}
	pageSize := clampPageSize(limit)
	requestID = id.CoalesceID(requestID, "explain")

	conn, err := db.Conn(ctx)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: explain conn: %w", err)
	}
	defer func() { _ = conn.Close() }()

	on := "SET SHOWPLAN_TEXT ON"
	off := "SET SHOWPLAN_TEXT OFF"
	if analyze {
		on = "SET STATISTICS XML ON"
		off = "SET STATISTICS XML OFF"
	}
	if _, err := conn.ExecContext(ctx, on); err != nil {
		return nil, fmt.Errorf("sqlserver: %s: %w", on, err)
	}
	defer func() {
		_, _ = conn.ExecContext(context.Background(), off)
	}()

	start := time.Now()
	rows, err := conn.QueryContext(ctx, sqlText)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: explain: %w", err)
	}
	defer rows.Close()

	columns, page, err := collectExplainResult(rows, pageSize)
	if err != nil {
		return nil, err
	}
	return &QueryExecResult{
		RequestID:    requestID,
		Columns:      columns,
		Rows:         page,
		RowCount:     len(page),
		FetchedCount: len(page),
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   "EXPLAIN",
	}, nil
}

func collectExplainResult(rows *sql.Rows, pageSize int) ([]ColumnMeta, [][]any, error) {
	var bestCols []ColumnMeta
	var bestRows [][]any
	for {
		cols, err := columnMetasFromRows(rows)
		if err != nil {
			return nil, nil, err
		}
		page := make([][]any, 0, pageSize)
		for len(page) < pageSize && rows.Next() {
			encoded, serr := scanEncodedRow(rows, cols)
			if serr != nil {
				return nil, nil, serr
			}
			page = append(page, encoded)
		}
		if err := rows.Err(); err != nil {
			return nil, nil, fmt.Errorf("sqlserver: explain rows: %w", err)
		}
		if isShowplanColumns(cols) || len(bestCols) == 0 {
			bestCols, bestRows = cols, page
		}
		if !rows.NextResultSet() {
			break
		}
	}
	return bestCols, bestRows, nil
}

func isShowplanColumns(cols []ColumnMeta) bool {
	for _, col := range cols {
		name := strings.ToLower(col.Name)
		if strings.Contains(name, "showplan") || strings.Contains(name, "stmttext") {
			return true
		}
	}
	return false
}
