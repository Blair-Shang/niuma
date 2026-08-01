package dataio

import (
	"bufio"
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"strings"
	"unicode"
)

// execSqlFile 从本地 SQL 文件逐条读取并执行语句。
// 支持：单/双引号字符串、反引号标识符、-- / # 行注释、/* */ 块注释、
// 客户端 DELIMITER 指令（对齐 mysql CLI / Navicat / DBeaver 还原过程与函数）。
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
		inSingle         bool
		inDouble         bool
		inBacktick       bool
		inLineComment    bool
		inBlockComment   bool
		blockCommentStar bool
		bytesRead        int64
		executed         int
		failed           int
		delimiter        = ";"
		held             []rune // 分隔符部分匹配缓冲
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

	flushHeld := func() {
		for _, hr := range held {
			stmt.WriteRune(hr)
		}
		held = held[:0]
	}

	flush := func() error {
		flushHeld()
		raw := strings.TrimSpace(stmt.String())
		stmt.Reset()
		if raw == "" {
			return nil
		}
		if newDelim, ok := parseDelimiterCommand(raw); ok {
			if newDelim == "" {
				return fmt.Errorf("mysql: empty DELIMITER")
			}
			delimiter = newDelim
			m.emitProgress(taskID, PhaseRunning, bytesRead, int64(executed),
				fmt.Sprintf("delimiter set to %q", delimiter))
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

	inQuoteOrComment := func() bool {
		return inSingle || inDouble || inBacktick || inLineComment || inBlockComment
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
			if blockCommentStar && r == '/' {
				inBlockComment = false
				blockCommentStar = false
			} else {
				blockCommentStar = r == '*'
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
				flushHeld()
				inLineComment = true
				continue
			}
		}
		if r == '#' {
			flushHeld()
			inLineComment = true
			continue
		}
		if r == '/' {
			next, peekErr := reader.Peek(1)
			if peekErr == nil && next[0] == '*' {
				_, _ = reader.ReadByte()
				bytesRead++
				flushHeld()
				inBlockComment = true
				blockCommentStar = false
				continue
			}
		}

		if r == '\'' {
			flushHeld()
			inSingle = true
			stmt.WriteRune(r)
			continue
		}
		if r == '"' {
			flushHeld()
			inDouble = true
			stmt.WriteRune(r)
			continue
		}
		if r == '`' {
			flushHeld()
			inBacktick = true
			stmt.WriteRune(r)
			continue
		}

		// DELIMITER 指令按整行结束（mysql 客户端语义），忽略其中的分隔符字符
		if !inQuoteOrComment() && isDelimiterCommandLine(stmt.String(), held, r) {
			if r == '\n' {
				stmt.WriteRune(r)
				if err := flush(); err != nil {
					return err
				}
				continue
			}
			flushHeld()
			stmt.WriteRune(r)
			continue
		}

		// 普通语句：匹配当前 delimiter
		if !inQuoteOrComment() && len(delimiter) > 0 {
			dr := []rune(delimiter)
			held = append(held, r)
			matched := true
			for i := 0; i < len(held); i++ {
				if held[i] != dr[i] {
					matched = false
					break
				}
			}
			if matched {
				if len(held) == len(dr) {
					held = held[:0]
					if err := flush(); err != nil {
						return err
					}
				}
				continue
			}
			// 失配：写出 held，当前已含在 held 末尾
			flushHeld()
			continue
		}

		stmt.WriteRune(r)
	}

	flushHeld()
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

// isDelimiterCommandLine 判断当前缓冲是否为（或正在输入）DELIMITER 客户端指令行。
func isDelimiterCommandLine(buf string, held []rune, next rune) bool {
	var b strings.Builder
	b.WriteString(buf)
	for _, hr := range held {
		b.WriteRune(hr)
	}
	b.WriteRune(next)
	line := strings.TrimLeft(b.String(), " \t")
	if line == "" {
		return false
	}
	upper := strings.ToUpper(line)
	const keyword = "DELIMITER"
	if len(upper) < len(keyword) {
		return strings.HasPrefix(keyword, upper)
	}
	if !strings.HasPrefix(upper, keyword) {
		return false
	}
	if len(upper) == len(keyword) {
		return true
	}
	return unicode.IsSpace(rune(line[len(keyword)])) || line[len(keyword)] == '\n' || line[len(keyword)] == '\r'
}

// parseDelimiterCommand 识别客户端 DELIMITER 指令，返回新分隔符。
func parseDelimiterCommand(raw string) (string, bool) {
	trimmed := strings.TrimSpace(raw)
	if len(trimmed) < 9 {
		return "", false
	}
	upper := strings.ToUpper(trimmed)
	if !strings.HasPrefix(upper, "DELIMITER") {
		return "", false
	}
	rest := strings.TrimSpace(trimmed[len("DELIMITER"):])
	if rest == "" {
		return "", true
	}
	end := 0
	for end < len(rest) && !unicode.IsSpace(rune(rest[end])) {
		end++
	}
	return rest[:end], true
}
