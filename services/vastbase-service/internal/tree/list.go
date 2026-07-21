// Package tree 提供 Vastbase 对象树轻量元数据
//（database → schema → tables/views/routines）。
//
// 约定（docs/22 §5.3 / §8）：
//   - 仅返回 name / type，不对每张表执行 COUNT(*) 或体积统计；
//   - 支持 filter 前缀与 limit，超限返回 Truncated；
//   - 供连接树懒加载使用，与业务长会话解耦（可由短连或会话池查询）。
package tree

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
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
	// Types 过滤表对象类型：空表示全部（table / view / materialized_view / foreign_table）。
	Types []string
	// RoutineKinds 过滤例程：空表示 function+procedure。
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

// TableInfo 是表 / 视图节点。
type TableInfo struct {
	Name string `json:"name"`
	Type string `json:"type"` // table | view | materialized_view | foreign_table
}

// ListResult 是带截断标记的通用列表结果包装辅助。
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

// RoutineInfo 是函数 / 存储过程节点。
type RoutineInfo struct {
	OID  uint32 `json:"oid"`
	Name string `json:"name"`
	Kind string `json:"kind"` // function | procedure | aggregate | window
	Args string `json:"args,omitempty"`
}

// RoutinesResult 是例程列表结果。
type RoutinesResult struct {
	Routines  []RoutineInfo `json:"routines"`
	Truncated bool          `json:"truncated,omitempty"`
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
	// 转义 LIKE 通配符，仅做前缀匹配。
	f = strings.ReplaceAll(f, `\`, `\\`)
	f = strings.ReplaceAll(f, `%`, `\%`)
	f = strings.ReplaceAll(f, `_`, `\_`)
	return f + "%"
}

// ListDatabases 列出实例上的数据库（轻量，不含 size）。
func ListDatabases(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*DatabasesResult, error) {
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1

	// 无前缀时不用 ILIKE/ESCAPE：部分 openGauss / Vastbase 对 `ESCAPE '\'` 与空串 OR 组合不稳定。
	query := `
SELECT d.datname
FROM pg_catalog.pg_database d
WHERE COALESCE(d.datallowconn, true)
ORDER BY d.datname
LIMIT $1`
	args := []any{fetch}
	if prefix != "" {
		query = `
SELECT d.datname
FROM pg_catalog.pg_database d
WHERE COALESCE(d.datallowconn, true)
  AND d.datname ILIKE $1 ESCAPE '\'
ORDER BY d.datname
LIMIT $2`
		args = []any{prefix, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list databases: %w", err)
	}
	defer rows.Close()

	out := make([]DatabaseInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("vastbase: list databases scan: %w", err)
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

// ListSchemas 列出指定库下的 schema（通过当前连接；调用方应确保连到目标库或有权限）。
func ListSchemas(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*SchemasResult, error) {
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1

	// 与 ListDatabases 相同：无前缀时避开空串 OR + ESCAPE，兼容 Vastbase / openGauss。
	// ExcludeSystem 同时过滤 PG 经典系统 schema 与 Vastbase/openGauss 内置包。
	const systemSchemaExcludeSQL = `
      n.nspname NOT IN (
        'pg_catalog', 'information_schema', 'pg_toast',
        'cstore', 'db4ai', 'dbe_perf', 'dbe_pldebugger', 'dbe_pldeveloper', 'dbe_sql_util',
        'blockchain', 'audit',
        'sys', 'snapshot', 'sqladvisor', 'coverage'
      )
      AND n.nspname NOT LIKE 'pg_toast_%'
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast_temp_%'
      AND n.nspname NOT LIKE 'dbms_%'
      AND n.nspname NOT LIKE 'dbe_%'
      AND n.nspname NOT LIKE 'pkg_%'
      AND n.nspname NOT LIKE 'utl_%'
`
	query := `
SELECT n.nspname
FROM pg_catalog.pg_namespace n
WHERE (
    NOT $1
    OR (` + systemSchemaExcludeSQL + `
    )
  )
ORDER BY n.nspname
LIMIT $2`
	args := []any{params.ExcludeSystem, fetch}
	if prefix != "" {
		query = `
SELECT n.nspname
FROM pg_catalog.pg_namespace n
WHERE n.nspname ILIKE $1 ESCAPE '\'
  AND (
    NOT $2
    OR (` + systemSchemaExcludeSQL + `
    )
  )
ORDER BY n.nspname
LIMIT $3`
		args = []any{prefix, params.ExcludeSystem, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list schemas: %w", err)
	}
	defer rows.Close()

	out := make([]SchemaInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("vastbase: list schemas scan: %w", err)
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

// ListTables 列出 schema 下的表 / 视图（不含行数统计）。
func ListTables(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*TablesResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("vastbase: schema required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1
	relkinds := tableRelkinds(params.Types)

	query := `
SELECT c.relname,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'f' THEN 'foreign_table'
    ELSE c.relkind::text
  END AS kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind = ANY($2::char[])
ORDER BY c.relname
LIMIT $3`
	args := []any{schema, relkinds, fetch}
	if prefix != "" {
		query = `
SELECT c.relname,
  CASE c.relkind
    WHEN 'r' THEN 'table'
    WHEN 'p' THEN 'table'
    WHEN 'v' THEN 'view'
    WHEN 'm' THEN 'materialized_view'
    WHEN 'f' THEN 'foreign_table'
    ELSE c.relkind::text
  END AS kind
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind = ANY($2::char[])
  AND c.relname ILIKE $3 ESCAPE '\'
ORDER BY c.relname
LIMIT $4`
		args = []any{schema, relkinds, prefix, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list tables: %w", err)
	}
	defer rows.Close()

	out := make([]TableInfo, 0)
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, fmt.Errorf("vastbase: list tables scan: %w", err)
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

// tableRelkinds 将 API type 过滤映射为 pg_class.relkind。
func tableRelkinds(types []string) []string {
	if len(types) == 0 {
		return []string{"r", "p", "v", "m", "f"}
	}
	seen := make(map[string]struct{}, len(types)*2)
	out := make([]string, 0, len(types)*2)
	add := func(k string) {
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	for _, t := range types {
		switch strings.ToLower(strings.TrimSpace(t)) {
		case "table":
			add("r")
			add("p")
		case "view":
			add("v")
		case "materialized_view":
			add("m")
		case "foreign_table":
			add("f")
		}
	}
	if len(out) == 0 {
		return []string{"r", "p", "v", "m", "f"}
	}
	return out
}

// ListRoutines 列出 schema 下的函数 / 存储过程（不含源码）。
func ListRoutines(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*RoutinesResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("vastbase: schema required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1
	prokinds := routineProkinds(params.RoutineKinds)

	query := `
SELECT p.oid,
  p.proname,
  CASE p.prokind
    WHEN 'f' THEN 'function'
    WHEN 'p' THEN 'procedure'
    WHEN 'a' THEN 'aggregate'
    WHEN 'w' THEN 'window'
    ELSE p.prokind::text
  END AS kind,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1
  AND p.prokind = ANY($2::char[])
ORDER BY p.proname, p.oid
LIMIT $3`
	args := []any{schema, prokinds, fetch}
	if prefix != "" {
		query = `
SELECT p.oid,
  p.proname,
  CASE p.prokind
    WHEN 'f' THEN 'function'
    WHEN 'p' THEN 'procedure'
    WHEN 'a' THEN 'aggregate'
    WHEN 'w' THEN 'window'
    ELSE p.prokind::text
  END AS kind,
  pg_catalog.pg_get_function_identity_arguments(p.oid) AS args
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = $1
  AND p.prokind = ANY($2::char[])
  AND p.proname ILIKE $3 ESCAPE '\'
ORDER BY p.proname, p.oid
LIMIT $4`
		args = []any{schema, prokinds, prefix, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list routines: %w", err)
	}
	defer rows.Close()

	out := make([]RoutineInfo, 0)
	for rows.Next() {
		var info RoutineInfo
		if err := rows.Scan(&info.OID, &info.Name, &info.Kind, &info.Args); err != nil {
			return nil, fmt.Errorf("vastbase: list routines scan: %w", err)
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

// routineProkinds 将 API kind 过滤映射为 pg_proc.prokind。
func routineProkinds(kinds []string) []string {
	if len(kinds) == 0 {
		return []string{"f", "p"}
	}
	seen := make(map[string]struct{}, len(kinds))
	out := make([]string, 0, len(kinds))
	add := func(k string) {
		if _, ok := seen[k]; ok {
			return
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	for _, k := range kinds {
		switch strings.ToLower(strings.TrimSpace(k)) {
		case "function":
			add("f")
		case "procedure":
			add("p")
		case "aggregate":
			add("a")
		case "window":
			add("w")
		}
	}
	if len(out) == 0 {
		return []string{"f", "p"}
	}
	return out
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

// ListSequences 列出 schema 下的 sequence（pg_class.relkind = 'S'）。
func ListSequences(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*SequencesResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("vastbase: schema required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1

	query := `
SELECT c.relname
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind = 'S'
ORDER BY c.relname
LIMIT $2`
	args := []any{schema, fetch}
	if prefix != "" {
		query = `
SELECT c.relname
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND c.relkind = 'S'
  AND c.relname ILIKE $2 ESCAPE '\'
ORDER BY c.relname
LIMIT $3`
		args = []any{schema, prefix, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("vastbase: list sequences: %w", err)
	}
	defer rows.Close()

	out := make([]SequenceInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("vastbase: list sequences scan: %w", err)
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
