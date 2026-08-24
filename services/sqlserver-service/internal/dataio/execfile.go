package dataio

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strconv"
	"strings"
	"unicode"
)

// execSqlFile 从本地 SQL 文件按 GO 批执行。GO 是客户端分隔符，不会发给服务器。
func execSqlFile(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	inputPath string,
	opts ExecSqlFileOptions,
) error {
	raw, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("sqlserver: open sql file: %w", err)
	}
	total := int64(len(raw))
	batches := splitGoBatches(string(raw))

	var (
		executed int
		failed   int
		bytesEst int64
	)

	handleErr := func(batchNo int, execErr error) error {
		if !opts.ContinueOnError {
			return fmt.Errorf("sqlserver: exec sql file near batch %d: %w", batchNo, execErr)
		}
		msg := fmt.Sprintf("error near batch %d: %v", batchNo, execErr)
		failed++
		m.emitProgress(taskID, PhaseRunning, bytesEst, int64(executed), msg)
		return nil
	}

	for i, batch := range batches {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		bytesEst += int64(len(batch))
		sqlText := strings.TrimSpace(batch)
		if sqlText == "" {
			continue
		}
		stmtNo := executed + failed + 1
		if _, execErr := db.ExecContext(ctx, sqlText); execErr != nil {
			if err := handleErr(stmtNo, execErr); err != nil {
				return err
			}
			continue
		}
		executed++
		m.emitProgress(taskID, PhaseRunning, min64(bytesEst, total), int64(executed),
			fmt.Sprintf("executed %d statement(s)", executed))
		_ = i
	}

	if failed > 0 {
		m.emitProgress(taskID, PhaseRunning, total, int64(executed),
			fmt.Sprintf("completed with %d error(s), %d succeeded", failed, executed))
		return fmt.Errorf("sqlserver: exec sql file completed with %d error(s), %d succeeded", failed, executed)
	}
	m.emitProgress(taskID, PhaseRunning, total, int64(executed),
		fmt.Sprintf("executed %d statement(s)", executed))
	return nil
}

func min64(a, b int64) int64 {
	if a < b {
		return a
	}
	return b
}

// splitGoBatches 按独占一行的 GO（可选重复次数）拆批；不把 GO 写入批内容。
// 识别引号、方括号标识符、-- 行注释与 /* */ 块注释，避免字面量中的 GO 被误拆。
func splitGoBatches(text string) []string {
	if text == "" {
		return nil
	}
	var (
		out            []string
		stmt           strings.Builder
		inSingle       bool
		inBracket      bool
		inLineComment  bool
		inBlockComment bool
		blockStar      bool
		lineStart      bool
	)
	lineStart = true

	flush := func() {
		raw := strings.TrimSpace(stmt.String())
		stmt.Reset()
		if raw != "" {
			out = append(out, raw)
		}
	}

	n := len(text)
	for i := 0; i < n; i++ {
		c := text[i]

		if inBlockComment {
			if blockStar && c == '/' {
				inBlockComment = false
				blockStar = false
			} else {
				blockStar = c == '*'
			}
			if c == '\n' {
				lineStart = true
			}
			continue
		}
		if inLineComment {
			if c == '\n' {
				inLineComment = false
				lineStart = true
				stmt.WriteByte(c)
			}
			continue
		}
		if inSingle {
			stmt.WriteByte(c)
			if c == '\'' {
				if i+1 < n && text[i+1] == '\'' {
					stmt.WriteByte(text[i+1])
					i++
				} else {
					inSingle = false
				}
			}
			if c == '\n' {
				lineStart = true
			} else {
				lineStart = false
			}
			continue
		}
		if inBracket {
			stmt.WriteByte(c)
			if c == ']' {
				if i+1 < n && text[i+1] == ']' {
					stmt.WriteByte(text[i+1])
					i++
				} else {
					inBracket = false
				}
			}
			if c == '\n' {
				lineStart = true
			} else {
				lineStart = false
			}
			continue
		}

		if c == '-' && i+1 < n && text[i+1] == '-' {
			i++
			inLineComment = true
			continue
		}
		if c == '/' && i+1 < n && text[i+1] == '*' {
			i++
			inBlockComment = true
			blockStar = false
			continue
		}
		if c == '\'' {
			inSingle = true
			stmt.WriteByte(c)
			lineStart = false
			continue
		}
		if c == '[' {
			inBracket = true
			stmt.WriteByte(c)
			lineStart = false
			continue
		}

		if lineStart && (c == 'G' || c == 'g') && looksLikeGo(text, i) {
			end, count := consumeGo(text, i)
			flush()
			for extra := 1; extra < count; extra++ {
				if len(out) > 0 {
					out = append(out, out[len(out)-1])
				}
			}
			i = end
			lineStart = true
			continue
		}

		stmt.WriteByte(c)
		if c == '\n' {
			lineStart = true
		} else if !unicode.IsSpace(rune(c)) {
			lineStart = false
		}
	}
	flush()
	return out
}

func looksLikeGo(text string, i int) bool {
	if i+1 >= len(text) {
		return false
	}
	if (text[i] != 'G' && text[i] != 'g') || (text[i+1] != 'O' && text[i+1] != 'o') {
		return false
	}
	j := i + 2
	for j < len(text) && (text[j] == ' ' || text[j] == '\t') {
		j++
	}
	if j >= len(text) || text[j] == '\n' || text[j] == '\r' {
		return true
	}
	if text[j] >= '0' && text[j] <= '9' {
		return true
	}
	return false
}

func consumeGo(text string, i int) (end int, count int) {
	j := i + 2
	for j < len(text) && (text[j] == ' ' || text[j] == '\t') {
		j++
	}
	count = 1
	if j < len(text) && text[j] >= '0' && text[j] <= '9' {
		k := j
		for k < len(text) && text[k] >= '0' && text[k] <= '9' {
			k++
		}
		if n, err := strconv.Atoi(text[j:k]); err == nil && n > 0 {
			count = n
		}
		j = k
	}
	for j < len(text) && text[j] != '\n' {
		if text[j] != ' ' && text[j] != '\t' && text[j] != '\r' {
			break
		}
		j++
	}
	if j < len(text) && text[j] == '\r' {
		j++
	}
	if j < len(text) && text[j] == '\n' {
		j++
	}
	return j - 1, count
}
