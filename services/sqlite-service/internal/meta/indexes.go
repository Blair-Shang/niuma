package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// IndexColumn 是索引列。
type IndexColumn struct {
	Name       string `json:"name"`
	Ordinal    int    `json:"ordinal"`
	Descending bool   `json:"descending,omitempty"`
}

// IndexInfo 是索引元数据。
type IndexInfo struct {
	Name    string        `json:"name"`
	Unique  bool          `json:"unique"`
	Origin  string        `json:"origin,omitempty"` // c | u | pk …
	Partial bool          `json:"partial,omitempty"`
	Columns []IndexColumn `json:"columns,omitempty"`
}

// IndexesResult 是索引列表。
type IndexesResult struct {
	Indexes []IndexInfo `json:"indexes"`
}

type indexHeader struct {
	Name    string
	Unique  bool
	Origin  string
	Partial bool
}

// ListIndexes 使用 PRAGMA index_list / index_info / index_xinfo。
// 先收集 index_list 再查列，避免 MaxOpenConns(1) 下嵌套查询死锁。
func ListIndexes(ctx context.Context, db *sql.DB, schema, table string) (*IndexesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: meta: nil db")
	}
	schema = schemaOrMain(schema)
	table = strings.TrimSpace(table)
	if table == "" {
		return nil, fmt.Errorf("sqlite: meta: table required")
	}

	rows, err := db.QueryContext(ctx, pragmaCall(schema, "index_list", table))
	if err != nil {
		return nil, fmt.Errorf("sqlite: meta: index_list: %w", err)
	}

	headers := make([]indexHeader, 0, 8)
	for rows.Next() {
		var seq int
		var name, origin string
		var unique, partial int
		if err := rows.Scan(&seq, &name, &unique, &origin, &partial); err != nil {
			_ = rows.Close()
			return nil, fmt.Errorf("sqlite: meta: scan index: %w", err)
		}
		headers = append(headers, indexHeader{
			Name:    strings.TrimSpace(name),
			Unique:  unique != 0,
			Origin:  strings.TrimSpace(origin),
			Partial: partial != 0,
		})
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return nil, err
	}
	_ = rows.Close()

	out := make([]IndexInfo, 0, len(headers))
	for _, h := range headers {
		cols, cerr := listIndexColumns(ctx, db, schema, h.Name)
		if cerr != nil {
			return nil, cerr
		}
		out = append(out, IndexInfo{
			Name:    h.Name,
			Unique:  h.Unique,
			Origin:  h.Origin,
			Partial: h.Partial,
			Columns: cols,
		})
	}
	return &IndexesResult{Indexes: out}, nil
}

func listIndexColumns(ctx context.Context, db *sql.DB, schema, indexName string) ([]IndexColumn, error) {
	rows, err := db.QueryContext(ctx, pragmaCall(schema, "index_xinfo", indexName))
	if err != nil {
		rows, err = db.QueryContext(ctx, pragmaCall(schema, "index_info", indexName))
		if err != nil {
			return nil, fmt.Errorf("sqlite: meta: index_info: %w", err)
		}
		defer rows.Close()
		out := make([]IndexColumn, 0, 4)
		for rows.Next() {
			var seqno, cid int
			var name sql.NullString
			if err := rows.Scan(&seqno, &cid, &name); err != nil {
				return nil, err
			}
			if !name.Valid || name.String == "" {
				continue
			}
			out = append(out, IndexColumn{Name: name.String, Ordinal: seqno})
		}
		return out, rows.Err()
	}
	defer rows.Close()
	out := make([]IndexColumn, 0, 4)
	for rows.Next() {
		var seqno, cid, desc, key int
		var name sql.NullString
		var coll sql.NullString
		if err := rows.Scan(&seqno, &cid, &name, &desc, &coll, &key); err != nil {
			return nil, err
		}
		if !name.Valid || name.String == "" {
			continue
		}
		out = append(out, IndexColumn{
			Name:       name.String,
			Ordinal:    seqno,
			Descending: desc != 0,
		})
	}
	return out, rows.Err()
}
