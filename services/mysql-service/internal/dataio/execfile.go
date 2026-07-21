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

// execSqlFile 从本地 SQL 文件逐条读取并执行语句。
// 支持 MySQL 语法：单引号/双引号字符串、反引号标识符、-- 和 # 行注释、/* */ 块注释。
// 语句以 `;` 分隔；不支持 DELIMITER 重写（如需存储过程请使用 query.exec）。
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
		return fmt.Errorf("mysql: open sql file: %w", err)
	}
	defer f.Close()

	info, err := f.Stat()
	if err != nil {
		return err
	}
	total := info.Size()

	reader := bufio.NewReaderSize(f, 256*1024)

	var (
		stmt             strings.Builder
		inSingle         bool // 单引号字符串内
		inDouble         bool // 双引号字符串内
		inBacktick       bool // 反引号标识符内
		inLineComment    bool // 行注释（-- 或 #）内
		inBlockComment   bool // 块注释 /* */ 内
		blockCommentStar bool // 块注释中上一字符为 *
		bytesRead        int64
		executed         int
		failed           int
	)

	handleErr := func(stmtNo int, execErr error) error {
		if !opts.ContinueOnError {
			return fmt.Errorf("mysql: exec sql file near statement %d: %w", stmtNo, execErr)
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

		// 块注释内
		if inBlockComment {
			if blockCommentStar && r == '/' {
				inBlockComment = false
				blockCommentStar = false
			} else {
				blockCommentStar = r == '*'
			}
			continue
		}

		// 行注释内
		if inLineComment {
			if r == '\n' {
				inLineComment = false
				stmt.WriteRune(r) // 保留换行以便行号对齐
			}
			continue
		}

		// 单引号字符串内
		if inSingle {
			stmt.WriteRune(r)
			if r == '\'' {
				// MySQL 用 '' 转义单引号
				next, peekErr := reader.Peek(1)
				if peekErr == nil && next[0] == '\'' {
					b, _ := reader.ReadByte()
					stmt.WriteByte(b)
					bytesRead++
				} else {
					inSingle = false
				}
			} else if r == '\\' {
				// 反斜杠转义下一字符
				b, _, readErr := reader.ReadRune()
				if readErr == nil {
					stmt.WriteRune(b)
					bytesRead++
				}
			}
			continue
		}

		// 双引号字符串内
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

		// 反引号标识符内
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

		// 普通状态：检测注释开始
		if r == '-' {
			next, peekErr := reader.Peek(1)
			if peekErr == nil && next[0] == '-' {
				// -- 行注释
				_, _ = reader.ReadByte()
				bytesRead++
				inLineComment = true
				continue
			}
		}
		if r == '#' {
			inLineComment = true
			continue
		}
		if r == '/' {
			next, peekErr := reader.Peek(1)
			if peekErr == nil && next[0] == '*' {
				_, _ = reader.ReadByte()
				bytesRead++
				inBlockComment = true
				blockCommentStar = false
				continue
			}
		}

		// 引号/反引号开始
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

		// 语句分隔符
		if r == ';' {
			if err := flush(); err != nil {
				return err
			}
			continue
		}

		stmt.WriteRune(r)
	}

	// 文件末尾可能有无 `;` 的最后一条语句
	if err := flush(); err != nil {
		return err
	}

	if failed > 0 {
		m.emitProgress(taskID, PhaseRunning, total, int64(executed),
			fmt.Sprintf("completed with %d error(s), %d succeeded", failed, executed))
		return fmt.Errorf("mysql: exec sql file completed with %d error(s), %d succeeded", failed, executed)
	}
	m.emitProgress(taskID, PhaseRunning, total, int64(executed),
		fmt.Sprintf("executed %d statement(s)", executed))
	return nil
}
