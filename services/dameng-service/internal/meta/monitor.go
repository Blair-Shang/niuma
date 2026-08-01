// 会话监控：进程列表、Kill、实例概览、锁等待（达梦动态性能视图，失败时降级）。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// ProcessInfo 是一条会话/进程行（JSON 形状与 MySQL 兼容）。
// Command/State 填达梦 STATE（ACTIVE / IDLE 等）；Time 为距 LAST_RECV_TIME 的秒数。
type ProcessInfo struct {
	ID      int64   `json:"id"`
	User    string  `json:"user"`
	Host    string  `json:"host"`
	DB      *string `json:"db,omitempty"`
	Command string  `json:"command"`
	Time    int64   `json:"time"`
	State   *string `json:"state,omitempty"`
	Info    *string `json:"info,omitempty"`
}

// ProcesslistResult 是 meta.processlist 返回。
type ProcesslistResult struct {
	Processes []ProcessInfo `json:"processes"`
}

// InstanceOverviewResult 是实例级概览（Monitor「实例」页）。
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
	StatusPartial    bool     `json:"statusPartial,omitempty"`
	Warnings         []string `json:"warnings,omitempty"`
}

// LockInfo 是锁等待摘要；waitingPid / blockingPid 为会话 SESS_ID。
type LockInfo struct {
	WaitingPID     int64  `json:"waitingPid"`
	BlockingPID    int64  `json:"blockingPid,omitempty"`
	WaitingUser    string `json:"waitingUser,omitempty"`
	BlockingUser   string `json:"blockingUser,omitempty"`
	WaitingQuery   string `json:"waitingQuery,omitempty"`
	LockType       string `json:"lockType,omitempty"`
	LockMode       string `json:"lockMode,omitempty"`
	ObjectName     string `json:"objectName,omitempty"`
	WaitAgeSeconds int64  `json:"waitAgeSeconds,omitempty"`
}

// LocksResult 是 meta.locks 返回。
type LocksResult struct {
	Locks       []LockInfo `json:"locks"`
	Truncated   bool       `json:"truncated,omitempty"`
	Limit       int        `json:"limit,omitempty"`
	Unavailable bool       `json:"unavailable,omitempty"`
	Message     string     `json:"message,omitempty"`
}

const locksFetchLimit = 200

// ListProcesslist 读取 V$SESSIONS；优先 LAST_RECV 活跃时长，多路列名回退。
func ListProcesslist(ctx context.Context, db *sql.DB) (*ProcesslistResult, error) {
	if db == nil {
		return nil, fmt.Errorf("dameng: processlist: nil db")
	}
	// 达梦列名是 CURR_SCH / CLNT_IP（不是 CURRENT_SCH）；SQL_TEXT 可能偏长，CAST 便于驱动扫描。
	queries := []string{
		`SELECT SESS_ID, USER_NAME, CLNT_IP, CURR_SCH, STATE, CAST(SQL_TEXT AS VARCHAR(4000)), DATEDIFF(SS, LAST_RECV_TIME, SYSDATE) FROM V$SESSIONS`,
		`SELECT SESS_ID, USER_NAME, CLNT_HOST, CURR_SCH, STATE, CAST(SQL_TEXT AS VARCHAR(4000)), DATEDIFF(SS, LAST_RECV_TIME, SYSDATE) FROM V$SESSIONS`,
		`SELECT SESS_ID, USER_NAME, CLNT_IP, CURR_SCH, STATE, CAST(SQL_TEXT AS VARCHAR(4000)), LAST_RECV_TIME FROM V$SESSIONS`,
		`SELECT SESS_ID, USER_NAME, CLNT_IP, CURR_SCH, STATE, SQL_TEXT, LAST_RECV_TIME FROM V$SESSIONS`,
		`SELECT SESS_ID, USER_NAME, CLNT_IP, CURR_SCH, STATE, CAST(SQL_TEXT AS VARCHAR(4000)), CREATE_TIME FROM V$SESSIONS`,
		`SELECT SESS_ID, USER_NAME, CLNT_IP, CURR_SCH, STATE, NULL, 0 FROM V$SESSIONS`,
	}
	var lastErr error
	for _, q := range queries {
		out, err := queryProcesslist(ctx, db, q)
		if err == nil {
			return out, nil
		}
		lastErr = err
	}
	if lastErr != nil {
		return nil, fmt.Errorf("dameng: processlist: %w", lastErr)
	}
	return &ProcesslistResult{Processes: []ProcessInfo{}}, nil
}

func queryProcesslist(ctx context.Context, db *sql.DB, q string) (*ProcesslistResult, error) {
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	out := &ProcesslistResult{Processes: make([]ProcessInfo, 0, 32)}
	now := time.Now()
	for rows.Next() {
		cols, err := rows.Columns()
		if err != nil {
			return nil, err
		}
		dest := make([]any, len(cols))
		holders := make([]any, len(cols))
		for i := range dest {
			holders[i] = &dest[i]
		}
		if err := rows.Scan(holders...); err != nil {
			return nil, fmt.Errorf("dameng: scan processlist: %w", err)
		}
		if len(dest) < 1 {
			continue
		}
		id := toInt64(dest[0])
		user := pickNullString(dest, 1)
		host := pickNullString(dest, 2)
		dbName := pickNullString(dest, 3)
		state := pickNullString(dest, 4)
		info := pickNullString(dest, 5)
		timeSec := int64(0)
		if len(dest) > 6 {
			timeSec = durationSeconds(dest[6], now)
		}
		stateVal := strings.TrimSpace(state.String)
		p := ProcessInfo{
			ID:      id,
			User:    user.String,
			Host:    host.String,
			Command: "IDLE",
			Time:    timeSec,
		}
		if dbName.Valid && strings.TrimSpace(dbName.String) != "" {
			s := strings.TrimSpace(dbName.String)
			p.DB = &s
		}
		if stateVal != "" {
			s := stateVal
			p.State = &s
			p.Command = strings.ToUpper(s)
		}
		if info.Valid && strings.TrimSpace(info.String) != "" {
			s := info.String
			p.Info = &s
		}
		out.Processes = append(out.Processes, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

// durationSeconds 解析 DATEDIFF 数值或 TIMESTAMP。
func durationSeconds(v any, now time.Time) int64 {
	if v == nil {
		return 0
	}
	if n := toInt64(v); n != 0 || isNumeric(v) {
		if n < 0 {
			return 0
		}
		return n
	}
	if t, ok := v.(time.Time); ok {
		sec := int64(now.Sub(t).Seconds())
		if sec < 0 {
			return 0
		}
		return sec
	}
	if ns := toNullString(v); ns.Valid {
		for _, layout := range []string{
			"2006-01-02 15:04:05.999999999",
			"2006-01-02 15:04:05",
			time.RFC3339Nano,
			time.RFC3339,
		} {
			if t, e := time.ParseInLocation(layout, strings.TrimSpace(ns.String), time.Local); e == nil {
				sec := int64(now.Sub(t).Seconds())
				if sec < 0 {
					return 0
				}
				return sec
			}
		}
	}
	return 0
}

func isNumeric(v any) bool {
	switch v.(type) {
	case int64, int32, int, float64, float32:
		return true
	case []byte, string:
		s := strings.TrimSpace(fmt.Sprint(v))
		_, err := strconv.ParseInt(s, 10, 64)
		return err == nil
	default:
		return false
	}
}

func pickNullString(dest []any, i int) sql.NullString {
	if i >= len(dest) {
		return sql.NullString{}
	}
	return toNullString(dest[i])
}

// KillProcess 关闭会话：CALL SP_CLOSE_SESSION(?)。
// 达梦无可靠的「仅取消当前语句」API；queryOnly=true 时返回明确错误，避免误杀会话。
func KillProcess(ctx context.Context, db *sql.DB, id int64, queryOnly bool) error {
	if db == nil {
		return fmt.Errorf("dameng: kill: nil db")
	}
	if id <= 0 {
		return fmt.Errorf("dameng: kill: invalid id")
	}
	if queryOnly {
		return fmt.Errorf("dameng: query-only kill is not supported; close the session instead")
	}
	if _, err := db.ExecContext(ctx, "CALL SP_CLOSE_SESSION(?)", id); err != nil {
		// 部分驱动对过程占位符支持差，回退字面量
		if _, err2 := db.ExecContext(ctx, fmt.Sprintf("CALL SP_CLOSE_SESSION(%d)", id)); err2 != nil {
			return fmt.Errorf("dameng: kill session %d: %w", id, err)
		}
	}
	return nil
}

// InstanceOverview 读取版本 / 会话数 / schema 数等概览；不可用字段省略。
func InstanceOverview(ctx context.Context, db *sql.DB) (*InstanceOverviewResult, error) {
	if db == nil {
		return nil, fmt.Errorf("dameng: instance overview: nil db")
	}
	out := &InstanceOverviewResult{}
	var warnings []string

	out.Version = readVersion(ctx, db)
	if out.Version == "" {
		warnings = append(warnings, "version unavailable")
	}

	var user string
	if err := db.QueryRowContext(ctx, "SELECT USER FROM DUAL").Scan(&user); err == nil {
		out.CurrentUser = strings.TrimSpace(user)
	}
	var sch string
	if err := db.QueryRowContext(ctx, "SELECT SYS_CONTEXT('USERENV','CURRENT_SCHEMA') FROM DUAL").Scan(&sch); err == nil {
		out.CurrentDatabase = strings.TrimSpace(sch)
	}

	var threads int
	if err := db.QueryRowContext(ctx, "SELECT COUNT(*) FROM V$SESSIONS").Scan(&threads); err == nil {
		out.ThreadsConnected = threads
	}

	var dbCount int
	for _, q := range []string{
		"SELECT COUNT(*) FROM ALL_USERS",
		"SELECT COUNT(*) FROM DBA_USERS",
		`SELECT COUNT(*) FROM ALL_OBJECTS WHERE OBJECT_TYPE = 'SCH'`,
	} {
		if err := db.QueryRowContext(ctx, q).Scan(&dbCount); err == nil {
			out.DatabaseCount = dbCount
			break
		}
	}

	if len(warnings) > 0 {
		out.StatusPartial = true
		out.Warnings = warnings
	}
	return out, nil
}

func readVersion(ctx context.Context, db *sql.DB) string {
	var v string
	if err := db.QueryRowContext(ctx, "SELECT BANNER FROM V$VERSION WHERE ROWNUM = 1").Scan(&v); err == nil {
		return strings.TrimSpace(v)
	}
	if err := db.QueryRowContext(ctx, "SELECT * FROM V$VERSION").Scan(&v); err == nil {
		return strings.TrimSpace(v)
	}
	rows, err := db.QueryContext(ctx, "SELECT * FROM V$VERSION")
	if err != nil {
		return ""
	}
	defer rows.Close()
	parts := make([]string, 0, 4)
	for rows.Next() {
		cols, _ := rows.Columns()
		dest := make([]any, len(cols))
		holders := make([]any, len(cols))
		for i := range dest {
			holders[i] = &dest[i]
		}
		if err := rows.Scan(holders...); err != nil {
			break
		}
		for _, d := range dest {
			if s := strings.TrimSpace(fmt.Sprint(d)); s != "" && s != "<nil>" {
				parts = append(parts, s)
			}
		}
	}
	return strings.Join(parts, " ")
}

// ListLocks 优先 V$TRXWAIT（事务等待）映射到 SESS_ID；失败返回 Unavailable。
func ListLocks(ctx context.Context, db *sql.DB) (*LocksResult, error) {
	if db == nil {
		return nil, fmt.Errorf("dameng: locks: nil db")
	}
	out, err := listLocksQueries(ctx, db)
	if err != nil {
		return &LocksResult{
			Locks:       []LockInfo{},
			Limit:       locksFetchLimit,
			Unavailable: true,
			Message:     err.Error(),
		}, nil
	}
	out.Limit = locksFetchLimit
	if len(out.Locks) > locksFetchLimit {
		out.Truncated = true
		out.Locks = out.Locks[:locksFetchLimit]
	}
	return out, nil
}

func listLocksQueries(ctx context.Context, db *sql.DB) (*LocksResult, error) {
	// 对齐达梦运维文档：
	//   V$TRXWAIT.ID = 等待事务，WAIT_FOR_ID = 阻塞事务，WAIT_TIME = 毫秒
	//   V$TRX.SESS_ID → V$SESSIONS；V$LOCK.BLOCKED=1 时阻塞方事务在 TID
	queries := []string{
		// 主查询：等待图 + 被阻塞锁的对象信息
		`
SELECT
  COALESCE(ws.SESS_ID, 0),
  COALESCE(bs.SESS_ID, 0),
  COALESCE(ws.USER_NAME, ''),
  COALESCE(bs.USER_NAME, ''),
  COALESCE(CAST(ws.SQL_TEXT AS VARCHAR(4000)), ''),
  COALESCE(l.LTYPE, ''),
  COALESCE(CAST(l.LMODE AS VARCHAR(64)), ''),
  COALESCE(o.NAME, ''),
  COALESCE(w.WAIT_TIME, 0) / 1000
FROM V$TRXWAIT w
LEFT JOIN V$TRX wt ON wt.ID = w.ID
LEFT JOIN V$TRX bt ON bt.ID = w.WAIT_FOR_ID
LEFT JOIN V$SESSIONS ws ON ws.SESS_ID = wt.SESS_ID
LEFT JOIN V$SESSIONS bs ON bs.SESS_ID = bt.SESS_ID
LEFT JOIN V$LOCK l ON l.TRX_ID = w.ID AND l.BLOCKED = 1
LEFT JOIN SYSOBJECTS o ON o.ID = l.TABLE_ID
ORDER BY w.WAIT_TIME DESC
`,
		// 无锁对象信息（V$LOCK / SYSOBJECTS 不可用时）
		`
SELECT
  COALESCE(ws.SESS_ID, 0),
  COALESCE(bs.SESS_ID, 0),
  COALESCE(ws.USER_NAME, ''),
  COALESCE(bs.USER_NAME, ''),
  COALESCE(CAST(ws.SQL_TEXT AS VARCHAR(4000)), ''),
  CAST('' AS VARCHAR(64)),
  CAST('' AS VARCHAR(64)),
  CAST('' AS VARCHAR(128)),
  COALESCE(w.WAIT_TIME, 0) / 1000
FROM V$TRXWAIT w
LEFT JOIN V$TRX wt ON wt.ID = w.ID
LEFT JOIN V$TRX bt ON bt.ID = w.WAIT_FOR_ID
LEFT JOIN V$SESSIONS ws ON ws.SESS_ID = wt.SESS_ID
LEFT JOIN V$SESSIONS bs ON bs.SESS_ID = bt.SESS_ID
ORDER BY w.WAIT_TIME DESC
`,
		// 会话直接经 TRX_ID 关联（部分环境 V$TRX.SESS_ID 不可用）
		`
SELECT
  COALESCE(ws.SESS_ID, 0),
  COALESCE(bs.SESS_ID, 0),
  COALESCE(ws.USER_NAME, ''),
  COALESCE(bs.USER_NAME, ''),
  COALESCE(CAST(ws.SQL_TEXT AS VARCHAR(4000)), ''),
  CAST('' AS VARCHAR(64)),
  CAST('' AS VARCHAR(64)),
  CAST('' AS VARCHAR(128)),
  COALESCE(w.WAIT_TIME, 0) / 1000
FROM V$TRXWAIT w
LEFT JOIN V$SESSIONS ws ON ws.TRX_ID = w.ID
LEFT JOIN V$SESSIONS bs ON bs.TRX_ID = w.WAIT_FOR_ID
ORDER BY w.WAIT_TIME DESC
`,
		// DDL/字典等：仅 V$LOCK.BLOCKED=1；阻塞事务在 TID（不是 BLOCKED_TRX_ID）
		`
SELECT
  COALESCE(ws.SESS_ID, 0),
  COALESCE(bs.SESS_ID, 0),
  COALESCE(ws.USER_NAME, ''),
  COALESCE(bs.USER_NAME, ''),
  COALESCE(CAST(ws.SQL_TEXT AS VARCHAR(4000)), ''),
  COALESCE(l.LTYPE, ''),
  COALESCE(CAST(l.LMODE AS VARCHAR(64)), ''),
  COALESCE(o.NAME, ''),
  0
FROM V$LOCK l
LEFT JOIN V$SESSIONS ws ON ws.TRX_ID = l.TRX_ID
LEFT JOIN V$SESSIONS bs ON bs.TRX_ID = l.TID
LEFT JOIN SYSOBJECTS o ON o.ID = l.TABLE_ID
WHERE l.BLOCKED = 1
`,
	}
	var lastErr error
	for _, q := range queries {
		rows, err := db.QueryContext(ctx, q)
		if err != nil {
			lastErr = err
			continue
		}
		out, err := scanLockRows(rows)
		rows.Close()
		if err != nil {
			lastErr = err
			continue
		}
		return out, nil
	}
	if lastErr == nil {
		lastErr = fmt.Errorf("dameng: locks view unavailable")
	}
	return nil, lastErr
}

func scanLockRows(rows *sql.Rows) (*LocksResult, error) {
	out := &LocksResult{Locks: make([]LockInfo, 0, 16)}
	seen := make(map[string]struct{}, 16)
	for rows.Next() {
		var item LockInfo
		var object string
		if err := rows.Scan(
			&item.WaitingPID,
			&item.BlockingPID,
			&item.WaitingUser,
			&item.BlockingUser,
			&item.WaitingQuery,
			&item.LockType,
			&item.LockMode,
			&object,
			&item.WaitAgeSeconds,
		); err != nil {
			return nil, fmt.Errorf("dameng: scan locks: %w", err)
		}
		item.ObjectName = strings.TrimPrefix(strings.TrimSpace(object), ".")
		// V$LOCK 联接可能一对多，按会话对去重
		key := fmt.Sprintf("%d:%d", item.WaitingPID, item.BlockingPID)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out.Locks = append(out.Locks, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}

func toInt64(v any) int64 {
	switch x := v.(type) {
	case nil:
		return 0
	case int64:
		return x
	case int32:
		return int64(x)
	case int:
		return int64(x)
	case float64:
		return int64(x)
	case float32:
		return int64(x)
	case []byte:
		n, _ := strconv.ParseInt(string(x), 10, 64)
		return n
	case string:
		n, _ := strconv.ParseInt(strings.TrimSpace(x), 10, 64)
		return n
	default:
		n, _ := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(x)), 10, 64)
		return n
	}
}

func toNullString(v any) sql.NullString {
	if v == nil {
		return sql.NullString{}
	}
	switch x := v.(type) {
	case string:
		return sql.NullString{String: x, Valid: true}
	case []byte:
		return sql.NullString{String: string(x), Valid: true}
	default:
		s := strings.TrimSpace(fmt.Sprint(x))
		if s == "" || s == "<nil>" {
			return sql.NullString{}
		}
		return sql.NullString{String: s, Valid: true}
	}
}
