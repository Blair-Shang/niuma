package session

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"niuma/pkg/common/id"
	"niuma/pkg/common/sqlcell"
)

const (
	// DefaultQueryLimit 是默认页大小（对标 DBeaver fetch size）。
	DefaultQueryLimit = 1000
	// MaxQueryLimit 是单次 fetch / 一页最大行数。
	MaxQueryLimit = 10000
)

// QueryExecParams 是 query.exec 入参。
type QueryExecParams struct {
	SessionID string `json:"sessionId"`
	// Database 可选：与会话默认库不同时，在目标库短连上执行（浏览跨库对象）。
	Database  string `json:"database,omitempty"`
	SQL       string `json:"sql"`
	Limit     int    `json:"limit"`
	TimeoutMS int    `json:"timeoutMs"`
	RequestID string `json:"requestId"`
}

// ColumnMeta 描述结果集列。
type ColumnMeta struct {
	Name       string `json:"name"`
	DataType   string `json:"dataType,omitempty"`
	Nullable   *bool  `json:"nullable,omitempty"`
	PrimaryKey *bool  `json:"primaryKey,omitempty"`
}

// QueryExecResult 是 query.exec 返回。
// HasMore + ResultSetID 表示服务端仍有未取完的游标，可用 query.fetch 续取。
// Truncated 仅在触达 MaxResultSetRows 软上限时为 true（非整页截断）。
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
	// RowsAffected 来自 CommandTag（INSERT/UPDATE/DELETE 等）；指针保证影响 0 行也能序列化。
	RowsAffected *int64   `json:"rowsAffected,omitempty"`
	Notices      []string `json:"notices,omitempty"`
}

// ExecQuery 在会话连接上执行单条 SQL，并对 SELECT 类结果应用行数上限。
func ExecQuery(ctx context.Context, sess *Session, params QueryExecParams) (*QueryExecResult, error) {
	sqlText := strings.TrimSpace(params.SQL)
	if sqlText == "" {
		return nil, fmt.Errorf("kingbase: sql required")
	}
	limit := params.Limit
	if limit <= 0 {
		limit = DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		limit = MaxQueryLimit
	}

	requestID := id.CoalesceID(params.RequestID, "q")

	runCtx := ctx
	var cancelTimeout context.CancelFunc
	if params.TimeoutMS > 0 {
		runCtx, cancelTimeout = context.WithTimeout(ctx, time.Duration(params.TimeoutMS)*time.Millisecond)
		defer cancelTimeout()
	}

	qCtx, release := sess.RegisterQuery(runCtx, requestID)
	defer release()

	return ExecOnPool(qCtx, sess.Pool, sqlText, limit, requestID)
}

// ExecOnPool 在给定连接池上执行查询（短连 / 跨库目标库，无会话取消注册）。
func ExecOnPool(ctx context.Context, pool *pgxpool.Pool, sqlText string, limit int, requestID string) (*QueryExecResult, error) {
	sqlText = strings.TrimSpace(sqlText)
	if sqlText == "" {
		return nil, fmt.Errorf("kingbase: sql required")
	}
	if limit <= 0 {
		limit = DefaultQueryLimit
	}
	if limit > MaxQueryLimit {
		limit = MaxQueryLimit
	}
	requestID = id.CoalesceID(requestID, "q")

	start := time.Now()
	rows, err := pool.Query(ctx, sqlText)
	if err != nil {
		return nil, fmt.Errorf("kingbase: query: %w", err)
	}
	defer rows.Close()

	fieldDescs := rows.FieldDescriptions()
	columns := buildColumnMetas(ctx, pool, fieldDescs)

	// 一次性读满一页后探测是否还有后续（Explain / 无会话场景：不保留游标）。
	outRows := make([][]any, 0, limit)
	for len(outRows) < limit && rows.Next() {
		values, err := rows.Values()
		if err != nil {
			return nil, fmt.Errorf("kingbase: row values: %w", err)
		}
		encoded := make([]any, len(values))
		for i, v := range values {
			encoded[i] = encodeCell(v)
		}
		outRows = append(outRows, encoded)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: rows: %w", err)
	}
	truncated := false
	if len(outRows) >= limit && rows.Next() {
		truncated = true
		// 丢弃探测行，关闭剩余结果（一次性路径不保留游标）。
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: rows: %w", err)
	}

	tag := rows.CommandTag()
	return &QueryExecResult{
		RequestID:    requestID,
		Columns:      columns,
		Rows:         outRows,
		RowCount:     len(outRows),
		FetchedCount: len(outRows),
		HasMore:      false,
		RowsAffected: rowsAffectedFromTag(tag, len(columns)),
		Truncated:    truncated,
		DurationMS:   time.Since(start).Milliseconds(),
		CommandTag:   tag.String(),
	}, nil
}

// ProbeVersion 执行 SELECT version()，用于 session.test 展示。
func ProbeVersion(ctx context.Context, pool *pgxpool.Pool) (string, error) {
	var version string
	if err := pool.QueryRow(ctx, "SELECT version()").Scan(&version); err != nil {
		return "", err
	}
	return version, nil
}

func encodeCell(v any) any {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case bool, string:
		return t
	case int32:
		return t
	case int64:
		return t
	case int16:
		return int32(t)
	case float32:
		if math.IsNaN(float64(t)) || math.IsInf(float64(t), 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case []byte:
		return sqlcell.EncodeBytesAsTextOrBinary(t)
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	case pgtype.Numeric:
		if !t.Valid {
			return nil
		}
		f, err := t.Float64Value()
		if err == nil && f.Valid {
			return f.Float64
		}
		return t.Int.String()
	case json.RawMessage:
		return json.RawMessage(t)
	case map[string]any, []any:
		return t
	default:
		// 复杂 PG 类型回退为字符串，避免 JSON 编解码失败。
		return fmt.Sprintf("%v", t)
	}
}

func oidTypeName(oid uint32) string {
	// 常见内建类型 OID；未知则留空由前端按值推断。
	switch oid {
	case 16:
		return "bool"
	case 17:
		return "bytea"
	case 20:
		return "int8"
	case 21:
		return "int2"
	case 23:
		return "int4"
	case 25:
		return "text"
	case 700:
		return "float4"
	case 701:
		return "float8"
	case 1043:
		return "varchar"
	case 1082:
		return "date"
	case 1114:
		return "timestamp"
	case 1184:
		return "timestamptz"
	case 1700:
		return "numeric"
	case 2950:
		return "uuid"
	case 3802:
		return "jsonb"
	case 114:
		return "json"
	default:
		return ""
	}
}

// rowsAffectedPtr 仅在无结果列时回传（DML/DDL）；SELECT/RETURNING 走 rowCount。
func rowsAffectedPtr(n int64, columnCount int) *int64 {
	if columnCount > 0 {
		return nil
	}
	v := n
	return &v
}

// rowsAffectedFromTag 从 pgx CommandTag 提取影响行数。
func rowsAffectedFromTag(tag pgconn.CommandTag, columnCount int) *int64 {
	return rowsAffectedPtr(tag.RowsAffected(), columnCount)
}
