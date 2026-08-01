package ddl

import (
	"fmt"
	"regexp"
	"strings"
)

// QuoteIdent 用双引号包裹达梦标识符，内部双引号加倍。
func QuoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

// Qualified 返回 "schema"."table" 形式的全限定名。
func Qualified(schema, table string) string {
	return QuoteIdent(schema) + "." + QuoteIdent(table)
}

func quoteIdent(name string) string { return QuoteIdent(name) }

func qualified(schema, table string) string { return Qualified(schema, table) }

func quoteStringLiteral(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

var (
	defaultBareExprRe = regexp.MustCompile(
		`(?i)^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME|USER)(?:\(\d*\))?|SYSDATE|SYSTIMESTAMP|USER)$`,
	)
	defaultNumberRe = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)
)

// FormatDefaultExpr 将默认值整理为 DEFAULT 子句片段。
func FormatDefaultExpr(expr string) string {
	e := strings.TrimSpace(expr)
	if e == "" {
		return ""
	}
	if (strings.HasPrefix(e, "'") && strings.HasSuffix(e, "'") && len(e) >= 2) ||
		(strings.HasPrefix(e, `"`) && strings.HasSuffix(e, `"`) && len(e) >= 2) {
		return e
	}
	if defaultBareExprRe.MatchString(e) {
		return e
	}
	if defaultNumberRe.MatchString(e) {
		return e
	}
	if strings.HasPrefix(e, "(") && strings.HasSuffix(e, ")") {
		return e
	}
	return quoteStringLiteral(e)
}

func requireSchemaName(schema, table string) error {
	if strings.TrimSpace(schema) == "" {
		return fmt.Errorf("dameng: schema required")
	}
	if strings.TrimSpace(table) == "" {
		return fmt.Errorf("dameng: table name required")
	}
	return nil
}

func requireNewName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("dameng: newName required")
	}
	return nil
}

func quoteIdentList(names []string) (string, error) {
	if len(names) == 0 {
		return "", fmt.Errorf("dameng: columns required")
	}
	parts := make([]string, 0, len(names))
	for i, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			return "", fmt.Errorf("dameng: columns[%d] empty", i)
		}
		parts = append(parts, quoteIdent(n))
	}
	return strings.Join(parts, ", "), nil
}

func validateSQLFragment(expr, field string) error {
	e := strings.TrimSpace(expr)
	if e == "" {
		return fmt.Errorf("dameng: %s required", field)
	}
	lower := strings.ToLower(e)
	for _, bad := range []string{";", "--", "/*", "*/"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("dameng: %s contains forbidden characters", field)
		}
	}
	return nil
}

func validateDataType(dt string) error {
	t := strings.TrimSpace(dt)
	if t == "" {
		return fmt.Errorf("dameng: dataType required")
	}
	lower := strings.ToLower(t)
	for _, bad := range []string{";", "--", "/*", "*/", "\n", "\r"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("dameng: dataType contains forbidden characters")
		}
	}
	return nil
}

// schemaFromParams 优先 Schema，兼容 Database 别名。
func schemaFromParams(schema, database string) string {
	if s := strings.TrimSpace(schema); s != "" {
		return s
	}
	return strings.TrimSpace(database)
}
