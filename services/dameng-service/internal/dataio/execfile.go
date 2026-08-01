package dataio

import (
	"context"
	"database/sql"
	"fmt"
	"os"
	"strings"
)

// execSqlFile 拆分并执行 SQL 文件（支持 / 终止的 PL/SQL 与普通 ; 分句）。
// schema 非空时先 ALTER SESSION SET CURRENT_SCHEMA，使无限定名落到目标 schema。
func execSqlFile(
	ctx context.Context,
	db *sql.DB,
	taskID string,
	m *Manager,
	schema string,
	inputPath string,
	opts ExecSqlFileOptions,
) error {
	schema = strings.TrimSpace(schema)
	if schema != "" {
		alter := "ALTER SESSION SET CURRENT_SCHEMA = " + quoteIdent(schema)
		if _, err := db.ExecContext(ctx, alter); err != nil {
			return fmt.Errorf("dameng: set current schema: %w", err)
		}
		m.emitProgress(taskID, PhaseRunning, 0, 0, fmt.Sprintf("current schema = %s", schema))
	}

	raw, err := os.ReadFile(inputPath)
	if err != nil {
		return fmt.Errorf("dameng: open sql file: %w", err)
	}
	// 去 UTF-8 BOM
	text := string(raw)
	if strings.HasPrefix(text, "\uFEFF") {
		text = text[len("\uFEFF"):]
	}

	stmts := splitSqlScript(text)
	total := len(stmts)
	if total == 0 {
		m.emitProgress(taskID, PhaseRunning, int64(len(raw)), 0, "no statements")
		return nil
	}

	var (
		executed int
		failed   int
		skipped  int
		bytesEst = int64(len(raw))
	)

	for i, sqlText := range stmts {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		stmtNo := i + 1
		if _, execErr := db.ExecContext(ctx, sqlText); execErr != nil {
			// 旧转储无 IF EXISTS：空目标 schema 上 DROP 不存在对象属预期，跳过而非计失败。
			if isBenignDropMissingError(sqlText, execErr) {
				skipped++
				m.emitProgress(taskID, PhaseRunning, bytesEst, int64(executed),
					fmt.Sprintf("skip statement %d (object already absent): %v", stmtNo, execErr))
				continue
			}
			if !opts.ContinueOnError {
				return fmt.Errorf("dameng: exec sql file near statement %d: %w", stmtNo, execErr)
			}
			failed++
			m.emitProgress(taskID, PhaseRunning, bytesEst, int64(executed),
				fmt.Sprintf("error near statement %d: %v", stmtNo, execErr))
			continue
		}
		executed++
		if executed%10 == 0 || i == total-1 {
			m.emitProgress(taskID, PhaseRunning, bytesEst, int64(executed),
				fmt.Sprintf("executed %d / %d statement(s)", executed, total))
		}
	}

	summary := fmt.Sprintf("executed %d statement(s), %d failed", executed, failed)
	if skipped > 0 {
		summary = fmt.Sprintf("executed %d statement(s), %d failed, %d skipped", executed, failed, skipped)
	}
	m.emitProgress(taskID, PhaseRunning, bytesEst, int64(executed), summary)
	if failed > 0 {
		return fmt.Errorf("dameng: exec sql file completed with %d error(s), %d succeeded", failed, executed)
	}
	return nil
}

// isBenignDropMissingError 判断是否为「DROP 不存在对象」的可忽略错误（对齐 DROP IF EXISTS）。
func isBenignDropMissingError(sqlText string, err error) bool {
	if err == nil {
		return false
	}
	upper := strings.ToUpper(strings.TrimSpace(sqlText))
	if !strings.HasPrefix(upper, "DROP ") {
		return false
	}
	msg := err.Error()
	msgLower := strings.ToLower(msg)
	switch {
	case strings.Contains(msg, "-2106"): // 无效的表或视图名
		return true
	case strings.Contains(msg, "无效的表或视图名"):
		return true
	case strings.Contains(msg, "无效的对象名"):
		return true
	case strings.Contains(msgLower, "invalid table or view"):
		return true
	case strings.Contains(msgLower, "does not exist"):
		return true
	case strings.Contains(msg, "不存在"):
		return true
	default:
		return false
	}
}
