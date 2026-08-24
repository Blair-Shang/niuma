package meta

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// DatabaseOverview 是已有库的建库相关属性（复制 CREATE DATABASE / 对照 Navicat 属性）。
type DatabaseOverview struct {
	Name            string `json:"name"`
	Owner           string `json:"owner,omitempty"`
	Encoding        string `json:"encoding,omitempty"`
	Collate         string `json:"collate,omitempty"`
	Ctype           string `json:"ctype,omitempty"`
	Tablespace      string `json:"tablespace,omitempty"`
	ConnectionLimit int    `json:"connectionLimit"`
	AllowConn       bool   `json:"allowConn"`
	IsTemplate      bool   `json:"isTemplate"`
}

// GetDatabaseOverview 读取 pg_database 中指定库的建库属性。
func GetDatabaseOverview(ctx context.Context, pool *pgxpool.Pool, name string) (*DatabaseOverview, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return nil, fmt.Errorf("postgres: database name required")
	}
	const query = `
SELECT d.datname,
       pg_catalog.pg_get_userbyid(d.datdba) AS owner,
       pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
       d.datcollate,
       d.datctype,
       t.spcname,
       d.datconnlimit,
       d.datallowconn,
       d.datistemplate
FROM pg_catalog.pg_database d
JOIN pg_catalog.pg_tablespace t ON t.oid = d.dattablespace
WHERE d.datname = $1
LIMIT 1`
	var out DatabaseOverview
	err := pool.QueryRow(ctx, query, name).Scan(
		&out.Name,
		&out.Owner,
		&out.Encoding,
		&out.Collate,
		&out.Ctype,
		&out.Tablespace,
		&out.ConnectionLimit,
		&out.AllowConn,
		&out.IsTemplate,
	)
	if err != nil {
		return nil, fmt.Errorf("postgres: database overview: %w", err)
	}
	out.Encoding = strings.ToUpper(strings.TrimSpace(out.Encoding))
	return &out, nil
}
