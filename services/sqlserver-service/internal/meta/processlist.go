// 会话监视（sys.dm_exec_sessions / requests）与 KILL。
//
// 与 query.cancel 区分：cancel 只取消本会话登记的请求；
// Kill 针对服务器上任意 session_id（需 ALTER ANY CONNECTION / VIEW SERVER STATE）。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strconv"
	"strings"
)

// ProcessInfo 是一条用户会话监视行。
type ProcessInfo struct {
	SessionID         int64  `json:"sessionId"`
	LoginName         string `json:"loginName"`
	HostName          string `json:"hostName"`
	ProgramName       string `json:"programName"`
	Status            string `json:"status"`
	Database          string `json:"database,omitempty"`
	Command           string `json:"command,omitempty"`
	WaitType          string `json:"waitType,omitempty"`
	BlockingSessionID int64  `json:"blockingSessionId,omitempty"`
	CPUTime           int64  `json:"cpuTime"`
	ElapsedMs         int64  `json:"elapsedMs"`
	LoginTime         string `json:"loginTime,omitempty"`
	Info              string `json:"info,omitempty"`
}

// ProcesslistResult 是 meta.processlist 返回。
type ProcesslistResult struct {
	Processes []ProcessInfo `json:"processes"`
}

const processlistSQL = `
SELECT
  s.session_id,
  ISNULL(s.login_name, N''),
  ISNULL(s.host_name, N''),
  ISNULL(s.program_name, N''),
  ISNULL(s.status, N''),
  ISNULL(DB_NAME(s.database_id), N''),
  ISNULL(r.command, N''),
  ISNULL(r.wait_type, N''),
  ISNULL(r.blocking_session_id, 0),
  s.cpu_time,
  ISNULL(r.total_elapsed_time, CASE
    WHEN s.last_request_start_time IS NULL THEN 0
    ELSE DATEDIFF(millisecond, s.last_request_start_time, GETDATE())
  END),
  CONVERT(nvarchar(33), s.login_time, 126),
  ISNULL(SUBSTRING(t.text, 1, 4000), N'')
FROM sys.dm_exec_sessions AS s
LEFT JOIN sys.dm_exec_requests AS r
  ON r.session_id = s.session_id
OUTER APPLY sys.dm_exec_sql_text(r.sql_handle) AS t
WHERE s.is_user_process = 1
ORDER BY s.session_id
`

// ListProcesslist 读取用户会话与当前请求。
func ListProcesslist(ctx context.Context, db *sql.DB) (*ProcesslistResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlserver: processlist: nil db")
	}
	rows, err := db.QueryContext(ctx, processlistSQL)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: processlist: %w", err)
	}
	defer rows.Close()

	out := &ProcesslistResult{Processes: make([]ProcessInfo, 0, 32)}
	for rows.Next() {
		var p ProcessInfo
		if err := rows.Scan(
			&p.SessionID,
			&p.LoginName,
			&p.HostName,
			&p.ProgramName,
			&p.Status,
			&p.Database,
			&p.Command,
			&p.WaitType,
			&p.BlockingSessionID,
			&p.CPUTime,
			&p.ElapsedMs,
			&p.LoginTime,
			&p.Info,
		); err != nil {
			return nil, fmt.Errorf("sqlserver: scan processlist: %w", err)
		}
		if p.BlockingSessionID < 0 {
			p.BlockingSessionID = 0
		}
		p.LoginName = strings.TrimSpace(p.LoginName)
		p.HostName = strings.TrimSpace(p.HostName)
		p.ProgramName = strings.TrimSpace(p.ProgramName)
		p.Status = strings.TrimSpace(p.Status)
		p.Database = strings.TrimSpace(p.Database)
		p.Command = strings.TrimSpace(p.Command)
		p.WaitType = strings.TrimSpace(p.WaitType)
		p.LoginTime = strings.TrimSpace(p.LoginTime)
		p.Info = strings.TrimSpace(p.Info)
		out.Processes = append(out.Processes, p)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("sqlserver: processlist rows: %w", err)
	}
	return out, nil
}

// KillSession 执行 KILL <session_id>。
func KillSession(ctx context.Context, db *sql.DB, sessionID int64) error {
	if sessionID <= 0 {
		return fmt.Errorf("sqlserver: kill: invalid session id")
	}
	if db == nil {
		return fmt.Errorf("sqlserver: kill: nil db")
	}
	q := "KILL " + strconv.FormatInt(sessionID, 10)
	if _, err := db.ExecContext(ctx, q); err != nil {
		return fmt.Errorf("sqlserver: %s: %w", strings.ToLower(q), err)
	}
	return nil
}
