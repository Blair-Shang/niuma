package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// PrimaryKeyResult 是主键列列表。
type PrimaryKeyResult struct {
	Columns []string `json:"columns"`
}

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

// GetPrimaryKey 读取表主键列（CONSTRAINT_TYPE='P'）。
func GetPrimaryKey(ctx context.Context, db *sql.DB, r RelationRef) (PrimaryKeyResult, error) {
	q := `
SELECT cc.COLUMN_NAME
FROM ALL_CONSTRAINTS c
JOIN ALL_CONS_COLUMNS cc
  ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
WHERE c.OWNER = ? AND c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'P'
ORDER BY cc.POSITION`
	rows, err := db.QueryContext(ctx, q, r.Schema, r.Name)
	if err != nil {
		return PrimaryKeyResult{}, fmt.Errorf("dameng: primary key: %w", err)
	}
	defer rows.Close()
	out := PrimaryKeyResult{}
	for rows.Next() {
		var col string
		if err := rows.Scan(&col); err != nil {
			return out, err
		}
		out.Columns = append(out.Columns, col)
	}
	return out, rows.Err()
}

// ListForeignKeys 读取表外键（CONSTRAINT_TYPE='R'）。
func ListForeignKeys(ctx context.Context, db *sql.DB, r RelationRef) (ForeignKeysResult, error) {
	q := `
SELECT c.CONSTRAINT_NAME,
       cc.COLUMN_NAME,
       rc.OWNER,
       rc.TABLE_NAME,
       rcc.COLUMN_NAME,
       c.DELETE_RULE,
       cc.POSITION
FROM ALL_CONSTRAINTS c
JOIN ALL_CONS_COLUMNS cc
  ON cc.OWNER = c.OWNER AND cc.CONSTRAINT_NAME = c.CONSTRAINT_NAME
JOIN ALL_CONSTRAINTS rc
  ON rc.OWNER = c.R_OWNER AND rc.CONSTRAINT_NAME = c.R_CONSTRAINT_NAME
JOIN ALL_CONS_COLUMNS rcc
  ON rcc.OWNER = rc.OWNER AND rcc.CONSTRAINT_NAME = rc.CONSTRAINT_NAME AND rcc.POSITION = cc.POSITION
WHERE c.OWNER = ? AND c.TABLE_NAME = ? AND c.CONSTRAINT_TYPE = 'R'
ORDER BY c.CONSTRAINT_NAME, cc.POSITION`
	rows, err := db.QueryContext(ctx, q, r.Schema, r.Name)
	if err != nil {
		return ForeignKeysResult{}, fmt.Errorf("dameng: foreign keys: %w", err)
	}
	defer rows.Close()

	byName := map[string]*ForeignKeyInfo{}
	var order []string
	for rows.Next() {
		var name, col, refSchema, refTable, refCol string
		var onDelete sql.NullString
		var pos int
		if err := rows.Scan(&name, &col, &refSchema, &refTable, &refCol, &onDelete, &pos); err != nil {
			return ForeignKeysResult{}, err
		}
		fk, ok := byName[name]
		if !ok {
			fk = &ForeignKeyInfo{
				Name:      name,
				RefSchema: refSchema,
				RefTable:  refTable,
				OnDelete:  strings.TrimSpace(onDelete.String),
			}
			byName[name] = fk
			order = append(order, name)
		}
		fk.Columns = append(fk.Columns, col)
		fk.RefColumns = append(fk.RefColumns, refCol)
	}
	if err := rows.Err(); err != nil {
		return ForeignKeysResult{}, err
	}
	out := ForeignKeysResult{ForeignKeys: make([]ForeignKeyInfo, 0, len(order))}
	for _, name := range order {
		out.ForeignKeys = append(out.ForeignKeys, *byName[name])
	}
	return out, nil
}
