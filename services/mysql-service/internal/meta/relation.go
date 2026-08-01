// Package meta 提供 MySQL 对象元数据查询（列、索引、DDL）。
//
// 约定（docs/25 §5.5）：
//   - 与 tree 包解耦：树保持轻量，元数据由 browse / DDL 面板按需拉取；
//   - 无独立 schema：RelationRef 使用 Database + Name；
//   - 不做行数 / 体积统计，避免面板打开打满生产库。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

// RelationRef 定位一张表 / 视图。
type RelationRef struct {
	Database string
	Name     string
}

// ColumnInfo 是列元数据。
type ColumnInfo struct {
	Ordinal       int     `json:"ordinal"`
	Name          string  `json:"name"`
	DataType      string  `json:"dataType"`
	Nullable      bool    `json:"nullable"`
	Default       *string `json:"default,omitempty"`
	Comment       string  `json:"comment,omitempty"`
	// AutoIncrement 来自 information_schema.COLUMNS.EXTRA（含 auto_increment）。
	// 设计器改主键前必须知道此状态：带 AI 的列不能无 KEY（Error 1075）。
	AutoIncrement bool `json:"autoIncrement,omitempty"`
}

// IndexInfo 是索引元数据。
type IndexInfo struct {
	Name       string   `json:"name"`
	Unique     bool     `json:"unique"`
	Primary    bool     `json:"primary"`
	Definition string   `json:"definition"`
	Columns    []string `json:"columns,omitempty"`
	Method     string   `json:"method,omitempty"`
}

// ColumnsResult 是 meta.columns 返回。
type ColumnsResult struct {
	Columns      []ColumnInfo `json:"columns"`
	TableComment string       `json:"tableComment,omitempty"`
}

// IndexesResult 是 meta.indexes 返回。
type IndexesResult struct {
	Indexes []IndexInfo `json:"indexes"`
}

// DDLResult 是 meta.ddl 返回。
type DDLResult struct {
	ObjectType string `json:"objectType"` // table | view | unknown
	DDL        string `json:"ddl"`
}

func requireRelation(ref RelationRef) error {
	if strings.TrimSpace(ref.Database) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("mysql: database and name required")
	}
	return nil
}

func quoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

func qualified(ref RelationRef) string {
	return quoteIdent(ref.Database) + "." + quoteIdent(ref.Name)
}

// ListColumns 列出表 / 视图列。
func ListColumns(ctx context.Context, db *sql.DB, ref RelationRef) (*ColumnsResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  ORDINAL_POSITION,
  COLUMN_NAME,
  COLUMN_TYPE,
  IS_NULLABLE,
  COLUMN_DEFAULT,
  COLUMN_COMMENT,
  EXTRA
FROM information_schema.COLUMNS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY ORDINAL_POSITION`

	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("mysql: list columns: %w", err)
	}
	defer rows.Close()

	out := make([]ColumnInfo, 0)
	for rows.Next() {
		var col ColumnInfo
		var nullable string
		var def sql.NullString
		var comment sql.NullString
		var extra sql.NullString
		if err := rows.Scan(&col.Ordinal, &col.Name, &col.DataType, &nullable, &def, &comment, &extra); err != nil {
			return nil, fmt.Errorf("mysql: list columns scan: %w", err)
		}
		col.Nullable = strings.EqualFold(nullable, "YES")
		if def.Valid {
			v := def.String
			col.Default = &v
		}
		if comment.Valid {
			col.Comment = comment.String
		}
		if extra.Valid {
			col.AutoIncrement = strings.Contains(strings.ToLower(extra.String), "auto_increment")
		}
		out = append(out, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	tableComment, err := tableComment(ctx, db, ref)
	if err != nil {
		return nil, err
	}
	return &ColumnsResult{Columns: out, TableComment: tableComment}, nil
}

func tableComment(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `
SELECT TABLE_COMMENT
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`
	var comment sql.NullString
	if err := db.QueryRowContext(ctx, q, ref.Database, ref.Name).Scan(&comment); err != nil {
		if err == sql.ErrNoRows {
			return "", nil
		}
		return "", fmt.Errorf("mysql: table comment: %w", err)
	}
	if comment.Valid {
		return comment.String, nil
	}
	return "", nil
}

type indexRow struct {
	name      string
	nonUnique int
	seq       int
	column    string
	indexType string
}

// ListIndexes 列出表索引（视图通常为空）。
func ListIndexes(ctx context.Context, db *sql.DB, ref RelationRef) (*IndexesResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}
	const q = `
SELECT
  INDEX_NAME,
  NON_UNIQUE,
  SEQ_IN_INDEX,
  COLUMN_NAME,
  INDEX_TYPE
FROM information_schema.STATISTICS
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?
ORDER BY INDEX_NAME, SEQ_IN_INDEX`

	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("mysql: list indexes: %w", err)
	}
	defer rows.Close()

	byName := make(map[string]*IndexInfo)
	order := make([]string, 0)
	for rows.Next() {
		var r indexRow
		var col sql.NullString
		if err := rows.Scan(&r.name, &r.nonUnique, &r.seq, &col, &r.indexType); err != nil {
			return nil, fmt.Errorf("mysql: list indexes scan: %w", err)
		}
		info, ok := byName[r.name]
		if !ok {
			info = &IndexInfo{
				Name:    r.name,
				Unique:  r.nonUnique == 0,
				Primary: strings.EqualFold(r.name, "PRIMARY"),
				Method:  r.indexType,
				Columns: make([]string, 0, 4),
			}
			byName[r.name] = info
			order = append(order, r.name)
		}
		if col.Valid && col.String != "" {
			info.Columns = append(info.Columns, col.String)
		}
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	out := make([]IndexInfo, 0, len(order))
	for _, name := range order {
		info := byName[name]
		cols := strings.Join(info.Columns, ", ")
		kind := "INDEX"
		if info.Primary {
			kind = "PRIMARY KEY"
		} else if info.Unique {
			kind = "UNIQUE"
		}
		if info.Method != "" {
			info.Definition = fmt.Sprintf("%s (%s) USING %s", kind, cols, info.Method)
		} else {
			info.Definition = fmt.Sprintf("%s (%s)", kind, cols)
		}
		out = append(out, *info)
	}
	return &IndexesResult{Indexes: out}, nil
}

// GetDDL 返回 SHOW CREATE TABLE/VIEW 文本。
func GetDDL(ctx context.Context, db *sql.DB, ref RelationRef) (*DDLResult, error) {
	if err := requireRelation(ref); err != nil {
		return nil, err
	}

	objectType, err := detectObjectType(ctx, db, ref)
	if err != nil {
		return nil, err
	}

	q := "SHOW CREATE TABLE " + qualified(ref)
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mysql: show create: %w", err)
	}
	defer rows.Close()

	ddl, err := scanShowCreateDDL(rows)
	if err != nil {
		return nil, err
	}

	if objectType == "" {
		objectType = "unknown"
		upper := strings.ToUpper(ddl)
		if strings.Contains(upper, "CREATE VIEW") || strings.Contains(upper, "CREATE ALGORITHM") {
			objectType = "view"
		} else if strings.Contains(upper, "CREATE TABLE") {
			objectType = "table"
		}
	}

	return &DDLResult{ObjectType: objectType, DDL: ddl}, nil
}

// scanShowCreateDDL 从已打开的 SHOW CREATE 结果集读取 DDL 文本。
func scanShowCreateDDL(rows *sql.Rows) (string, error) {
	cols, err := rows.Columns()
	if err != nil {
		return "", fmt.Errorf("mysql: show create columns: %w", err)
	}
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return "", err
		}
		return "", fmt.Errorf("mysql: show create: no rows")
	}
	ddl, err := scanShowCreateRow(cols, rows)
	if err != nil {
		return "", err
	}
	if strings.TrimSpace(ddl) == "" {
		return "", fmt.Errorf("mysql: show create: empty ddl")
	}
	return ddl, nil
}

func scanShowCreateRow(cols []string, rows *sql.Rows) (string, error) {
	raw := make([]sql.NullString, len(cols))
	ptrs := make([]any, len(cols))
	for i := range raw {
		ptrs[i] = &raw[i]
	}
	if err := rows.Scan(ptrs...); err != nil {
		return "", fmt.Errorf("mysql: show create scan: %w", err)
	}
	for i, name := range cols {
		if strings.HasPrefix(strings.ToLower(name), "create ") && raw[i].Valid && strings.TrimSpace(raw[i].String) != "" {
			return raw[i].String, nil
		}
	}
	if len(raw) >= 2 && raw[1].Valid && strings.TrimSpace(raw[1].String) != "" {
		return raw[1].String, nil
	}
	if len(raw) >= 1 && raw[0].Valid {
		return raw[0].String, nil
	}
	return "", nil
}

// RoutineRef 定位存储过程 / 函数。
type RoutineRef struct {
	Database string
	Name     string
	// Kind：procedure | function
	Kind string
}

// RoutineSourceResult 是 meta.routineSource 返回。
type RoutineSourceResult struct {
	Name       string `json:"name"`
	Kind       string `json:"kind"`
	Definition string `json:"definition"`
}

func requireRoutine(ref RoutineRef) error {
	if strings.TrimSpace(ref.Database) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("mysql: database and name required")
	}
	kind := strings.ToLower(strings.TrimSpace(ref.Kind))
	if kind != "procedure" && kind != "function" {
		return fmt.Errorf("mysql: kind must be procedure or function")
	}
	return nil
}

// GetRoutineSource 返回 SHOW CREATE PROCEDURE/FUNCTION 文本。
func GetRoutineSource(ctx context.Context, db *sql.DB, ref RoutineRef) (*RoutineSourceResult, error) {
	if err := requireRoutine(ref); err != nil {
		return nil, err
	}
	kind := strings.ToLower(strings.TrimSpace(ref.Kind))
	verb := "PROCEDURE"
	if kind == "function" {
		verb = "FUNCTION"
	}
	q := "SHOW CREATE " + verb + " " + quoteIdent(ref.Database) + "." + quoteIdent(ref.Name)
	rows, err := db.QueryContext(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("mysql: show create %s: %w", kind, err)
	}
	defer rows.Close()

	ddl, err := scanShowCreateDDL(rows)
	if err != nil {
		return nil, err
	}
	return &RoutineSourceResult{
		Name:       ref.Name,
		Kind:       kind,
		Definition: ddl,
	}, nil
}

func detectObjectType(ctx context.Context, db *sql.DB, ref RelationRef) (string, error) {
	const q = `
SELECT TABLE_TYPE
FROM information_schema.TABLES
WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ?`
	var tableType sql.NullString
	err := db.QueryRowContext(ctx, q, ref.Database, ref.Name).Scan(&tableType)
	if err == sql.ErrNoRows {
		return "unknown", nil
	}
	if err != nil {
		return "", fmt.Errorf("mysql: detect object type: %w", err)
	}
	if !tableType.Valid {
		return "unknown", nil
	}
	switch strings.ToUpper(tableType.String) {
	case "VIEW", "SYSTEM VIEW":
		return "view", nil
	case "BASE TABLE", "SYSTEM TABLE":
		return "table", nil
	default:
		return strings.ToLower(tableType.String), nil
	}
}
