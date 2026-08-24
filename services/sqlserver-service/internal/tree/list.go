// Package tree 提供 SQL Server 对象树轻量元数据
//（database → schema → tables/views/routines/synonyms/sequences）。
//
// 约定（docs/32 §5.3）：
//   - 仅返回 name / type，不对每张表执行 COUNT(*) 或体积统计；
//   - 支持 filter 前缀与 limit，超限返回 Truncated；
//   - 供连接树懒加载使用；系统 schema 默认隐藏 sys / INFORMATION_SCHEMA 等。
package tree

import (
	"context"
	"database/sql"
	"fmt"
	"strings"
)

const (
	// DefaultLimit 是树列表默认条数上限。
	DefaultLimit = 500
	// MaxLimit 是树列表允许的最大条数。
	MaxLimit = 5000
)

// ListParams 是树列表通用过滤参数。
type ListParams struct {
	Filter        string
	Limit         int
	ExcludeSystem bool
	Database      string
	Schema        string
	// Types 过滤表类对象：空表示 table+view+synonym；可含 table / view / synonym。
	Types []string
	// RoutineKinds 过滤例程：空表示 procedure+function。
	RoutineKinds []string
}

// DatabaseInfo 是库节点。
type DatabaseInfo struct {
	Name string `json:"name"`
}

// SchemaInfo 是 schema 节点。
type SchemaInfo struct {
	Name string `json:"name"`
}

// TableInfo 是表 / 视图 / 同义词节点。
type TableInfo struct {
	Name string `json:"name"`
	Type string `json:"type"` // table | view | synonym
}

// DatabasesResult 是库列表结果。
type DatabasesResult struct {
	Databases []DatabaseInfo `json:"databases"`
	Truncated bool           `json:"truncated,omitempty"`
}

// SchemasResult 是 schema 列表结果。
type SchemasResult struct {
	Schemas   []SchemaInfo `json:"schemas"`
	Truncated bool         `json:"truncated,omitempty"`
}

// TablesResult 是表列表结果。
type TablesResult struct {
	Tables    []TableInfo `json:"tables"`
	Truncated bool        `json:"truncated,omitempty"`
}

// RoutineInfo 是过程 / 函数节点。
type RoutineInfo struct {
	Name string `json:"name"`
	Kind string `json:"kind"` // procedure | function
}

// RoutinesResult 是例程列表结果。
type RoutinesResult struct {
	Routines  []RoutineInfo `json:"routines"`
	Truncated bool          `json:"truncated,omitempty"`
}

// SequenceInfo 是序列节点。
type SequenceInfo struct {
	Name string `json:"name"`
}

// SequencesResult 是序列列表结果。
type SequencesResult struct {
	Sequences []SequenceInfo `json:"sequences"`
	Truncated bool           `json:"truncated,omitempty"`
}

func normalizeLimit(limit int) int {
	if limit <= 0 {
		return DefaultLimit
	}
	if limit > MaxLimit {
		return MaxLimit
	}
	return limit
}

func likePrefix(filter string) string {
	f := strings.TrimSpace(filter)
	if f == "" {
		return ""
	}
	escaped := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(f)
	return escaped + "%"
}

func requireDB(db *sql.DB) error {
	if db == nil {
		return fmt.Errorf("sqlserver: tree: nil db")
	}
	return nil
}

// argBinder 按追加顺序分配 SQL Server 的序号占位符。
//
// go-mssqldb 不接受 `?`，参数只能写成 @p1…@pN（或 @Name），
// 且序号必须与传给 QueryContext 的 args 下标一一对应；用 next 同时
// 登记取值与生成占位符，可避免动态拼接分支时序号错位。
type argBinder struct {
	args []any
}

// next 登记一个参数取值，并返回它在 SQL 中对应的占位符。
func (b *argBinder) next(value any) string {
	b.args = append(b.args, value)
	return fmt.Sprintf("@p%d", len(b.args))
}

// values 返回与占位符序号对齐的参数取值。
func (b *argBinder) values() []any {
	return b.args
}

// buildDatabasesQuery 拼装库列表查询与其参数。
func buildDatabasesQuery(params ListParams) (string, []any) {
	fetch := normalizeLimit(params.Limit) + 1
	b := &argBinder{}

	query := fmt.Sprintf(`
SELECT TOP (%d) d.name
FROM sys.databases d
WHERE d.state = 0`, fetch)
	if prefix := likePrefix(params.Filter); prefix != "" {
		query += `
  AND d.name LIKE ` + b.next(prefix) + ` ESCAPE '\'`
	}
	query += `
ORDER BY d.name`
	return query, b.values()
}

// ListDatabases 列出实例上的数据库（ONLINE；不含 size）。
func ListDatabases(ctx context.Context, db *sql.DB, params ListParams) (*DatabasesResult, error) {
	if err := requireDB(db); err != nil {
		return nil, err
	}
	limit := normalizeLimit(params.Limit)
	query, args := buildDatabasesQuery(params)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list databases: %w", err)
	}
	defer rows.Close()

	out := make([]DatabaseInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("sqlserver: list databases scan: %w", err)
		}
		out = append(out, DatabaseInfo{Name: name})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	truncated := len(out) > limit
	if truncated {
		out = out[:limit]
	}
	return &DatabasesResult{Databases: out, Truncated: truncated}, nil
}

// systemSchemaNames 是对象树默认隐藏的固定角色 / 系统 schema（大小写不敏感）。
var systemSchemaNames = []string{
	"sys",
	"INFORMATION_SCHEMA",
	"guest",
	"db_owner",
	"db_accessadmin",
	"db_securityadmin",
	"db_ddladmin",
	"db_backupoperator",
	"db_datareader",
	"db_datawriter",
	"db_denydatareader",
	"db_denydatawriter",
}

// IsSystemSchema 报告 name 是否为 SQL Server 固定角色或系统 schema。
func IsSystemSchema(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	if n == "" {
		return false
	}
	for _, s := range systemSchemaNames {
		if n == strings.ToLower(s) {
			return true
		}
	}
	return false
}

// systemSchemaExcludeSQL 与 systemSchemaNames 同步：默认在对象树中隐藏。
func systemSchemaExcludeSQL() string {
	parts := make([]string, len(systemSchemaNames))
	for i, s := range systemSchemaNames {
		parts[i] = "N'" + strings.ReplaceAll(s, "'", "''") + "'"
	}
	return "s.name NOT IN (" + strings.Join(parts, ", ") + ")"
}

// buildSchemasQuery 拼装 schema 列表查询与其参数。
func buildSchemasQuery(params ListParams) (string, []any) {
	fetch := normalizeLimit(params.Limit) + 1
	b := &argBinder{}

	query := fmt.Sprintf(`
SELECT TOP (%d) s.name
FROM sys.schemas s
WHERE 1 = 1`, fetch)
	if params.ExcludeSystem {
		query += `
  AND (` + systemSchemaExcludeSQL() + `)`
	}
	if prefix := likePrefix(params.Filter); prefix != "" {
		query += `
  AND s.name LIKE ` + b.next(prefix) + ` ESCAPE '\'`
	}
	query += `
ORDER BY s.name`
	return query, b.values()
}

// ListSchemas 列出当前库下的 schema。
func ListSchemas(ctx context.Context, db *sql.DB, params ListParams) (*SchemasResult, error) {
	if err := requireDB(db); err != nil {
		return nil, err
	}
	limit := normalizeLimit(params.Limit)
	query, args := buildSchemasQuery(params)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list schemas: %w", err)
	}
	defer rows.Close()

	out := make([]SchemaInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("sqlserver: list schemas scan: %w", err)
		}
		out = append(out, SchemaInfo{Name: name})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	truncated := len(out) > limit
	if truncated {
		out = out[:limit]
	}
	return &SchemasResult{Schemas: out, Truncated: truncated}, nil
}

// buildTablesQuery 拼装表 / 视图 / 同义词的 UNION ALL 查询与其参数。
// 第三个返回值为 false 表示 Types 未选中任何对象类型，无需查询。
func buildTablesQuery(params ListParams, schema string) (string, []any, bool) {
	fetch := normalizeLimit(params.Limit) + 1
	prefix := likePrefix(params.Filter)
	wantTable, wantView, wantSynonym := tableTypeFlags(params.Types)

	b := &argBinder{}
	parts := make([]string, 0, 3)
	// 每个分支自带 schema 参数，占位符按拼接顺序分配，与 UNION ALL 的顺序一致。
	appendPart := func(body, nameColumn string) {
		part := body + b.next(schema)
		if prefix != "" {
			part += `
  AND ` + nameColumn + ` LIKE ` + b.next(prefix) + ` ESCAPE '\'`
		}
		parts = append(parts, part)
	}

	if wantTable {
		appendPart(`
SELECT t.name AS name, N'table' AS type
FROM sys.tables t
INNER JOIN sys.schemas s ON s.schema_id = t.schema_id
WHERE s.name = `, "t.name")
	}
	if wantView {
		appendPart(`
SELECT v.name AS name, N'view' AS type
FROM sys.views v
INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
WHERE s.name = `, "v.name")
	}
	if wantSynonym {
		appendPart(`
SELECT syn.name AS name, N'synonym' AS type
FROM sys.synonyms syn
INNER JOIN sys.schemas s ON s.schema_id = syn.schema_id
WHERE s.name = `, "syn.name")
	}
	if len(parts) == 0 {
		return "", nil, false
	}

	union := strings.Join(parts, `
UNION ALL
`)
	query := fmt.Sprintf(`
SELECT TOP (%d) name, type
FROM (%s) AS objects
ORDER BY name, type`, fetch, union)
	return query, b.values(), true
}

// ListTables 列出 schema 下的表 / 视图 / 同义词（不含行数）。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) (*TablesResult, error) {
	if err := requireDB(db); err != nil {
		return nil, err
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("sqlserver: schema required")
	}
	limit := normalizeLimit(params.Limit)
	query, args, ok := buildTablesQuery(params, schema)
	if !ok {
		return &TablesResult{Tables: []TableInfo{}}, nil
	}

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list tables: %w", err)
	}
	defer rows.Close()

	out := make([]TableInfo, 0)
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, fmt.Errorf("sqlserver: list tables scan: %w", err)
		}
		out = append(out, TableInfo{Name: name, Type: kind})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	truncated := len(out) > limit
	if truncated {
		out = out[:limit]
	}
	return &TablesResult{Tables: out, Truncated: truncated}, nil
}

func tableTypeFlags(types []string) (wantTable, wantView, wantSynonym bool) {
	if len(types) == 0 {
		return true, true, true
	}
	for _, t := range types {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "table":
			wantTable = true
		case "view":
			wantView = true
		case "synonym":
			wantSynonym = true
		}
	}
	return wantTable, wantView, wantSynonym
}

// buildRoutinesQuery 拼装存储过程 / 函数列表查询与其参数。
// 第三个返回值为 false 表示 RoutineKinds 未选中任何例程类型，无需查询。
func buildRoutinesQuery(params ListParams, schema string) (string, []any, bool) {
	typeFilter := routineTypeSQL(params.RoutineKinds)
	if typeFilter == "" {
		return "", nil, false
	}
	fetch := normalizeLimit(params.Limit) + 1
	b := &argBinder{}

	query := fmt.Sprintf(`
SELECT TOP (%d)
  o.name,
  CASE
    WHEN o.type IN (N'P', N'PC') THEN N'procedure'
    ELSE N'function'
  END AS kind
FROM sys.objects o
INNER JOIN sys.schemas s ON s.schema_id = o.schema_id
WHERE s.name = %s
  AND o.type IN (%s)
  AND o.is_ms_shipped = 0`, fetch, b.next(schema), typeFilter)
	if prefix := likePrefix(params.Filter); prefix != "" {
		query += `
  AND o.name LIKE ` + b.next(prefix) + ` ESCAPE '\'`
	}
	query += `
ORDER BY o.name, kind`
	return query, b.values(), true
}

// ListRoutines 列出 schema 下的存储过程 / 函数（不含源码）。
func ListRoutines(ctx context.Context, db *sql.DB, params ListParams) (*RoutinesResult, error) {
	if err := requireDB(db); err != nil {
		return nil, err
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("sqlserver: schema required")
	}
	limit := normalizeLimit(params.Limit)
	query, args, ok := buildRoutinesQuery(params, schema)
	if !ok {
		return &RoutinesResult{Routines: []RoutineInfo{}}, nil
	}

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list routines: %w", err)
	}
	defer rows.Close()

	out := make([]RoutineInfo, 0)
	for rows.Next() {
		var info RoutineInfo
		if err := rows.Scan(&info.Name, &info.Kind); err != nil {
			return nil, fmt.Errorf("sqlserver: list routines scan: %w", err)
		}
		out = append(out, info)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	truncated := len(out) > limit
	if truncated {
		out = out[:limit]
	}
	return &RoutinesResult{Routines: out, Truncated: truncated}, nil
}

func routineTypeSQL(kinds []string) string {
	wantProc, wantFunc := true, true
	if len(kinds) > 0 {
		wantProc, wantFunc = false, false
		for _, k := range kinds {
			switch strings.ToLower(strings.TrimSpace(k)) {
			case "procedure", "proc":
				wantProc = true
			case "function", "func":
				wantFunc = true
			}
		}
	}
	parts := make([]string, 0, 6)
	if wantProc {
		parts = append(parts, `N'P'`, `N'PC'`)
	}
	if wantFunc {
		// FN=scalar, IF=inline TVF, TF=multi-statement TVF, AF=aggregate, FT/FS=CLR
		parts = append(parts, `N'FN'`, `N'IF'`, `N'TF'`, `N'AF'`, `N'FT'`, `N'FS'`)
	}
	return strings.Join(parts, ", ")
}

// buildSequencesQuery 拼装序列列表查询与其参数。
func buildSequencesQuery(params ListParams, schema string) (string, []any) {
	fetch := normalizeLimit(params.Limit) + 1
	b := &argBinder{}

	query := fmt.Sprintf(`
SELECT TOP (%d) seq.name
FROM sys.sequences seq
INNER JOIN sys.schemas s ON s.schema_id = seq.schema_id
WHERE s.name = %s`, fetch, b.next(schema))
	if prefix := likePrefix(params.Filter); prefix != "" {
		query += `
  AND seq.name LIKE ` + b.next(prefix) + ` ESCAPE '\'`
	}
	query += `
ORDER BY seq.name`
	return query, b.values()
}

// ListSequences 列出 schema 下的 SEQUENCE（2012+ / sys.sequences）。
func ListSequences(ctx context.Context, db *sql.DB, params ListParams) (*SequencesResult, error) {
	if err := requireDB(db); err != nil {
		return nil, err
	}
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("sqlserver: schema required")
	}
	limit := normalizeLimit(params.Limit)
	query, args := buildSequencesQuery(params, schema)

	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("sqlserver: list sequences: %w", err)
	}
	defer rows.Close()

	out := make([]SequenceInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("sqlserver: list sequences scan: %w", err)
		}
		out = append(out, SequenceInfo{Name: name})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	truncated := len(out) > limit
	if truncated {
		out = out[:limit]
	}
	return &SequencesResult{Sequences: out, Truncated: truncated}, nil
}
