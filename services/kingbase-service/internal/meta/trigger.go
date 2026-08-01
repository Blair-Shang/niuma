package meta

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// TriggerRef 定位触发器（表上的命名触发器）。
type TriggerRef struct {
	Schema    string
	Name      string
	TableName string
	OID       uint32
}

// TriggerDDLResult 是触发器 CREATE 文本。
type TriggerDDLResult struct {
	Name       string `json:"name"`
	TableName  string `json:"tableName"`
	Definition string `json:"definition"`
	OID        uint32 `json:"oid,omitempty"`
}

func requireTrigger(ref TriggerRef) error {
	if ref.OID > 0 {
		return nil
	}
	if strings.TrimSpace(ref.Schema) == "" || strings.TrimSpace(ref.Name) == "" || strings.TrimSpace(ref.TableName) == "" {
		return fmt.Errorf("kingbase: schema, table and trigger name required")
	}
	return nil
}

// GetTriggerDDL 通过 pg_get_triggerdef 还原 CREATE TRIGGER。
func GetTriggerDDL(ctx context.Context, pool *pgxpool.Pool, ref TriggerRef) (*TriggerDDLResult, error) {
	if err := requireTrigger(ref); err != nil {
		return nil, err
	}

	var (
		oid       uint32
		name      string
		tableName string
		def       string
	)

	if ref.OID > 0 {
		err := pool.QueryRow(ctx, `
SELECT t.oid, t.tgname, c.relname, pg_catalog.pg_get_triggerdef(t.oid, true)
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
WHERE t.oid = $1 AND NOT t.tgisinternal`, ref.OID).Scan(&oid, &name, &tableName, &def)
		if err != nil {
			return nil, fmt.Errorf("kingbase: trigger ddl: %w", err)
		}
	} else {
		err := pool.QueryRow(ctx, `
SELECT t.oid, t.tgname, c.relname, pg_catalog.pg_get_triggerdef(t.oid, true)
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2 AND t.tgname = $3 AND NOT t.tgisinternal
LIMIT 1`, ref.Schema, ref.TableName, ref.Name).Scan(&oid, &name, &tableName, &def)
		if err != nil {
			return nil, fmt.Errorf("kingbase: trigger ddl: %w", err)
		}
	}

	return &TriggerDDLResult{
		Name:       name,
		TableName:  tableName,
		Definition: strings.TrimRight(def, "; \n\t"),
		OID:        oid,
	}, nil
}

// FormatDropTrigger 生成 DROP TRIGGER IF EXISTS … ON schema.table。
func FormatDropTrigger(schema, table, trigger string) string {
	return fmt.Sprintf(
		"DROP TRIGGER IF EXISTS %s ON %s",
		quoteIdent(trigger),
		quoteIdent(schema)+"."+quoteIdent(table),
	)
}
