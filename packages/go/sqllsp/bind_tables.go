package sqllsp

import (
	"strings"
	"unicode"
)

// statementClauseKeywords 截断 FROM 扫描区时遇到这些词则停止吃表引用。
var statementClauseKeywords = map[string]struct{}{
	"where": {}, "group": {}, "order": {}, "having": {}, "limit": {},
	"offset": {}, "union": {}, "set": {}, "on": {}, "using": {},
	"returning": {}, "window": {}, "for": {},
}

// ExtractTableRefs 从光标附近语句轻量扫描表引用（半成品友好，不依赖完整 AST）。
func ExtractTableRefs(text string, offset int) []TableRef {
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	stmtStart, stmt := currentStatementSpan(text, offset)
	if strings.TrimSpace(stmt) == "" {
		return nil
	}
	refs := scanTableRefs(stmt)
	for i := range refs {
		refs[i].StartByte += stmtStart
		refs[i].EndByte += stmtStart
	}
	return refs
}

// ResolveDotQualifier 将 `x`（来自 x.）解析为真实 schema+table。
// 优先别名，其次表名；命中返回 ok=true。未命中时调用方可再把 x 当 schema。
func ResolveDotQualifier(refs []TableRef, name, defaultDB string) (schema, table string, ok bool) {
	name = stripIdent(strings.TrimSpace(name))
	if name == "" {
		return "", "", false
	}
	lower := strings.ToLower(name)
	for _, r := range refs {
		alias := strings.TrimSpace(r.Alias)
		if alias != "" && strings.ToLower(alias) == lower {
			return coalesceSchema(r.Schema, defaultDB), r.Name, true
		}
	}
	for _, r := range refs {
		if strings.ToLower(r.Name) == lower {
			return coalesceSchema(r.Schema, defaultDB), r.Name, true
		}
	}
	return "", "", false
}

func coalesceSchema(schema, defaultDB string) string {
	schema = strings.TrimSpace(schema)
	if schema != "" {
		return schema
	}
	return strings.TrimSpace(defaultDB)
}

// currentStatementSpan 返回语句在全文中的起始字节与语句文本。
func currentStatementSpan(text string, offset int) (start int, stmt string) {
	start = offset
	for start > 0 && text[start-1] != ';' {
		start--
	}
	end := offset
	for end < len(text) && text[end] != ';' {
		end++
	}
	return start, text[start:end]
}

func currentStatement(text string, offset int) string {
	_, stmt := currentStatementSpan(text, offset)
	return stmt
}

func scanTableRefs(stmt string) []TableRef {
	tokens := tokenizeSQL(stmt)
	var refs []TableRef
	i := 0
	for i < len(tokens) {
		kw := strings.ToLower(tokens[i].raw)
		switch kw {
		case "from", "join", "update", "into":
			i++
			for i < len(tokens) {
				t := tokens[i]
				low := strings.ToLower(t.raw)
				if _, stop := statementClauseKeywords[low]; stop {
					break
				}
				if low == "left" || low == "right" || low == "inner" || low == "outer" ||
					low == "cross" || low == "straight_join" || low == "natural" {
					break
				}
				if low == "join" || low == "from" || low == "update" || low == "into" {
					break
				}
				if t.raw == "," {
					i++
					continue
				}
				if t.raw == "(" {
					// 子查询：( SELECT … ) [AS] alias — 提取投影列
					openIdx := i
					closeIdx := skipBalanced(tokens, i)
					innerCols := extractSelectListColumns(tokens, openIdx+1, closeIdx-1)
					i = closeIdx
					alias := ""
					if i < len(tokens) {
						if strings.EqualFold(tokens[i].raw, "as") && i+1 < len(tokens) && isIdentLike(tokens[i+1].raw) {
							alias = stripIdent(tokens[i+1].raw)
							i += 2
						} else if isIdentLike(tokens[i].raw) {
							n := strings.ToLower(tokens[i].raw)
							if _, stop := statementClauseKeywords[n]; !stop &&
								n != "left" && n != "right" && n != "inner" && n != "outer" &&
								n != "cross" && n != "join" && n != "on" && n != "using" &&
								n != "natural" && n != "straight_join" {
								alias = stripIdent(tokens[i].raw)
								i++
							}
						}
					}
					if alias != "" {
						refs = append(refs, TableRef{
							Name:    alias,
							Alias:   alias,
							Virtual: true,
							Columns: innerCols,
						})
					}
					continue
				}
				ref, next, ok := parseTableRef(tokens, i)
				if !ok {
					i++
					continue
				}
				refs = append(refs, ref)
				i = next
				// 逗号继续同从句多表；否则交给外层找下一个 from/join
				if i < len(tokens) && tokens[i].raw == "," {
					i++
					continue
				}
				break
			}
		default:
			i++
		}
	}
	// CTE：标记 Virtual 并挂上投影列
	cteDefs := ExtractCTEDefs(stmt)
	cteByName := map[string][]string{}
	for _, d := range cteDefs {
		cteByName[strings.ToLower(d.Name)] = d.Columns
	}
	for i := range refs {
		key := strings.ToLower(refs[i].Name)
		if cols, ok := cteByName[key]; ok {
			refs[i].Virtual = true
			if len(refs[i].Columns) == 0 {
				refs[i].Columns = cols
			}
		}
		if refs[i].Alias != "" {
			akey := strings.ToLower(refs[i].Alias)
			if cols, ok := cteByName[akey]; ok {
				refs[i].Virtual = true
				if len(refs[i].Columns) == 0 {
					refs[i].Columns = cols
				}
			}
		}
	}
	seen := map[string]struct{}{}
	for _, r := range refs {
		seen[strings.ToLower(r.Name)] = struct{}{}
		if r.Alias != "" {
			seen[strings.ToLower(r.Alias)] = struct{}{}
		}
	}
	for _, d := range cteDefs {
		key := strings.ToLower(d.Name)
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		refs = append(refs, TableRef{
			Name:    d.Name,
			Alias:   d.Name,
			Virtual: true,
			Columns: d.Columns,
		})
	}
	return refs
}

type sqlTok struct {
	raw   string
	start int // byte offset in stmt
	end   int
}

func tokenizeSQL(s string) []sqlTok {
	var out []sqlTok
	i := 0
	for i < len(s) {
		r := rune(s[i])
		if unicode.IsSpace(r) {
			i++
			continue
		}
		// 行注释
		if r == '-' && i+1 < len(s) && s[i+1] == '-' {
			for i < len(s) && s[i] != '\n' {
				i++
			}
			continue
		}
		if r == '#' {
			for i < len(s) && s[i] != '\n' {
				i++
			}
			continue
		}
		if r == '/' && i+1 < len(s) && s[i+1] == '*' {
			i += 2
			for i+1 < len(s) && !(s[i] == '*' && s[i+1] == '/') {
				i++
			}
			if i+1 < len(s) {
				i += 2
			}
			continue
		}
		start := i
		if r == '[' {
			i++
			for i < len(s) {
				if s[i] == ']' {
					i++
					if i < len(s) && s[i] == ']' { // escaped ]
						i++
						continue
					}
					break
				}
				i++
			}
			out = append(out, sqlTok{raw: s[start:i], start: start, end: i})
			continue
		}
		if r == '`' || r == '"' || r == '\'' {
			q := byte(r)
			i++
			for i < len(s) {
				if s[i] == q {
					i++
					if i < len(s) && s[i] == q { // escaped quote
						i++
						continue
					}
					break
				}
				i++
			}
			out = append(out, sqlTok{raw: s[start:i], start: start, end: i})
			continue
		}
		if r == ',' || r == '(' || r == ')' || r == '.' || r == ';' {
			out = append(out, sqlTok{raw: string(r), start: start, end: start + 1})
			i++
			continue
		}
		if isIdentStart(r) {
			i++
			for i < len(s) {
				rr := rune(s[i])
				if isIdentPart(rr) {
					i++
					continue
				}
				break
			}
			out = append(out, sqlTok{raw: s[start:i], start: start, end: i})
			continue
		}
		// 其它单字符
		out = append(out, sqlTok{raw: string(r), start: start, end: start + 1})
		i++
	}
	return out
}

func isIdentStart(r rune) bool {
	return unicode.IsLetter(r) || r == '_' || r == '$'
}

func isIdentPart(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$'
}

func stripIdent(s string) string {
	s = strings.TrimSpace(s)
	if len(s) >= 2 {
		if (s[0] == '`' && s[len(s)-1] == '`') || (s[0] == '"' && s[len(s)-1] == '"') {
			return s[1 : len(s)-1]
		}
		if s[0] == '[' && s[len(s)-1] == ']' {
			return strings.ReplaceAll(s[1:len(s)-1], "]]", "]")
		}
	}
	return s
}

func parseTableRef(tokens []sqlTok, i int) (TableRef, int, bool) {
	if i >= len(tokens) {
		return TableRef{}, i, false
	}
	a := tokens[i]
	if a.raw == "(" || a.raw == "," || a.raw == ")" {
		return TableRef{}, i, false
	}
	low := strings.ToLower(a.raw)
	if _, stop := statementClauseKeywords[low]; stop {
		return TableRef{}, i, false
	}
	if !isIdentLike(a.raw) {
		return TableRef{}, i, false
	}

	schema := ""
	name := stripIdent(a.raw)
	nameStart, nameEnd := a.start, a.end
	i++

	// db.table
	if i+1 < len(tokens) && tokens[i].raw == "." && isIdentLike(tokens[i+1].raw) {
		schema = name
		name = stripIdent(tokens[i+1].raw)
		nameStart = tokens[i+1].start
		nameEnd = tokens[i+1].end
		i += 2
	}

	alias := ""
	if i < len(tokens) {
		if strings.EqualFold(tokens[i].raw, "as") && i+1 < len(tokens) && isIdentLike(tokens[i+1].raw) {
			alias = stripIdent(tokens[i+1].raw)
			i += 2
		} else if isIdentLike(tokens[i].raw) {
			n := strings.ToLower(tokens[i].raw)
			if _, stop := statementClauseKeywords[n]; !stop &&
				n != "left" && n != "right" && n != "inner" && n != "outer" &&
				n != "cross" && n != "join" && n != "on" && n != "using" &&
				n != "natural" && n != "straight_join" {
				alias = stripIdent(tokens[i].raw)
				i++
			}
		}
	}

	return TableRef{
		Schema:    schema,
		Name:      name,
		Alias:     alias,
		StartByte: nameStart,
		EndByte:   nameEnd,
	}, i, name != ""
}

func isIdentLike(s string) bool {
	if s == "" || s == "," || s == "(" || s == ")" || s == "." || s == ";" {
		return false
	}
	if s[0] == '`' || s[0] == '"' || s[0] == '[' {
		return true
	}
	r := rune(s[0])
	return isIdentStart(r)
}

func skipBalanced(tokens []sqlTok, openIdx int) int {
	if openIdx >= len(tokens) || tokens[openIdx].raw != "(" {
		return openIdx + 1
	}
	depth := 0
	for i := openIdx; i < len(tokens); i++ {
		switch tokens[i].raw {
		case "(":
			depth++
		case ")":
			depth--
			if depth == 0 {
				return i + 1
			}
		}
	}
	return len(tokens)
}

// IdentAt 返回 offset 处标识符及其起止字节偏移（不含引号内容的外引号时仍返回裸名）。
func IdentAt(text string, offset int) (name string, start, end int, ok bool) {
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	// 若落在标识符中间，向两边扩展
	start = offset
	for start > 0 {
		r := rune(text[start-1])
		if isIdentPart(r) || r == '`' || r == '"' || r == '[' || r == ']' {
			start--
			continue
		}
		break
	}
	end = offset
	for end < len(text) {
		r := rune(text[end])
		if isIdentPart(r) || r == '`' || r == '"' || r == '[' || r == ']' {
			end++
			continue
		}
		break
	}
	if start >= end {
		return "", start, end, false
	}
	raw := text[start:end]
	name = stripIdent(raw)
	if name == "" {
		return "", start, end, false
	}
	return name, start, end, true
}

// QualifiedIdentAt 尝试解析 offset 处的 a.b 或单独 ident。
func QualifiedIdentAt(text string, offset int) (left, right string, start, end int, ok bool) {
	name, s, e, ok1 := IdentAt(text, offset)
	if !ok1 {
		return "", "", 0, 0, false
	}
	// 左侧是否有 .
	if s > 0 && text[s-1] == '.' {
		leftName, ls, _, ok2 := IdentAt(text, s-2)
		if ok2 {
			return leftName, name, ls, e, true
		}
	}
	// 右侧是否有 .xxx（光标在 qualifier 上）
	if e < len(text) && text[e] == '.' {
		rightName, _, re, ok2 := IdentAt(text, e+1)
		if ok2 {
			return name, rightName, s, re, true
		}
	}
	return "", name, s, e, true
}

// OffsetToPosition 将字节偏移转为近似 LSP Position（按 rune / BMP）。
func OffsetToPosition(text string, offset int) Position {
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	line, col := 0, 0
	for i := 0; i < offset; {
		if text[i] == '\n' {
			line++
			col = 0
			i++
			continue
		}
		r, size := decodeRune(text[i:])
		units := 1
		if r > 0xFFFF {
			units = 2
		}
		col += units
		i += size
	}
	return Position{Line: line, Character: col}
}

// FindQualifiedColumnRefs 扫描语句中的 qualifier.column（供语义诊断）。
func FindQualifiedColumnRefs(stmt string) []struct {
	Qualifier string
	Column    string
	Start     int
	End       int
} {
	tokens := tokenizeSQL(stmt)
	var out []struct {
		Qualifier string
		Column    string
		Start     int
		End       int
	}
	for i := 0; i+2 < len(tokens); i++ {
		if tokens[i+1].raw != "." {
			continue
		}
		if !isIdentLike(tokens[i].raw) || !isIdentLike(tokens[i+2].raw) {
			continue
		}
		q := stripIdent(tokens[i].raw)
		c := stripIdent(tokens[i+2].raw)
		// 跳过明显的 schema.table（后面还有 .col 时由三节处理简化：仍检查）
		out = append(out, struct {
			Qualifier string
			Column    string
			Start     int
			End       int
		}{q, c, tokens[i].start, tokens[i+2].end})
	}
	return out
}
