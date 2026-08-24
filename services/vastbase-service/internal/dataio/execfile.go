package dataio

import (
	"bufio"
	"context"
	"fmt"
	"io"
	"os"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ExecSqlFileOptions 控制执行 SQL 文件行为。
type ExecSqlFileOptions struct {
	// ContinueOnError 单条语句失败后继续执行后续语句（对标 Navicat / DBeaver「出错继续」）。
	ContinueOnError bool `json:"continueOnError"`
}

func execSqlFile(
	ctx context.Context,
	pool *pgxpool.Pool,
	taskID string,
	m *Manager,
	inputPath string,
	opts ExecSqlFileOptions,
) error {
	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("vastbase: open sql file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	total := info.Size()

	conn, err := pool.Acquire(ctx)
	if err != nil {
		return err
	}
	defer func() {
		if conn != nil {
			conn.Release()
		}
	}()

	reacquire := func() error {
		if conn != nil {
			conn.Release()
			conn = nil
		}
		c, err := pool.Acquire(ctx)
		if err != nil {
			return err
		}
		conn = c
		return nil
	}

	scanner := newSQLStmtScanner(bufio.NewReaderSize(f, 256*1024))
	var (
		executed int
		failed   int
	)

	handleErr := func(stmtNo int, kind string, err error) error {
		if !opts.ContinueOnError {
			if kind == "copy" {
				return fmt.Errorf("vastbase: exec sql file copy near statement %d: %w", stmtNo, err)
			}
			return fmt.Errorf("vastbase: exec sql file near statement %d: %w", stmtNo, err)
		}
		msg := fmt.Sprintf("error near statement %d: %v", stmtNo, err)
		if kind == "copy" {
			msg = fmt.Sprintf("error near statement %d (copy): %v", stmtNo, err)
		}
		failed++
		m.emitProgress(taskID, PhaseRunning, scanner.bytesRead, int64(executed), msg)
		return nil
	}

	runStmt := func(sql string) error {
		stmtNo := executed + failed + 1
		bytesRead := scanner.bytesRead

		if isCopyFromStdin(sql) {
			m.emitProgress(taskID, PhaseRunning, bytesRead, int64(executed), fmt.Sprintf("copying (%d)", stmtNo))
			scanner.addBytes(skipCopyStmtLineEnding(scanner.reader))
			payload := &copyDataReader{br: scanner.reader}
			cr := &countingReader{r: payload, onProgress: func(n int64) {
				m.emitProgress(taskID, PhaseRunning, bytesRead+n, int64(executed), fmt.Sprintf("imported %d bytes", n))
			}}
			_, err := conn.Conn().PgConn().CopyFrom(ctx, cr, sql)
			// 无论成功失败都尽量吃完脚本中的 COPY 数据段，避免后续语句错位
			if !payload.done {
				n, _ := io.Copy(io.Discard, payload)
				_ = n
			}
			scanner.addBytes(payload.consumed())
			if err != nil {
				_ = reacquire()
				return handleErr(stmtNo, "copy", err)
			}
			executed++
			m.emitProgress(taskID, PhaseRunning, scanner.bytesRead, int64(executed), fmt.Sprintf("executed %d statement(s)", executed))
			return nil
		}

		if _, err := conn.Exec(ctx, sql); err != nil {
			return handleErr(stmtNo, "exec", err)
		}
		executed++
		m.emitProgress(taskID, PhaseRunning, scanner.bytesRead, int64(executed), fmt.Sprintf("executed %d statement(s)", executed))
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		sql, err := scanner.next()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if err := runStmt(sql); err != nil {
			return err
		}
	}

	if failed > 0 {
		m.emitProgress(taskID, PhaseRunning, total, int64(executed),
			fmt.Sprintf("completed with %d error(s), %d succeeded", failed, executed))
		return fmt.Errorf("vastbase: completed with %d error(s), %d succeeded", failed, executed)
	}
	m.emitProgress(taskID, PhaseRunning, total, int64(executed), fmt.Sprintf("executed %d statement(s)", executed))
	return nil
}
