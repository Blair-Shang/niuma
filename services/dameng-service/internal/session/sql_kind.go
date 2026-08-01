package session

import "strings"

// sqlKind 返回语句首关键字（大写）。
// 会跳过前置空白与行/块注释；注释吃完仍无关键字时返回空串。
func sqlKind(q string) string {
	q = stripLeadingSQLTrivia(q)
	fields := strings.Fields(strings.ToUpper(q))
	if len(fields) == 0 {
		return ""
	}
	return fields[0]
}

// returnsRows 判断语句是否更可能返回结果集（应走 Query）。
func returnsRows(q string) bool {
	switch sqlKind(q) {
	case "SELECT", "WITH", "CALL", "EXPLAIN", "SHOW", "DESC", "DESCRIBE", "VALUES":
		return true
	}
	return false
}

func tag(q string) string { return sqlKind(q) }

func stripLeadingSQLTrivia(sqlText string) string {
	s := strings.TrimSpace(sqlText)
	for {
		if s == "" {
			return ""
		}
		switch {
		case strings.HasPrefix(s, "/*"):
			end := strings.Index(s[2:], "*/")
			if end < 0 {
				return ""
			}
			s = strings.TrimSpace(s[2+end+2:])
		case strings.HasPrefix(s, "--"):
			nl := strings.IndexByte(s, '\n')
			if nl < 0 {
				return ""
			}
			s = strings.TrimSpace(s[nl+1:])
		case strings.HasPrefix(s, "#"):
			nl := strings.IndexByte(s, '\n')
			if nl < 0 {
				return ""
			}
			s = strings.TrimSpace(s[nl+1:])
		default:
			return s
		}
	}
}
