package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
	"time"
)

const (
	// objectCatalogDefaultLimit 是对象一览默认条数上限。
	objectCatalogDefaultLimit = 2000
	// objectCatalogMaxLimit 是对象一览允许的最大条数。
	objectCatalogMaxLimit = 5000
)

// ObjectCatalogItem 是库对象一览行（information_schema 统计，不对表做 COUNT(*)）。
type ObjectCatalogItem struct {
	Name          string `json:"name"`
	Type          string `json:"type"` // table | view | procedure | function
	Comment       string `json:"comment,omitempty"`
	Rows          *int64 `json:"rows,omitempty"`
	DataLength    *int64 `json:"dataLength,omitempty"`
	IndexLength   *int64 `json:"indexLength,omitempty"`
	AutoIncrement *int64 `json:"autoIncrement,omitempty"`
	Engine        string `json:"engine,omitempty"`
	Charset       string `json:"charset,omitempty"`
	Collation     string `json:"collation,omitempty"`
	CreatedAt     string `json:"createdAt,omitempty"`
	UpdatedAt     string `json:"updatedAt,omitempty"`
	Definer       string `json:"definer,omitempty"`
	Returns       string `json:"returns,omitempty"`
}

// ObjectCatalogParams 是 meta.objectCatalog 入参。
type ObjectCatalogParams struct {
	Database string
	// Types 为空时默认 table；可含 table / view / procedure / function。
	Types []string
	Limit int
}

// ObjectCatalogResult 是 meta.objectCatalog 返回。
type ObjectCatalogResult struct {
	Items     []ObjectCatalogItem `json:"items"`
	Truncated bool                `json:"truncated,omitempty"`
}

func normalizeObjectCatalogLimit(limit int) int {
	if limit <= 0 {
		return objectCatalogDefaultLimit
	}
	if limit > objectCatalogMaxLimit {
		return objectCatalogMaxLimit
	}
	return limit
}

func catalogObjectKind(types []string) string {
	for _, raw := range types {
		k := strings.ToLower(strings.TrimSpace(raw))
		switch k {
		case "table", "view", "procedure", "function":
			return k
		}
	}
	return "table"
}

// charsetFromCollation 从 collation 取字符集（utf8mb4_unicode_ci → utf8mb4）。
func charsetFromCollation(collation string) string {
	c := strings.TrimSpace(collation)
	if c == "" {
		return ""
	}
	i := strings.Index(c, "_")
	if i <= 0 {
		return c
	}
	return c[:i]
}

func nullInt64Ptr(n sql.NullInt64) *int64 {
	if !n.Valid {
		return nil
	}
	v := n.Int64
	return &v
}

func formatNullTime(t sql.NullTime) string {
	if !t.Valid {
		return ""
	}
	return t.Time.In(time.Local).Format("2006-01-02 15:04:05")
}

func tableTypeIN(kind string) string {
	if kind == "view" {
		return "'VIEW','SYSTEM VIEW'"
	}
	return "'BASE TABLE'"
}

func routineTypeIN(kind string) string {
	if kind == "function" {
		return "'FUNCTION'"
	}
	return "'PROCEDURE'"
}

// ListObjectCatalog 列出指定库下一类对象的状态信息。
// 表/视图读 information_schema.TABLES（TABLE_ROWS 为引擎估算）；例程读 ROUTINES。
func ListObjectCatalog(ctx context.Context, db *sql.DB, params ObjectCatalogParams) (*ObjectCatalogResult, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: object catalog: nil db")
	}
	database := strings.TrimSpace(params.Database)
	if database == "" {
		return nil, fmt.Errorf("mysql: object catalog: database required")
	}
	kind := catalogObjectKind(params.Types)
	limit := normalizeObjectCatalogLimit(params.Limit)
	if kind == "procedure" || kind == "function" {
		return listRoutineCatalog(ctx, db, database, kind, limit)
	}
	return listTableCatalog(ctx, db, database, kind, limit)
}

func listTableCatalog(ctx context.Context, db *sql.DB, database, kind string, limit int) (*ObjectCatalogResult, error) {
	query := `
SELECT TABLE_NAME,
  CASE TABLE_TYPE
    WHEN 'BASE TABLE' THEN 'table'
    WHEN 'VIEW' THEN 'view'
    WHEN 'SYSTEM VIEW' THEN 'view'
    ELSE LOWER(TABLE_TYPE)
  END AS typ,
  TABLE_COMMENT,
  TABLE_ROWS,
  DATA_LENGTH,
  INDEX_LENGTH,
  AUTO_INCREMENT,
  ENGINE,
  TABLE_COLLATION,
  CREATE_TIME,
  UPDATE_TIME
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ?
  AND TABLE_TYPE IN (` + tableTypeIN(kind) + `)
ORDER BY TABLE_NAME
LIMIT ?`
	rows, err := db.QueryContext(ctx, query, database, limit+1)
	if err != nil {
		return nil, fmt.Errorf("mysql: object catalog tables: %w", err)
	}
	defer rows.Close()

	out := make([]ObjectCatalogItem, 0, limit)
	for rows.Next() {
		var (
			name, typ     string
			comment       sql.NullString
			tableRows     sql.NullInt64
			dataLength    sql.NullInt64
			indexLength   sql.NullInt64
			autoIncrement sql.NullInt64
			engine        sql.NullString
			collation     sql.NullString
			created       sql.NullTime
			updated       sql.NullTime
		)
		if err := rows.Scan(
			&name, &typ, &comment, &tableRows, &dataLength, &indexLength,
			&autoIncrement, &engine, &collation, &created, &updated,
		); err != nil {
			return nil, fmt.Errorf("mysql: object catalog tables scan: %w", err)
		}
		coll := strings.TrimSpace(collation.String)
		item := ObjectCatalogItem{
			Name:          name,
			Type:          typ,
			Comment:       strings.TrimSpace(comment.String),
			Rows:          nullInt64Ptr(tableRows),
			DataLength:    nullInt64Ptr(dataLength),
			IndexLength:   nullInt64Ptr(indexLength),
			AutoIncrement: nullInt64Ptr(autoIncrement),
			Engine:        strings.TrimSpace(engine.String),
			Collation:     coll,
			Charset:       charsetFromCollation(coll),
			CreatedAt:     formatNullTime(created),
			UpdatedAt:     formatNullTime(updated),
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: object catalog tables rows: %w", err)
	}
	return truncateCatalog(out, limit), nil
}

func listRoutineCatalog(ctx context.Context, db *sql.DB, database, kind string, limit int) (*ObjectCatalogResult, error) {
	query := `
SELECT ROUTINE_NAME,
  CASE ROUTINE_TYPE
    WHEN 'PROCEDURE' THEN 'procedure'
    WHEN 'FUNCTION' THEN 'function'
    ELSE LOWER(ROUTINE_TYPE)
  END AS typ,
  ROUTINE_COMMENT,
  DEFINER,
  DTD_IDENTIFIER,
  CHARACTER_SET_CLIENT,
  CREATED,
  LAST_ALTERED
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = ?
  AND ROUTINE_TYPE IN (` + routineTypeIN(kind) + `)
ORDER BY ROUTINE_NAME
LIMIT ?`
	rows, err := db.QueryContext(ctx, query, database, limit+1)
	if err != nil {
		return nil, fmt.Errorf("mysql: object catalog routines: %w", err)
	}
	defer rows.Close()

	out := make([]ObjectCatalogItem, 0, limit)
	for rows.Next() {
		var (
			name, typ string
			comment   sql.NullString
			definer   sql.NullString
			returns   sql.NullString
			charset   sql.NullString
			created   sql.NullTime
			updated   sql.NullTime
		)
		if err := rows.Scan(&name, &typ, &comment, &definer, &returns, &charset, &created, &updated); err != nil {
			return nil, fmt.Errorf("mysql: object catalog routines scan: %w", err)
		}
		item := ObjectCatalogItem{
			Name:      name,
			Type:      typ,
			Comment:   strings.TrimSpace(comment.String),
			Definer:   strings.TrimSpace(definer.String),
			Returns:   strings.TrimSpace(returns.String),
			Charset:   strings.TrimSpace(charset.String),
			CreatedAt: formatNullTime(created),
			UpdatedAt: formatNullTime(updated),
		}
		out = append(out, item)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("mysql: object catalog routines rows: %w", err)
	}
	return truncateCatalog(out, limit), nil
}

func truncateCatalog(items []ObjectCatalogItem, limit int) *ObjectCatalogResult {
	truncated := false
	if len(items) > limit {
		truncated = true
		items = items[:limit]
	}
	return &ObjectCatalogResult{Items: items, Truncated: truncated}
}
