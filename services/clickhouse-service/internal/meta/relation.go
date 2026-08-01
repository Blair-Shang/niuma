// Package meta 提供 ClickHouse 表级元数据（列 / 引擎信息 / 跳数索引 / DDL）。
//
// 数据来源为 system.* 与 SHOW CREATE TABLE；禁止对树节点默认 COUNT(*) 行数。
package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

	"niuma/services/clickhouse-service/internal/session"
)

// RelationRef 标识 database.table（或视图 / MV）。
type RelationRef struct {
	Database string
	Name     string
}

func requireRelation(ref RelationRef) error {
	if strings.TrimSpace(ref.Database) == "" || strings.TrimSpace(ref.Name) == "" {
		return fmt.Errorf("clickhouse: meta: database and table required")
	}
	if !session.IsSafeDatabaseName(ref.Database) {
		return fmt.Errorf("clickhouse: meta: unsafe database name %q", ref.Database)
	}
	if !session.IsSafeDatabaseName(ref.Name) {
		return fmt.Errorf("clickhouse: meta: unsafe table name %q", ref.Name)
	}
	return nil
}

func qualified(ref RelationRef) (string, error) {
	if err := requireRelation(ref); err != nil {
		return "", err
	}
	db, err := session.QuoteIdent(ref.Database)
	if err != nil {
		return "", err
	}
	tbl, err := session.QuoteIdent(ref.Name)
	if err != nil {
		return "", err
	}
	return db + "." + tbl, nil
}

// ColumnInfo 是列元数据。
type ColumnInfo struct {
	Ordinal  int     `json:"ordinal"`
	Name     string  `json:"name"`
	DataType string  `json:"dataType"`
	Nullable bool    `json:"nullable"`
	Default  *string `json:"default,omitempty"`
	Comment  string  `json:"comment,omitempty"`
}

// ColumnsResult 是 meta.columns 返回。
type ColumnsResult struct {
	Columns      []ColumnInfo `json:"columns"`
	TableComment string       `json:"tableComment,omitempty"`
}

// TableInfo 是引擎 / 键 / 统计摘要（meta.tableInfo）。
type TableInfo struct {
	Database     string `json:"database"`
	Name         string `json:"name"`
	Engine       string `json:"engine,omitempty"`
	PartitionKey string `json:"partitionKey,omitempty"`
	SortingKey   string `json:"sortingKey,omitempty"`
	PrimaryKey   string `json:"primaryKey,omitempty"`
	TotalRows    *int64 `json:"totalRows,omitempty"`
	TotalBytes   *int64 `json:"totalBytes,omitempty"`
	Comment      string `json:"comment,omitempty"`
	ObjectType   string `json:"objectType,omitempty"` // table | view | materialized_view | dictionary
}

// IndexInfo 是数据跳过索引（ClickHouse 无传统 BTree 主键索引列表）。
type IndexInfo struct {
	Name       string `json:"name"`
	Type       string `json:"type,omitempty"`
	Expression string `json:"expression,omitempty"`
	Definition string `json:"definition,omitempty"`
}

// IndexesResult 是 meta.indexes 返回。
type IndexesResult struct {
	Indexes []IndexInfo `json:"indexes"`
}

// DDLResult 是 meta.ddl 返回。
type DDLResult struct {
	ObjectType string `json:"objectType"`
	DDL        string `json:"ddl"`
	Type       string `json:"type,omitempty"` // 兼容别名
}

// ListColumns 列出 system.columns。
func ListColumns(ctx context.Context, db *sql.DB, ref RelationRef) (*ColumnsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: meta: nil db")
	}
	if err := requireRelation(ref); err != nil {
		return nil, err
	}

	const q = `
SELECT
  position,
  name,
  type,
  default_kind,
  default_expression,
  comment
FROM system.columns
WHERE database = ? AND table = ?
ORDER BY position`

	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name)
	if err != nil {
		return nil, fmt.Errorf("clickhouse: list columns: %w", err)
	}
	defer rows.Close()

	out := make([]ColumnInfo, 0)
	for rows.Next() {
		var (
			pos                                uint64
			name, typ, defKind, defExpr, comment string
		)
		if err := rows.Scan(&pos, &name, &typ, &defKind, &defExpr, &comment); err != nil {
			return nil, fmt.Errorf("clickhouse: list columns scan: %w", err)
		}
		col := ColumnInfo{
			Ordinal:  int(pos),
			Name:     name,
			DataType: typ,
			Nullable: strings.HasPrefix(strings.ToUpper(typ), "NULLABLE("),
			Comment:  comment,
		}
		if expr := strings.TrimSpace(defExpr); expr != "" {
			v := expr
			if kind := strings.TrimSpace(defKind); kind != "" {
				v = kind + " " + expr
			}
			col.Default = &v
		}
		out = append(out, col)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	info, _ := GetTableInfo(ctx, db, ref)
	tableComment := ""
	if info != nil {
		tableComment = info.Comment
	}
	return &ColumnsResult{Columns: out, TableComment: tableComment}, nil
}

// GetTableInfo 读取 system.tables 一行摘要。
func GetTableInfo(ctx context.Context, db *sql.DB, ref RelationRef) (*TableInfo, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: meta: nil db")
	}
	if err := requireRelation(ref); err != nil {
		return nil, err
	}

	const q = `
SELECT
  engine,
  partition_key,
  sorting_key,
  primary_key,
  total_rows,
  total_bytes,
  comment
FROM system.tables
WHERE database = ? AND name = ?
LIMIT 1`

	var (
		engine, partKey, sortKey, pk, comment sql.NullString
		totalRows, totalBytes                 sql.NullInt64
	)
	err := db.QueryRowContext(ctx, q, ref.Database, ref.Name).Scan(
		&engine, &partKey, &sortKey, &pk, &totalRows, &totalBytes, &comment,
	)
	if err == sql.ErrNoRows {
		return nil, fmt.Errorf("clickhouse: table not found: %s.%s", ref.Database, ref.Name)
	}
	if err != nil {
		return nil, fmt.Errorf("clickhouse: table info: %w", err)
	}

	info := &TableInfo{
		Database:     ref.Database,
		Name:         ref.Name,
		Engine:       nullStr(engine),
		PartitionKey: nullStr(partKey),
		SortingKey:   nullStr(sortKey),
		PrimaryKey:   nullStr(pk),
		Comment:      nullStr(comment),
		ObjectType:   classifyObjectType(nullStr(engine)),
	}
	if totalRows.Valid {
		v := totalRows.Int64
		info.TotalRows = &v
	}
	if totalBytes.Valid {
		v := totalBytes.Int64
		info.TotalBytes = &v
	}
	return info, nil
}

// ListIndexes 列出 system.data_skipping_indices（无则空列表）。
func ListIndexes(ctx context.Context, db *sql.DB, ref RelationRef) (*IndexesResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: meta: nil db")
	}
	if err := requireRelation(ref); err != nil {
		return nil, err
	}

	const q = `
SELECT name, type, expr
FROM system.data_skipping_indices
WHERE database = ? AND table = ?
ORDER BY name`

	rows, err := db.QueryContext(ctx, q, ref.Database, ref.Name)
	if err != nil {
		// 旧版本可能无此系统表：降级为空列表。
		if isUnknownTable(err) {
			return &IndexesResult{Indexes: []IndexInfo{}}, nil
		}
		return nil, fmt.Errorf("clickhouse: list indexes: %w", err)
	}
	defer rows.Close()

	out := make([]IndexInfo, 0)
	for rows.Next() {
		var name, typ, expr string
		if err := rows.Scan(&name, &typ, &expr); err != nil {
			return nil, fmt.Errorf("clickhouse: list indexes scan: %w", err)
		}
		out = append(out, IndexInfo{
			Name:       name,
			Type:       typ,
			Expression: expr,
			Definition: fmt.Sprintf("INDEX %s %s TYPE %s", name, expr, typ),
		})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return &IndexesResult{Indexes: out}, nil
}

// GetDDL 返回 SHOW CREATE TABLE / DICTIONARY 文本。
func GetDDL(ctx context.Context, db *sql.DB, ref RelationRef) (*DDLResult, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: meta: nil db")
	}
	qual, err := qualified(ref)
	if err != nil {
		return nil, err
	}

	objectType := "table"
	if info, ierr := GetTableInfo(ctx, db, ref); ierr == nil && info != nil {
		objectType = info.ObjectType
	} else if isDictionaryObject(ctx, db, ref) {
		objectType = "dictionary"
	}

	queries := []string{"SHOW CREATE TABLE " + qual}
	if objectType == "dictionary" {
		queries = []string{"SHOW CREATE DICTIONARY " + qual, "SHOW CREATE TABLE " + qual}
	}

	var statement string
	var lastErr error
	for _, q := range queries {
		statement, lastErr = execShowCreate(ctx, db, q)
		if lastErr == nil && strings.TrimSpace(statement) != "" {
			break
		}
	}
	if lastErr != nil {
		return nil, fmt.Errorf("clickhouse: show create: %w", lastErr)
	}
	statement = strings.TrimSpace(statement)
	if statement == "" {
		return nil, fmt.Errorf("clickhouse: show create: empty ddl")
	}
	return &DDLResult{ObjectType: objectType, DDL: statement, Type: objectType}, nil
}

func isDictionaryObject(ctx context.Context, db *sql.DB, ref RelationRef) bool {
	var name string
	err := db.QueryRowContext(ctx,
		`SELECT name FROM system.dictionaries WHERE database = ? AND name = ? LIMIT 1`,
		ref.Database, ref.Name,
	).Scan(&name)
	return err == nil && strings.TrimSpace(name) != ""
}

func execShowCreate(ctx context.Context, db *sql.DB, q string) (string, error) {
	var statement string
	if err := db.QueryRowContext(ctx, q).Scan(&statement); err == nil {
		return statement, nil
	} else {
		rows, qerr := db.QueryContext(ctx, q)
		if qerr != nil {
			return "", err
		}
		defer rows.Close()
		return scanShowCreate(rows)
	}
}

func scanShowCreate(rows *sql.Rows) (string, error) {
	cols, err := rows.Columns()
	if err != nil {
		return "", err
	}
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return "", err
		}
		return "", fmt.Errorf("clickhouse: show create: no rows")
	}
	raw := make([]any, len(cols))
	dest := make([]any, len(cols))
	for i := range raw {
		dest[i] = &raw[i]
	}
	if err := rows.Scan(dest...); err != nil {
		return "", err
	}
	// 取最后一列或名为 statement / create_table_query 的列。
	for i, name := range cols {
		n := strings.ToLower(name)
		if n == "statement" || n == "create_table_query" || i == len(cols)-1 {
			return cellToString(raw[i]), nil
		}
	}
	return "", fmt.Errorf("clickhouse: show create: no statement column")
}

func cellToString(v any) string {
	switch t := v.(type) {
	case nil:
		return ""
	case string:
		return t
	case []byte:
		return string(t)
	default:
		return strings.TrimSpace(fmt.Sprint(t))
	}
}

func nullStr(v sql.NullString) string {
	if v.Valid {
		return v.String
	}
	return ""
}

func classifyObjectType(engine string) string {
	switch strings.TrimSpace(engine) {
	case "View":
		return "view"
	case "MaterializedView":
		return "materialized_view"
	case "Dictionary":
		return "dictionary"
	default:
		return "table"
	}
}

func isUnknownTable(err error) bool {
	if err == nil {
		return false
	}
	msg := strings.ToLower(err.Error())
	return strings.Contains(msg, "unknown table") ||
		strings.Contains(msg, "doesn't exist") ||
		strings.Contains(msg, "does not exist")
}
