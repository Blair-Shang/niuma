package meta

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// InstanceOverviewResult 是实例级属性（连接节点「实例属性」）。
type InstanceOverviewResult struct {
	Version         string `json:"version"`
	VersionNum      string `json:"versionNum,omitempty"`
	CurrentUser     string `json:"currentUser,omitempty"`
	CurrentDatabase string `json:"currentDatabase,omitempty"`
	ServerAddr      string `json:"serverAddr,omitempty"`
	StartTime       string `json:"startTime,omitempty"`
	DatabaseCount   int    `json:"databaseCount"`
	ActiveBackends  int    `json:"activeBackends"`
	MaxConnections  int    `json:"maxConnections,omitempty"`
}

// InstanceOverview 读取实例版本、连接数等概览信息。
// 使用单参数 current_setting(text)：部分 Kingbase / 旧内核无 current_setting(text, bool)。
func InstanceOverview(ctx context.Context, pool *pgxpool.Pool) (*InstanceOverviewResult, error) {
	out := &InstanceOverviewResult{}

	err := pool.QueryRow(ctx, `
SELECT version(),
       current_setting('server_version'::text),
       current_user::text,
       current_database(),
       COALESCE(inet_server_addr()::text, ''),
       COALESCE(pg_postmaster_start_time()::text, ''),
       (SELECT COUNT(*)::int FROM pg_catalog.pg_database WHERE NOT datistemplate),
       (SELECT COUNT(*)::int FROM pg_catalog.pg_stat_activity),
       COALESCE(NULLIF(current_setting('max_connections'::text), '')::int, 0)
`).Scan(
		&out.Version,
		&out.VersionNum,
		&out.CurrentUser,
		&out.CurrentDatabase,
		&out.ServerAddr,
		&out.StartTime,
		&out.DatabaseCount,
		&out.ActiveBackends,
		&out.MaxConnections,
	)
	if err != nil {
		return nil, fmt.Errorf("kingbase: instance overview: %w", err)
	}
	return out, nil
}

// ActivitySession 是 pg_stat_activity 一行摘要。
// PID 用 int64：部分环境（线程模型 / 大 pid）超出 int32。
type ActivitySession struct {
	PID             int64  `json:"pid"`
	UserName        string `json:"userName,omitempty"`
	Database        string `json:"database,omitempty"`
	State           string `json:"state,omitempty"`
	WaitEvent       string `json:"waitEvent,omitempty"`
	WaitEventType   string `json:"waitEventType,omitempty"`
	ClientAddr      string `json:"clientAddr,omitempty"`
	ClientPort      int    `json:"clientPort,omitempty"`
	ApplicationName string `json:"applicationName,omitempty"`
	Query           string `json:"query,omitempty"`
	DurationMS      int64  `json:"durationMs,omitempty"`
	BackendType     string `json:"backendType,omitempty"`
	QueryStart      string `json:"queryStart,omitempty"`
	XactStart       string `json:"xactStart,omitempty"`
	Waiting         bool   `json:"waiting,omitempty"`
	SessionID       string `json:"sessionId,omitempty"`
	QueryID         string `json:"queryId,omitempty"`
}

const activityFetchLimit = 500

// ActivityResult 是活动会话列表。
type ActivityResult struct {
	Sessions  []ActivitySession `json:"sessions"`
	Truncated bool              `json:"truncated,omitempty"`
	Limit     int               `json:"limit,omitempty"`
}

// ListActivity 列出当前实例活动会话。
// 优先读 wait_event / backend_type（PG 9.6+ / 10+）；列不存在时逐级回退。
func ListActivity(ctx context.Context, pool *pgxpool.Pool) (*ActivityResult, error) {
	out, err := listActivity(ctx, pool, activitySQLKingbase)
	if err != nil && isUndefinedColumn(err) {
		out, err = listActivity(ctx, pool, activitySQLModern)
	}
	if err != nil && isUndefinedColumn(err) {
		out, err = listActivity(ctx, pool, activitySQLWaitEvent)
	}
	if err != nil && isUndefinedColumn(err) {
		out, err = listActivity(ctx, pool, activitySQLLegacyWaiting)
	}
	if err != nil && isUndefinedColumn(err) {
		out, err = listActivity(ctx, pool, activitySQLMinimal)
	}
	if err != nil {
		return nil, err
	}
	out.Limit = activityFetchLimit
	if len(out.Sessions) > activityFetchLimit {
		out.Truncated = true
		out.Sessions = out.Sessions[:activityFetchLimit]
	}
	return out, nil
}

// 列顺序：pid, user, db, state, wait_event, wait_event_type, client, app, query, duration,
// backend_type, client_port, query_start, xact_start, waiting, session_id, query_id
// 耗时语义：
// - active / fastpath = 当前查询耗时
// - idle in transaction* = 事务耗时
// - idle 及其他 = 进入当前状态以来的时长（优先 state_change，否则 query_start）
const activityDurationExpr = `
CASE
  WHEN COALESCE(a.state, '') = 'active'
    OR COALESCE(a.state, '') = 'fastpath function call'
    THEN COALESCE(EXTRACT(EPOCH FROM (now() - a.query_start)) * 1000, 0)::bigint
  WHEN COALESCE(a.state, '') LIKE 'idle in transaction%'
    THEN COALESCE(EXTRACT(EPOCH FROM (now() - COALESCE(a.xact_start, a.query_start))) * 1000, 0)::bigint
  ELSE COALESCE(EXTRACT(EPOCH FROM (now() - COALESCE(a.state_change, a.query_start))) * 1000, 0)::bigint
END
`

// activityDurationExprNoXact：无 xact_start / state_change 的旧内核。
const activityDurationExprNoXact = `
CASE
  WHEN COALESCE(a.state, '') = 'active'
    OR COALESCE(a.state, '') = 'fastpath function call'
    OR COALESCE(a.state, '') LIKE 'idle in transaction%'
    THEN COALESCE(EXTRACT(EPOCH FROM (now() - a.query_start)) * 1000, 0)::bigint
  ELSE COALESCE(EXTRACT(EPOCH FROM (now() - a.query_start)) * 1000, 0)::bigint
END
`

// activitySQLKingbase：含 sessionid / query_id（openGauss / Kingbase 常见扩展列）。
const activitySQLKingbase = `
SELECT a.pid::bigint,
       COALESCE(a.usename::text, ''),
       COALESCE(a.datname::text, ''),
       COALESCE(a.state::text, ''),
       COALESCE(a.wait_event::text, ''),
       COALESCE(a.wait_event_type::text, ''),
       COALESCE(a.client_addr::text, ''),
       COALESCE(a.application_name::text, ''),
       COALESCE(left(a.query, 4000), ''),
` + activityDurationExpr + `,
       COALESCE(a.backend_type::text, ''),
       COALESCE(a.client_port, 0)::int,
       COALESCE(a.query_start::text, ''),
       COALESCE(a.xact_start::text, ''),
       (a.wait_event IS NOT NULL AND a.wait_event <> ''),
       COALESCE(a.sessionid::text, ''),
       COALESCE(a.query_id::text, '')
FROM pg_catalog.pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
ORDER BY a.query_start NULLS LAST
LIMIT 501
`

const activitySQLModern = `
SELECT a.pid::bigint,
       COALESCE(a.usename::text, ''),
       COALESCE(a.datname::text, ''),
       COALESCE(a.state::text, ''),
       COALESCE(a.wait_event::text, ''),
       COALESCE(a.wait_event_type::text, ''),
       COALESCE(a.client_addr::text, ''),
       COALESCE(a.application_name::text, ''),
       COALESCE(left(a.query, 4000), ''),
` + activityDurationExpr + `,
       COALESCE(a.backend_type::text, ''),
       COALESCE(a.client_port, 0)::int,
       COALESCE(a.query_start::text, ''),
       COALESCE(a.xact_start::text, ''),
       (a.wait_event IS NOT NULL AND a.wait_event <> ''),
       ''::text,
       ''::text
FROM pg_catalog.pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
ORDER BY a.query_start NULLS LAST
LIMIT 501
`

const activitySQLWaitEvent = `
SELECT a.pid::bigint,
       COALESCE(a.usename::text, ''),
       COALESCE(a.datname::text, ''),
       COALESCE(a.state::text, ''),
       COALESCE(a.wait_event::text, ''),
       ''::text,
       COALESCE(a.client_addr::text, ''),
       COALESCE(a.application_name::text, ''),
       COALESCE(left(a.query, 4000), ''),
` + activityDurationExpr + `,
       ''::text,
       COALESCE(a.client_port, 0)::int,
       COALESCE(a.query_start::text, ''),
       COALESCE(a.xact_start::text, ''),
       (a.wait_event IS NOT NULL AND a.wait_event <> ''),
       ''::text,
       ''::text
FROM pg_catalog.pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
ORDER BY a.query_start NULLS LAST
LIMIT 501
`

const activitySQLLegacyWaiting = `
SELECT a.pid::bigint,
       COALESCE(a.usename::text, ''),
       COALESCE(a.datname::text, ''),
       COALESCE(a.state::text, ''),
       CASE WHEN a.waiting IS TRUE THEN 'waiting' ELSE '' END,
       ''::text,
       COALESCE(a.client_addr::text, ''),
       COALESCE(a.application_name::text, ''),
       COALESCE(left(a.query, 4000), ''),
` + activityDurationExprNoXact + `,
       ''::text,
       COALESCE(a.client_port, 0)::int,
       COALESCE(a.query_start::text, ''),
       ''::text,
       (a.waiting IS TRUE),
       ''::text,
       ''::text
FROM pg_catalog.pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
ORDER BY a.query_start NULLS LAST
LIMIT 501
`

const activitySQLMinimal = `
SELECT a.pid::bigint,
       COALESCE(a.usename::text, ''),
       COALESCE(a.datname::text, ''),
       COALESCE(a.state::text, ''),
       ''::text,
       ''::text,
       COALESCE(a.client_addr::text, ''),
       COALESCE(a.application_name::text, ''),
       COALESCE(left(a.query, 4000), ''),
` + activityDurationExprNoXact + `,
       ''::text,
       COALESCE(a.client_port, 0)::int,
       COALESCE(a.query_start::text, ''),
       ''::text,
       false::boolean,
       ''::text,
       ''::text
FROM pg_catalog.pg_stat_activity a
WHERE a.pid <> pg_backend_pid()
ORDER BY a.query_start NULLS LAST
LIMIT 501
`

func listActivity(ctx context.Context, pool *pgxpool.Pool, querySQL string) (*ActivityResult, error) {
	rows, err := pool.Query(ctx, querySQL)
	if err != nil {
		return nil, fmt.Errorf("kingbase: list activity: %w", err)
	}
	defer rows.Close()

	out := &ActivityResult{Sessions: make([]ActivitySession, 0, 32)}
	for rows.Next() {
		var (
			s                                                   ActivitySession
			userName, database, state, waitEvent, waitEventType sql.NullString
			clientAddr, applicationName, queryText, backendType sql.NullString
			queryStart, xactStart, sessionID, queryID           sql.NullString
			durationMS                                          sql.NullInt64
			clientPort                                          sql.NullInt64
			waiting                                             sql.NullBool
		)
		if err := rows.Scan(
			&s.PID,
			&userName,
			&database,
			&state,
			&waitEvent,
			&waitEventType,
			&clientAddr,
			&applicationName,
			&queryText,
			&durationMS,
			&backendType,
			&clientPort,
			&queryStart,
			&xactStart,
			&waiting,
			&sessionID,
			&queryID,
		); err != nil {
			return nil, fmt.Errorf("kingbase: scan activity: %w", err)
		}
		s.UserName = nullStr(userName)
		s.Database = nullStr(database)
		s.State = nullStr(state)
		s.WaitEvent = nullStr(waitEvent)
		s.WaitEventType = nullStr(waitEventType)
		s.ClientAddr = nullStr(clientAddr)
		s.ApplicationName = nullStr(applicationName)
		s.Query = nullStr(queryText)
		s.DurationMS = nullInt64(durationMS)
		s.BackendType = nullStr(backendType)
		if clientPort.Valid && clientPort.Int64 != 0 {
			s.ClientPort = int(clientPort.Int64)
		}
		s.QueryStart = nullStr(queryStart)
		s.XactStart = nullStr(xactStart)
		s.Waiting = waiting.Valid && waiting.Bool
		s.SessionID = nullStr(sessionID)
		s.QueryID = nullStr(queryID)
		out.Sessions = append(out.Sessions, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: activity rows: %w", err)
	}
	return out, nil
}

const locksFetchLimit = 500

// LockInfo 是锁等待摘要。
type LockInfo struct {
	PID          int64  `json:"pid"`
	Mode         string `json:"mode,omitempty"`
	Granted      bool   `json:"granted"`
	Relation     string `json:"relation,omitempty"`
	LockType     string `json:"lockType,omitempty"`
	Database     string `json:"database,omitempty"`
	BlockedByPID int64  `json:"blockedByPid,omitempty"`
}

// LockBlockingEdge 是「被阻塞 PID → 阻塞方 PID」边（可拼阻塞链）。
type LockBlockingEdge struct {
	BlockedPID  int64 `json:"blockedPid"`
	BlockingPID int64 `json:"blockingPid"`
}

// LocksResult 是锁列表。
type LocksResult struct {
	Locks     []LockInfo         `json:"locks"`
	Blocking  []LockBlockingEdge `json:"blocking,omitempty"`
	Truncated bool               `json:"truncated,omitempty"`
	Limit     int                `json:"limit,omitempty"`
}

// ListLocks 列出未授予或关系锁（限制条数），并标注阻塞方 PID / 阻塞边。
func ListLocks(ctx context.Context, pool *pgxpool.Pool) (*LocksResult, error) {
	out, err := listLocksWithBlockedBy(ctx, pool)
	if err != nil && isUndefinedColumn(err) {
		out, err = listLocksBasic(ctx, pool)
	}
	if err != nil {
		return nil, err
	}
	out.Limit = locksFetchLimit
	if len(out.Locks) > locksFetchLimit {
		out.Truncated = true
		out.Locks = out.Locks[:locksFetchLimit]
	}
	if edges, eerr := listBlockingEdges(ctx, pool); eerr == nil {
		out.Blocking = edges
	}
	return out, nil
}

func listLocksWithBlockedBy(ctx context.Context, pool *pgxpool.Pool) (*LocksResult, error) {
	rows, err := pool.Query(ctx, `
SELECT l.pid::bigint,
       COALESCE(l.mode::text, ''),
       COALESCE(l.granted, false),
       COALESCE(c.relname::text, ''),
       COALESCE(l.locktype::text, ''),
       COALESCE(d.datname::text, ''),
       COALESCE((
         SELECT bl.pid::bigint
         FROM pg_catalog.pg_locks bl
         WHERE bl.granted
           AND NOT COALESCE(l.granted, false)
           AND bl.pid IS DISTINCT FROM l.pid
           AND bl.locktype = l.locktype
           AND bl.database IS NOT DISTINCT FROM l.database
           AND bl.relation IS NOT DISTINCT FROM l.relation
           AND bl.page IS NOT DISTINCT FROM l.page
           AND bl.tuple IS NOT DISTINCT FROM l.tuple
           AND bl.virtualxid IS NOT DISTINCT FROM l.virtualxid
           AND bl.transactionid IS NOT DISTINCT FROM l.transactionid
           AND bl.classid IS NOT DISTINCT FROM l.classid
           AND bl.objid IS NOT DISTINCT FROM l.objid
           AND bl.objsubid IS NOT DISTINCT FROM l.objsubid
         ORDER BY bl.pid
         LIMIT 1
       ), 0)::bigint
FROM pg_catalog.pg_locks l
LEFT JOIN pg_catalog.pg_class c ON c.oid = l.relation
LEFT JOIN pg_catalog.pg_database d ON d.oid = l.database
WHERE l.pid IS NOT NULL
  AND (NOT l.granted OR l.locktype IN ('relation', 'tuple', 'transactionid'))
ORDER BY l.granted, l.pid
LIMIT 501
`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := &LocksResult{Locks: make([]LockInfo, 0, 32)}
	for rows.Next() {
		var (
			item                         LockInfo
			mode, relation, lockType, db sql.NullString
			granted                      sql.NullBool
			blockedBy                    sql.NullInt64
		)
		if err := rows.Scan(
			&item.PID,
			&mode,
			&granted,
			&relation,
			&lockType,
			&db,
			&blockedBy,
		); err != nil {
			return nil, fmt.Errorf("kingbase: scan lock: %w", err)
		}
		item.Mode = nullStr(mode)
		item.Granted = granted.Valid && granted.Bool
		item.Relation = nullStr(relation)
		item.LockType = nullStr(lockType)
		item.Database = nullStr(db)
		item.BlockedByPID = nullInt64(blockedBy)
		out.Locks = append(out.Locks, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: locks rows: %w", err)
	}
	return out, nil
}

func listLocksBasic(ctx context.Context, pool *pgxpool.Pool) (*LocksResult, error) {
	rows, err := pool.Query(ctx, `
SELECT l.pid::bigint,
       COALESCE(l.mode::text, ''),
       COALESCE(l.granted, false),
       COALESCE(c.relname::text, ''),
       COALESCE(l.locktype::text, ''),
       COALESCE(d.datname::text, '')
FROM pg_catalog.pg_locks l
LEFT JOIN pg_catalog.pg_class c ON c.oid = l.relation
LEFT JOIN pg_catalog.pg_database d ON d.oid = l.database
WHERE l.pid IS NOT NULL
  AND (NOT l.granted OR l.locktype IN ('relation', 'tuple', 'transactionid'))
ORDER BY l.granted, l.pid
LIMIT 501
`)
	if err != nil {
		return nil, fmt.Errorf("kingbase: list locks: %w", err)
	}
	defer rows.Close()

	out := &LocksResult{Locks: make([]LockInfo, 0, 32)}
	for rows.Next() {
		var (
			item                         LockInfo
			mode, relation, lockType, db sql.NullString
			granted                      sql.NullBool
		)
		if err := rows.Scan(
			&item.PID,
			&mode,
			&granted,
			&relation,
			&lockType,
			&db,
		); err != nil {
			return nil, fmt.Errorf("kingbase: scan lock: %w", err)
		}
		item.Mode = nullStr(mode)
		item.Granted = granted.Valid && granted.Bool
		item.Relation = nullStr(relation)
		item.LockType = nullStr(lockType)
		item.Database = nullStr(db)
		out.Locks = append(out.Locks, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: locks rows: %w", err)
	}
	return out, nil
}

func listBlockingEdges(ctx context.Context, pool *pgxpool.Pool) ([]LockBlockingEdge, error) {
	edges, err := queryBlockingEdges(ctx, pool, blockingEdgesSQL)
	if err != nil && isUndefinedColumn(err) {
		edges, err = queryBlockingEdges(ctx, pool, blockingEdgesSQLNoVirtualXid)
	}
	if err != nil {
		return nil, err
	}
	return edges, nil
}

const blockingEdgesSQL = `
SELECT DISTINCT blocked.pid::bigint, blocking.pid::bigint
FROM pg_catalog.pg_locks blocked
JOIN pg_catalog.pg_locks blocking
  ON blocking.granted
 AND NOT COALESCE(blocked.granted, false)
 AND blocked.pid IS DISTINCT FROM blocking.pid
 AND blocked.locktype = blocking.locktype
 AND blocked.database IS NOT DISTINCT FROM blocking.database
 AND blocked.relation IS NOT DISTINCT FROM blocking.relation
 AND blocked.page IS NOT DISTINCT FROM blocking.page
 AND blocked.tuple IS NOT DISTINCT FROM blocking.tuple
 AND blocked.virtualxid IS NOT DISTINCT FROM blocking.virtualxid
 AND blocked.transactionid IS NOT DISTINCT FROM blocking.transactionid
 AND blocked.classid IS NOT DISTINCT FROM blocking.classid
 AND blocked.objid IS NOT DISTINCT FROM blocking.objid
 AND blocked.objsubid IS NOT DISTINCT FROM blocking.objsubid
WHERE blocked.pid IS NOT NULL
  AND blocking.pid IS NOT NULL
LIMIT 500
`

const blockingEdgesSQLNoVirtualXid = `
SELECT DISTINCT blocked.pid::bigint, blocking.pid::bigint
FROM pg_catalog.pg_locks blocked
JOIN pg_catalog.pg_locks blocking
  ON blocking.granted
 AND NOT COALESCE(blocked.granted, false)
 AND blocked.pid IS DISTINCT FROM blocking.pid
 AND blocked.locktype = blocking.locktype
 AND blocked.database IS NOT DISTINCT FROM blocking.database
 AND blocked.relation IS NOT DISTINCT FROM blocking.relation
 AND blocked.page IS NOT DISTINCT FROM blocking.page
 AND blocked.tuple IS NOT DISTINCT FROM blocking.tuple
 AND blocked.transactionid IS NOT DISTINCT FROM blocking.transactionid
 AND blocked.classid IS NOT DISTINCT FROM blocking.classid
 AND blocked.objid IS NOT DISTINCT FROM blocking.objid
 AND blocked.objsubid IS NOT DISTINCT FROM blocking.objsubid
WHERE blocked.pid IS NOT NULL
  AND blocking.pid IS NOT NULL
LIMIT 500
`

func queryBlockingEdges(ctx context.Context, pool *pgxpool.Pool, querySQL string) ([]LockBlockingEdge, error) {
	rows, err := pool.Query(ctx, querySQL)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := make([]LockBlockingEdge, 0, 16)
	for rows.Next() {
		var e LockBlockingEdge
		if err := rows.Scan(&e.BlockedPID, &e.BlockingPID); err != nil {
			return nil, fmt.Errorf("kingbase: scan blocking edge: %w", err)
		}
		if e.BlockedPID > 0 && e.BlockingPID > 0 {
			out = append(out, e)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("kingbase: blocking edges rows: %w", err)
	}
	return out, nil
}

// BackendActionResult 是取消 / 终止后端的结果。
type BackendActionResult struct {
	PID     int64 `json:"pid"`
	Success bool  `json:"success"`
}

// CancelBackend 向目标后端发送查询取消（pg_cancel_backend）。
// Kingbase / 线程模型下 pid 可能超出 int4，须按 bigint 传递。
func CancelBackend(ctx context.Context, pool *pgxpool.Pool, pid int64) (*BackendActionResult, error) {
	return backendAction(ctx, pool, pid, "pg_cancel_backend")
}

// TerminateBackend 强制断开目标后端（pg_terminate_backend）。
func TerminateBackend(ctx context.Context, pool *pgxpool.Pool, pid int64) (*BackendActionResult, error) {
	return backendAction(ctx, pool, pid, "pg_terminate_backend")
}

func backendAction(ctx context.Context, pool *pgxpool.Pool, pid int64, fn string) (*BackendActionResult, error) {
	if pid <= 0 {
		return nil, fmt.Errorf("kingbase: invalid backend pid")
	}
	if fn != "pg_cancel_backend" && fn != "pg_terminate_backend" {
		return nil, fmt.Errorf("kingbase: unknown backend action")
	}
	var self int64
	if err := pool.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&self); err != nil {
		return nil, fmt.Errorf("kingbase: read backend pid: %w", err)
	}
	if pid == self {
		return nil, fmt.Errorf("kingbase: cannot act on current backend")
	}

	// 优先 bigint：线程模型 pid 远超 int4；回退经 pg_stat_activity 取同类型 pid 再调用。
	ok, err := callBackendFn(ctx, pool, fn, pid)
	if err != nil {
		return nil, fmt.Errorf("kingbase: backend action: %w", err)
	}
	return &BackendActionResult{PID: pid, Success: ok}, nil
}

func callBackendFn(ctx context.Context, pool *pgxpool.Pool, fn string, pid int64) (bool, error) {
	var ok bool
	qDirect := fmt.Sprintf(`SELECT %s($1::bigint)`, fn)
	err := pool.QueryRow(ctx, qDirect, pid).Scan(&ok)
	if err == nil {
		return ok, nil
	}
	// 无 bigint 重载时：用活动视图中的 pid 列（与内核函数签名一致）转发。
	qViaActivity := fmt.Sprintf(`
SELECT %s(a.pid)
FROM pg_catalog.pg_stat_activity a
WHERE a.pid = $1::bigint
LIMIT 1
`, fn)
	err2 := pool.QueryRow(ctx, qViaActivity, pid).Scan(&ok)
	if err2 != nil {
		return false, err
	}
	return ok, nil
}

func isUndefinedColumn(err error) bool {
	var pgErr *pgconn.PgError
	if errors.As(err, &pgErr) {
		return pgErr.Code == "42703"
	}
	msg := err.Error()
	return strings.Contains(msg, "SQLSTATE 42703") ||
		(strings.Contains(msg, "column") && strings.Contains(msg, "does not exist"))
}

func nullInt64(v sql.NullInt64) int64 {
	if !v.Valid {
		return 0
	}
	return v.Int64
}

// TruncateQueryPreview 截断查询预览（供测试/日志）。
func TruncateQueryPreview(q string, max int) string {
	q = strings.TrimSpace(q)
	if max <= 0 || len(q) <= max {
		return q
	}
	return q[:max] + "…"
}
