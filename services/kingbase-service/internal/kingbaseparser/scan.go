package kingbaseparser

import (
	"strings"
	"unicode"

	"niuma/pkg/sqllsp"
)

func skipLeadingNoise(s string) int {
	return skipWSAndComments(s, 0)
}

func skipWSAndComments(s string, i int) int {
	n := len(s)
	for i < n {
		c := s[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		if c == '-' && i+1 < n && s[i+1] == '-' {
			i = skipLineComment(s, i)
			continue
		}
		if c == '/' && i+1 < n && s[i+1] == '*' {
			i = skipBlockComment(s, i)
			continue
		}
		// Oracle Q 引号：q'[...]' / Q'{...}'
		if (c == 'q' || c == 'Q') && i+1 < n && s[i+1] == '\'' {
			i = skipQQuote(s, i)
			continue
		}
		break
	}
	return i
}

func skipLineComment(s string, i int) int {
	n := len(s)
	for i < n && s[i] != '\n' {
		i++
	}
	if i < n {
		i++
	}
	return i
}

func skipBlockComment(s string, i int) int {
	end, _ := skipBlockCommentChecked(s, i)
	return end
}

func skipBlockCommentChecked(s string, i int) (end int, closed bool) {
	n := len(s)
	if i+1 >= n || s[i] != '/' || s[i+1] != '*' {
		return i + 1, true
	}
	i += 2
	for i+1 < n {
		if s[i] == '*' && s[i+1] == '/' {
			return i + 2, true
		}
		i++
	}
	return n, false
}

func skipQuoted(s string, i int, quote byte) int {
	end, _ := skipQuotedChecked(s, i, quote)
	return end
}

// skipQuotedChecked 跳过 '…' / "…"；closed=false 表示未见闭合引号。
// 闭合引号恰好落在文本末尾时 end==len(s) 且 closed=true（勿当作未闭合）。
func skipQuotedChecked(s string, i int, quote byte) (end int, closed bool) {
	n := len(s)
	i++
	for i < n {
		c := s[i]
		if c == quote {
			if i+1 < n && s[i+1] == quote {
				i += 2
				continue
			}
			return i + 1, true
		}
		i++
	}
	return n, false
}

// skipQQuote 跳过 Oracle Q 引号字面量：q'[...]' / q'{...}' / q'!...!' 等。
func skipQQuote(s string, i int) int {
	end, _ := skipQQuoteChecked(s, i)
	return end
}

func skipQQuoteChecked(s string, i int) (end int, closed bool) {
	n := len(s)
	if i+2 >= n || (s[i] != 'q' && s[i] != 'Q') || s[i+1] != '\'' {
		return i + 1, true
	}
	i += 2
	if i >= n {
		return n, false
	}
	open := s[i]
	closeCh := open
	switch open {
	case '[':
		closeCh = ']'
	case '{':
		closeCh = '}'
	case '(':
		closeCh = ')'
	case '<':
		closeCh = '>'
	}
	i++
	for i < n {
		if s[i] == closeCh && i+1 < n && s[i+1] == '\'' {
			return i + 2, true
		}
		i++
	}
	return n, false
}

// skipDollarQuoteChecked skips PostgreSQL / Kingbase dollar-quoted strings.
func skipDollarQuoteChecked(s string, i int) (end int, closed bool) {
	if i >= len(s) || s[i] != '$' {
		return i + 1, true
	}
	j := i + 1
	for j < len(s) && (s[j] == '_' ||
		(s[j] >= 'a' && s[j] <= 'z') ||
		(s[j] >= 'A' && s[j] <= 'Z') ||
		(s[j] >= '0' && s[j] <= '9')) {
		j++
	}
	if j >= len(s) || s[j] != '$' {
		return i + 1, true
	}
	tag := s[i : j+1]
	if offset := strings.Index(s[j+1:], tag); offset >= 0 {
		return j + 1 + offset + len(tag), true
	}
	return len(s), false
}

func skipDollarQuote(s string, i int) int {
	end, _ := skipDollarQuoteChecked(s, i)
	return end
}

func skipBalanced(s string, openIdx int, open, close byte) (int, bool) {
	if openIdx >= len(s) || s[openIdx] != open {
		return 0, false
	}
	depth := 0
	i := openIdx
	n := len(s)
	for i < n {
		c := s[i]
		if c == '\'' {
			// q' 已在外层处理；普通 '...'
			if i > 0 && (s[i-1] == 'q' || s[i-1] == 'Q') {
				i = skipQQuote(s, i-1)
				continue
			}
			i = skipQuoted(s, i, '\'')
			continue
		}
		if c == '"' {
			i = skipQuoted(s, i, '"')
			continue
		}
		if c == '$' {
			i = skipDollarQuote(s, i)
			continue
		}
		if c == '-' && i+1 < n && s[i+1] == '-' {
			i = skipLineComment(s, i)
			continue
		}
		if c == '/' && i+1 < n && s[i+1] == '*' {
			i = skipBlockComment(s, i)
			continue
		}
		if c == open {
			depth++
			i++
			continue
		}
		if c == close {
			depth--
			i++
			if depth == 0 {
				return i, true
			}
			continue
		}
		i++
	}
	return 0, false
}

func matchKeywordAt(s string, i int, kw string) bool {
	n := len(kw)
	if i+n > len(s) {
		return false
	}
	for k := 0; k < n; k++ {
		a := s[i+k]
		b := kw[k]
		if a >= 'A' && a <= 'Z' {
			a += 'a' - 'A'
		}
		if a != b {
			return false
		}
	}
	if i+n < len(s) {
		r := rune(s[i+n])
		if isIdentCont(r) {
			return false
		}
	}
	if i > 0 {
		r := rune(s[i-1])
		if isIdentCont(r) {
			return false
		}
	}
	return true
}

func indexKeyword(s string, from int, kw string) int {
	n := len(s)
	for i := from; i < n; {
		i = skipWSAndComments(s, i)
		if i >= n {
			break
		}
		c := s[i]
		if c == '\'' {
			if i > 0 && (s[i-1] == 'q' || s[i-1] == 'Q') {
				i = skipQQuote(s, i-1)
			} else {
				i = skipQuoted(s, i, '\'')
			}
			continue
		}
		if c == '"' {
			i = skipQuoted(s, i, '"')
			continue
		}
		if c == '$' {
			i = skipDollarQuote(s, i)
			continue
		}
		if (c == 'q' || c == 'Q') && i+1 < n && s[i+1] == '\'' {
			i = skipQQuote(s, i)
			continue
		}
		if matchKeywordAt(s, i, kw) {
			return i
		}
		i++
	}
	return -1
}

func isIdentStart(r rune) bool {
	return r == '_' || unicode.IsLetter(r)
}

func isIdentCont(r rune) bool {
	return r == '_' || r == '$' || unicode.IsLetter(r) || unicode.IsDigit(r)
}

func scanIdent(s string, i int) (int, bool) {
	if i >= len(s) {
		return 0, false
	}
	if s[i] == '"' {
		return skipQuoted(s, i, '"'), true
	}
	r := rune(s[i])
	if !isIdentStart(r) {
		return 0, false
	}
	i++
	for i < len(s) {
		r = rune(s[i])
		if !isIdentCont(r) {
			break
		}
		i++
	}
	return i, true
}

func scanQualifiedIdent(s string, i int) (int, bool) {
	end, ok := scanIdent(s, i)
	if !ok {
		return 0, false
	}
	j := skipWSAndComments(s, end)
	if j < len(s) && s[j] == '.' {
		j = skipWSAndComments(s, j+1)
		end2, ok2 := scanIdent(s, j)
		if !ok2 {
			return end, true
		}
		return end2, true
	}
	return end, true
}

func scanTypeName(s string, i int) (int, bool) {
	end, ok := scanIdent(s, i)
	if !ok {
		return 0, false
	}
	j := skipWSAndComments(s, end)
	if j < len(s) && s[j] == '(' {
		closeParen, ok := skipBalanced(s, j, '(', ')')
		if !ok {
			return end, true
		}
		end = closeParen
	}
	return end, true
}

func isAtEOFNoise(s string, i int) bool {
	return skipWSAndComments(s, i) >= len(s)
}

func stripTrailingTerminators(s string) string {
	t := strings.TrimRight(s, " \t\r\n")
	if strings.HasSuffix(t, "/") {
		// 单独的脚本终止符 /
		before := strings.TrimRight(t[:len(t)-1], " \t\r\n")
		if before == "" || strings.HasSuffix(before, ";") || strings.HasSuffix(strings.ToLower(before), "end") {
			t = before
		}
	}
	t = strings.TrimRight(t, " \t\r\n")
	if strings.HasSuffix(t, ";") {
		t = strings.TrimRight(t[:len(t)-1], " \t\r\n")
	}
	return t
}

func looksIncomplete(trimmed string) bool {
	t := stripTrailingTerminators(trimmed)
	if t == "" {
		return true
	}
	lower := strings.ToLower(t)
	if strings.HasSuffix(lower, ",") || strings.HasSuffix(lower, "(") ||
		strings.HasSuffix(lower, "=") || strings.HasSuffix(lower, " set") ||
		strings.HasSuffix(lower, " from") || strings.HasSuffix(lower, " where") ||
		strings.HasSuffix(lower, " into") || strings.HasSuffix(lower, " values") ||
		strings.HasSuffix(lower, " select") || strings.HasSuffix(lower, " and") ||
		strings.HasSuffix(lower, " or") || strings.HasSuffix(lower, " join") ||
		strings.HasSuffix(lower, " as") || strings.HasSuffix(lower, " is") ||
		strings.HasSuffix(lower, " begin") {
		return true
	}
	// 未写 END 的例程半成品
	if (strings.Contains(lower, "procedure") || strings.Contains(lower, "function")) &&
		!strings.Contains(lower, "end") {
		return true
	}
	return false
}

func offsetToPosition(s string, offset int) sqllsp.Position {
	return sqllsp.OffsetToPosition(s, offset)
}

func errorAt(s string, offset int, msg string) sqllsp.Diagnostic {
	pos := offsetToPosition(s, offset)
	return sqllsp.Diagnostic{
		Range: sqllsp.Range{
			Start: pos,
			End:   sqllsp.Position{Line: pos.Line, Character: pos.Character + 1},
		},
		Severity: 1,
		Source:   "kingbase-lsp",
		Message:  msg,
	}
}

func hintAt(s string, offset int, msg string) sqllsp.Diagnostic {
	d := errorAt(s, offset, msg)
	d.Severity = 4
	return d
}

func warningAt(s string, offset int, msg string) sqllsp.Diagnostic {
	d := errorAt(s, offset, msg)
	d.Severity = 2
	return d
}

func remapDiags(doc string, stmtStart int, stmt string, diags []sqllsp.Diagnostic) []sqllsp.Diagnostic {
	if stmtStart == 0 || len(diags) == 0 {
		return diags
	}
	out := make([]sqllsp.Diagnostic, 0, len(diags))
	for _, d := range diags {
		startOff := sqllsp.OffsetFromPosition(stmt, d.Range.Start) + stmtStart
		endOff := sqllsp.OffsetFromPosition(stmt, d.Range.End) + stmtStart
		if endOff <= startOff {
			endOff = startOff + 1
		}
		out = append(out, sqllsp.Diagnostic{
			Range: sqllsp.Range{
				Start: sqllsp.OffsetToPosition(doc, startOff),
				End:   sqllsp.OffsetToPosition(doc, endOff),
			},
			Severity: d.Severity,
			Source:   d.Source,
			Message:  d.Message,
		})
	}
	return out
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func stripIdent(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 && s[0] == '"' && s[len(s)-1] == '"' {
		return s[1 : len(s)-1]
	}
	return s
}
