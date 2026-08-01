package dmparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// WorkAST 私有工作 AST：只服务补全 / 语义 / 符号，不做完整文法还原。
type WorkAST struct {
	Kind      StmtKind
	Tables    []sqllsp.TableRef
	Declares  []DeclareVar
	Params    []DeclareVar
	Routine   *RoutineInfo
	StmtStart int
	StmtText  string
}

// DeclareVar 参数或 DECLARE 变量。
type DeclareVar struct {
	Name     string
	DataType string
	Start    int
	End      int
}

// RoutineInfo 例程外壳信息。
type RoutineInfo struct {
	Kind      string // procedure | function
	Name      string
	NameStart int
	NameEnd   int
	BodyStart int
	BodyEnd   int
}

// ParseWorkAST 解析光标附近语句的工作 AST。
func ParseWorkAST(text string, pos sqllsp.Position) WorkAST {
	offset := sqllsp.OffsetFromPosition(text, pos)
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}

	// 优先：整份文档若是例程 DDL，用全文
	if isRoutineDDL(text) {
		return parseRoutineAST(text, 0)
	}

	start, stmt := currentStatementSpanDM(text, offset)
	ast := WorkAST{
		Kind:      Classify(stmt),
		StmtStart: start,
		StmtText:  stmt,
		Tables:    extractTableRefsDM(stmt, start),
	}
	if ast.Kind == StmtCreateProc || ast.Kind == StmtCreateFunc {
		return parseRoutineAST(stmt, start)
	}
	return ast
}

func parseRoutineAST(text string, base int) WorkAST {
	ast := WorkAST{
		Kind:      Classify(text),
		StmtStart: base,
		StmtText:  text,
	}
	i := skipLeadingNoise(text)
	createAt := indexKeyword(text, i, "create")
	if createAt < 0 {
		return ast
	}
	i = skipWSAndComments(text, createAt+6)
	if matchKeywordAt(text, i, "or") {
		i = skipWSAndComments(text, i+2)
		if matchKeywordAt(text, i, "replace") {
			i = skipWSAndComments(text, i+7)
		}
	}
	kind := ""
	if matchKeywordAt(text, i, "procedure") {
		kind = "procedure"
		i = skipWSAndComments(text, i+9)
	} else if matchKeywordAt(text, i, "function") {
		kind = "function"
		i = skipWSAndComments(text, i+8)
	} else {
		return ast
	}

	nameStart := i
	nameEnd, ok := scanQualifiedIdent(text, i)
	name := ""
	if ok {
		name = stripIdent(extractLastIdent(text[nameStart:nameEnd]))
		i = skipWSAndComments(text, nameEnd)
	}

	var params []DeclareVar
	if i < len(text) && text[i] == '(' {
		closeParen, ok := skipBalanced(text, i, '(', ')')
		if ok {
			params = parseParamList(text[i+1:closeParen-1], i+1)
			i = skipWSAndComments(text, closeParen)
		}
	}

	// 跳过 RETURN type / AS|IS
	if matchKeywordAt(text, i, "return") || matchKeywordAt(text, i, "returns") {
		kwLen := 6
		if matchKeywordAt(text, i, "returns") {
			kwLen = 7
		}
		i = skipWSAndComments(text, i+kwLen)
		if end, ok := scanTypeName(text, i); ok {
			i = skipWSAndComments(text, end)
		}
	}
	if matchKeywordAt(text, i, "as") || matchKeywordAt(text, i, "is") {
		i = skipWSAndComments(text, i+2)
	}

	// DECLARE 区：AS/IS 之后、BEGIN 之前
	beginAt := indexKeyword(text, i, "begin")
	declares := []DeclareVar{}
	if beginAt > i {
		declares = parseDeclareSection(text[i:beginAt], i)
	}

	bodyStart, bodyEnd := 0, 0
	if beginAt >= 0 {
		bodyStart = skipWSAndComments(text, beginAt+5)
		if end, ok := findMatchingEnd(text, bodyStart, 1); ok {
			bodyEnd = end
			body := text[bodyStart:end]
			// 体内 DML 的表引用
			for _, st := range splitTopLevelStatements(body) {
				sql := strings.TrimSpace(st.text)
				if sql == "" || shouldSkipBodyStmt(sql) {
					continue
				}
				refs := extractTableRefsDM(st.text, base+bodyStart+st.start)
				ast.Tables = append(ast.Tables, refs...)
			}
		}
	}

	ast.Params = params
	ast.Declares = declares
	ast.Routine = &RoutineInfo{
		Kind:      kind,
		Name:      name,
		NameStart: base + nameStart,
		NameEnd:   base + nameEnd,
		BodyStart: base + bodyStart,
		BodyEnd:   base + bodyEnd,
	}
	return ast
}

func extractLastIdent(s string) string {
	s = strings.TrimSpace(s)
	if i := strings.LastIndex(s, "."); i >= 0 {
		return strings.TrimSpace(s[i+1:])
	}
	return s
}

func parseParamList(seg string, base int) []DeclareVar {
	var out []DeclareVar
	parts := splitTopLevelComma(seg)
	offset := 0
	for _, p := range parts {
		raw := p
		// 相对 seg 的起始
		idx := strings.Index(seg[offset:], raw)
		if idx < 0 {
			idx = 0
		}
		partStart := base + offset + idx
		offset = offset + idx + len(raw)
		name, typ, ns, ne := parseVarDecl(raw)
		if name == "" {
			continue
		}
		out = append(out, DeclareVar{
			Name:     name,
			DataType: typ,
			Start:    partStart + ns,
			End:      partStart + ne,
		})
	}
	return out
}

func parseDeclareSection(seg string, base int) []DeclareVar {
	var out []DeclareVar
	i := 0
	n := len(seg)
	for i < n {
		i = skipWSAndComments(seg, i)
		if i >= n {
			break
		}
		if matchKeywordAt(seg, i, "cursor") {
			// CURSOR c IS … ; 跳到分号
			for i < n && seg[i] != ';' {
				i++
			}
			if i < n {
				i++
			}
			continue
		}
		start := i
		for i < n && seg[i] != ';' {
			i++
		}
		line := seg[start:i]
		if i < n {
			i++
		}
		name, typ, ns, ne := parseVarDecl(line)
		if name == "" {
			continue
		}
		out = append(out, DeclareVar{
			Name:     name,
			DataType: typ,
			Start:    base + start + ns,
			End:      base + start + ne,
		})
	}
	return out
}

func parseVarDecl(line string) (name, typ string, nameStart, nameEnd int) {
	if strings.TrimSpace(line) == "" {
		return "", "", 0, 0
	}
	raw := line
	// Locate name after optional IN/OUT/INOUT/NOCOPY.
	lead := skipWSAndComments(raw, 0)
	for {
		if matchKeywordAt(raw, lead, "in") {
			lead = skipWSAndComments(raw, lead+2)
			continue
		}
		if matchKeywordAt(raw, lead, "out") {
			lead = skipWSAndComments(raw, lead+3)
			continue
		}
		if matchKeywordAt(raw, lead, "inout") {
			lead = skipWSAndComments(raw, lead+5)
			continue
		}
		if matchKeywordAt(raw, lead, "nocopy") {
			lead = skipWSAndComments(raw, lead+6)
			continue
		}
		break
	}
	nameEndPos, ok := scanIdent(raw, lead)
	if !ok {
		return "", "", 0, 0
	}
	name = stripIdent(raw[lead:nameEndPos])
	if name == "" {
		return "", "", 0, 0
	}
	j := skipWSAndComments(raw, nameEndPos)
	typeEnd, ok := scanTypeName(raw, j)
	if ok {
		typ = strings.TrimSpace(raw[j:typeEnd])
	}
	return name, typ, lead, nameEndPos
}

func splitTopLevelComma(s string) []string {
	var parts []string
	n := len(s)
	start := 0
	depth := 0
	for i := 0; i < n; {
		c := s[i]
		if c == '\'' {
			i = skipQuoted(s, i, '\'')
			continue
		}
		if c == '"' {
			i = skipQuoted(s, i, '"')
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
			parts = append(parts, s[start:i])
			i++
			start = i
			continue
		}
		i++
	}
	if start < n {
		parts = append(parts, s[start:])
	}
	return parts
}

// currentStatementSpanDM 感知 `/` 终止符的语句切片。
func currentStatementSpanDM(text string, offset int) (start int, stmt string) {
	spans := splitDocumentStatements(text)
	if len(spans) == 0 {
		return 0, text
	}
	for _, sp := range spans {
		end := sp.start + len(sp.text)
		if offset >= sp.start && offset <= end {
			return sp.start, sp.text
		}
	}
	// 落在分句空隙：取前一条
	for i := len(spans) - 1; i >= 0; i-- {
		if spans[i].start <= offset {
			return spans[i].start, spans[i].text
		}
	}
	return spans[0].start, spans[0].text
}

func extractTableRefsDM(stmt string, base int) []sqllsp.TableRef {
	refs := sqllsp.ExtractTableRefs(stmt, len(stmt))
	if base == 0 {
		return refs
	}
	for i := range refs {
		refs[i].StartByte += base
		refs[i].EndByte += base
	}
	return refs
}

// LocalNames 返回参数 + DECLARE 名（供补全与语义降噪）。
func (a WorkAST) LocalNames() []string {
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
	for _, p := range a.Params {
		add(p.Name)
	}
	for _, d := range a.Declares {
		add(d.Name)
	}
	return out
}