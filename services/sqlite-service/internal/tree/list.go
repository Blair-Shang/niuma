// Package tree 提供 SQLite 对象树轻量元数据。
//
// 对象模型对齐 DBeaver / Navicat / IDEA：
//
//	connection → schema(main) → {Tables|Views|Indexes|Triggers} → object
//
// 约定（docs/27 §5.3）：仅 name/type；filter/limit；不对每张表 COUNT(*)。
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
	// SchemaMain 是主库 schema 名。
	SchemaMain = "main"
)

// ListParams 是树列表通用过滤参数。
type ListParams struct {
	Filter        string
	Limit         int
	ExcludeSystem bool
	Schema        string
	// Types 过滤：table / view；indexes|triggers 用独立 API。
	Types []string
}

// SchemaInfo 是 schema 节点（main + ATTACH）。
type SchemaInfo struct {
	Name string `json:"name"`
	File string `json:"file,omitempty"`
	Seq  int    `json:"seq,omitempty"`
}

// ObjectInfo 是表 / 视图 / 索引 / 触发器节点。
type ObjectInfo struct {
	Name   string `json:"name"`
	Type   string `json:"type"` // table | view | index | trigger
	Table  string `json:"table,omitempty"`
	Schema string `json:"schema,omitempty"`
}

// SchemasResult 是 schema 列表。
type SchemasResult struct {
	Schemas   []SchemaInfo `json:"schemas"`
	Truncated bool         `json:"truncated,omitempty"`
}

// ObjectsResult 是对象列表。
type ObjectsResult struct {
	Objects   []ObjectInfo `json:"objects"`
	Tables    []ObjectInfo `json:"tables,omitempty"` // 兼容 MySQL 形字段（前端可选用）
	Truncated bool         `json:"truncated,omitempty"`
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

func schemaOrMain(schema string) string {
	s := strings.TrimSpace(schema)
	if s == "" {
		return SchemaMain
	}
	return s
}

func isSafeSchema(name string) bool {
	for _, r := range name {
		switch {
		case r >= 'a' && r <= 'z':
		case r >= 'A' && r <= 'Z':
		case r >= '0' && r <= '9':
		case r == '_':
		default:
			return false
		}
	}
	return name != ""
}

// IsSystemObject 判断是否为 SQLite 内部对象（默认隐藏，对齐 IDEA/DBeaver）。
func IsSystemObject(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	return strings.HasPrefix(n, "sqlite_")
}

// ListSchemas 列出已 ATTACH 的数据库（含 main）。
func ListSchemas(ctx context.Context, db *sql.DB, params ListParams) (*SchemasResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: tree: nil db")
	}
	limit := normalizeLimit(params.Limit)
	prefix := strings.ToLower(strings.TrimSpace(params.Filter))

	rows, err := db.QueryContext(ctx, `PRAGMA database_list`)
	if err != nil {
		return nil, fmt.Errorf("sqlite: tree: database_list: %w", err)
	}
	defer rows.Close()

	out := make([]SchemaInfo, 0, 4)
	truncated := false
	for rows.Next() {
		var seq int
		var name, file string
		if err := rows.Scan(&seq, &name, &file); err != nil {
			return nil, fmt.Errorf("sqlite: tree: scan schema: %w", err)
		}
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if prefix != "" && !strings.HasPrefix(strings.ToLower(name), prefix) {
			continue
		}
		if len(out) >= limit {
			truncated = true
			break
		}
		out = append(out, SchemaInfo{Name: name, File: file, Seq: seq})
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) == 0 {
		out = []SchemaInfo{{Name: SchemaMain}}
	}
	return &SchemasResult{Schemas: out, Truncated: truncated}, nil
}

// ListTables 列出 table / view（sqlite_schema / sqlite_master）。
func ListTables(ctx context.Context, db *sql.DB, params ListParams) (*ObjectsResult, error) {
	return listMasterObjects(ctx, db, params, []string{"table", "view"})
}

// ListIndexes 列出用户索引（不含自动 PRIMARY KEY 内部名时可仍展示；对齐 DBeaver 索引节点）。
func ListIndexes(ctx context.Context, db *sql.DB, params ListParams) (*ObjectsResult, error) {
	return listMasterObjects(ctx, db, params, []string{"index"})
}

// ListTriggers 列出触发器。
func ListTriggers(ctx context.Context, db *sql.DB, params ListParams) (*ObjectsResult, error) {
	return listMasterObjects(ctx, db, params, []string{"trigger"})
}

func listMasterObjects(ctx context.Context, db *sql.DB, params ListParams, wantTypes []string) (*ObjectsResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: tree: nil db")
	}
	schema := schemaOrMain(params.Schema)
	if !isSafeSchema(schema) {
		return nil, fmt.Errorf("sqlite: tree: invalid schema")
	}
	limit := normalizeLimit(params.Limit)
	prefix := likePrefix(params.Filter)

	typeSet := make(map[string]struct{}, len(wantTypes))
	for _, t := range wantTypes {
		typeSet[strings.ToLower(t)] = struct{}{}
	}
	if len(params.Types) > 0 {
		typeSet = make(map[string]struct{}, len(params.Types))
		for _, t := range params.Types {
			typeSet[strings.ToLower(strings.TrimSpace(t))] = struct{}{}
		}
	}
	if len(typeSet) == 0 {
		typeSet["table"] = struct{}{}
		typeSet["view"] = struct{}{}
	}

	// schema.sqlite_master；temp 用 sqlite_temp_master。
	master := quoteIdent(schema) + ".sqlite_master"
	if strings.EqualFold(schema, "temp") {
		master = "sqlite_temp_master"
	}

	query := fmt.Sprintf(`
SELECT name, type, tbl_name
FROM %s
WHERE name IS NOT NULL AND name != ''
ORDER BY type, name COLLATE NOCASE`, master)

	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("sqlite: tree: list: %w", err)
	}
	defer rows.Close()

	out := make([]ObjectInfo, 0, 32)
	truncated := false
	for rows.Next() {
		var name, typ, tbl sql.NullString
		if err := rows.Scan(&name, &typ, &tbl); err != nil {
			return nil, err
		}
		n := strings.TrimSpace(name.String)
		t := strings.ToLower(strings.TrimSpace(typ.String))
		if n == "" || t == "" {
			continue
		}
		if _, ok := typeSet[t]; !ok {
			continue
		}
		if params.ExcludeSystem && IsSystemObject(n) {
			continue
		}
		if prefix != "" {
			// 简单前缀（大小写不敏感）
			if !strings.HasPrefix(strings.ToLower(n), strings.ToLower(strings.TrimSuffix(prefix, "%"))) {
				continue
			}
		}
		if len(out) >= limit {
			truncated = true
			break
		}
		obj := ObjectInfo{Name: n, Type: t, Schema: schema}
		if t == "index" || t == "trigger" {
			obj.Table = strings.TrimSpace(tbl.String)
		}
		out = append(out, obj)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	res := &ObjectsResult{Objects: out, Truncated: truncated}
	// 兼容 tables 字段：仅 table/view 时填充。
	if _, hasTable := typeSet["table"]; hasTable || typeSetHasView(typeSet) {
		res.Tables = out
	}
	return res, nil
}

func typeSetHasView(m map[string]struct{}) bool {
	_, ok := m["view"]
	return ok
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}
