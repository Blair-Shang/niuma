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
	Version         string `json:"version"`
	VersionComment  string `json:"versionComment,omitempty"`
	CurrentUser     string `json:"currentUser,omitempty"`
	CurrentDatabase string `json:"currentDatabase,omitempty"`
	ServerAddr      string `json:"serverAddr,omitempty"`
	UptimeSeconds   int64  `json:"uptimeSeconds,omitempty"`
	DatabaseCount   int    `json:"databaseCount"`
	ThreadsConnected int   `json:"threadsConnected"`
	MaxConnections  int    `json:"maxConnections,omitempty"`
	Questions       int64  `json:"questions,omitempty"`
	SlowQueries     int64  `json:"slowQueries,omitempty"`
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

	out.UptimeSeconds = statusInt64(ctx, db, "Uptime")
	out.ThreadsConnected = int(statusInt64(ctx, db, "Threads_connected"))
	out.Questions = statusInt64(ctx, db, "Questions")
	out.SlowQueries = statusInt64(ctx, db, "Slow_queries")
	out.MaxConnections = int(globalVarInt64(ctx, db, "max_connections"))

	var dbCount int
	if err := db.QueryRowContext(ctx, `
SELECT COUNT(*) FROM information_schema.SCHEMATA
WHERE SCHEMA_NAME NOT IN ('information_schema','performance_schema','mysql','sys')`).Scan(&dbCount); err == nil {
		out.DatabaseCount = dbCount
	}

	return out, nil
}

func statusInt64(ctx context.Context, db *sql.DB, name string) int64 {
	var nName string
	var v sql.NullString
	if err := db.QueryRowContext(ctx, "SHOW GLOBAL STATUS LIKE ?", name).Scan(&nName, &v); err != nil || !v.Valid {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(v.String), 10, 64)
	return n
}

func globalVarInt64(ctx context.Context, db *sql.DB, name string) int64 {
	var v sql.NullString
	// name 来自内部白名单常量，非用户输入
	q := "SELECT @@" + name
	if err := db.QueryRowContext(ctx, q).Scan(&v); err != nil || !v.Valid {
		return 0
	}
	n, _ := strconv.ParseInt(strings.TrimSpace(v.String), 10, 64)
	return n
}
