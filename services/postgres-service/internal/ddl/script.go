// Package ddl 提供受控 DDL 脚本生成与执行（截断 / 删除 / 新建模板）。
//
// 变更不走自由 SQL 全文：仅白名单 action → 拼装标识符安全的语句，
// 避免连接树右键把任意字符串送进执行器。
package ddl

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	ActionTruncateTable       = "truncate_table"
	ActionDropTable           = "drop_table"
	ActionDropView            = "drop_view"
	ActionDropFunction        = "drop_function"
	ActionDropProcedure       = "drop_procedure"
	ActionCreateTable         = "create_table"
	ActionCreateView          = "create_view"
	ActionCreateFunction      = "create_function"
	ActionCreateProcedure     = "create_procedure"
	ActionRenameTable         = "rename_table"
	ActionRenameView          = "rename_view"
	ActionRenameFunction      = "rename_function"
	ActionRenameProcedure     = "rename_procedure"
	ActionCreateDatabase      = "create_database"
	ActionRenameDatabase      = "rename_database"
	ActionDropDatabase        = "drop_database"
	ActionCreateSchema        = "create_schema"
	ActionRenameSchema        = "rename_schema"
	ActionDropSchema          = "drop_schema"
	ActionAlterDatabaseOwner  = "alter_database_owner"
	ActionAlterSchemaOwner    = "alter_schema_owner"
	ActionAlterFunctionOwner  = "alter_function_owner"
	ActionAlterProcedureOwner = "alter_procedure_owner"
)

// templateDatabaseName 是维护库候选耗尽时的最后回退（几乎所有 PG 线实例都有）。
const templateDatabaseName = "template1"

// maintenanceDatabaseFallbacks 是官方 PostgreSQL 维护库候选（按优先级）。
var maintenanceDatabaseFallbacks = []string{"postgres", templateDatabaseName}

// ScriptParams 是 ddl.script 入参。
type ScriptParams struct {
	Action string `json:"action"`
	Schema string `json:"schema"`
	Name   string `json:"name"`
	// Args 为例程 identity arguments（无外层括号），可与 Name 组合精确 DROP。
	Args string `json:"args,omitempty"`
	// OID 优先：按 OID::regprocedure 删除 / 重命名重载例程。
	OID uint32 `json:"oid,omitempty"`
	// NewName 用于 rename_* 动作。
	NewName string `json:"newName,omitempty"`
	// 库级 create_database 可选参数。
	Owner           string `json:"owner,omitempty"`
	Encoding        string `json:"encoding,omitempty"`
	Template        string `json:"template,omitempty"`
	LCCollate       string `json:"lcCollate,omitempty"`
	LCCtype         string `json:"lcCtype,omitempty"`
	Tablespace      string `json:"tablespace,omitempty"`
	ConnectionLimit *int   `json:"connectionLimit,omitempty"`
	// Capabilities 会话方言能力（缺省则按产品默认 PostgreSQL Cap）。
	Capabilities []string `json:"capabilities,omitempty"`
	// Table 触发器所属表。
	Table string `json:"table,omitempty"`
	// Privileges / Grantee 用于 grant / revoke。
	Privileges  []string `json:"privileges,omitempty"`
	Grantee     string   `json:"grantee,omitempty"`
	GrantOption bool     `json:"grantOption,omitempty"`
	ObjectKind  string   `json:"objectKind,omitempty"`
	Concurrently bool    `json:"concurrently,omitempty"`
}

// ScriptResult 是 ddl.script 返回。
type ScriptResult struct {
	Action  string `json:"action"`
	SQL     string `json:"sql"`
	Danger  bool   `json:"danger,omitempty"`
	Summary string `json:"summary,omitempty"`
}

// ExecParams 是 ddl.exec 入参。
type ExecParams struct {
	Action    string `json:"action"`
	Schema    string `json:"schema"`
	Name      string `json:"name"`
	Args      string `json:"args,omitempty"`
	OID       uint32 `json:"oid,omitempty"`
	NewName   string `json:"newName,omitempty"`
	Owner           string `json:"owner,omitempty"`
	Encoding        string `json:"encoding,omitempty"`
	Template        string `json:"template,omitempty"`
	LCCollate       string `json:"lcCollate,omitempty"`
	LCCtype         string `json:"lcCtype,omitempty"`
	Tablespace      string `json:"tablespace,omitempty"`
	ConnectionLimit *int   `json:"connectionLimit,omitempty"`
	Table        string   `json:"table,omitempty"`
	Privileges   []string `json:"privileges,omitempty"`
	Grantee      string   `json:"grantee,omitempty"`
	GrantOption  bool     `json:"grantOption,omitempty"`
	ObjectKind   string   `json:"objectKind,omitempty"`
	Concurrently bool     `json:"concurrently,omitempty"`
}

// ExecResult 是 ddl.exec 返回。
type ExecResult struct {
	Action     string `json:"action"`
	CommandTag string `json:"commandTag,omitempty"`
	DurationMS int64  `json:"durationMs"`
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func qualified(schema, name string) string {
	return quoteIdent(schema) + "." + quoteIdent(name)
}

func requireSchemaName(schema, name string) error {
	if strings.TrimSpace(schema) == "" || strings.TrimSpace(name) == "" {
		return fmt.Errorf("postgres: schema and name required")
	}
	return nil
}

func requireNewName(newName string) error {
	if strings.TrimSpace(newName) == "" {
		return fmt.Errorf("postgres: newName required")
	}
	return nil
}

func requireDatabaseName(name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return fmt.Errorf("postgres: database name required")
	}
	if strings.Contains(name, "\x00") {
		return fmt.Errorf("postgres: invalid database name")
	}
	return nil
}

func isProtectedDatabase(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "postgres", "template0", "template1":
		return true
	default:
		return false
	}
}

// IsProtectedSchema 表示系统 schema，禁止重命名 / 删除。
func IsProtectedSchema(name string) bool {
	n := strings.ToLower(strings.TrimSpace(name))
	switch n {
	case "information_schema", "pg_catalog":
		return true
	}
	return strings.HasPrefix(n, "pg_")
}

// IsSchemaAction 表示 schema 级 DDL（在目标库连接上执行）。
func IsSchemaAction(action string) bool {
	switch strings.TrimSpace(action) {
	case ActionCreateSchema, ActionRenameSchema, ActionDropSchema, ActionAlterSchemaOwner:
		return true
	default:
		return false
	}
}

// IsDatabaseAction 表示库级 DDL（须在维护库连接上执行）。
func IsDatabaseAction(action string) bool {
	switch strings.TrimSpace(action) {
	case ActionCreateDatabase, ActionRenameDatabase, ActionDropDatabase, ActionAlterDatabaseOwner:
		return true
	default:
		return false
	}
}

// MaintenanceDatabaseCandidates 返回执行库级 DDL 时应尝试连接的数据库名列表。
// 不能连到被操作库本身；preferred 为会话/连接配置中的初始库（可空）。
func MaintenanceDatabaseCandidates(targetDatabase, preferred string) []string {
	target := strings.TrimSpace(targetDatabase)
	seen := make(map[string]struct{}, 8)
	out := make([]string, 0, 8)
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		// template0 通常拒绝普通连接，不作维护库。
		if strings.EqualFold(name, "template0") {
			return
		}
		if target != "" && strings.EqualFold(name, target) {
			return
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	add(preferred)
	for _, fb := range maintenanceDatabaseFallbacks {
		add(fb)
	}
	return out
}

// MaintenanceDatabase 返回执行库级 DDL 时应连接的首选数据库名。
func MaintenanceDatabase(targetDatabase, preferred string) string {
	cands := MaintenanceDatabaseCandidates(targetDatabase, preferred)
	if len(cands) == 0 {
		return templateDatabaseName
	}
	return cands[0]
}

func buildRenameRoutineSQL(kind, schema, name, args, newName string, oid uint32) (string, error) {
	if err := requireNewName(newName); err != nil {
		return "", err
	}
	target := ""
	if oid > 0 {
		target = fmt.Sprintf("%d::regprocedure", oid)
	} else {
		if err := requireSchemaName(schema, name); err != nil {
			return "", err
		}
		target = qualified(schema, name)
		if strings.TrimSpace(args) != "" {
			target += "(" + args + ")"
		}
	}
	return fmt.Sprintf("ALTER %s %s RENAME TO %s", kind, target, quoteIdent(newName)), nil
}

var allowedDatabaseEncodings = map[string]struct{}{
	"UTF8":      {},
	"LATIN1":    {},
	"SQL_ASCII": {},
	"GBK":       {},
	"GB18030":   {},
	"EUC_CN":    {},
	"EUC_JP":    {},
	"EUC_KR":    {},
	"EUC_TW":    {},
	"WIN1252":   {},
	"WIN936":    {},
}

func isSafeDatabaseLiteral(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" {
		return false
	}
	for _, r := range value {
		if r == '\'' || r == '\x00' {
			return false
		}
	}
	return true
}

func isSafeDatabaseIdent(name string) bool {
	name = strings.TrimSpace(name)
	if name == "" {
		return false
	}
	return !strings.Contains(name, `"`)
}

func isDefaultCreateOption(value string) bool {
	v := strings.TrimSpace(value)
	return v == "" || strings.EqualFold(v, "DEFAULT") || v == "__default__"
}

func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func buildCreateDatabaseSQL(name string, params ScriptParams) (string, error) {
	if err := requireDatabaseName(name); err != nil {
		return "", err
	}
	clauses := make([]string, 0, 7)

	// 省略 OWNER 即默认当前用户（与 OWNER CURRENT_USER 等价，且避免无 CREATEROLE 时的歧义）。
	owner := strings.TrimSpace(params.Owner)
	if owner != "" && !strings.EqualFold(owner, "CURRENT_USER") {
		if !isSafeDatabaseIdent(owner) {
			return "", fmt.Errorf("postgres: invalid database owner %q", owner)
		}
		clauses = append(clauses, "OWNER = "+quoteIdent(owner))
	}

	encoding := strings.ToUpper(strings.TrimSpace(params.Encoding))
	if encoding != "" {
		if _, ok := allowedDatabaseEncodings[encoding]; !ok {
			if !isSafeDatabaseLiteral(encoding) {
				return "", fmt.Errorf("postgres: unsupported database encoding %q", encoding)
			}
		}
		clauses = append(clauses, "ENCODING = "+quoteLiteral(encoding))
	}

	// DBeaver：空模板省略 TEMPLATE，允许任意已有库作为克隆源。
	if template := strings.TrimSpace(params.Template); !isDefaultCreateOption(template) {
		if !isSafeDatabaseIdent(template) {
			return "", fmt.Errorf("postgres: unsupported database template %q", template)
		}
		clauses = append(clauses, "TEMPLATE = "+quoteIdent(template))
	}

	if lc := strings.TrimSpace(params.LCCollate); lc != "" && !isDefaultCreateOption(lc) {
		if !isSafeDatabaseLiteral(lc) {
			return "", fmt.Errorf("postgres: invalid lcCollate")
		}
		clauses = append(clauses, "LC_COLLATE = "+quoteLiteral(lc))
	}
	if lc := strings.TrimSpace(params.LCCtype); lc != "" && !isDefaultCreateOption(lc) {
		if !isSafeDatabaseLiteral(lc) {
			return "", fmt.Errorf("postgres: invalid lcCtype")
		}
		clauses = append(clauses, "LC_CTYPE = "+quoteLiteral(lc))
	}

	// DBeaver：Default 省略 TABLESPACE（RDS 等不能写 TABLESPACE pg_default）。
	if ts := strings.TrimSpace(params.Tablespace); !isDefaultCreateOption(ts) {
		if !isSafeDatabaseIdent(ts) {
			return "", fmt.Errorf("postgres: invalid tablespace %q", ts)
		}
		clauses = append(clauses, "TABLESPACE = "+quoteIdent(ts))
	}

	if params.ConnectionLimit != nil && *params.ConnectionLimit >= 0 {
		clauses = append(clauses, fmt.Sprintf("CONNECTION LIMIT = %d", *params.ConnectionLimit))
	}

	sql := "CREATE DATABASE " + quoteIdent(strings.TrimSpace(name))
	if len(clauses) > 0 {
		sql += "\n  WITH " + strings.Join(clauses, "\n       ")
	}
	return sql, nil
}

func buildOwnerClause(owner string) (string, error) {
	owner = strings.TrimSpace(owner)
	if owner == "" || strings.EqualFold(owner, "CURRENT_USER") {
		return "CURRENT_USER", nil
	}
	if !isSafeDatabaseIdent(owner) {
		return "", fmt.Errorf("postgres: invalid owner %q", owner)
	}
	return quoteIdent(owner), nil
}

func buildDropRoutineSQL(kind, schema, name, args string, oid uint32) (string, error) {
	if oid > 0 {
		// 按 OID 精确定位重载：CAST 为 regprocedure / 适用 FUNCTION&PROCEDURE。
		return fmt.Sprintf("DROP %s IF EXISTS %d::regprocedure CASCADE", kind, oid), nil
	}
	if err := requireSchemaName(schema, name); err != nil {
		return "", err
	}
	target := qualified(schema, name)
	if strings.TrimSpace(args) != "" {
		target += "(" + args + ")"
	}
	return fmt.Sprintf("DROP %s IF EXISTS %s CASCADE", kind, target), nil
}

func buildAlterRoutineOwnerSQL(kind, schema, name, args, owner string, oid uint32) (string, error) {
	ownerSQL, err := buildOwnerClause(owner)
	if err != nil {
		return "", err
	}
	target := ""
	if oid > 0 {
		target = fmt.Sprintf("%d::regprocedure", oid)
	} else {
		if err := requireSchemaName(schema, name); err != nil {
			return "", err
		}
		target = qualified(schema, name)
		if strings.TrimSpace(args) != "" {
			target += "(" + args + ")"
		}
	}
	return fmt.Sprintf("ALTER %s %s OWNER TO %s", kind, target, ownerSQL), nil
}

// BuildScript 按白名单 action 生成 SQL（只读预览 / 新建模板）。
func BuildScript(params ScriptParams) (*ScriptResult, error) {
	action := strings.TrimSpace(params.Action)
	schema := strings.TrimSpace(params.Schema)
	name := strings.TrimSpace(params.Name)
	if name == "" {
		name = "new_object"
	}
	if schema == "" {
		schema = "public"
	}

	switch action {
	case ActionTruncateTable:
		if err := requireSchemaName(schema, name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "TRUNCATE TABLE " + qualified(schema, name),
			Danger:  true,
			Summary: "truncate table",
		}, nil
	case ActionDropTable:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "DROP TABLE IF EXISTS " + qualified(schema, name) + " CASCADE",
			Danger:  true,
			Summary: "drop table",
		}, nil
	case ActionDropView:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "DROP VIEW IF EXISTS " + qualified(schema, name) + " CASCADE",
			Danger:  true,
			Summary: "drop view",
		}, nil
	case ActionDropFunction:
		sql, err := buildDropRoutineSQL("FUNCTION", schema, name, params.Args, params.OID)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "drop function"}, nil
	case ActionDropProcedure:
		sql, err := buildDropRoutineSQL("PROCEDURE", schema, name, params.Args, params.OID)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "drop procedure"}, nil
	case ActionCreateTable:
		qn := qualified(schema, name)
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE TABLE %s (
  id BIGINT PRIMARY KEY,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
)`, qn),
			Summary: "create table template",
		}, nil
	case ActionCreateView:
		qn := qualified(schema, name)
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE OR REPLACE VIEW %s AS
SELECT 1 AS col`, qn),
			Summary: "create view template",
		}, nil
	case ActionCreateFunction:
		qn := qualified(schema, name)
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE OR REPLACE FUNCTION %s(
  -- p_arg1 integer
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY INVOKER
AS $$
BEGIN
  -- TODO: implement
  RETURN 1;
END;
$$;`, qn),
			Summary: "create function template",
		}, nil
	case ActionCreateProcedure:
		qn := qualified(schema, name)
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE OR REPLACE PROCEDURE %s(
  -- IN p_arg1 integer
)
LANGUAGE plpgsql
SECURITY INVOKER
AS $$
BEGIN
  -- TODO: implement
  NULL;
END;
$$;`, qn),
			Summary: "create procedure template (plpgsql)",
		}, nil
	case ActionRenameTable:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		if err := requireNewName(params.NewName); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER TABLE %s RENAME TO %s",
				qualified(schema, name),
				quoteIdent(strings.TrimSpace(params.NewName)),
			),
			Danger:  true,
			Summary: "rename table",
		}, nil
	case ActionRenameView:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		if err := requireNewName(params.NewName); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER VIEW %s RENAME TO %s",
				qualified(schema, name),
				quoteIdent(strings.TrimSpace(params.NewName)),
			),
			Danger:  true,
			Summary: "rename view",
		}, nil
	case ActionRenameFunction:
		sql, err := buildRenameRoutineSQL("FUNCTION", schema, name, params.Args, params.NewName, params.OID)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "rename function"}, nil
	case ActionRenameProcedure:
		sql, err := buildRenameRoutineSQL("PROCEDURE", schema, name, params.Args, params.NewName, params.OID)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "rename procedure"}, nil
	case ActionCreateDatabase:
		sql, err := buildCreateDatabaseSQL(name, params)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     sql,
			Summary: "create database",
		}, nil
	case ActionRenameDatabase:
		if err := requireDatabaseName(params.Name); err != nil {
			return nil, err
		}
		if isProtectedDatabase(params.Name) {
			return nil, fmt.Errorf("postgres: cannot rename protected database %q", params.Name)
		}
		if err := requireNewName(params.NewName); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER DATABASE %s RENAME TO %s",
				quoteIdent(strings.TrimSpace(params.Name)),
				quoteIdent(strings.TrimSpace(params.NewName)),
			),
			Danger:  true,
			Summary: "rename database",
		}, nil
	case ActionDropDatabase:
		if err := requireDatabaseName(params.Name); err != nil {
			return nil, err
		}
		if isProtectedDatabase(params.Name) {
			return nil, fmt.Errorf("postgres: cannot drop protected database %q", params.Name)
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "DROP DATABASE IF EXISTS " + quoteIdent(strings.TrimSpace(params.Name)),
			Danger:  true,
			Summary: "drop database",
		}, nil
	case ActionCreateSchema:
		if err := requireDatabaseName(name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "CREATE SCHEMA " + quoteIdent(strings.TrimSpace(name)),
			Summary: "create schema",
		}, nil
	case ActionRenameSchema:
		if err := requireDatabaseName(params.Name); err != nil {
			return nil, err
		}
		if IsProtectedSchema(params.Name) {
			return nil, fmt.Errorf("postgres: cannot rename protected schema %q", params.Name)
		}
		if err := requireNewName(params.NewName); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER SCHEMA %s RENAME TO %s",
				quoteIdent(strings.TrimSpace(params.Name)),
				quoteIdent(strings.TrimSpace(params.NewName)),
			),
			Danger:  true,
			Summary: "rename schema",
		}, nil
	case ActionDropSchema:
		if err := requireDatabaseName(params.Name); err != nil {
			return nil, err
		}
		if IsProtectedSchema(params.Name) {
			return nil, fmt.Errorf("postgres: cannot drop protected schema %q", params.Name)
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "DROP SCHEMA IF EXISTS " + quoteIdent(strings.TrimSpace(params.Name)) + " CASCADE",
			Danger:  true,
			Summary: "drop schema",
		}, nil
	case ActionAlterDatabaseOwner:
		if err := requireDatabaseName(params.Name); err != nil {
			return nil, err
		}
		ownerSQL, err := buildOwnerClause(params.Owner)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER DATABASE %s OWNER TO %s",
				quoteIdent(strings.TrimSpace(params.Name)),
				ownerSQL,
			),
			Danger:  true,
			Summary: "alter database owner",
		}, nil
	case ActionAlterSchemaOwner:
		if err := requireDatabaseName(params.Name); err != nil {
			return nil, err
		}
		if IsProtectedSchema(params.Name) {
			return nil, fmt.Errorf("postgres: cannot alter owner of protected schema %q", params.Name)
		}
		ownerSQL, err := buildOwnerClause(params.Owner)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER SCHEMA %s OWNER TO %s",
				quoteIdent(strings.TrimSpace(params.Name)),
				ownerSQL,
			),
			Danger:  true,
			Summary: "alter schema owner",
		}, nil
	case ActionAlterFunctionOwner:
		sql, err := buildAlterRoutineOwnerSQL("FUNCTION", schema, name, params.Args, params.Owner, params.OID)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "alter function owner"}, nil
	case ActionAlterProcedureOwner:
		sql, err := buildAlterRoutineOwnerSQL("PROCEDURE", schema, name, params.Args, params.Owner, params.OID)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "alter procedure owner"}, nil
	case ActionGrant:
		sql, err := buildGrantSQL(params)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "grant"}, nil
	case ActionRevoke:
		sql, err := buildRevokeSQL(params)
		if err != nil {
			return nil, err
		}
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "revoke"}, nil
	case ActionVacuumTable:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "VACUUM ANALYZE " + qualified(schema, name),
			Danger:  true,
			Summary: "vacuum analyze",
		}, nil
	case ActionAnalyzeTable:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "ANALYZE " + qualified(schema, name),
			Danger:  true,
			Summary: "analyze",
		}, nil
	case ActionRefreshMatView:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		sql := "REFRESH MATERIALIZED VIEW "
		if params.Concurrently {
			sql += "CONCURRENTLY "
		}
		sql += qualified(schema, name)
		return &ScriptResult{Action: action, SQL: sql, Danger: true, Summary: "refresh materialized view"}, nil
	case ActionDropMatView:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action:  action,
			SQL:     "DROP MATERIALIZED VIEW IF EXISTS " + qualified(schema, name) + " CASCADE",
			Danger:  true,
			Summary: "drop materialized view",
		}, nil
	case ActionRenameMatView:
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		if err := requireNewName(params.NewName); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"ALTER MATERIALIZED VIEW %s RENAME TO %s",
				qualified(schema, name),
				quoteIdent(strings.TrimSpace(params.NewName)),
			),
			Danger:  true,
			Summary: "rename materialized view",
		}, nil
	case ActionDropTrigger:
		table := strings.TrimSpace(params.Table)
		if table == "" {
			return nil, fmt.Errorf("postgres: trigger table required")
		}
		if err := requireSchemaName(schema, params.Name); err != nil {
			return nil, err
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(
				"DROP TRIGGER IF EXISTS %s ON %s",
				quoteIdent(name),
				qualified(schema, table),
			),
			Danger:  true,
			Summary: "drop trigger",
		}, nil
	case ActionCreateTrigger:
		table := strings.TrimSpace(params.Table)
		if table == "" {
			table = "target_table"
		}
		on := qualified(schema, table)
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE TRIGGER %s
  AFTER INSERT OR UPDATE OR DELETE
  ON %s
  FOR EACH ROW
  EXECUTE PROCEDURE %s()`, quoteIdent(name), on, qualified(schema, "trigger_fn")),
			Summary: "create trigger template",
		}, nil
	case ActionCreateMatView:
		qn := qualified(schema, name)
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE MATERIALIZED VIEW %s AS
SELECT 1 AS col
WITH DATA`, qn),
			Summary: "create materialized view template",
		}, nil
	default:
		return nil, fmt.Errorf("postgres: unsupported ddl action %q", action)
	}
}

// Exec 执行白名单 DDL（危险操作与 create_database）。
func Exec(ctx context.Context, pool *pgxpool.Pool, params ExecParams) (*ExecResult, error) {
	script, err := BuildScript(ScriptParams{
		Action:          params.Action,
		Schema:          params.Schema,
		Name:            params.Name,
		Args:            params.Args,
		OID:             params.OID,
		NewName:         params.NewName,
		Owner:           params.Owner,
		Encoding:        params.Encoding,
		Template:        params.Template,
		LCCollate:       params.LCCollate,
		LCCtype:         params.LCCtype,
		Tablespace:      params.Tablespace,
		ConnectionLimit: params.ConnectionLimit,
		Table:           params.Table,
		Privileges:      params.Privileges,
		Grantee:         params.Grantee,
		GrantOption:     params.GrantOption,
		ObjectKind:      params.ObjectKind,
		Concurrently:    params.Concurrently,
	})
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(params.Action) == ActionCreateDatabase && isProtectedDatabase(params.Name) {
		return nil, fmt.Errorf("postgres: cannot create protected database %q", strings.TrimSpace(params.Name))
	}
	if !script.Danger && strings.TrimSpace(params.Action) != ActionCreateDatabase && strings.TrimSpace(params.Action) != ActionCreateSchema {
		return nil, fmt.Errorf("postgres: action %q is not executable via ddl.exec; open query instead", params.Action)
	}

	start := time.Now()
	tag, err := pool.Exec(ctx, script.SQL)
	if err != nil {
		return nil, fmt.Errorf("postgres: ddl exec: %w", err)
	}
	return &ExecResult{
		Action:     params.Action,
		CommandTag: tag.String(),
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
