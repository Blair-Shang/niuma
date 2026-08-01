package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	defaultSlowWindowMinutes = 60
	maxSlowWindowMinutes     = 1440
	defaultSlowMinDurationMs = 1000
	defaultSlowLimit         = 50
	maxSlowLimit             = 200
)

// MetricsSnapshotResult 是轻量指标快照，供前端环缓冲采样画趋势。
type MetricsSnapshotResult struct {
	TsMs                int64  `json:"tsMs"`
	MemoryTracking      *int64 `json:"memoryTracking,omitempty"`
	QueryMetric         *int64 `json:"queryMetric,omitempty"`
	MergeMetric         *int64 `json:"mergeMetric,omitempty"`
	DelayedInserts      *int64 `json:"delayedInserts,omitempty"`
	ProcessCount        *int   `json:"processCount,omitempty"`
	RunningMerges       *int   `json:"runningMerges,omitempty"`
	MaxPartsInPartition *int64 `json:"maxPartsInPartition,omitempty"`
	MaxReplicaDelaySecs *int64 `json:"maxReplicaDelaySecs,omitempty"`
}

// MetricsSnapshot 读取少量 system.metrics / asynchronous_metrics，避免全量 overview。
func MetricsSnapshot(ctx context.Context, db *sql.DB) (*MetricsSnapshotResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: metrics snapshot: nil db")
	}
	out := &MetricsSnapshotResult{TsMs: time.Now().UnixMilli()}

	rows, err := db.QueryContext(ctx, `
SELECT metric, value
FROM system.metrics
WHERE metric IN ('MemoryTracking', 'Query', 'Merge', 'DelayedInserts')`)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: metrics snapshot: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var name string
		var value int64
		if err := rows.Scan(&name, &value); err != nil {
			return nil, fmt.Errorf("clickhouse: scan metrics snapshot: %w", err)
		}
		v := value
		switch name {
		case "MemoryTracking":
			out.MemoryTracking = &v
		case "Query":
			out.QueryMetric = &v
		case "Merge":
			out.MergeMetric = &v
		case "DelayedInserts":
			out.DelayedInserts = &v
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: metrics snapshot rows: %w", err)
	}

	if n, err := queryScalarInt64(ctx, db, `SELECT count() FROM system.processes`); err == nil {
		v := int(n)
		out.ProcessCount = &v
	}
	if n, err := queryScalarInt64(ctx, db, `SELECT count() FROM system.merges`); err == nil {
		v := int(n)
		out.RunningMerges = &v
	}

	var maxParts sql.NullFloat64
	if err := db.QueryRowContext(ctx, `
SELECT value FROM system.asynchronous_metrics
WHERE metric = 'MaxPartCountForPartition' LIMIT 1`).Scan(&maxParts); err == nil && maxParts.Valid {
		v := int64(maxParts.Float64)
		out.MaxPartsInPartition = &v
	}

	// system.replicas 为空时 max() 为 NULL；无副本视为延迟 0，避免趋势图断点。
	var maxDelay sql.NullInt64
	if err := db.QueryRowContext(ctx, `
SELECT toInt64(ifNull(max(absolute_delay), 0)) FROM system.replicas`).Scan(&maxDelay); err == nil {
		v := int64(0)
		if maxDelay.Valid {
			v = maxDelay.Int64
		}
		out.MaxReplicaDelaySecs = &v
	}

	return out, nil
}

// SlowQueryInfo 是 system.query_log 中的一条慢查询摘要。
type SlowQueryInfo struct {
	QueryID         string `json:"queryId"`
	User            string `json:"user"`
	StartTime       string `json:"startTime,omitempty"`
	EventTime       string `json:"eventTime"` // 结束时间（query_log.event_time）
	DurationMs      int64  `json:"durationMs"`
	ReadRows        int64  `json:"readRows"`
	ReadBytes       int64  `json:"readBytes"`
	WrittenRows     int64  `json:"writtenRows"`
	WrittenBytes    int64  `json:"writtenBytes"`
	MemoryUsage     int64  `json:"memoryUsage"`
	PeakMemoryUsage int64  `json:"peakMemoryUsage"`
	Type            string `json:"type"`
	Exception       string `json:"exception,omitempty"`
	Query           string `json:"query,omitempty"`
}

// SlowQueriesResult 是 meta.slowQueries 返回。
type SlowQueriesResult struct {
	Queries       []SlowQueryInfo `json:"queries"`
	WindowMinutes int             `json:"windowMinutes"`
	MinDurationMs int64           `json:"minDurationMs"`
	Truncated     bool            `json:"truncated,omitempty"`
}

// SlowQueriesOptions 控制 query_log 扫描窗口与阈值。
type SlowQueriesOptions struct {
	WindowMinutes int
	MinDurationMs int64
	Limit         int
}

// NormalizeSlowQueriesOptions 校正窗口 / 阈值 / 条数边界。
func NormalizeSlowQueriesOptions(opt SlowQueriesOptions) SlowQueriesOptions {
	if opt.WindowMinutes <= 0 {
		opt.WindowMinutes = defaultSlowWindowMinutes
	}
	if opt.WindowMinutes > maxSlowWindowMinutes {
		opt.WindowMinutes = maxSlowWindowMinutes
	}
	if opt.MinDurationMs < 0 {
		opt.MinDurationMs = 0
	}
	if opt.MinDurationMs == 0 {
		opt.MinDurationMs = defaultSlowMinDurationMs
	}
	if opt.Limit <= 0 {
		opt.Limit = defaultSlowLimit
	}
	if opt.Limit > maxSlowLimit {
		opt.Limit = maxSlowLimit
	}
	return opt
}

// ListSlowQueries 从 system.query_log 取 TopN 慢查询（仅 initial query）。
func ListSlowQueries(ctx context.Context, db *sql.DB, opt SlowQueriesOptions) (*SlowQueriesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: slow queries: nil db")
	}
	opt = NormalizeSlowQueriesOptions(opt)

	// limit+1 用于 truncated 判定；参数用字面量拼装（已规范化为整数）。
	fetchLimit := opt.Limit + 1
	// 别名勿与列同名：ClickHouse 会在 WHERE 中优先用 SELECT 别名，
	// toString(event_time) AS event_time 会导致 String 与 DateTime 比较 (code 386)。
	q := fmt.Sprintf(`
SELECT
  query_id,
  user,
  toString(event_time - toIntervalMillisecond(query_duration_ms)) AS start_time_str,
  toString(event_time) AS event_time_str,
  query_duration_ms,
  read_rows,
  read_bytes,
  written_rows,
  written_bytes,
  memory_usage,
  toUInt64(ProfileEvents['PeakMemoryUsage']) AS peak_memory_usage,
  toString(type) AS type_str,
  exception,
  query
FROM system.query_log
WHERE event_date >= toDate(now() - INTERVAL %d MINUTE)
  AND event_time >= now() - INTERVAL %d MINUTE
  AND type IN ('QueryFinish', 'ExceptionWhileProcessing')
  AND is_initial_query = 1
  AND query_duration_ms >= %d
  AND positionCaseInsensitive(query, 'FROM system.query_log') = 0
  AND positionCaseInsensitive(query, 'FROM system.metrics') = 0
ORDER BY query_duration_ms DESC
LIMIT %d`,
		opt.WindowMinutes, opt.WindowMinutes, opt.MinDurationMs, fetchLimit)

	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: system.query_log: %w", err)
	}
	defer rows.Close()

	out := &SlowQueriesResult{
		Queries:       make([]SlowQueryInfo, 0, opt.Limit),
		WindowMinutes: opt.WindowMinutes,
		MinDurationMs: opt.MinDurationMs,
	}
	for rows.Next() {
		var (
			queryID, user, startTime, eventTime, typ, exception, query string
			durationMs, readRows, readBytes                            int64
			writtenRows, writtenBytes, memoryUsage, peakMem            int64
		)
		if err := rows.Scan(
			&queryID, &user, &startTime, &eventTime, &durationMs,
			&readRows, &readBytes, &writtenRows, &writtenBytes,
			&memoryUsage, &peakMem, &typ, &exception, &query,
		); err != nil {
			return nil, fmt.Errorf("clickhouse: scan slow queries: %w", err)
		}
		out.Queries = append(out.Queries, SlowQueryInfo{
			QueryID:         queryID,
			User:            user,
			StartTime:       startTime,
			EventTime:       eventTime,
			DurationMs:      durationMs,
			ReadRows:        readRows,
			ReadBytes:       readBytes,
			WrittenRows:     writtenRows,
			WrittenBytes:    writtenBytes,
			MemoryUsage:     memoryUsage,
			PeakMemoryUsage: peakMem,
			Type:            typ,
			Exception:       strings.TrimSpace(exception),
			Query:           query,
		})
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("clickhouse: slow queries rows: %w", err)
	}
	if len(out.Queries) > opt.Limit {
		out.Truncated = true
		out.Queries = out.Queries[:opt.Limit]
	}
	return out, nil
}
