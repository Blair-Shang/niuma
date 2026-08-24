package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// CategoryCountsResult 是 schema 下分类对象数量（非行数）。
type CategoryCountsResult struct {
	Tables     int `json:"tables"`
	Views      int `json:"views"`
	Procedures int `json:"procedures"`
	Functions  int `json:"functions"`
	Synonyms   int `json:"synonyms"`
	Sequences  int `json:"sequences"`
}

// categoryCountsQuery 统计各分类对象数。
//
// 六个子查询过滤的都是同一个 schema，因此复用同一个序号占位符 @p1，
// 只需传入一个参数（go-mssqldb 不支持 `?`，参数须为 @pN / @Name）。
const categoryCountsQuery = `
SELECT
  (SELECT COUNT(*)
   FROM sys.tables t
   INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
   WHERE s.name = @p1),
  (SELECT COUNT(*)
   FROM sys.views v
   INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
   WHERE s.name = @p1),
  (SELECT COUNT(*)
   FROM sys.objects o
   INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
   WHERE s.name = @p1 AND o.type IN (N'P', N'PC') AND o.is_ms_shipped = 0),
  (SELECT COUNT(*)
   FROM sys.objects o
   INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
   WHERE s.name = @p1 AND o.type IN (N'FN', N'IF', N'TF', N'AF', N'FT', N'FS') AND o.is_ms_shipped = 0),
  (SELECT COUNT(*)
   FROM sys.synonyms syn
   INNER JOIN sys.schemas s ON s.schema_id = syn.schema_id
   WHERE s.name = @p1),
  (SELECT COUNT(*)
   FROM sys.sequences seq
   INNER JOIN sys.schemas s ON s.schema_id = seq.schema_id
   WHERE s.name = @p1)
`

// CountCategories 统计 schema 下各分类对象数（轻量 COUNT，非行数）。
func CountCategories(ctx context.Context, db *sql.DB, schema string) (*CategoryCountsResult, error) {
	if err := requireDB(db); err != nil {
		return nil, err
	}
	sch := strings.TrimSpace(schema)
	if sch == "" {
		return nil, fmt.Errorf("sqlserver: schema required")
	}

	out := &CategoryCountsResult{}
	err := db.QueryRowContext(ctx, categoryCountsQuery, sch).Scan(
		&out.Tables,
		&out.Views,
		&out.Procedures,
		&out.Functions,
		&out.Synonyms,
		&out.Sequences,
	)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: count categories: %w", err)
	}
	return out, nil
}
