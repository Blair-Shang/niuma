package session

import "strings"

// returnsResultSet 判断语句是否更可能返回结果集。
func returnsResultSet(sqlText string) bool {
	kw := leadingSQLKeyword(sqlText)
	switch kw {
	case "SELECT", "WITH", "VALUES", "EXPLAIN", "PRAGMA", "ANALYZE":
		if kw == "WITH" {
			return !cteWrapsDML(sqlText)
		}
		if kw == "PRAGMA" {
			// 部分 PRAGMA 无结果集（如 journal_mode=WAL 写形式仍可能返回一行）。
			return true
		}
		return true
	default:
		return false
	}
}

func commandTagForSQL(sqlText string) string {
	kw := leadingSQLKeyword(sqlText)
	if kw == "" {
		return "OK"
	}
	return kw
}

func leadingSQLKeyword(sqlText string) string {
	s := stripLeadingSQLTrivia(sqlText)
	i := 0
	for i < len(s) {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c == '_' {
			i++
			continue
		}
		break
	}
	if i == 0 {
		return ""
	}
	return strings.ToUpper(s[:i])
}

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
		default:
			return s
		}
	}
}

func cteWrapsDML(sqlText string) bool {
	upper := strings.ToUpper(stripLeadingSQLTrivia(sqlText))
	for _, verb := range []string{
		" UPDATE ", " INSERT ", " DELETE ", " REPLACE ",
		"\nUPDATE ", "\nINSERT ", "\nDELETE ", "\nREPLACE ",
	} {
		if strings.Contains(upper, verb) {
			return true
		}
	}
	return false
}

func int64Ptr(v int64) *int64 { return &v }
