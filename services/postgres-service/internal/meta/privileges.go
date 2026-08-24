package meta

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// PrivilegeGrant 是一条对象 ACL。
type PrivilegeGrant struct {
	Grantee    string `json:"grantee"`
	Privilege  string `json:"privilege"`
	Grantable  bool   `json:"grantable"`
}

// PrivilegesResult 是 meta.privileges 返回。
type PrivilegesResult struct {
	ObjectKind string           `json:"objectKind"`
	Grants     []PrivilegeGrant `json:"grants"`
}

// PrivilegesParams 定位授权对象。
type PrivilegesParams struct {
	Schema     string
	Name       string
	Args       string
	OID        uint32
	ObjectKind string
}

func normalizePrivilegeKind(kind string) string {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "view", "materialized_view", "foreign_table", "table", "":
		return "table"
	case "sequence":
		return "sequence"
	case "schema":
		return "schema"
	case "function", "procedure":
		return "routine"
	case "database":
		return "database"
	default:
		return "table"
	}
}

// ListPrivileges 读取对象当前 GRANT（information_schema）。
func ListPrivileges(ctx context.Context, pool *pgxpool.Pool, params PrivilegesParams) (*PrivilegesResult, error) {
	kind := normalizePrivilegeKind(params.ObjectKind)
	out := &PrivilegesResult{ObjectKind: kind, Grants: []PrivilegeGrant{}}

	switch kind {
	case "schema":
		if strings.TrimSpace(params.Name) == "" {
			return nil, fmt.Errorf("postgres: schema name required")
		}
		rows, err := pool.Query(ctx, `
SELECT r.rolname,
  a.privilege_type,
  a.is_grantable
FROM (
  SELECT (aclexplode(n.nspacl)).grantee AS grantee,
         (aclexplode(n.nspacl)).privilege_type AS privilege_type,
         (aclexplode(n.nspacl)).is_grantable AS is_grantable
  FROM pg_catalog.pg_namespace n
  WHERE n.nspname = $1
) a
LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee`, params.Name)
		if err != nil {
			return nil, fmt.Errorf("postgres: list schema privileges: %w", err)
		}
		return scanPrivilegeRows(rows, out)
	case "database":
		name := strings.TrimSpace(params.Name)
		if name == "" {
			return nil, fmt.Errorf("postgres: database name required")
		}
		rows, err := pool.Query(ctx, `
SELECT r.rolname,
  a.privilege_type,
  a.is_grantable
FROM (
  SELECT (aclexplode(datacl)).grantee AS grantee,
         (aclexplode(datacl)).privilege_type AS privilege_type,
         (aclexplode(datacl)).is_grantable AS is_grantable
  FROM pg_catalog.pg_database
  WHERE datname = $1
) a
LEFT JOIN pg_catalog.pg_roles r ON r.oid = a.grantee`, name)
		if err != nil {
			return nil, fmt.Errorf("postgres: list database privileges: %w", err)
		}
		return scanPrivilegeRows(rows, out)
	case "sequence":
		if err := requireRelation(RelationRef{Schema: params.Schema, Name: params.Name}); err != nil {
			return nil, err
		}
		rows, err := pool.Query(ctx, `
SELECT grantee, privilege_type, is_grantable = 'YES'
FROM information_schema.usage_privileges
WHERE object_schema = $1 AND object_name = $2 AND object_type = 'SEQUENCE'`, params.Schema, params.Name)
		if err != nil {
			return nil, fmt.Errorf("postgres: list sequence privileges: %w", err)
		}
		return scanPrivilegeRows(rows, out)
	case "routine":
		if params.OID == 0 && (strings.TrimSpace(params.Schema) == "" || strings.TrimSpace(params.Name) == "") {
			return nil, fmt.Errorf("postgres: routine required")
		}
		rows, err := pool.Query(ctx, `
SELECT grantee, privilege_type, is_grantable = 'YES'
FROM information_schema.routine_privileges
WHERE routine_schema = $1 AND routine_name = $2`, params.Schema, params.Name)
		if err != nil {
			return nil, fmt.Errorf("postgres: list routine privileges: %w", err)
		}
		return scanPrivilegeRows(rows, out)
	default:
		if err := requireRelation(RelationRef{Schema: params.Schema, Name: params.Name}); err != nil {
			return nil, err
		}
		rows, err := pool.Query(ctx, `
SELECT grantee, privilege_type, is_grantable = 'YES'
FROM information_schema.role_table_grants
WHERE table_schema = $1 AND table_name = $2`, params.Schema, params.Name)
		if err != nil {
			return nil, fmt.Errorf("postgres: list table privileges: %w", err)
		}
		return scanPrivilegeRows(rows, out)
	}
}

func scanPrivilegeRows(rows interface {
	Close()
	Next() bool
	Scan(dest ...any) error
	Err() error
}, out *PrivilegesResult) (*PrivilegesResult, error) {
	defer rows.Close()
	for rows.Next() {
		var g PrivilegeGrant
		var grantee *string
		if err := rows.Scan(&grantee, &g.Privilege, &g.Grantable); err != nil {
			return nil, fmt.Errorf("postgres: scan privileges: %w", err)
		}
		if grantee == nil || strings.TrimSpace(*grantee) == "" {
			g.Grantee = "PUBLIC"
		} else {
			g.Grantee = *grantee
		}
		out.Grants = append(out.Grants, g)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
