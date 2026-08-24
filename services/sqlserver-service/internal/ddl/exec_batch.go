package ddl

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// execSQLBatchInTx 在同一事务中顺序执行多条 T-SQL；任一步失败则整批回滚。
func execSQLBatchInTx(ctx context.Context, db *sql.DB, statements []string, label string) error {
	if len(statements) == 0 {
		return fmt.Errorf("sqlserver: %s: no statements", label)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("sqlserver: %s begin: %w", label, err)
	}
	defer func() { _ = tx.Rollback() }()

	for i, s := range statements {
		sqlText := strings.TrimSpace(s)
		if sqlText == "" {
			continue
		}
		if _, err := tx.ExecContext(ctx, sqlText); err != nil {
			return fmt.Errorf("sqlserver: %s failed at statement %d/%d (rolled back): %w\nSQL: %s",
				label, i+1, len(statements), err, sqlText)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("sqlserver: %s commit: %w", label, err)
	}
	return nil
}
