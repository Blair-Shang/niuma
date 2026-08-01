package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// InstanceOverviewResult 是实例级概览（连接节点 Monitor「实例」页）。
type InstanceOverviewResult struct {
	Version          string   `json:"version"`
	VersionComment   string   `json:"versionComment,omitempty"`
	CurrentUser      string   `json:"currentUser,omitempty"`
	CurrentDatabase  string   `json:"currentDatabase,omitempty"`
	ServerAddr       string   `json:"serverAddr,omitempty"`
	UptimeSeconds    int64    `json:"uptimeSeconds,omitempty"`
	DatabaseCount    int      `json:"databaseCount"`
	ThreadsConnected int      `json:"threadsConnected"`
	MaxConnections   int      `json:"maxConnections,omitempty"`
	Questions        int64    `json:"questions,omitempty"`
	SlowQueries      int64    `json:"slowQueries,omitempty"`
	// StatusPartial：部分 GLOBAL STATUS 读取失败时为 true（避免 UI 把 0 当真实值）。
	StatusPartial bool     `json:"statusPartial,omitempty"`
	Warnings      []string `json:"warnings,omitempty"`
}

// InstanceOverview 读取 VERSION / 连接数等概览。
func InstanceOverview(ctx context.Context, db *sql.DB) (*InstanceOverviewResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: instance overview: nil db")
	}
	out := &InstanceOverviewResult{}

	_ = db.QueryRowContext(ctx, "SELECT VERSION()").Scan(&out.Version)
	_ = db.QueryRowContext(ctx, "SELECT @@version_comment").Scan(&out.VersionComment)
	_ = db.QueryRowContext(ctx, "SELECT CURRENT_USER()").Scan(&out.CurrentUser)
	_ = db.QueryRowContext(ctx, "SELECT DATABASE()").Scan(&out.CurrentDatabase)

	var host, port string
	_ = db.QueryRowContext(ctx, "SELECT @@hostname").Scan(&host)
	_ = db.QueryRowContext(ctx, "SELECT @@port").Scan(&port)
	if host != "" {
		if port != "" {
			out.ServerAddr = host + ":" + port
		} else {
			out.ServerAddr = host
		}
	}

	var statusMissed []string
	out.UptimeSeconds = statusInt64Tracked(ctx, db, "Uptime", &statusMissed)
	out.ThreadsConnected = int(statusInt64Tracked(ctx, db, "Threads_connected", &statusMissed))
	out.Questions = statusInt64Tracked(ctx, db, "Questions", &statusMissed)
	out.SlowQueries = statusInt64Tracked(ctx, db, "Slow_queries", &statusMissed)
	out.MaxConnections = int(globalVarInt64(ctx, db, "max_connections"))
	if len(statusMissed) > 0 {
		out.StatusPartial = true
		out.Warnings = append(out.Warnings,
			fmt.Sprintf("global status unavailable: %s", strings.Join(statusMissed, ", ")))
	}

	var dbCount int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys')`).Scan(&dbCount); err == nil {
		out.DatabaseCount = dbCount
	}

	return out, nil
}

// allowedGlobalStatus 仅允许内部常量名进入 SHOW / performance_schema 查询。
func allowedGlobalStatus(name string) bool {
	switch name {
	case "Uptime", "Threads_connected", "Questions", "Slow_queries":
		return true
	default:
		return false
	}
}

func statusInt64(ctx context.Context, db *sql.DB, name string) int64 {
	return statusInt64Tracked(ctx, db, name, nil)
}

func statusInt64Tracked(ctx context.Context, db *sql.DB, name string, missed *[]string) int64 {
	if !allowedGlobalStatus(name) {
		return 0
	}
	var v sql.NullString
	// database/sql 对 SHOW ... LIKE ? 常走预处理，MySQL 对此支持差，易静默失败并返回 0。
	// 优先用 performance_schema（支持占位符）；失败再回退到白名单拼接的 SHOW。
	err := db.QueryRowContext(ctx,
		`SELECT VARIABLE_VALUE FROM performance_schema.global_status WHERE VARIABLE_NAME = ?`,
		name,
	).Scan(&v)
	if err != nil || !v.Valid {
		var nName string
		q := "SHOW GLOBAL STATUS LIKE '" + name + "'"
		if err2 := db.QueryRowContext(ctx, q).Scan(&nName, &v); err2 != nil || !v.Valid {
			if missed != nil {
				*missed = append(*missed, name)
			}
			return 0
		}
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(v.String), 10, 64)
	return n
}

func globalVarInt64(ctx context.Context, db *sql.DB, name string) int64 {
	switch name {
	case "max_connections":
		// ok
	default:
		return 0
	}
	var v sql.NullString
	// name 来自内部白名单常量，非用户输入
	q := "SELECT @@" + name
	if err := db.QueryRowContext(ctx, q).Scan(&v); err != nil || !v.Valid {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(v.String), 10, 64)
	return n
}
