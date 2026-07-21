package meta

import (
	"context"
	"database/sql"
	"fmt"
)

// PrimaryKeyResult 是 meta.primaryKey 返回。
type PrimaryKeyResult struct {
	Columns []string `json:"columns"`
}

// ForeignKeyInfo 是外键摘要。
type ForeignKeyInfo struct {
	Name       string   `json:"name"`
	Columns    []string `json:"columns"`
	RefDatabase string  `json:"refDatabase,omitempty"`
	RefTable   string   `json:"refTable"`
	RefColumns []string `json:"refColumns"`
	OnDelete   string   `json:"onDelete,omitempty"`
	OnUpdate   string   `json:"onUpdate,omitempty"`
}

// ForeignKeysResult 是 meta.foreignKeys 返回。
type ForeignKeysResult struct {
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
}

// ListPrimaryKey 列出主键列（按序号）。
func ListPrimaryKey(ctx context.Context, db *sql.DB, ref RelationRef) (*PrimaryKeyResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT COLUMN_NAME
FROM information_schema.KEY_COLUMN_USAGE
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND CONSTRAINT_NAME = 'PRIMARY'
ORDER BY ORDINAL_POSITION`
	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("mysql: primary key: %w", err)
	}
	defer rows.Close()
	cols := make([]string, 0, 4)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, err
		}
		cols = append(cols, name)
	}
	return &PrimaryKeyResult{Columns: cols}, rows.Err()
}

// ListForeignKeys 列出外键。
func ListForeignKeys(ctx context.Context, db *sql.DB, ref RelationRef) (*ForeignKeysResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  k.CONSTRAINT_NAME,
  k.COLUMN_NAME,
  k.REFERENCED_TABLE_SCHEMA,
  k.REFERENCED_TABLE_NAME,
  k.REFERENCED_COLUMN_NAME,
  COALESCE(r.DELETE_RULE, ''),
  COALESCE(r.UPDATE_RULE, ''),
  k.ORDINAL_POSITION
FROM information_schema.KEY_COLUMN_USAGE k
JOIN information_schema.REFERENTIAL_CONSTRAINTS r
  ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA
 AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
WHERE k.TABLE_SCHEMA = ? AND k.TABLE_NAME = ?
  AND k.REFERENCED_TABLE_NAME IS NOT NULL
ORDER BY k.CONSTRAINT_NAME, k.ORDINAL_POSITION`

	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("mysql: foreign keys: %w", err)
	}
	defer rows.Close()

	byName := map[string]*ForeignKeyInfo{}
	order := make([]string, 0)
	for rows.Next() {
		var (
			name, col, refDB, refTable, refCol, onDel, onUpd string
			ord                                             int
		)
		if err := rows.Scan(&name, &col, &refDB, &refTable, &refCol, &onDel, &onUpd, &ord); err != nil {
			return nil, err
		}
		fk, ok := byName[name]
		if !ok {
			fk = &ForeignKeyInfo{
				Name:        name,
				Columns:     nil,
				RefDatabase: refDB,
				RefTable:    refTable,
				RefColumns:  nil,
				OnDelete:    onDel,
				OnUpdate:    onUpd,
			}
			byName[name] = fk
			order = append(order, name)
		}
		fk.Columns = append(fk.Columns, col)
		fk.RefColumns = append(fk.RefColumns, refCol)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	out := make([]ForeignKeyInfo, 0, len(order))
	for _, n := range order {
		out = append(out, *byName[n])
	}
	return &ForeignKeysResult{ForeignKeys: out}, nil
}
