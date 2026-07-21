package meta

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

// DatabaseOverviewResult 是数据库概览（属性 + schema / 对象粗计数）。
type DatabaseOverviewResult struct {
	Name       string `json:"name"`
	Owner      string `json:"owner,omitempty"`
	Encoding   string `json:"encoding,omitempty"`
	Collate    string `json:"collate,omitempty"`
	Ctype      string `json:"ctype,omitempty"`
	Comment    string `json:"comment,omitempty"`
	SizeBytes  int64  `json:"sizeBytes,omitempty"`
	Schemas    int    `json:"schemas"`
	Tables     int    `json:"tables"`
	Views      int    `json:"views"`
	Functions  int    `json:"functions"`
	Procedures int    `json:"procedures"`
}

// DatabaseOverview 读取当前库属性与粗粒度对象统计。
func DatabaseOverview(ctx context.Context, pool *pgxpool.Pool, database string) (*DatabaseOverviewResult, error) {
	db := strings.TrimSpace(database)
	if db == "" {
		return nil, fmt.Errorf("vastbase: database required")
	}

	out := &DatabaseOverviewResult{Name: db}

	var (
		owner, encoding, collate, ctype, comment sql.NullString
	)
	// 不用 COALESCE(..., '')：Vastbase Oracle 兼容模式下空串等同 NULL，仍会扫崩 string。
	// 注释走 pg_shdescription LEFT JOIN；可空列一律 Null* 扫描。
	// 库大小单独查询：部分账号对 pg_database_size 无权限时不应拖垮整页概览。
	err := pool.QueryRow(ctx, `
SELECT pg_catalog.pg_get_userbyid(d.datdba) AS owner,
       pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
       d.datcollate,
       d.datctype,
       sd.description AS comment
FROM pg_catalog.pg_database d
LEFT JOIN pg_catalog.pg_shdescription sd
  ON sd.objoid = d.oid
 AND sd.classoid = 'pg_database'::regclass
WHERE d.datname = current_database()
`).Scan(&owner, &encoding, &collate, &ctype, &comment)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("vastbase: database not found: %s", db)
		}
		return nil, fmt.Errorf("vastbase: database overview: %w", err)
	}
	out.Owner = nullStr(owner)
	out.Encoding = nullStr(encoding)
	out.Collate = nullStr(collate)
	out.Ctype = nullStr(ctype)
	out.Comment = nullStr(comment)

	var sizeBytes sql.NullInt64
	if sizeErr := pool.QueryRow(ctx, `
SELECT pg_catalog.pg_database_size(current_database())::bigint
`).Scan(&sizeBytes); sizeErr == nil {
		out.SizeBytes = nullInt64(sizeBytes)
	}

	err = pool.QueryRow(ctx, `
SELECT
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_namespace n
   WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     AND n.nspname <> 'information_schema'),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     AND n.nspname <> 'information_schema'
     AND c.relkind IN ('r', 'p')),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_class c
   JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     AND n.nspname <> 'information_schema'
     AND c.relkind IN ('v', 'm', 'f')),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     AND n.nspname <> 'information_schema'
     AND p.prokind = 'f'),
  (SELECT COUNT(*)::int
   FROM pg_catalog.pg_proc p
   JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname NOT LIKE 'pg\_%' ESCAPE '\'
     AND n.nspname <> 'information_schema'
     AND p.prokind = 'p')
`).Scan(&out.Schemas, &out.Tables, &out.Views, &out.Functions, &out.Procedures)
	if err != nil {
		return nil, fmt.Errorf("vastbase: database overview counts: %w", err)
	}

	return out, nil
}
