package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"strings"
)

// execSqlFile 按分号拆分并执行 SQL 文件（支持引号、-- / /* */ 注释；无 MySQL DELIMITER）。
func execSqlFile(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	inputPath string,
	opts ExecSqlFileOptions,
) error {
	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("sqlite: open sql file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	_ = info.Size()

	reader := bufio.NewReaderSize(f, 256*1024)

	var (
		stmt           strings.Builder
		inSingle       bool
		inDouble       bool
		inLineComment  bool
		inBlockComment bool
		blockStar      bool
		bytesRead      int64
		executed       int
		failed         int
	)

	handleErr := func(stmtNo int, execErr error) error {
		if !opts.ContinueOnError {
			return fmt.Errorf("sqlite: exec sql file near statement %d: %w", stmtNo, execErr)
		}
		msg := fmt.Sprintf("error near statement %d: %v", stmtNo, execErr)
		failed++
		m.emitProgress(taskID, PhaseRunning, bytesRead, int64(executed), msg)
		return nil
	}

	flush := func() error {
		raw := strings.TrimSpace(stmt.String())
		stmt.Reset()
		if raw == "" {
			return nil
		}
		stmtNo := executed + failed + 1
		if _, execErr := db.ExecContext(ctx, raw); execErr != nil {
			return handleErr(stmtNo, execErr)
		}
		executed++
		m.emitProgress(taskID, PhaseRunning, bytesRead, int64(executed),
			fmt.Sprintf("executed %d statement(s)", executed))
		return nil
	}

	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}

		r, _, err := reader.ReadRune()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		bytesRead++

		if inBlockComment {
			if blockStar && r == '/' {
				inBlockComment = false
				blockStar = false
			} else {
				blockStar = r == '*'
			}
			continue
		}

		if inLineComment {
			if r == '\n' {
				inLineComment = false
				stmt.WriteRune(r)
			}
			continue
		}

		if inSingle {
			stmt.WriteRune(r)
			if r == '\'' {
				next, peekErr := reader.Peek(1)
				if peekErr == nil && next[0] == '\'' {
					b, _ := reader.ReadByte()
					stmt.WriteByte(b)
					bytesRead++
				} else {
					inSingle = false
				}
			}
			continue
		}

		if inDouble {
			stmt.WriteRune(r)
			if r == '"' {
				next, peekErr := reader.Peek(1)
				if peekErr == nil && next[0] == '"' {
					b, _ := reader.ReadByte()
					stmt.WriteByte(b)
					bytesRead++
				} else {
					inDouble = false
				}
			}
			continue
		}

		if r == '-' {
			next, peekErr := reader.Peek(1)
			if peekErr == nil && next[0] == '-' {
				_, _ = reader.ReadByte()
				bytesRead++
				inLineComment = true
				continue
			}
		}
		if r == '/' {
			next, peekErr := reader.Peek(1)
			if peekErr == nil && next[0] == '*' {
				_, _ = reader.ReadByte()
				bytesRead++
				inBlockComment = true
				blockStar = false
				continue
			}
		}

		if r == '\'' {
			inSingle = true
			stmt.WriteRune(r)
			continue
		}
		if r == '"' {
			inDouble = true
			stmt.WriteRune(r)
			continue
		}
		if r == ';' {
			if err := flush(); err != nil {
				return err
			}
			continue
		}
		stmt.WriteRune(r)
	}

	if err := flush(); err != nil {
		return err
	}
	m.emitProgress(taskID, PhaseRunning, bytesRead, int64(executed),
		fmt.Sprintf("executed %d statement(s), %d failed", executed, failed))
	return nil
}
