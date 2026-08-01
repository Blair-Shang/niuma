package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// countSynonyms 统计模式下私有同义词。
// 优先 SYSOBJECTS（SUBTYPE$=SYNOM）；ALL_SYNONYMS / ALL_OBJECTS 在部分达梦版本上为空。
func countSynonyms(ctx context.Context, db *sql.DB, schema string) (int64, error) {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		return 0, nil
	}
	var n int64
	err := db.QueryRowContext(ctx, `
SELECT COUNT(*)
FROM SYSOBJECTS o
INNER JOIN SYSOBJECTS s ON o.SCHID = s.ID AND s.TYPE$ = 'SCH'
WHERE UPPER(s.NAME) = UPPER(?)
  AND o.TYPE$ = 'SCHOBJ'
  AND o.SUBTYPE$ = 'SYNOM'`, schema).Scan(&n)
	if err == nil {
		return n, nil
	}
	var n2 int64
	err2 := db.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM ALL_SYNONYMS WHERE UPPER(OWNER) = UPPER(?)`, schema,
	).Scan(&n2)
	if err2 == nil {
		return n2, nil
	}
	return 0, fmt.Errorf("dameng: count synonyms: %v (fallback: %v)", err, err2)
}

// listSynonyms 列出模式下私有同义词名。
func listSynonyms(ctx context.Context, db *sql.DB, schema, filter string, lim int) ([]ObjectItem, bool, error) {
	schema = strings.TrimSpace(schema)
	if schema == "" {
		return nil, false, nil
	}
	if lim <= 0 {
		lim = DefaultLimit
	}
	like := strings.TrimSpace(filter) + "%"

	items, truncated, err := listSynonymsFromSysobjects(ctx, db, schema, like, lim)
	if err == nil {
		return items, truncated, nil
	}
	items2, truncated2, err2 := listSynonymsFromAllSynonyms(ctx, db, schema, like, lim)
	if err2 == nil {
		return items2, truncated2, nil
	}
	return nil, false, fmt.Errorf("dameng: list synonyms: %v (fallback: %v)", err, err2)
}

func listSynonymsFromSysobjects(
	ctx context.Context, db *sql.DB, schema, like string, lim int,
) ([]ObjectItem, bool, error) {
	r, err := db.QueryContext(ctx, `
SELECT o.NAME
FROM SYSOBJECTS o
INNER JOIN SYSOBJECTS s ON o.SCHID = s.ID AND s.TYPE$ = 'SCH'
WHERE UPPER(s.NAME) = UPPER(?)
  AND o.TYPE$ = 'SCHOBJ'
  AND o.SUBTYPE$ = 'SYNOM'
  AND UPPER(o.NAME) LIKE UPPER(?)
ORDER BY o.NAME`, schema, like)
	if err != nil {
		return nil, false, err
	}
	defer r.Close()
	return scanSynonymNames(r, lim)
}

func listSynonymsFromAllSynonyms(
	ctx context.Context, db *sql.DB, schema, like string, lim int,
) ([]ObjectItem, bool, error) {
	r, err := db.QueryContext(ctx,
		`SELECT SYNONYM_NAME FROM ALL_SYNONYMS WHERE UPPER(OWNER) = UPPER(?) AND UPPER(SYNONYM_NAME) LIKE UPPER(?) ORDER BY SYNONYM_NAME`,
		schema, like)
	if err != nil {
		return nil, false, err
	}
	defer r.Close()
	return scanSynonymNames(r, lim)
}

func scanSynonymNames(r *sql.Rows, lim int) ([]ObjectItem, bool, error) {
	var out []ObjectItem
	truncated := false
	for r.Next() {
		var n string
		if err := r.Scan(&n); err != nil {
			return out, truncated, err
		}
		if len(out) >= lim {
			truncated = true
			break
		}
		out = append(out, ObjectItem{Name: n, Type: "synonym"})
	}
	return out, truncated, r.Err()
}
