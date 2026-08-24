package ddl

import (
	"fmt"
	"regexp"
	"strings"
)

// QuoteIdent 用方括号包裹 T-SQL 标识符（] → ]]）。
func QuoteIdent(name string) string {
	return "[" + strings.ReplaceAll(strings.TrimSpace(name), "]", "]]") + "]"
}

// Qualified 返回 [schema].[table]。
func Qualified(schema, table string) string {
	return QuoteIdent(schema) + "." + QuoteIdent(table)
}

func quoteIdent(name string) string { return QuoteIdent(name) }

func qualified(schema, table string) string { return Qualified(schema, table) }

func quoteStringLiteral(s string) string {
	return "N'" + strings.ReplaceAll(s, "'", "''") + "'"
}

func quoteNString(s string) string {
	return "N'" + strings.ReplaceAll(s, "'", "''") + "'"
}

var (
	defaultBareExprRe = regexp.MustCompile(
		`(?i)^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME)(?:\(\d*\))?|GETDATE\(\)|GETUTCDATE\(\)|SYSDATETIME\(\)|SYSUTCDATETIME\(\)|NEWID\(\)|NEWSEQUENTIALID\(\))$`,
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
		(strings.HasPrefix(e, "N'") && strings.HasSuffix(e, "'") && len(e) >= 3) ||
		(strings.HasPrefix(e, "(") && strings.HasSuffix(e, ")")) {
		return e
	}
	if defaultBareExprRe.MatchString(e) {
		return e
	}
	if defaultNumberRe.MatchString(e) {
		return e
	}
	return quoteStringLiteral(e)
}

func requireSchemaName(schema, table string) error {
	if strings.TrimSpace(schema) == "" {
		return fmt.Errorf("sqlserver: schema required")
	}
	if strings.TrimSpace(table) == "" {
		return fmt.Errorf("sqlserver: table name required")
	}
	return nil
}

func requireNewName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("sqlserver: newName required")
	}
	return nil
}

func quoteIdentList(names []string) (string, error) {
	if len(names) == 0 {
		return "", fmt.Errorf("sqlserver: columns required")
	}
	parts := make([]string, 0, len(names))
	for i, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			return "", fmt.Errorf("sqlserver: columns[%d] empty", i)
		}
		parts = append(parts, quoteIdent(n))
	}
	return strings.Join(parts, ", "), nil
}

func validateSQLFragment(expr, field string) error {
	e := strings.TrimSpace(expr)
	if e == "" {
		return fmt.Errorf("sqlserver: %s required", field)
	}
	lower := strings.ToLower(e)
	for _, bad := range []string{";", "--", "/*", "*/"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("sqlserver: %s contains forbidden characters", field)
		}
	}
	return nil
}

func validateDataType(dt string) error {
	t := strings.TrimSpace(dt)
	if t == "" {
		return fmt.Errorf("sqlserver: dataType required")
	}
	lower := strings.ToLower(t)
	for _, bad := range []string{";", "--", "/*", "*/", "\n", "\r"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("sqlserver: dataType contains forbidden characters")
		}
	}
	return nil
}

func schemaFromParams(schema, databaseAlias string) string {
	if s := strings.TrimSpace(schema); s != "" {
		return s
	}
	return strings.TrimSpace(databaseAlias)
}
