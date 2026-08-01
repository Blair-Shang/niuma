package ddl

import (
	"context"
	"database/sql"
	"fmt"
)

// execSQLBatchInTx 在同一事务中顺序执行多条 SQL；任一步失败则整批回滚。
// 达梦 DM8 支持 DDL 事务（与 Oracle 不同），建表/设计器多语句场景可避免半成品对象。
func execSQLBatchInTx(ctx context.Context, db *sql.DB, statements []string, label string) error {
	if len(statements) == 0 {
		return fmt.Errorf("dameng: %s: no statements", label)
	}
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("dameng: %s begin: %w", label, err)
	}
	defer func() { _ = tx.Rollback() }()

	for i, s := range statements {
		if _, err := tx.ExecContext(ctx, s); err != nil {
			return fmt.Errorf("dameng: %s failed at statement %d/%d (rolled back): %w\nSQL: %s",
				label, i+1, len(statements), err, s)
		}
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("dameng: %s commit: %w", label, err)
	}
	return nil
}
