package dataio

import (
	"context"
	"database/sql"
	"fmt"
	"os"

	"niuma/services/sqlite-service/internal/sqliteparser"
)

// execSqlFile 按分号拆分并执行 SQL 文件（支持引号、注释；CREATE TRIGGER BEGIN…END 体内不分句）。
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
		return fmt.Errorf("sqlite: open sql file: %w", err)
	}
	text := string(raw)
	stmts := sqliteparser.SplitSQL(text)
	totalBytes := int64(len(raw))
	total := len(stmts)
	if total == 0 {
		m.emitProgress(taskID, PhaseRunning, totalBytes, 0, "no statements")
		return nil
	}

	var executed, failed int
	var bytesDone int64
	handleErr := func(stmtNo int, stmt string, execErr error) error {
		bytesDone += int64(len(stmt))
		if !opts.ContinueOnError {
			return fmt.Errorf("sqlite: exec sql file near statement %d: %w", stmtNo, execErr)
		}
		msg := fmt.Sprintf("error near statement %d: %v", stmtNo, execErr)
		failed++
		m.emitProgress(taskID, PhaseRunning, bytesDone, int64(executed), msg)
		return nil
	}

	for _, stmt := range stmts {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		stmtNo := executed + failed + 1
		if _, execErr := db.ExecContext(ctx, stmt); execErr != nil {
			if err := handleErr(stmtNo, stmt, execErr); err != nil {
				return err
			}
			continue
		}
		executed++
		bytesDone += int64(len(stmt))
		// 每条都上报，前端同类进度会合并为最新一行；总数便于观察进度。
		m.emitProgress(taskID, PhaseRunning, bytesDone, int64(executed),
			fmt.Sprintf("executed %d / %d statement(s)", executed, total))
	}

	m.emitProgress(taskID, PhaseRunning, totalBytes, int64(executed),
		fmt.Sprintf("executed %d statement(s), %d failed", executed, failed))
	return nil
}
