package mysqlparser

import (
	"strings"
)

// localVar 参数或 DECLARE 变量。
type localVar struct {
	Name  string
	Start int
	End   int
}

// routineInfo 例程外壳。
type routineInfo struct {
	Kind      string // procedure | function
	Name      string
	NameStart int
	NameEnd   int
	BodyStart int
	BodyEnd   int
	Params    []localVar
	Declares  []localVar
}

type stmtSpan struct {
	start int
	text  string
}

// parseRoutineScope 从 CREATE PROCEDURE/FUNCTION 提取参数、DECLARE 与例程名。
func parseRoutineScope(text string, base int) *routineInfo {
	normalized := preprocessDelimiter(text)
	if !isRoutineDDL(normalized) {
		return nil
	}
	s := normalized
	i := skipLeadingNoise(s)
	createAt := indexKeyword(s, i, "create")
	if createAt < 0 {
		return nil
	}
	i = skipWSAndComments(s, createAt+6)
	if matchKeywordAt(s, i, "or") {
		i = skipWSAndComments(s, i+2)
		if matchKeywordAt(s, i, "replace") {
			i = skipWSAndComments(s, i+7)
		}
	}
	i = skipDefinerClause(s, i)
	i = skipWSAndComments(s, i)

	kind := ""
	if matchKeywordAt(s, i, "procedure") {
		kind = "procedure"
		i = skipWSAndComments(s, i+9)
	} else if matchKeywordAt(s, i, "function") {
		kind = "function"
		i = skipWSAndComments(s, i+8)
	} else {
		return nil
	}

	nameStart := i
	nameEnd, ok := scanQualifiedIdent(s, i)
	if !ok {
		return &routineInfo{Kind: kind}
	}
	name := stripIdent(extractLastIdent(s[nameStart:nameEnd]))
	i = skipWSAndComments(s, nameEnd)

	info := &routineInfo{
		Kind:      kind,
		Name:      name,
		NameStart: base + nameStart,
		NameEnd:   base + nameEnd,
	}

	if i < len(s) && s[i] == '(' {
		closeParen, ok := skipBalanced(s, i, '(', ')')
		if ok {
			info.Params = parseParamList(s[i+1:closeParen-1], base+i+1)
			i = skipWSAndComments(s, closeParen)
		}
	}

	if kind == "function" && matchKeywordAt(s, i, "returns") {
		i = skipWSAndComments(s, i+7)
		if end, ok := scanTypeName(s, i); ok {
			i = skipWSAndComments(s, end)
		}
		i = skipRoutineCharacteristics(s, i)
	} else {
		i = skipRoutineCharacteristics(s, i)
	}

	beginAt := indexKeyword(s, i, "begin")
	if beginAt < 0 {
		return info
	}
	bodyStart := skipWSAndComments(s, beginAt+5)
	info.BodyStart = base + bodyStart
	endAt, ok := findMatchingEnd(s, bodyStart, 1)
	if ok {
		info.BodyEnd = base + endAt
		info.Declares = parseDeclareSection(s[bodyStart:endAt], base+bodyStart)
	} else {
		info.BodyEnd = base + len(s)
		info.Declares = parseDeclareSection(s[bodyStart:], base+bodyStart)
	}
	return info
}

func (r *routineInfo) localNames() []string {
	if r == nil {
		return nil
	}
	seen := map[string]struct{}{}
	var out []string
	add := func(name string) {
		name = strings.TrimSpace(name)
		if name == "" {
			return
		}
		key := strings.ToLower(name)
		if _, ok := seen[key]; ok {
			return
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	for _, p := range r.Params {
		add(p.Name)
	}
	for _, d := range r.Declares {
		add(d.Name)
	}
	return out
}

func (r *routineInfo) allLocals() []localVar {
	if r == nil {
		return nil
	}
	return append(append([]localVar{}, r.Params...), r.Declares...)
}

// parseParamList 解析 (IN a INT, OUT b VARCHAR(10), c DECIMAL(10,2))。
func parseParamList(seg string, base int) []localVar {
	var out []localVar
	parts := splitTopLevelComma(seg)
	for _, part := range parts {
		raw := part.text
		abs := base + part.start
		j := skipWSAndComments(raw, 0)
		// 可选 IN / OUT / INOUT
		if matchKeywordAt(raw, j, "inout") {
			j = skipWSAndComments(raw, j+5)
		} else if matchKeywordAt(raw, j, "out") {
			j = skipWSAndComments(raw, j+3)
		} else if matchKeywordAt(raw, j, "in") {
			j = skipWSAndComments(raw, j+2)
		}
		nameStart := j
		nameEnd, ok := scanIdent(raw, j)
		if !ok {
			continue
		}
		name := stripIdent(raw[nameStart:nameEnd])
		if name == "" {
			continue
		}
		out = append(out, localVar{
			Name:  name,
			Start: abs + nameStart,
			End:   abs + nameEnd,
		})
	}
	return out
}

// parseDeclareSection 解析体内 DECLARE a INT; / DECLARE a, b INT;（跳过 HANDLER）。
func parseDeclareSection(body string, base int) []localVar {
	var out []localVar
	stmts := splitTopLevelStatements(body)
	for _, st := range stmts {
		raw := st.text
		j := skipWSAndComments(raw, 0)
		if !matchKeywordAt(raw, j, "declare") {
			continue
		}
		j = skipWSAndComments(raw, j+7)
		// DECLARE CONTINUE/EXIT/UNDO HANDLER …
		if matchKeywordAt(raw, j, "continue") || matchKeywordAt(raw, j, "exit") ||
			matchKeywordAt(raw, j, "undo") || matchKeywordAt(raw, j, "handler") {
			continue
		}
		for {
			nameStart := j
			nameEnd, ok := scanIdent(raw, j)
			if !ok {
				break
			}
			name := stripIdent(raw[nameStart:nameEnd])
			if name != "" {
				out = append(out, localVar{
					Name:  name,
					Start: base + st.start + nameStart,
					End:   base + st.start + nameEnd,
				})
			}
			j = skipWSAndComments(raw, nameEnd)
			if j < len(raw) && raw[j] == ',' {
				j = skipWSAndComments(raw, j+1)
				continue
			}
			break
		}
	}
	return out
}

type commaPart struct {
	start int
	text  string
}

func splitTopLevelComma(seg string) []commaPart {
	var out []commaPart
	n := len(seg)
	start := 0
	depth := 0
	i := 0
	for i < n {
		c := seg[i]
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(seg, i, c)
			continue
		}
		if c == '(' {
			depth++
			i++
			continue
		}
		if c == ')' {
			if depth > 0 {
				depth--
			}
			i++
			continue
		}
		if c == ',' && depth == 0 {
			out = append(out, commaPart{start: start, text: seg[start:i]})
			i++
			start = i
			continue
		}
		i++
	}
	if start < n || (start == n && n > 0 && strings.TrimSpace(seg[start:]) == "" && len(out) > 0) {
		// trailing empty ignored
	}
	if start <= n {
		rest := seg[start:]
		if strings.TrimSpace(rest) != "" {
			out = append(out, commaPart{start: start, text: rest})
		}
	}
	return out
}

func stripIdent(s string) string {
	s = strings.TrimSpace(s)
	return strings.Trim(s, "`\"'")
}

func extractLastIdent(raw string) string {
	raw = strings.TrimSpace(raw)
	if i := strings.LastIndex(raw, "."); i >= 0 {
		return raw[i+1:]
	}
	return raw
}

// splitDocumentStatements 顶层分句（感知字符串/注释/括号/BEGIN…END）。
func splitDocumentStatements(text string) []stmtSpan {
	var out []stmtSpan
	n := len(text)
	i := 0
	stmtStart := 0
	beginDepth := 0
	parenDepth := 0
	for i < n {
		c := text[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		if c == '-' && i+1 < n && text[i+1] == '-' {
			i = skipLineComment(text, i)
			continue
		}
		if c == '#' {
			i = skipLineComment(text, i)
			continue
		}
		if c == '/' && i+1 < n && text[i+1] == '*' {
			i = skipBlockComment(text, i)
			continue
		}
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(text, i, c)
			continue
		}
		if c == '(' {
			parenDepth++
			i++
			continue
		}
		if c == ')' {
			if parenDepth > 0 {
				parenDepth--
			}
			i++
			continue
		}
		if matchKeywordAt(text, i, "begin") {
			beginDepth++
			i += 5
			continue
		}
		if matchKeywordAt(text, i, "end") {
			after := skipWSAndComments(text, i+3)
			skip := 0
			switch {
			case matchKeywordAt(text, after, "if"):
				skip = 2
			case matchKeywordAt(text, after, "while"):
				skip = 5
			case matchKeywordAt(text, after, "loop"):
				skip = 4
			case matchKeywordAt(text, after, "repeat"):
				skip = 6
			case matchKeywordAt(text, after, "case"):
				skip = 4
			}
			if skip > 0 {
				i = after + skip
				continue
			}
			if beginDepth > 0 {
				beginDepth--
			}
			i = after
			continue
		}
		if c == ';' && beginDepth == 0 && parenDepth == 0 {
			chunk := text[stmtStart:i]
			if strings.TrimSpace(chunk) != "" {
				out = append(out, stmtSpan{start: stmtStart, text: chunk})
			}
			i++
			stmtStart = i
			continue
		}
		i++
	}
	if stmtStart < n {
		rest := text[stmtStart:]
		if strings.TrimSpace(rest) != "" {
			out = append(out, stmtSpan{start: stmtStart, text: rest})
		}
	}
	return out
}
