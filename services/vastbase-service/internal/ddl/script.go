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

	"niuma/services/vastbase-service/internal/dialect"
)

const (
	ActionTruncateTable   = "truncate_table"
	ActionDropTable       = "drop_table"
	ActionDropView        = "drop_view"
	ActionDropFunction    = "drop_function"
	ActionDropProcedure   = "drop_procedure"
	ActionCreateTable     = "create_table"
	ActionCreateView      = "create_view"
	ActionCreateFunction  = "create_function"
	ActionCreateProcedure = "create_procedure"
	ActionRenameTable     = "rename_table"
	ActionRenameView      = "rename_view"
	ActionRenameFunction  = "rename_function"
	ActionRenameProcedure = "rename_procedure"
	ActionCreateDatabase  = "create_database"
	ActionRenameDatabase  = "rename_database"
	ActionDropDatabase    = "drop_database"
	ActionCreateSchema    = "create_schema"
	ActionRenameSchema    = "rename_schema"
	ActionDropSchema      = "drop_schema"
	ActionAlterDatabaseOwner  = "alter_database_owner"
	ActionAlterSchemaOwner    = "alter_schema_owner"
	ActionAlterFunctionOwner  = "alter_function_owner"
	ActionAlterProcedureOwner = "alter_procedure_owner"
)

// maintenanceDatabaseName 是执行库级 DDL 时使用的维护库（不能连到被操作库本身）。
const maintenanceDatabaseName = "postgres"

// templateDatabaseName 是维护库本身被操作时的回退连接库。
const templateDatabaseName = "template1"

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
	Owner     string `json:"owner,omitempty"`
	Encoding  string `json:"encoding,omitempty"`
	Template  string `json:"template,omitempty"`
	LCCollate string `json:"lcCollate,omitempty"`
	LCCtype   string `json:"lcCtype,omitempty"`
	// Capabilities 会话方言能力（缺省则按 DefaultVastbase）。
	Capabilities []string `json:"capabilities,omitempty"`
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
	Action  string `json:"action"`
	Schema  string `json:"schema"`
	Name    string `json:"name"`
	Args    string `json:"args,omitempty"`
	OID     uint32 `json:"oid,omitempty"`
	NewName string `json:"newName,omitempty"`
	Owner     string `json:"owner,omitempty"`
	Encoding  string `json:"encoding,omitempty"`
	Template  string `json:"template,omitempty"`
	LCCollate string `json:"lcCollate,omitempty"`
	LCCtype   string `json:"lcCtype,omitempty"`
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
		return fmt.Errorf("vastbase: schema and name required")
	}
	return nil
}

func requireNewName(newName string) error {
	if strings.TrimSpace(newName) == "" {
		return fmt.Errorf("vastbase: newName required")
	}
	return nil
}

func requireDatabaseName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("vastbase: database name required")
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
	if n == "information_schema" || n == "pg_catalog" {
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

// MaintenanceDatabase 返回执行库级 DDL 时应连接的数据库名。
func MaintenanceDatabase(targetDatabase string) string {
	if strings.EqualFold(strings.TrimSpace(targetDatabase), maintenanceDatabaseName) {
		return templateDatabaseName
	}
	return maintenanceDatabaseName
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

var allowedDatabaseTemplates = map[string]struct{}{
	"template0": {},
	"template1": {},
}

func quoteLiteral(value string) string {
	return "'" + strings.ReplaceAll(value, "'", "''") + "'"
}

func buildCreateDatabaseSQL(name string, params ScriptParams) (string, error) {
	if err := requireDatabaseName(name); err != nil {
		return "", err
	}
	clauses := make([]string, 0, 5)

	owner := strings.TrimSpace(params.Owner)
	if owner == "" || strings.EqualFold(owner, "CURRENT_USER") {
		clauses = append(clauses, "OWNER = CURRENT_USER")
	} else {
		if !isSafeDatabaseIdent(owner) {
			return "", fmt.Errorf("vastbase: invalid database owner %q", owner)
		}
		clauses = append(clauses, "OWNER = "+quoteIdent(owner))
	}

	encoding := strings.ToUpper(strings.TrimSpace(params.Encoding))
	if encoding == "" {
		encoding = "UTF8"
	}
	if _, ok := allowedDatabaseEncodings[encoding]; !ok {
		if !isSafeDatabaseLiteral(encoding) {
			return "", fmt.Errorf("vastbase: unsupported database encoding %q", encoding)
		}
	}
	clauses = append(clauses, "ENCODING = "+quoteLiteral(encoding))

	template := strings.TrimSpace(params.Template)
	if template == "" {
		template = "template0"
	}
	if _, ok := allowedDatabaseTemplates[template]; !ok {
		if !isSafeDatabaseIdent(template) {
			return "", fmt.Errorf("vastbase: unsupported database template %q", template)
		}
	}
	clauses = append(clauses, "TEMPLATE = "+quoteIdent(template))

	if lc := strings.TrimSpace(params.LCCollate); lc != "" {
		if !isSafeDatabaseLiteral(lc) {
			return "", fmt.Errorf("vastbase: invalid lcCollate")
		}
		clauses = append(clauses, "LC_COLLATE = "+quoteLiteral(lc))
	}
	if lc := strings.TrimSpace(params.LCCtype); lc != "" {
		if !isSafeDatabaseLiteral(lc) {
			return "", fmt.Errorf("vastbase: invalid lcCtype")
		}
		clauses = append(clauses, "LC_CTYPE = "+quoteLiteral(lc))
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
		return "", fmt.Errorf("vastbase: invalid owner %q", owner)
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
		profile := scriptProfile(params.Capabilities)
		if dialect.Has(profile, dialect.CapFuncPlpgsqlDollar) {
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
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE OR REPLACE FUNCTION %s(
  -- p_arg1 integer
)
RETURN integer
AS
BEGIN
  RETURN 1;
END;
/`, qn),
			Summary: "create function template (plsql)",
		}, nil
	case ActionCreateProcedure:
		qn := qualified(schema, name)
		profile := scriptProfile(params.Capabilities)
		if dialect.Has(profile, dialect.CapProcPlpgsqlDollar) && !dialect.Has(profile, dialect.CapProcPlsqlBare) {
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
		}
		// 默认 / CapProcPlsqlBare：Navicat·Data Studio 对齐的 PL/SQL 过程
		slash := ""
		if dialect.Has(profile, dialect.CapScriptOracleSlash) {
			slash = "\n/"
		}
		return &ScriptResult{
			Action: action,
			SQL: fmt.Sprintf(`CREATE OR REPLACE PROCEDURE %s(
  -- p_arg1 IN integer
)
SECURITY INVOKER
AS
BEGIN
  -- TODO: implement
  NULL;
END;%s`, qn, slash),
			Summary: "create procedure template",
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
			return nil, fmt.Errorf("vastbase: cannot rename protected database %q", params.Name)
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
			return nil, fmt.Errorf("vastbase: cannot drop protected database %q", params.Name)
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
			return nil, fmt.Errorf("vastbase: cannot rename protected schema %q", params.Name)
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
			return nil, fmt.Errorf("vastbase: cannot drop protected schema %q", params.Name)
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
			return nil, fmt.Errorf("vastbase: cannot alter owner of protected schema %q", params.Name)
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
	default:
		return nil, fmt.Errorf("vastbase: unsupported ddl action %q", action)
	}
}

func scriptProfile(caps []string) *dialect.ServerProfile {
	if len(caps) == 0 {
		p := dialect.DefaultVastbase()
		return &p
	}
	return &dialect.ServerProfile{
		Family:       dialect.FamilyVastbase,
		Capabilities: append([]string(nil), caps...),
	}
}

// Exec 执行白名单 DDL（危险操作与 create_database）。
func Exec(ctx context.Context, pool *pgxpool.Pool, params ExecParams) (*ExecResult, error) {
	script, err := BuildScript(ScriptParams{
		Action:    params.Action,
		Schema:    params.Schema,
		Name:      params.Name,
		Args:      params.Args,
		OID:       params.OID,
		NewName:   params.NewName,
		Owner:     params.Owner,
		Encoding:  params.Encoding,
		Template:  params.Template,
		LCCollate: params.LCCollate,
		LCCtype:   params.LCCtype,
	})
	if err != nil {
		return nil, err
	}
	if !script.Danger && strings.TrimSpace(params.Action) != ActionCreateDatabase && strings.TrimSpace(params.Action) != ActionCreateSchema {
		return nil, fmt.Errorf("vastbase: action %q is not executable via ddl.exec; open query instead", params.Action)
	}

	start := time.Now()
	tag, err := pool.Exec(ctx, script.SQL)
	if err != nil {
		return nil, fmt.Errorf("vastbase: ddl exec: %w", err)
	}
	return &ExecResult{
		Action:     params.Action,
		CommandTag: tag.String(),
		DurationMS: time.Since(start).Milliseconds(),
	}, nil
}
