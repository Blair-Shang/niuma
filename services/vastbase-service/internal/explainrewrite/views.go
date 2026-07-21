// Package explainrewrite 在 EXPLAIN / EXPLAIN ANALYZE 前改写 SQL。
//
// Vastbase / openGauss 分布式下，普通视图目录只在 CN 完整可用；
// EXPLAIN 下推到 DN 时会报 relation "schema.view" does not exist on nodeN。
// 将普通视图替换为 (pg_get_viewdef) 子查询后，下推的是基表访问，与直接执行 SELECT 一致。
package explainrewrite

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

const maxExpandDepth = 8

var (
	// "schema"."name"
	quotedQualRef = regexp.MustCompile(`"((?:[^"]|"")*)"\s*\.\s*"((?:[^"]|"")*)"`)
	// schema.name（排除数字开头，避免误伤 1.0）
	plainQualRef = regexp.MustCompile(`\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*([A-Za-z_][A-Za-z0-9_]*)\b`)
)

type relationRef struct {
	Schema string
	Name   string
}

// ExpandOrdinaryViews 将 SQL 中的普通视图（relkind=v）展开为子查询。
// 物化视图有物理存储，通常可在 DN 解析，故不展开。
func ExpandOrdinaryViews(ctx context.Context, pool *pgxpool.Pool, sql string) (string, error) {
	if pool == nil {
		return sql, nil
	}
	out := strings.TrimSpace(sql)
	if out == "" {
		return out, nil
	}

	expanded := make(map[string]struct{})
	for depth := 0; depth < maxExpandDepth; depth++ {
		refs := findQualifiedRefs(out)
		if len(refs) == 0 {
			return out, nil
		}

		changed := false
		for _, ref := range refs {
			key := ref.Schema + "\x00" + ref.Name
			if _, ok := expanded[key]; ok {
				continue
			}
			def, ok, err := lookupOrdinaryViewDef(ctx, pool, ref)
			if err != nil {
				return "", err
			}
			if !ok {
				expanded[key] = struct{}{}
				continue
			}
			replacement := "(" + stripTrailingSemicolon(def) + ") AS " + quoteIdent(ref.Name)
			next := replaceQualifiedRelation(out, ref.Schema, ref.Name, replacement)
			if next != out {
				out = next
				changed = true
			}
			expanded[key] = struct{}{}
		}
		if !changed {
			return out, nil
		}
	}
	return out, nil
}

func lookupOrdinaryViewDef(ctx context.Context, pool *pgxpool.Pool, ref relationRef) (string, bool, error) {
	var relkind string
	var def string
	err := pool.QueryRow(ctx, `
SELECT c.relkind::text, COALESCE(pg_catalog.pg_get_viewdef(c.oid, true), '')
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = $1 AND c.relname = $2
LIMIT 1`, ref.Schema, ref.Name).Scan(&relkind, &def)
	if err != nil {
		// 对象不存在：留给后续 EXPLAIN 报原始错误
		if errors.Is(err, pgx.ErrNoRows) {
			return "", false, nil
		}
		return "", false, fmt.Errorf("vastbase: explain expand view %s.%s: %w", ref.Schema, ref.Name, err)
	}
	if relkind != "v" {
		return "", false, nil
	}
	def = strings.TrimSpace(def)
	if def == "" {
		return "", false, nil
	}
	return def, true, nil
}

func findQualifiedRefs(sql string) []relationRef {
	masked := maskStringLiterals(sql)
	seen := make(map[string]struct{})
	var out []relationRef

	add := func(schema, name string) {
		schema = unescapeIdent(schema)
		name = unescapeIdent(name)
		if schema == "" || name == "" {
			return
		}
		// 跳过常见非关系限定（模式/配置等误伤面很小，主要靠 catalog 再过滤）
		key := schema + "\x00" + name
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, relationRef{Schema: schema, Name: name})
	}

	for _, m := range quotedQualRef.FindAllStringSubmatch(masked, -1) {
		add(m[1], m[2])
	}
	for _, m := range plainQualRef.FindAllStringSubmatch(masked, -1) {
		add(m[1], m[2])
	}
	return out
}

func replaceQualifiedRelation(sql, schema, name, replacement string) string {
	// 先替换带引号形式，再替换裸标识符（避免部分匹配）
	quoted := quoteIdent(schema) + "." + quoteIdent(name)
	out := strings.ReplaceAll(sql, quoted, replacement)
	// 允许空白： "schema" . "name"
	flexibleQuoted := regexp.MustCompile(
		regexp.QuoteMeta(quoteIdent(schema)) + `\s*\.\s*` + regexp.QuoteMeta(quoteIdent(name)),
	)
	out = flexibleQuoted.ReplaceAllString(out, replacement)

	plain := schema + "." + name
	if strings.Contains(out, plain) {
		// 仅替换独立的 schema.name（前后非标识符字符）
		plainRe := regexp.MustCompile(`\b` + regexp.QuoteMeta(schema) + `\s*\.\s*` + regexp.QuoteMeta(name) + `\b`)
		out = plainRe.ReplaceAllString(out, replacement)
	}
	return out
}

func maskStringLiterals(sql string) string {
	var b strings.Builder
	b.Grow(len(sql))
	inSingle := false
	for i := 0; i < len(sql); i++ {
		ch := sql[i]
		if ch == '\'' {
			if inSingle {
				// SQL 转义 '' 
				if i+1 < len(sql) && sql[i+1] == '\'' {
					b.WriteByte(' ')
					b.WriteByte(' ')
					i++
					continue
				}
				inSingle = false
				b.WriteByte(' ')
				continue
			}
			inSingle = true
			b.WriteByte(' ')
			continue
		}
		if inSingle {
			b.WriteByte(' ')
			continue
		}
		b.WriteByte(ch)
	}
	return b.String()
}

func stripTrailingSemicolon(s string) string {
	s = strings.TrimSpace(s)
	for strings.HasSuffix(s, ";") {
		s = strings.TrimSpace(strings.TrimSuffix(s, ";"))
	}
	return s
}

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func unescapeIdent(name string) string {
	return strings.ReplaceAll(name, `""`, `"`)
}
