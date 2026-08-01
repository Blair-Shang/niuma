package ddl

import (
	"fmt"
	"regexp"
	"strings"
)

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func quoteLiteral(s string) string {
	return `'` + strings.ReplaceAll(s, `'`, `''`) + `'`
}

func qualified(schema, table string) string {
	return quoteIdent(schema) + "." + quoteIdent(table)
}

func requireSchemaTable(schema, table string) error {
	if strings.TrimSpace(schema) == "" {
		return fmt.Errorf("sqlite: schema required")
	}
	if strings.TrimSpace(table) == "" {
		return fmt.Errorf("sqlite: table name required")
	}
	return nil
}

func requireNewName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("sqlite: newName required")
	}
	return nil
}

func quoteIdentList(names []string) (string, error) {
	if len(names) == 0 {
		return "", fmt.Errorf("sqlite: columns required")
	}
	parts := make([]string, 0, len(names))
	for i, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			return "", fmt.Errorf("sqlite: columns[%d] empty", i)
		}
		parts = append(parts, quoteIdent(n))
	}
	return strings.Join(parts, ", "), nil
}

func validateDataType(dt string) error {
	t := strings.TrimSpace(dt)
	if t == "" {
		return fmt.Errorf("sqlite: dataType required")
	}
	lower := strings.ToLower(t)
	for _, bad := range []string{";", "--", "/*", "*/", "\n", "\r"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("sqlite: dataType contains forbidden characters")
		}
	}
	return nil
}

var (
	defaultBareExprRe = regexp.MustCompile(
		`(?i)^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME)(?:\(\d*\))?)$`,
	)
	defaultNumberRe = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)
)

// FormatDefaultExpr 整理 DEFAULT 表达式。
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
	return quoteLiteral(e)
}

func schemaOrMain(schema string) string {
	s := strings.TrimSpace(schema)
	if s == "" {
		return "main"
	}
	return s
}
