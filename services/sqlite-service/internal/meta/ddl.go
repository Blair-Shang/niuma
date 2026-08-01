package meta

import (
	"context"
	"database/sql"
	"fmt"
	"strings"

)

// DDLResult 是对象 DDL（sqlite_master.sql），对齐 Navicat「查看 DDL」/ DBeaver DDL。
type DDLResult struct {
	DDL    string `json:"ddl"`
	Name   string `json:"name,omitempty"`
	Type   string `json:"type,omitempty"`
	Schema string `json:"schema,omitempty"`
}

// GetDDL 读取 sqlite_master 中的 sql 文本。
func GetDDL(ctx context.Context, db *sql.DB, schema, name, objectType string) (*DDLResult, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlite: meta: nil db")
	}
	schema = schemaOrMain(schema)
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("sqlite: meta: name required")
	}
	master := quoteIdent(schema) + ".sqlite_master"
	if strings.EqualFold(schema, "temp") {
		master = "sqlite_temp_master"
	}

	query := fmt.Sprintf(`SELECT type, name, sql FROM %s WHERE name = ?`, master)
	args := []any{name}
	if t := strings.TrimSpace(objectType); t != "" {
		query += ` AND type = ?`
		args = append(args, strings.ToLower(t))
	}
	var typ, n string
	var sqlText sql.NullString
	if err := db.QueryRowContext(ctx, query, args...).Scan(&typ, &n, &sqlText); err != nil {
		if err == sql.ErrNoRows {
			return nil, fmt.Errorf("sqlite: meta: object not found: %s", name)
		}
		return nil, fmt.Errorf("sqlite: meta: ddl: %w", err)
	}
	ddl := ""
	if sqlText.Valid {
		ddl = strings.TrimSpace(sqlText.String)
	}
	// 部分内部对象无 sql；尽量拼可读说明。
	if ddl == "" {
		ddl = fmt.Sprintf("-- no CREATE statement stored for %s %s.%s", typ, schema, n)
	}
	if !strings.HasSuffix(ddl, ";") {
		ddl += ";"
	}
	return &DDLResult{
		DDL:    ddl,
		Name:   n,
		Type:   typ,
		Schema: schema,
	}, nil
}
