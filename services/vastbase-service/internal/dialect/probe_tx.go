package dialect

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// txExec 探测用的最小事务面（便于单测注入，避免依赖真实库）。
type txExec interface {
	Exec(ctx context.Context, sql string, arguments ...any) error
	Rollback(ctx context.Context) error
}

type beginFunc func(ctx context.Context) (txExec, error)

// ProbePlpgsqlProcedureSupport 在事务内 SAVEPOINT + 试探 CREATE PROCEDURE LANGUAGE plpgsql。
// 成功则表示会话可开 CapProcPlpgsqlDollar；无论成败均 Rollback，不留对象。
func ProbePlpgsqlProcedureSupport(ctx context.Context, begin beginFunc) bool {
	if begin == nil {
		return false
	}
	tx, err := begin(ctx)
	if err != nil || tx == nil {
		return false
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := tx.Exec(ctx, `SAVEPOINT nm_cap_plpgsql_proc`); err != nil {
		return false
	}
	name := fmt.Sprintf("nm_cap_probe_%d", time.Now().UnixNano())
	// 唯一临时名；过程体最小合法 plpgsql。
	sql := fmt.Sprintf(
		`CREATE OR REPLACE PROCEDURE %s() LANGUAGE plpgsql AS $$ BEGIN NULL; END; $$`,
		pgx.Identifier{name}.Sanitize(),
	)
	if err := tx.Exec(ctx, sql); err != nil {
		_ = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT nm_cap_plpgsql_proc`)
		return false
	}
	_ = tx.Exec(ctx, `ROLLBACK TO SAVEPOINT nm_cap_plpgsql_proc`)
	return true
}

type poolTx struct {
	tx pgx.Tx
}

func (t *poolTx) Exec(ctx context.Context, sql string, arguments ...any) error {
	_, err := t.tx.Exec(ctx, sql, arguments...)
	return err
}

func (t *poolTx) Rollback(ctx context.Context) error {
	return t.tx.Rollback(ctx)
}

func beginFromPool(pool *pgxpool.Pool) beginFunc {
	return func(ctx context.Context) (txExec, error) {
		tx, err := pool.Begin(ctx)
		if err != nil {
			return nil, err
		}
		return &poolTx{tx: tx}, nil
	}
}
