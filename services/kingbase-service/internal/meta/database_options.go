package meta

import (
	"context"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

const databaseOptionsListLimit = 500

// DatabaseCreateOptions 是新建库表单的候选项（来自实例 catalog）。
type DatabaseCreateOptions struct {
	Owners           []string `json:"owners"`
	Encodings        []string `json:"encodings"`
	Templates        []string `json:"templates"`
	Collations       []string `json:"collations"`
	DefaultEncoding  string   `json:"defaultEncoding,omitempty"`
	DefaultTemplate  string   `json:"defaultTemplate,omitempty"`
	DefaultLcCollate string   `json:"defaultLcCollate,omitempty"`
	DefaultLcCtype   string   `json:"defaultLcCtype,omitempty"`
}

// ListDatabaseCreateOptions 列出新建库表单候选项；encoding 用于过滤排序规则。
func ListDatabaseCreateOptions(ctx context.Context, pool *pgxpool.Pool, encoding string) (*DatabaseCreateOptions, error) {
	owners, err := listDatabaseOwners(ctx, pool)
	if err != nil {
		return nil, err
	}
	encodings, err := listDatabaseEncodings(ctx, pool)
	if err != nil {
		return nil, err
	}
	templates, err := listDatabaseTemplates(ctx, pool)
	if err != nil {
		return nil, err
	}
	defaults, err := loadTemplateDefaults(ctx, pool)
	if err != nil {
		return nil, err
	}

	enc := strings.ToUpper(strings.TrimSpace(encoding))
	if enc == "" {
		enc = defaults.Encoding
	}
	if enc == "" {
		enc = "UTF8"
	}

	collations, err := listDatabaseCollations(ctx, pool, enc, defaults)
	if err != nil {
		return nil, err
	}

	out := &DatabaseCreateOptions{
		Owners:           owners,
		Encodings:        encodings,
		Templates:        templates,
		Collations:       collations,
		DefaultEncoding:  defaults.Encoding,
		DefaultTemplate:  defaults.Template,
		DefaultLcCollate: defaults.LcCollate,
		DefaultLcCtype:   defaults.LcCtype,
	}
	if out.DefaultEncoding == "" && len(encodings) > 0 {
		out.DefaultEncoding = encodings[0]
	}
	if out.DefaultTemplate == "" && len(templates) > 0 {
		out.DefaultTemplate = templates[0]
	}
	return out, nil
}

type templateDefaults struct {
	Encoding  string
	Template  string
	LcCollate string
	LcCtype   string
}

func loadTemplateDefaults(ctx context.Context, pool *pgxpool.Pool) (templateDefaults, error) {
	const query = `
SELECT pg_catalog.pg_encoding_to_char(d.encoding) AS encoding,
       d.datcollate,
       d.datctype
FROM pg_catalog.pg_database d
WHERE d.datname = 'template0'
LIMIT 1`
	var out templateDefaults
	err := pool.QueryRow(ctx, query).Scan(&out.Encoding, &out.LcCollate, &out.LcCtype)
	if err != nil {
		return templateDefaults{
			Encoding: "UTF8",
			Template: "template0",
		}, nil
	}
	out.Template = "template0"
	out.Encoding = strings.ToUpper(strings.TrimSpace(out.Encoding))
	return out, nil
}

func listDatabaseOwners(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	const query = `
SELECT r.rolname
FROM pg_catalog.pg_roles r
WHERE r.rolname NOT LIKE 'pg\_%'
  AND (r.rolcreatedb OR r.rolsuper OR r.rolcanlogin)
ORDER BY r.rolname
LIMIT $1`
	return scanStringList(ctx, pool, query, databaseOptionsListLimit)
}

func listDatabaseEncodings(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	const query = `
SELECT DISTINCT pg_catalog.pg_encoding_to_char(i) AS encoding
FROM generate_series(0, 63) AS g(i)
WHERE pg_catalog.pg_encoding_to_char(i) <> ''
ORDER BY 1`
	rows, err := pool.Query(ctx, query)
	if err != nil {
		return nil, fmt.Errorf("kingbase: list encodings: %w", err)
	}
	defer rows.Close()

	seen := make(map[string]struct{})
	out := make([]string, 0, 16)
	for rows.Next() {
		var enc string
		if err := rows.Scan(&enc); err != nil {
			return nil, fmt.Errorf("kingbase: list encodings scan: %w", err)
		}
		enc = strings.ToUpper(strings.TrimSpace(enc))
		if enc == "" {
			continue
		}
		if _, ok := seen[enc]; ok {
			continue
		}
		seen[enc] = struct{}{}
		out = append(out, enc)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(out) > 0 {
		return out, nil
	}
	return []string{"UTF8", "LATIN1", "SQL_ASCII", "GBK", "GB18030"}, nil
}

func listDatabaseTemplates(ctx context.Context, pool *pgxpool.Pool) ([]string, error) {
	const query = `
SELECT d.datname
FROM pg_catalog.pg_database d
WHERE d.datistemplate
ORDER BY d.datname
LIMIT $1`
	out, err := scanStringList(ctx, pool, query, databaseOptionsListLimit)
	if err != nil {
		return nil, err
	}
	if len(out) > 0 {
		return out, nil
	}
	return []string{"template0", "template1"}, nil
}

func listDatabaseCollations(
	ctx context.Context,
	pool *pgxpool.Pool,
	encoding string,
	defaults templateDefaults,
) ([]string, error) {
	encoding = strings.ToUpper(strings.TrimSpace(encoding))
	merged := make([]string, 0, databaseOptionsListLimit)
	seen := make(map[string]struct{})

	appendUnique := func(items []string) {
		for _, item := range items {
			item = strings.TrimSpace(item)
			if item == "" {
				continue
			}
			if _, ok := seen[item]; ok {
				continue
			}
			seen[item] = struct{}{}
			merged = append(merged, item)
			if len(merged) >= databaseOptionsListLimit {
				return
			}
		}
	}

	const byEncoding = `
SELECT c.collname
FROM pg_catalog.pg_collation c
WHERE c.collencoding = pg_catalog.pg_char_to_encoding($1)
ORDER BY c.collname
LIMIT $2`
	if rows, err := scanStringList(ctx, pool, byEncoding, encoding, databaseOptionsListLimit); err == nil {
		appendUnique(rows)
	}

	if len(merged) == 0 {
		const allCollations = `
SELECT c.collname
FROM pg_catalog.pg_collation c
ORDER BY c.collname
LIMIT $1`
		if rows, err := scanStringList(ctx, pool, allCollations, databaseOptionsListLimit); err == nil {
			appendUnique(rows)
		}
	}

	const fromDatabases = `
SELECT DISTINCT locale_name
FROM (
  SELECT d.datcollate AS locale_name
  FROM pg_catalog.pg_database d
  WHERE COALESCE(d.datcollate, '') <> ''
  UNION
  SELECT d.datctype AS locale_name
  FROM pg_catalog.pg_database d
  WHERE COALESCE(d.datctype, '') <> ''
) locales
ORDER BY locale_name
LIMIT $1`
	if rows, err := scanStringList(ctx, pool, fromDatabases, databaseOptionsListLimit); err == nil {
		appendUnique(rows)
	}

	if defaults.LcCollate != "" {
		prependUnique(&merged, &seen, defaults.LcCollate)
	}
	if defaults.LcCtype != "" && defaults.LcCtype != defaults.LcCollate {
		prependUnique(&merged, &seen, defaults.LcCtype)
	}

	if len(merged) > 0 {
		return merged, nil
	}
	return []string{"C", "POSIX", "en_US.UTF-8", "zh_CN.UTF-8"}, nil
}

func prependUnique(target *[]string, seen *map[string]struct{}, value string) {
	value = strings.TrimSpace(value)
	if value == "" {
		return
	}
	if _, ok := (*seen)[value]; ok {
		return
	}
	(*seen)[value] = struct{}{}
	*target = append([]string{value}, *target...)
}

func scanStringList(ctx context.Context, pool *pgxpool.Pool, query string, args ...any) ([]string, error) {
	rows, err := pool.Query(ctx, query, args...)
	if err != nil {
		return nil, fmt.Errorf("kingbase: query options: %w", err)
	}
	defer rows.Close()

	out := make([]string, 0)
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, fmt.Errorf("kingbase: scan options: %w", err)
		}
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		out = append(out, value)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return out, nil
}
