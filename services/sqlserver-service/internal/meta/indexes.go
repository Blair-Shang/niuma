package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// ListIndexes 列出表索引（堆 / 视图通常为空或仅有主键）。
func ListIndexes(ctx context.Context, db *sql.DB, ref RelationRef) (*IndexesResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  i.name,
  i.is_unique,
  i.is_primary_key,
  i.type_desc,
  c.name,
  ic.key_ordinal,
  ic.is_included_column
FROM sys.indexes i
JOIN sys.index_columns ic
  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c
  ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(@p1)
  AND i.index_id > 0
  AND i.name IS NOT NULL
ORDER BY i.index_id, ic.is_included_column, ic.key_ordinal`

	rows, err := db.QueryContext(ctx, q, objectIDArg(ref.Schema, ref.Name))
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list indexes: %w", err)
	}
	defer rows.Close()

	type acc struct {
		info     *IndexInfo
		included []string
	}
	byName := make(map[string]*acc)
	order := make([]string, 0)
	for rows.Next() {
		var (
			name     sql.NullString
			unique   bool
			primary  bool
			method   sql.NullString
			col      sql.NullString
			ordinal  int
			included bool
		)
		if err := rows.Scan(&name, &unique, &primary, &method, &col, &ordinal, &included); err != nil {
			return nil, fmt.Errorf("sqlserver: list indexes scan: %w", err)
		}
		if !name.Valid || name.String == "" {
			continue
		}
		cur, ok := byName[name.String]
		if !ok {
			cur = &acc{
				info: &IndexInfo{
					Name:    name.String,
					Unique:  unique,
					Primary: primary,
					Method:  nullStr(method),
					Columns: make([]string, 0, 4),
				},
			}
			byName[name.String] = cur
			order = append(order, name.String)
		}
		if col.Valid && col.String != "" {
			if included {
				cur.included = append(cur.included, col.String)
			} else {
				cur.info.Columns = append(cur.info.Columns, col.String)
			}
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]IndexInfo, 0, len(order))
	for _, name := range order {
		cur := byName[name]
		cur.info.Definition = formatIndexDef(cur.info, cur.included)
		out = append(out, *cur.info)
	}
	return &IndexesResult{Indexes: out}, nil
}

func formatIndexDef(info *IndexInfo, included []string) string {
	cols := strings.Join(quoteList(info.Columns), ", ")
	kind := "INDEX"
	if info.Primary {
		kind = "PRIMARY KEY"
	} else if info.Unique {
		kind = "UNIQUE"
	}
	def := kind + " (" + cols + ")"
	if info.Method != "" {
		def += " " + info.Method
	}
	if len(included) > 0 {
		def += " INCLUDE (" + strings.Join(quoteList(included), ", ") + ")"
	}
	return def
}

func quoteList(names []string) []string {
	out := make([]string, 0, len(names))
	for _, n := range names {
		out = append(out, mustQuote(n))
	}
	return out
}

func nullStr(v sql.NullString) string {
	if v.Valid {
		return v.String
	}
	return ""
}

// ListPrimaryKey 返回主键列名（按键序）。
func ListPrimaryKey(ctx context.Context, db *sql.DB, ref RelationRef) (*PrimaryKeyResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT c.name
FROM sys.indexes i
JOIN sys.index_columns ic
  ON ic.object_id = i.object_id AND ic.index_id = i.index_id
JOIN sys.columns c
  ON c.object_id = ic.object_id AND c.column_id = ic.column_id
WHERE i.object_id = OBJECT_ID(@p1)
  AND i.is_primary_key = 1
ORDER BY ic.key_ordinal`

	rows, err := db.QueryContext(ctx, q, objectIDArg(ref.Schema, ref.Name))
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list primary key: %w", err)
	}
	defer rows.Close()

	cols := make([]string, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("sqlserver: list primary key scan: %w", err)
		}
		cols = append(cols, name)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &PrimaryKeyResult{Columns: cols}, nil
}
