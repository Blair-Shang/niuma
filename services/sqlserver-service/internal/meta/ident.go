package meta

import (
	"fmt"
	"strings"
)

// QuoteIdent 用方括号引用标识符（] → ]]）。
func QuoteIdent(name string) (string, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return "", fmt.Errorf("sqlserver: empty identifier")
	}
	if strings.ContainsRune(name, 0) {
		return "", fmt.Errorf("sqlserver: identifier contains NUL")
	}
	return "[" + strings.ReplaceAll(name, "]", "]]") + "]", nil
}

func mustQuote(name string) string {
	q, err := QuoteIdent(name)
	if err != nil {
		return "[?]"
	}
	return q
}

func qualifiedName(schema, name string) string {
	return mustQuote(schema) + "." + mustQuote(name)
}

func objectIDArg(schema, name string) string {
	return strings.TrimSpace(schema) + "." + strings.TrimSpace(name)
}
