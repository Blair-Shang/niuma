package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// ForeignKeyInfo 描述一条外键约束。
type ForeignKeyInfo struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefSchema  string   `json:"refSchema,omitempty"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

// ForeignKeysResult 是外键列表。
type ForeignKeysResult struct {
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
}

// CheckInfo 描述一条 CHECK 约束。
type CheckInfo struct {
	Name       string `json:"name"`
	Expression string `json:"expression"`
}

// ChecksResult 是 CHECK 约束列表。
type ChecksResult struct {
	Checks []CheckInfo `json:"checks"`
}

// ListForeignKeys 读取表外键。
func ListForeignKeys(ctx context.Context, db *sql.DB, ref RelationRef) (*ForeignKeysResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  fk.name,
  pc.name,
  rs.name,
  rt.name,
  rc.name,
  fk.delete_referential_action_desc,
  fk.update_referential_action_desc,
  fkc.constraint_column_id
FROM sys.foreign_keys fk
JOIN sys.foreign_key_columns fkc
  ON fkc.constraint_object_id = fk.object_id
JOIN sys.columns pc
  ON pc.object_id = fkc.parent_object_id AND pc.column_id = fkc.parent_column_id
JOIN sys.tables rt
  ON rt.object_id = fk.referenced_object_id
JOIN sys.schemas rs
  ON rs.schema_id = rt.schema_id
JOIN sys.columns rc
  ON rc.object_id = fkc.referenced_object_id AND rc.column_id = fkc.referenced_column_id
WHERE fk.parent_object_id = OBJECT_ID(@p1)
ORDER BY fk.name, fkc.constraint_column_id`

	rows, err := db.QueryContext(ctx, q, objectIDArg(ref.Schema, ref.Name))
	if err != nil {
		return nil, fmt.Errorf("sqlserver: foreign keys: %w", err)
	}
	defer rows.Close()

	order := make([]string, 0)
	byName := map[string]*ForeignKeyInfo{}
	for rows.Next() {
		var (
			name, col, refSchema, refTable, refCol string
			onDelete, onUpdate                     sql.NullString
			pos                                    int
		)
		if err := rows.Scan(&name, &col, &refSchema, &refTable, &refCol, &onDelete, &onUpdate, &pos); err != nil {
			return nil, fmt.Errorf("sqlserver: foreign keys scan: %w", err)
		}
		item, ok := byName[name]
		if !ok {
			item = &ForeignKeyInfo{
				Name:      name,
				RefSchema: refSchema,
				RefTable:  refTable,
				OnDelete:  strings.ReplaceAll(onDelete.String, "_", " "),
				OnUpdate:  strings.ReplaceAll(onUpdate.String, "_", " "),
			}
			byName[name] = item
			order = append(order, name)
		}
		item.Columns = append(item.Columns, col)
		item.RefColumns = append(item.RefColumns, refCol)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ForeignKeyInfo, 0, len(order))
	for _, name := range order {
		out = append(out, *byName[name])
	}
	return &ForeignKeysResult{ForeignKeys: out}, nil
}

// ListChecks 读取表 CHECK 约束。
func ListChecks(ctx context.Context, db *sql.DB, ref RelationRef) (*ChecksResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT cc.name, cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(@p1)
ORDER BY cc.name`

	rows, err := db.QueryContext(ctx, q, objectIDArg(ref.Schema, ref.Name))
	if err != nil {
		return nil, fmt.Errorf("sqlserver: checks: %w", err)
	}
	defer rows.Close()

	out := make([]CheckInfo, 0)
	for rows.Next() {
		var name, expr sql.NullString
		if err := rows.Scan(&name, &expr); err != nil {
			return nil, fmt.Errorf("sqlserver: checks scan: %w", err)
		}
		out = append(out, CheckInfo{Name: name.String, Expression: expr.String})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &ChecksResult{Checks: out}, nil
}
