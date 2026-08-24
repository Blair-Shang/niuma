package ddl

import (
	"fmt"
	"strings"
)

const (
	ActionGrant           = "grant"
	ActionRevoke          = "revoke"
	ActionVacuumTable     = "vacuum_table"
	ActionAnalyzeTable    = "analyze_table"
	ActionRefreshMatView  = "refresh_matview"
	ActionDropMatView     = "drop_matview"
	ActionRenameMatView   = "rename_matview"
	ActionDropTrigger     = "drop_trigger"
	ActionCreateTrigger   = "create_trigger"
	ActionCreateMatView   = "create_matview"
)

var grantPrivilegesByKind = map[string]map[string]struct{}{
	"table":              {"SELECT": {}, "INSERT": {}, "UPDATE": {}, "DELETE": {}, "TRUNCATE": {}, "REFERENCES": {}, "TRIGGER": {}, "ALL": {}},
	"view":               {"SELECT": {}, "INSERT": {}, "UPDATE": {}, "DELETE": {}, "TRUNCATE": {}, "REFERENCES": {}, "TRIGGER": {}, "ALL": {}},
	"materialized_view":  {"SELECT": {}, "INSERT": {}, "UPDATE": {}, "DELETE": {}, "TRUNCATE": {}, "REFERENCES": {}, "TRIGGER": {}, "ALL": {}},
	"foreign_table":      {"SELECT": {}, "INSERT": {}, "UPDATE": {}, "DELETE": {}, "TRUNCATE": {}, "REFERENCES": {}, "TRIGGER": {}, "ALL": {}},
	"sequence":           {"USAGE": {}, "SELECT": {}, "UPDATE": {}, "ALL": {}},
	"schema":             {"USAGE": {}, "CREATE": {}, "ALL": {}},
	"function":           {"EXECUTE": {}, "ALL": {}},
	"procedure":          {"EXECUTE": {}, "ALL": {}},
	"database":           {"CONNECT": {}, "CREATE": {}, "TEMPORARY": {}, "TEMP": {}, "ALL": {}},
}

func normalizeObjectKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "view":
		return "view"
	case "materialized_view", "matview":
		return "materialized_view"
	case "foreign_table":
		return "foreign_table"
	case "sequence":
		return "sequence"
	case "schema":
		return "schema"
	case "function":
		return "function"
	case "procedure":
		return "procedure"
	case "database":
		return "database"
	default:
		return "table"
	}
}

func grantTargetSQL(kind, schema, name, args string, oid uint32) (string, error) {
	switch kind {
	case "schema":
		if strings.TrimSpace(name) == "" {
			return "", fmt.Errorf("postgres: schema name required")
		}
		return "SCHEMA " + quoteIdent(name), nil
	case "database":
		if err := requireDatabaseName(name); err != nil {
			return "", err
		}
		return "DATABASE " + quoteIdent(name), nil
	case "function", "procedure":
		kw := "FUNCTION"
		if kind == "procedure" {
			kw = "PROCEDURE"
		}
		if oid > 0 {
			return fmt.Sprintf("%s %d::regprocedure", kw, oid), nil
		}
		if err := requireSchemaName(schema, name); err != nil {
			return "", err
		}
		target := qualified(schema, name)
		if strings.TrimSpace(args) != "" {
			target += "(" + args + ")"
		} else {
			target += "()"
		}
		return kw + " " + target, nil
	case "sequence":
		if err := requireSchemaName(schema, name); err != nil {
			return "", err
		}
		return "SEQUENCE " + qualified(schema, name), nil
	default:
		if err := requireSchemaName(schema, name); err != nil {
			return "", err
		}
		return "TABLE " + qualified(schema, name), nil
	}
}

func normalizePrivileges(kind string, raw []string) ([]string, error) {
	allowed, ok := grantPrivilegesByKind[kind]
	if !ok {
		return nil, fmt.Errorf("postgres: unsupported grant object kind %q", kind)
	}
	if len(raw) == 0 {
		return nil, fmt.Errorf("postgres: privileges required")
	}
	out := make([]string, 0, len(raw))
	seen := map[string]struct{}{}
	hasAll := false
	for _, p := range raw {
		priv := strings.ToUpper(strings.TrimSpace(p))
		if priv == "" {
			continue
		}
		if priv == "ALL PRIVILEGES" {
			priv = "ALL"
		}
		if _, ok := allowed[priv]; !ok {
			return nil, fmt.Errorf("postgres: privilege %q not allowed on %s", priv, kind)
		}
		if priv == "ALL" {
			hasAll = true
		}
		if _, dup := seen[priv]; dup {
			continue
		}
		seen[priv] = struct{}{}
		out = append(out, priv)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("postgres: privileges required")
	}
	// PostgreSQL 语法是 `{ priv [, ...] | ALL [ PRIVILEGES ] }`，ALL 不能与具体权限并列。
	if hasAll {
		return []string{"ALL"}, nil
	}
	return out, nil
}

func normalizeGrantee(grantee string) (string, error) {
	g := strings.TrimSpace(grantee)
	if g == "" {
		return "", fmt.Errorf("postgres: grantee required")
	}
	if strings.EqualFold(g, "PUBLIC") {
		return "PUBLIC", nil
	}
	if strings.EqualFold(g, "CURRENT_USER") {
		return "CURRENT_USER", nil
	}
	if strings.EqualFold(g, "SESSION_USER") {
		return "SESSION_USER", nil
	}
	if !isSafeDatabaseIdent(g) {
		return "", fmt.Errorf("postgres: invalid grantee %q", g)
	}
	return quoteIdent(g), nil
}

func buildGrantSQL(params ScriptParams) (string, error) {
	kind := normalizeObjectKind(params.ObjectKind)
	privs, err := normalizePrivileges(kind, params.Privileges)
	if err != nil {
		return "", err
	}
	target, err := grantTargetSQL(kind, params.Schema, params.Name, params.Args, params.OID)
	if err != nil {
		return "", err
	}
	grantee, err := normalizeGrantee(params.Grantee)
	if err != nil {
		return "", err
	}
	sql := "GRANT " + strings.Join(privs, ", ") + " ON " + target + " TO " + grantee
	if params.GrantOption {
		// PUBLIC 是伪角色，PostgreSQL 不允许 GRANT OPTION（SQLSTATE 0LP01）。
		if grantee == "PUBLIC" {
			return "", fmt.Errorf("postgres: WITH GRANT OPTION cannot be granted to PUBLIC")
		}
		sql += " WITH GRANT OPTION"
	}
	return sql, nil
}

func buildRevokeSQL(params ScriptParams) (string, error) {
	kind := normalizeObjectKind(params.ObjectKind)
	privs, err := normalizePrivileges(kind, params.Privileges)
	if err != nil {
		return "", err
	}
	target, err := grantTargetSQL(kind, params.Schema, params.Name, params.Args, params.OID)
	if err != nil {
		return "", err
	}
	grantee, err := normalizeGrantee(params.Grantee)
	if err != nil {
		return "", err
	}
	return "REVOKE " + strings.Join(privs, ", ") + " ON " + target + " FROM " + grantee, nil
}
