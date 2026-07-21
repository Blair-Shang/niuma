// 进程列表（SHOW FULL PROCESSLIST）与 KILL。
//
// 与 query.cancel 区分：cancel 只取消本会话登记的请求；
// Kill 针对服务器上任意连接 ID（需 PROCESS / SUPER 等权限）。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// ProcessInfo 是一条 SHOW FULL PROCESSLIST 行。
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

// ListProcesslist 执行 SHOW FULL PROCESSLIST。
func ListProcesslist(ctx context.Context, db *sql.DB) (*ProcesslistResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: processlist: nil db")
	}
	rows, err := db.QueryContext(ctx, "SHOW FULL PROCESSLIST")
	if err != nil {
		return nil, fmt.Errorf("mysql: show processlist: %w", err)
	}
	defer rows.Close()

	out := &ProcesslistResult{Processes: make([]ProcessInfo, 0, 32)}
	for rows.Next() {
		var (
			id            int64
			user, host    string
			dbName        sql.NullString
			command       string
			timeSec       int64
			state, info   sql.NullString
		)
		// Id, User, Host, db, Command, Time, State, Info
		if err := rows.Scan(&id, &user, &host, &dbName, &command, &timeSec, &state, &info); err != nil {
			return nil, fmt.Errorf("mysql: scan processlist: %w", err)
		}
		p := ProcessInfo{
			ID:      id,
			User:    user,
			Host:    host,
			Command: command,
			Time:    timeSec,
		}
		if dbName.Valid {
			s := dbName.String
			p.DB = &s
		}
		if state.Valid {
			s := state.String
			p.State = &s
		}
		if info.Valid {
			s := info.String
			p.Info = &s
		}
		out.Processes = append(out.Processes, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: processlist rows: %w", err)
	}
	return out, nil
}

// KillProcess 执行 KILL [QUERY] <id>。queryOnly 为 true 时仅取消当前语句。
func KillProcess(ctx context.Context, db *sql.DB, id int64, queryOnly bool) error {
	if db == nil {
		return fmt.Errorf("mysql: kill: nil db")
	}
	if id <= 0 {
		return fmt.Errorf("mysql: kill: invalid id")
	}
	idStr := strconv.FormatInt(id, 10)
	var q string
	if queryOnly {
		q = "KILL QUERY " + idStr
	} else {
		q = "KILL " + idStr
	}
	if _, err := db.ExecContext(ctx, q); err != nil {
		return fmt.Errorf("mysql: %s: %w", strings.ToLower(q), err)
	}
	return nil
}
