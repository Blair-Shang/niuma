package ddl

import (
	"fmt"
	"regexp"
	"strings"
)

// QuoteIdent 用反引号包裹 MySQL 标识符，内部的反引号用双反引号转义。
func QuoteIdent(name string) string {
	return "`" + strings.ReplaceAll(name, "`", "``") + "`"
}

// Qualified 返回 `database`.`table` 形式的全限定名。
func Qualified(database, table string) string {
	return QuoteIdent(database) + "." + QuoteIdent(table)
}

// quoteIdent 是包内小写别名，避免外部调用混淆。
func quoteIdent(name string) string { return QuoteIdent(name) }

// qualified 是包内小写别名。
func qualified(database, table string) string { return Qualified(database, table) }

// quoteStringLiteral 将字符串值转义为 MySQL 单引号字面量。
func quoteStringLiteral(s string) string {
	// MySQL 标准：单引号内用 '' 转义单引号
	return "'" + strings.ReplaceAll(s, "'", "''") + "'"
}

var (
	defaultBareExprRe = regexp.MustCompile(
		`(?i)^(NULL|TRUE|FALSE|CURRENT_(?:TIMESTAMP|DATE|TIME|USER)(?:\(\d*\))?|LOCALTIME(?:\(\d*\))?|LOCALTIMESTAMP(?:\(\d*\))?|UTC_TIMESTAMP(?:\(\d*\))?|NOW\(\))$`,
	)
	defaultNumberRe = regexp.MustCompile(`^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$`)
	defaultHexBitRe = regexp.MustCompile(`(?i)^(0x[0-9a-f]+|x'[0-9a-f]*'|b'[01]*')$`)
)

// FormatDefaultExpr 将 UI / information_schema 中的默认值整理为 DEFAULT 子句片段。
// 裸字符串（如 ss）会加单引号，避免 ALTER 生成 DEFAULT ss 触发 1064。
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
	if defaultHexBitRe.MatchString(e) {
		return e
	}
	if strings.HasPrefix(e, "(") && strings.HasSuffix(e, ")") {
		return e
	}
	return quoteStringLiteral(e)
}

// requireDatabaseName 校验 database 与 table 均非空。
func requireDatabaseName(database, table string) error {
	if strings.TrimSpace(database) == "" {
		return fmt.Errorf("mysql: database required")
	}
	if strings.TrimSpace(table) == "" {
		return fmt.Errorf("mysql: table name required")
	}
	return nil
}

// requireNewName 校验 NewName 字段非空。
func requireNewName(name string) error {
	if strings.TrimSpace(name) == "" {
		return fmt.Errorf("mysql: newName required")
	}
	return nil
}

// quoteIdentList 将标识符列表批量加引号后用逗号连接。
func quoteIdentList(names []string) (string, error) {
	if len(names) == 0 {
		return "", fmt.Errorf("mysql: columns required")
	}
	parts := make([]string, 0, len(names))
	for i, n := range names {
		n = strings.TrimSpace(n)
		if n == "" {
			return "", fmt.Errorf("mysql: columns[%d] empty", i)
		}
		parts = append(parts, quoteIdent(n))
	}
	return strings.Join(parts, ", "), nil
}

// validateSQLFragment 对用户提供的 SQL 片段做最小注入防护。
func validateSQLFragment(expr, field string) error {
	e := strings.TrimSpace(expr)
	if e == "" {
		return fmt.Errorf("mysql: %s required", field)
	}
	lower := strings.ToLower(e)
	for _, bad := range []string{";", "--", "/*", "*/"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("mysql: %s contains forbidden characters", field)
		}
	}
	return nil
}

// validateDataType 校验数据类型字符串不含注入危险字符。
func validateDataType(dt string) error {
	t := strings.TrimSpace(dt)
	if t == "" {
		return fmt.Errorf("mysql: dataType required")
	}
	lower := strings.ToLower(t)
	for _, bad := range []string{";", "--", "/*", "*/", "\n", "\r"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("mysql: dataType contains forbidden characters")
		}
	}
	return nil
}
