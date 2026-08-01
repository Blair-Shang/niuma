package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// IndexInfo 描述一条索引。
type IndexInfo struct {
	Name    string   `json:"name"`
	Unique  bool     `json:"unique"`
	Columns []string `json:"columns"`
	// Method 为 BTREE / BITMAP / HASH / SPATIAL（来自 INDEX_TYPE）。
	Method string `json:"method,omitempty"`
}

// IndexesResult 是索引列表。
type IndexesResult struct {
	Indexes []IndexInfo `json:"indexes"`
}

func mapIndexType(raw string) string {
	t := strings.ToUpper(strings.TrimSpace(raw))
	switch {
	case t == "" || strings.HasPrefix(t, "NORMAL"):
		return "BTREE"
	case strings.Contains(t, "BITMAP"):
		return "BITMAP"
	case strings.Contains(t, "HASH"):
		return "HASH"
	case strings.Contains(t, "SPATIAL"):
		return "SPATIAL"
	default:
		return "BTREE"
	}
}

// ListIndexes 读取表索引及列顺序。
func ListIndexes(ctx context.Context, db *sql.DB, r RelationRef) (IndexesResult, error) {
	q := `
SELECT i.INDEX_NAME,
       i.UNIQUENESS,
       i.INDEX_TYPE,
       c.COLUMN_NAME
FROM ALL_INDEXES i
JOIN ALL_IND_COLUMNS c
  ON c.INDEX_OWNER = i.OWNER AND c.INDEX_NAME = i.INDEX_NAME
WHERE i.TABLE_OWNER = ? AND i.TABLE_NAME = ?
ORDER BY i.INDEX_NAME, c.COLUMN_POSITION`
	rows, e := db.QueryContext(ctx, q, r.Schema, r.Name)
	if e != nil {
		return IndexesResult{}, fmt.Errorf("dameng: list indexes: %w", e)
	}
	defer rows.Close()
	out := IndexesResult{}
	by := map[string]*IndexInfo{}
	for rows.Next() {
		var n, u, c string
		var typ sql.NullString
		if e = rows.Scan(&n, &u, &typ, &c); e != nil {
			return out, e
		}
		x := by[n]
		if x == nil {
			x = &IndexInfo{Name: n, Unique: u == "UNIQUE", Method: mapIndexType(typ.String)}
			by[n] = x
			out.Indexes = append(out.Indexes, *x)
			x = &out.Indexes[len(out.Indexes)-1]
			by[n] = x
		}
		x.Columns = append(x.Columns, c)
	}
	return out, rows.Err()
}
