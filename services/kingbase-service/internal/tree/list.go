// Package tree 提供 KingbaseES 对象树轻量元数据
//（database → schema → tables/views/routines/sequences）。
//
// 约定（docs/31 §5.3）：
//   - 仅返回 name / type，不对每张表执行 COUNT(*) 或体积统计；
//   - 支持 filter 前缀与 limit，超限返回 Truncated；
//   - 供连接树懒加载使用；系统 schema 过滤按金仓常见集合，不复用 Vastbase 内置包列表。
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
		return nil, fmt.Errorf("kingbase: list databases: %w", err)
	}
	defer rows.Close()

	out := make([]DatabaseInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("kingbase: list databases scan: %w", err)
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

// 金仓系统 schema：PG 经典集合 + Kingbase 内置（sys / PL/SQL 调试 / 性能监控）。
// plsql_debug、perf 对普通角色常无 USAGE/SELECT，整库转储时必须排除。
const systemSchemaExcludeSQL = `
      n.nspname NOT IN (
        'pg_catalog', 'information_schema', 'pg_toast',
        'sys', 'sys_catalog',
        'plsql_debug', 'perf'
      )
      AND n.nspname NOT LIKE 'pg_toast_%'
      AND n.nspname NOT LIKE 'pg_temp_%'
      AND n.nspname NOT LIKE 'pg_toast_temp_%'
`

// ListSchemas 列出指定库下的 schema。
func ListSchemas(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*SchemasResult, error) {
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1

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
		return nil, fmt.Errorf("kingbase: list schemas: %w", err)
	}
	defer rows.Close()

	out := make([]SchemaInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("kingbase: list schemas scan: %w", err)
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
		return nil, fmt.Errorf("kingbase: schema required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1
	relkinds := tableRelkinds(params.Types)

	// 仅按名称排除金仓回收站对象（DROP 后改名为 bin$$…）。
	// 不要用 reloptions.deletestatus：正常表也可能带该选项，会把整棵表树滤空。
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
  AND c.relname NOT ILIKE 'bin$$%'
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
  AND c.relname NOT ILIKE 'bin$$%'
ORDER BY c.relname
LIMIT $4`
		args = []any{schema, relkinds, prefix, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("kingbase: list tables: %w", err)
	}
	defer rows.Close()

	out := make([]TableInfo, 0)
	for rows.Next() {
		var name, kind string
		if err := rows.Scan(&name, &kind); err != nil {
			return nil, fmt.Errorf("kingbase: list tables scan: %w", err)
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
		return nil, fmt.Errorf("kingbase: schema required")
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
		return nil, fmt.Errorf("kingbase: list routines: %w", err)
	}
	defer rows.Close()

	out := make([]RoutineInfo, 0)
	for rows.Next() {
		var info RoutineInfo
		if err := rows.Scan(&info.OID, &info.Name, &info.Kind, &info.Args); err != nil {
			return nil, fmt.Errorf("kingbase: list routines scan: %w", err)
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

// ListSequences 列出 schema 下的 sequence（pg_class.relkind = 'S'）。
func ListSequences(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*SequencesResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("kingbase: schema required")
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
		return nil, fmt.Errorf("kingbase: list sequences: %w", err)
	}
	defer rows.Close()

	out := make([]SequenceInfo, 0)
	for rows.Next() {
		var name string
		if err := rows.Scan(&name); err != nil {
			return nil, fmt.Errorf("kingbase: list sequences scan: %w", err)
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

// TriggerInfo 是表上的触发器节点。
type TriggerInfo struct {
	OID       uint32 `json:"oid"`
	Name      string `json:"name"`
	TableName string `json:"tableName"`
}

// TriggersResult 是触发器列表结果。
type TriggersResult struct {
	Triggers  []TriggerInfo `json:"triggers"`
	Truncated bool          `json:"truncated,omitempty"`
}

// ListTriggers 列出 schema 下用户触发器（排除 tgisinternal）。
func ListTriggers(ctx context.Context, pool *pgxpool.Pool, params ListParams) (*TriggersResult, error) {
	schema := strings.TrimSpace(params.Schema)
	if schema == "" {
		return nil, fmt.Errorf("kingbase: schema required")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)
	fetch := limit + 1

	query := `
SELECT t.oid, t.tgname, c.relname
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND NOT t.tgisinternal
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
ORDER BY c.relname, t.tgname
LIMIT $2`
	args := []any{schema, fetch}
	if prefix != "" {
		query = `
SELECT t.oid, t.tgname, c.relname
FROM pg_catalog.pg_trigger t
JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1
  AND NOT t.tgisinternal
  AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
  AND t.tgname ILIKE $2 ESCAPE '\'
ORDER BY c.relname, t.tgname
LIMIT $3`
		args = []any{schema, prefix, fetch}
	}

	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("kingbase: list triggers: %w", err)
	}
	defer rows.Close()

	out := make([]TriggerInfo, 0)
	for rows.Next() {
		var info TriggerInfo
		if err := rows.Scan(&info.OID, &info.Name, &info.TableName); err != nil {
			return nil, fmt.Errorf("kingbase: list triggers scan: %w", err)
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
	return &TriggersResult{Triggers: out, Truncated: truncated}, nil
}
