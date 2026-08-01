package ddl

import (
	"fmt"
	"strings"
)

// NormalizeGeneratedType 规范化 VIRTUAL / STORED；空表示非生成列。
func NormalizeGeneratedType(t string) (string, error) {
	u := strings.ToUpper(strings.TrimSpace(t))
	switch u {
	case "", "NONE", "OFF":
		return "", nil
	case "VIRTUAL", "STORED":
		return u, nil
	default:
		return "", fmt.Errorf("sqlite: generatedType must be VIRTUAL or STORED")
	}
}

// validateExprFragment 拒绝注入分隔符；允许常见 SQL 表达式字符。
func validateExprFragment(kind, expr string) error {
	e := strings.TrimSpace(expr)
	if e == "" {
		return fmt.Errorf("sqlite: %s required", kind)
	}
	lower := strings.ToLower(e)
	for _, bad := range []string{";", "--", "/*", "*/"} {
		if strings.Contains(lower, bad) {
			return fmt.Errorf("sqlite: %s contains forbidden characters", kind)
		}
	}
	return nil
}

// FormatCheckClause 返回 ` CHECK (expr)`；空 check 返回空串。
func FormatCheckClause(check string) (string, error) {
	c := strings.TrimSpace(check)
	if c == "" {
		return "", nil
	}
	if err := validateExprFragment("check", c); err != nil {
		return "", err
	}
	// 允许用户写带或不带外层括号
	if strings.HasPrefix(c, "(") && strings.HasSuffix(c, ")") {
		return " CHECK " + c, nil
	}
	return " CHECK (" + c + ")", nil
}

// FormatGeneratedClause 返回 ` GENERATED ALWAYS AS (expr) VIRTUAL|STORED`。
func FormatGeneratedClause(expr, genType string) (string, error) {
	gt, err := NormalizeGeneratedType(genType)
	if err != nil {
		return "", err
	}
	e := strings.TrimSpace(expr)
	if gt == "" {
		if e != "" {
			return "", fmt.Errorf("sqlite: generatedType required when generatedExpr is set")
		}
		return "", nil
	}
	if err := validateExprFragment("generatedExpr", e); err != nil {
		return "", err
	}
	if strings.HasPrefix(e, "(") && strings.HasSuffix(e, ")") {
		return " GENERATED ALWAYS AS " + e + " " + gt, nil
	}
	return " GENERATED ALWAYS AS (" + e + ") " + gt, nil
}

// appendColumnConstraints 追加 GENERATED / DEFAULT / NOT NULL / CHECK（互斥规则见 SQLite 文档）。
func appendColumnConstraints(
	b *strings.Builder,
	nullable bool,
	defaultExpr *string,
	check string,
	generatedExpr string,
	generatedType string,
	skipNullDefault bool, // PRIMARY KEY AUTOINCREMENT 路径已写完约束
) error {
	if skipNullDefault {
		chk, err := FormatCheckClause(check)
		if err != nil {
			return err
		}
		b.WriteString(chk)
		return nil
	}

	gen, err := FormatGeneratedClause(generatedExpr, generatedType)
	if err != nil {
		return err
	}
	if gen != "" {
		// 生成列：无 DEFAULT；NOT NULL 仍可写（SQLite 允许）
		if !nullable {
			b.WriteString(" NOT NULL")
		}
		b.WriteString(gen)
		chk, err := FormatCheckClause(check)
		if err != nil {
			return err
		}
		b.WriteString(chk)
		return nil
	}

	if !nullable {
		b.WriteString(" NOT NULL")
	}
	if defaultExpr != nil {
		if def := FormatDefaultExpr(*defaultExpr); def != "" {
			b.WriteString(" DEFAULT ")
			b.WriteString(def)
		}
	}
	chk, err := FormatCheckClause(check)
	if err != nil {
		return err
	}
	b.WriteString(chk)
	return nil
}
