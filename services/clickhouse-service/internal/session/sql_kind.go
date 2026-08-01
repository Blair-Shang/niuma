package session

import "strings"

// sqlKind 返回语句首关键字（大写）；注释开头返回空串。
func sqlKind(q string) string {
	q = strings.TrimSpace(q)
	for {
		if strings.HasPrefix(q, "--") || strings.HasPrefix(q, "#") {
			if i := strings.IndexByte(q, '\n'); i >= 0 {
				q = strings.TrimSpace(q[i+1:])
				continue
			}
			return ""
		}
		if strings.HasPrefix(q, "/*") {
			if i := strings.Index(q, "*/"); i >= 0 {
				q = strings.TrimSpace(q[i+2:])
				continue
			}
			return ""
		}
		break
	}
	fields := strings.Fields(strings.ToUpper(q))
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

// returnsResultSet 判断语句是否预期返回结果集。
func returnsResultSet(q string) bool {
	switch sqlKind(q) {
	case "SELECT", "WITH", "SHOW", "DESCRIBE", "DESC", "EXISTS", "EXPLAIN", "CHECK":
		return true
	default:
		return false
	}
}

// commandTagForSQL 返回简短命令标签。
func commandTagForSQL(q string) string {
	return sqlKind(q)
}
