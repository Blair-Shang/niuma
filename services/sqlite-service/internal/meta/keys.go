package meta

import (
	"context"
	"database/sql"
	"fmt"
	"sort"
	"strings"
)

// PrimaryKeyResult 是主键列（按 pk ordinal）。
type PrimaryKeyResult struct {
	Columns []string `json:"columns"`
}

// ForeignKeyInfo 是外键（PRAGMA foreign_key_list）。
type ForeignKeyInfo struct {
	ID               int    `json:"id"`
	Sequence         int    `json:"sequence"`
	ReferencedTable  string `json:"referencedTable"`
	FromColumn       string `json:"fromColumn"`
	ToColumn         string `json:"toColumn"`
	OnUpdate         string `json:"onUpdate,omitempty"`
	OnDelete         string `json:"onDelete,omitempty"`
	Match            string `json:"match,omitempty"`
}

// ForeignKeysResult 是外键列表。
type ForeignKeysResult struct {
	ForeignKeys []ForeignKeyInfo `json:"foreignKeys"`
}

// GetPrimaryKey 从 table_info 提取主键列。
func GetPrimaryKey(ctx context.Context, db *sql.DB, schema, table string) (*PrimaryKeyResult, error) {
	cols, err := ListColumns(ctx, db, schema, table)
	if err != nil {
		return nil, err
	}
	type pkCol struct {
		ord  int
		name string
	}
	var pks []pkCol
	for _, c := range cols.Columns {
		if c.PrimaryKey {
			pks = append(pks, pkCol{ord: c.PKOrdinal, name: c.Name})
		}
	}
	sort.Slice(pks, func(i, j int) bool { return pks[i].ord < pks[j].ord })
	out := make([]string, 0, len(pks))
	for _, p := range pks {
		out = append(out, p.name)
	}
	return &PrimaryKeyResult{Columns: out}, nil
}

// ListForeignKeys 使用 PRAGMA foreign_key_list。
func ListForeignKeys(ctx context.Context, db *sql.DB, schema, table string) (*ForeignKeysResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: meta: nil db")
	}
	schema = schemaOrMain(schema)
	table = strings.TrimSpace(table)
	if table == "" {
		return nil, fmt.Errorf("sqlite: meta: table required")
	}
	rows, err := db.QueryContext(ctx, pragmaCall(schema, "foreign_key_list", table))
	if err != nil {
		return nil, fmt.Errorf("sqlite: meta: foreign_key_list: %w", err)
	}
	defer rows.Close()

	out := make([]ForeignKeyInfo, 0, 4)
	for rows.Next() {
		var id, seq int
		var tableRef, from, to, onUpdate, onDelete, match string
		if err := rows.Scan(&id, &seq, &tableRef, &from, &to, &onUpdate, &onDelete, &match); err != nil {
			return nil, fmt.Errorf("sqlite: meta: scan fk: %w", err)
		}
		out = append(out, ForeignKeyInfo{
			ID:              id,
			Sequence:        seq,
			ReferencedTable: tableRef,
			FromColumn:      from,
			ToColumn:        to,
			OnUpdate:        onUpdate,
			OnDelete:        onDelete,
			Match:           match,
		})
	}
	return &ForeignKeysResult{ForeignKeys: out}, rows.Err()
}
