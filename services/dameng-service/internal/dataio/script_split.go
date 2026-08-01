package dataio

import (
	"strings"
	"unicode"
)

// splitSqlScript 按达梦/Oracle 脚本规则拆句：
//   - 独占一行的 / 始终作为批结束（不把 / 写入语句）
//   - 普通 SQL 在引号/注释外的 ; 处分句
//   - CREATE PROCEDURE/FUNCTION/PACKAGE/TRIGGER/TYPE、DECLARE、匿名 BEGIN 视为 PL/SQL，
//     体内 ; 不拆句，只等 / 或文件结束
//
// 返回的语句已 Trim，不含结尾 ; 或 /。
func splitSqlScript(text string) []string {
	if text == "" {
		return nil
	}
	var (
		out            []string
		stmt           strings.Builder
		inSingle       bool
		inDouble       bool
		inLineComment  bool
		inBlockComment bool
		blockStar      bool
		lineHasNonWS   bool
		plsqlSticky    bool
	)

	flush := func() {
		raw := strings.TrimSpace(stmt.String())
		stmt.Reset()
		plsqlSticky = false
		if raw == "" {
			return
		}
		raw = strings.TrimRightFunc(raw, func(r rune) bool {
			return r == ';' || unicode.IsSpace(r)
		})
		raw = strings.TrimSpace(raw)
		if raw != "" {
			out = append(out, raw)
		}
	}

	n := len(text)
	for i := 0; i < n; i++ {
		c := text[i]

		if inBlockComment {
			if blockStar && c == '/' {
				inBlockComment = false
				blockStar = false
			} else {
				blockStar = c == '*'
			}
			if c == '\n' {
				lineHasNonWS = false
			}
			continue
		}

		if inLineComment {
			if c == '\n' {
				inLineComment = false
				lineHasNonWS = false
				stmt.WriteByte(c)
			}
			continue
		}

		if inSingle {
			stmt.WriteByte(c)
			if c == '\'' {
				if i+1 < n && text[i+1] == '\'' {
					stmt.WriteByte(text[i+1])
					i++
				} else {
					inSingle = false
				}
			}
			continue
		}

		if inDouble {
			stmt.WriteByte(c)
			if c == '"' {
				if i+1 < n && text[i+1] == '"' {
					stmt.WriteByte(text[i+1])
					i++
				} else {
					inDouble = false
				}
			}
			continue
		}

		// Q-quote: q'[...]' / Q'{...}'
		if (c == 'q' || c == 'Q') && i+1 < n && text[i+1] == '\'' {
			stmt.WriteByte(c)
			stmt.WriteByte('\'')
			i += 2
			if i >= n {
				break
			}
			delim := text[i]
			stmt.WriteByte(delim)
			i++
			closeCh := qQuoteCloser(delim)
			for i < n {
				ch := text[i]
				stmt.WriteByte(ch)
				if ch == closeCh && i+1 < n && text[i+1] == '\'' {
					stmt.WriteByte('\'')
					i++
					break
				}
				i++
			}
			lineHasNonWS = true
			continue
		}

		if c == '-' && i+1 < n && text[i+1] == '-' {
			i++
			inLineComment = true
			continue
		}
		if c == '/' && i+1 < n && text[i+1] == '*' {
			i++
			inBlockComment = true
			blockStar = false
			continue
		}

		// 独占行的 / ：批终止符
		if c == '/' && !lineHasNonWS {
			j := i + 1
			onlyWS := true
			for j < n && text[j] != '\n' {
				if text[j] != ' ' && text[j] != '\t' && text[j] != '\r' {
					onlyWS = false
					break
				}
				j++
			}
			if onlyWS {
				flush()
				i = j // 指向 \n 或 EOF；若为 \n 由下一轮处理
				if i < n && text[i] == '\n' {
					lineHasNonWS = false
				}
				continue
			}
		}

		if c == '\'' {
			inSingle = true
			stmt.WriteByte(c)
			lineHasNonWS = true
			continue
		}
		if c == '"' {
			inDouble = true
			stmt.WriteByte(c)
			lineHasNonWS = true
			continue
		}

		if c == '\n' {
			stmt.WriteByte(c)
			lineHasNonWS = false
			continue
		}

		if c == ';' {
			if !plsqlSticky {
				plsqlSticky = looksLikePlsqlUnit(stmt.String())
			}
			if !plsqlSticky {
				flush()
				continue
			}
			stmt.WriteByte(c)
			lineHasNonWS = true
			continue
		}

		if c != ' ' && c != '\t' && c != '\r' {
			lineHasNonWS = true
		}
		stmt.WriteByte(c)
	}

	flush()
	return out
}

func qQuoteCloser(open byte) byte {
	switch open {
	case '[':
		return ']'
	case '{':
		return '}'
	case '<':
		return '>'
	case '(':
		return ')'
	default:
		return open
	}
}

// looksLikePlsqlUnit 判断当前缓冲是否以 PL/SQL 单元开头（需用 / 结束）。
func looksLikePlsqlUnit(sql string) bool {
	s := stripSQLLeadingNoise(sql)
	if s == "" {
		return false
	}
	upper := strings.ToUpper(s)
	switch {
	case strings.HasPrefix(upper, "DECLARE"):
		return true
	case strings.HasPrefix(upper, "BEGIN"):
		return true
	case strings.HasPrefix(upper, "CREATE"):
		rest := strings.TrimSpace(upper[len("CREATE"):])
		if strings.HasPrefix(rest, "OR REPLACE") {
			rest = strings.TrimSpace(rest[len("OR REPLACE"):])
		}
		for _, kw := range []string{"PROCEDURE", "FUNCTION", "PACKAGE", "TRIGGER", "TYPE"} {
			if strings.HasPrefix(rest, kw) {
				return true
			}
		}
	}
	return false
}

func stripSQLLeadingNoise(sql string) string {
	s := sql
	for {
		s = strings.TrimLeftFunc(s, unicode.IsSpace)
		if strings.HasPrefix(s, "--") {
			if i := strings.IndexByte(s, '\n'); i >= 0 {
				s = s[i+1:]
				continue
			}
			return ""
		}
		if strings.HasPrefix(s, "/*") {
			if i := strings.Index(s, "*/"); i >= 0 {
				s = s[i+2:]
				continue
			}
			return ""
		}
		return s
	}
}
