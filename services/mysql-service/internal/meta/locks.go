package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// LockInfo 是锁等待摘要（InnoDB / performance_schema）。
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

// ListLocks 列出锁等待；优先 performance_schema（8.0+），回退 information_schema（5.7）。
// 两路均失败时返回 Unavailable（非硬错误），便于 UI 区分「无锁」与「无权限/未开启」。
func ListLocks(ctx context.Context, db *sql.DB) (*LocksResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: locks: nil db")
	}
	out, err := listLocksPerfSchema(ctx, db)
	if err != nil {
		out, err = listLocksInnoDB57(ctx, db)
	}
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

func listLocksPerfSchema(ctx context.Context, db *sql.DB) (*LocksResult, error) {
	// PROCESSLIST_TIME：等待线程处于当前状态的秒数，近似等待时长。
	const q = `
SELECT
  COALESCE(r.PROCESSLIST_ID, 0),
  COALESCE(b.PROCESSLIST_ID, 0),
  COALESCE(r.PROCESSLIST_USER, ''),
  COALESCE(b.PROCESSLIST_USER, ''),
  COALESCE(r.PROCESSLIST_INFO, ''),
  COALESCE(dl.LOCK_TYPE, ''),
  COALESCE(dl.LOCK_MODE, ''),
  CONCAT(COALESCE(dl.OBJECT_SCHEMA,''), '.', COALESCE(dl.OBJECT_NAME,'')),
  COALESCE(r.PROCESSLIST_TIME, 0)
FROM performance_schema.data_lock_waits w
JOIN performance_schema.data_locks dl
  ON dl.ENGINE_LOCK_ID = w.REQUESTING_ENGINE_LOCK_ID
LEFT JOIN performance_schema.threads r
  ON r.THREAD_ID = w.REQUESTING_THREAD_ID
LEFT JOIN performance_schema.threads b
  ON b.THREAD_ID = w.BLOCKING_THREAD_ID
LIMIT ?`
	rows, err := db.QueryContext(ctx, q, locksFetchLimit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLockRows(rows)
}

func listLocksInnoDB57(ctx context.Context, db *sql.DB) (*LocksResult, error) {
	const q = `
SELECT
  COALESCE(r.trx_mysql_thread_id, 0),
  COALESCE(b.trx_mysql_thread_id, 0),
  '',
  '',
  COALESCE(r.trx_query, ''),
  COALESCE(l.lock_type, ''),
  COALESCE(l.lock_mode, ''),
  CONCAT(COALESCE(l.lock_table,''), ''),
  CASE
    WHEN r.trx_wait_started IS NULL THEN 0
    ELSE TIMESTAMPDIFF(SECOND, r.trx_wait_started, NOW())
  END
FROM information_schema.INNODB_LOCK_WAITS w
JOIN information_schema.INNODB_TRX r ON r.trx_id = w.requesting_trx_id
JOIN information_schema.INNODB_TRX b ON b.trx_id = w.blocking_trx_id
LEFT JOIN information_schema.INNODB_LOCKS l ON l.lock_id = w.requested_lock_id
LIMIT ?`
	rows, err := db.QueryContext(ctx, q, locksFetchLimit+1)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLockRows(rows)
}

func scanLockRows(rows *sql.Rows) (*LocksResult, error) {
	out := &LocksResult{Locks: make([]LockInfo, 0, 16)}
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
			return nil, fmt.Errorf("mysql: scan locks: %w", err)
		}
		item.ObjectName = strings.TrimPrefix(strings.TrimSpace(object), ".")
		out.Locks = append(out.Locks, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
