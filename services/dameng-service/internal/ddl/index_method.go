package ddl

import (
	"fmt"
	"strings"
)

// normalizeIndexMethod 归一化达梦索引类型。
// 空 / BTREE / NORMAL → 默认 B 树（SQL 不写类型前缀）；
// BITMAP / HASH / SPATIAL → 对应 CREATE <TYPE> INDEX。
func normalizeIndexMethod(raw string) (string, error) {
	m := strings.ToUpper(strings.TrimSpace(raw))
	switch m {
	case "", "BTREE", "NORMAL", "NORMAL/REV":
		return "", nil
	case "BITMAP", "HASH", "SPATIAL":
		return m, nil
	default:
		return "", fmt.Errorf("dameng: unsupported index method %q", raw)
	}
}

// formatCreateIndexSQL 生成达梦建索引语句。
// 语法：CREATE [UNIQUE] [BITMAP|HASH|SPATIAL] INDEX name ON rel (cols)
func formatCreateIndexSQL(unique bool, method, name, rel, cols string) string {
	var b strings.Builder
	b.WriteString("CREATE ")
	// BITMAP / SPATIAL 一般不与 UNIQUE 同用
	if unique && method != "BITMAP" && method != "SPATIAL" {
		b.WriteString("UNIQUE ")
	}
	if method != "" {
		b.WriteString(method)
		b.WriteByte(' ')
	}
	b.WriteString("INDEX ")
	b.WriteString(quoteIdent(name))
	b.WriteString(" ON ")
	b.WriteString(rel)
	b.WriteString(" (")
	b.WriteString(cols)
	b.WriteByte(')')
	return b.String()
}
