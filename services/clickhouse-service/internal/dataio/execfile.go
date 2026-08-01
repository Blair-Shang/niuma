package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"regexp"
	"strings"
)

var createDatabaseRe = regexp.MustCompile(`(?is)^\s*CREATE\s+DATABASE\b`)
var useDatabaseRe = regexp.MustCompile(`(?is)^\s*USE\b`)

// execSqlFile 从本地 SQL 文件逐条读取并执行语句。
// 支持：单/双引号字符串、反引号标识符、-- 行注释、/* */ 块注释；分隔符固定为 ";"。
// 不支持 MySQL 客户端 DELIMITER（ClickHouse 无过程体需求）。
//
// targetDatabase 为还原目标库：会把文件中的 CREATE DATABASE / USE 改写到该库，避免跨库还原写回源库名。
func execSqlFile(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	inputPath string,
	targetDatabase string,
	opts ExecSqlFileOptions,
) error {
	f, err := os.Open(inputPath)
	if err != nil {
		return fmt.Errorf("clickhouse: open sql file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	total := info.Size()
	targetDatabase = strings.TrimSpace(targetDatabase)

	reader := bufio.NewReaderSize(f, 256*1024)

	var (
		stmt           strings.Builder
		inSingle       bool
		inDouble       bool
		inBacktick     bool
		inLineComment  bool
		inBlockComment bool
		blockStar      bool
		bytesRead      int64
		executed       int
		failed         int
		errSamples     []string
	)

	handleErr := func(stmtNo int, execErr error) error {
		detail := fmt.Sprintf("error near statement %d: %v", stmtNo, execErr)
		if !opts.ContinueOnError {
			return fmt.Errorf("clickhouse: exec sql file near statement %d: %w", stmtNo, execErr)
		}
		failed++
		if len(errSamples) < 3 {
			errSamples = append(errSamples, truncateRunes(detail, 180))
		}
		m.emitProgress(taskID, PhaseRunning, bytesRead, int64(executed), detail)
		return nil
	}

	flush := func() error {
		raw := strings.TrimSpace(stmt.String())
		stmt.Reset()
		if raw == "" {
			return nil
		}
		raw = rewriteRestoreStatement(raw, targetDatabase)
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
			} else if r == '\\' {
				b, _, readErr := reader.ReadRune()
				if readErr == nil {
					stmt.WriteRune(b)
					bytesRead++
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

		if inBacktick {
			stmt.WriteRune(r)
			if r == '`' {
				next, peekErr := reader.Peek(1)
				if peekErr == nil && next[0] == '`' {
					b, _ := reader.ReadByte()
					stmt.WriteByte(b)
					bytesRead++
				} else {
					inBacktick = false
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
		if r == '`' {
			inBacktick = true
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

	if failed > 0 {
		msg := fmt.Sprintf("completed with %d error(s), %d succeeded", failed, executed)
		m.emitProgress(taskID, PhaseRunning, total, int64(executed), msg)
		if len(errSamples) > 0 {
			return fmt.Errorf("clickhouse: exec sql file %s; first errors: %s", msg, strings.Join(errSamples, " | "))
		}
		return fmt.Errorf("clickhouse: exec sql file %s", msg)
	}
	m.emitProgress(taskID, PhaseRunning, total, int64(executed),
		fmt.Sprintf("executed %d statement(s)", executed))
	return nil
}

// rewriteRestoreStatement 将 dump 中的源库 CREATE DATABASE / USE 改写到目标库。
func rewriteRestoreStatement(stmt, targetDatabase string) string {
	if targetDatabase == "" {
		return stmt
	}
	if createDatabaseRe.MatchString(stmt) {
		return "CREATE DATABASE IF NOT EXISTS " + quoteIdent(targetDatabase)
	}
	if useDatabaseRe.MatchString(stmt) {
		return "USE " + quoteIdent(targetDatabase)
	}
	return stmt
}

func truncateRunes(s string, max int) string {
	if max <= 0 || len(s) <= max {
		return s
	}
	// 按字节截断即可（日志用途）；避免把超长 CH 错误撑爆 toast
	if len(s) > max {
		return s[:max] + "…"
	}
	return s
}
