package dmparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

func diagnoseRoutine(text string, compat CompatMode) []sqllsp.Diagnostic {
	var diags []sqllsp.Diagnostic
	diags = append(diags, diagnoseRoutineShell(text)...)
	diags = append(diags, diagnoseRoutineBody(text, compat)...)
	return diags
}

func diagnoseRoutineShell(text string) []sqllsp.Diagnostic {
	s := text
	start := skipLeadingNoise(s)
	if start >= len(s) {
		return nil
	}
	i := indexKeyword(s, start, "create")
	if i < 0 {
		return nil
	}
	i = skipWSAndComments(s, i+6)
	if matchKeywordAt(s, i, "or") {
		i = skipWSAndComments(s, i+2)
		if matchKeywordAt(s, i, "replace") {
			i = skipWSAndComments(s, i+7)
		}
	}
	i = skipWSAndComments(s, i)

	kind := ""
	kindPos := i
	if matchKeywordAt(s, i, "procedure") {
		kind = "procedure"
		i = skipWSAndComments(s, i+9)
	} else if matchKeywordAt(s, i, "function") {
		kind = "function"
		i = skipWSAndComments(s, i+8)
	} else {
		return nil
	}

	trimmed := strings.TrimSpace(s)
	if i >= len(s) || isAtEOFNoise(s, i) {
		return []sqllsp.Diagnostic{hintAt(s, kindPos, "incomplete "+kind+" definition")}
	}

	nameEnd, ok := scanQualifiedIdent(s, i)
	if !ok {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, i, "expected "+kind+" name")}
		}
		return []sqllsp.Diagnostic{errorAt(s, i, "expected "+kind+" name")}
	}
	i = skipWSAndComments(s, nameEnd)

	// 参数列表可选：CREATE PROCEDURE p AS …（无参可省略 ()）
	if i < len(s) && s[i] == '(' {
		closeParen, ok := skipBalanced(s, i, '(', ')')
		if !ok {
			if looksIncomplete(trimmed) {
				return []sqllsp.Diagnostic{hintAt(s, i, "unclosed parameter list")}
			}
			return []sqllsp.Diagnostic{errorAt(s, i, "unclosed parameter list")}
		}
		i = skipWSAndComments(s, closeParen)
	}

	if kind == "function" {
		// RETURN <type>（达梦/Oracle；非 MySQL RETURNS）
		if matchKeywordAt(s, i, "return") {
			i = skipWSAndComments(s, i+6)
			typeEnd, ok := scanTypeName(s, i)
			if !ok {
				if looksIncomplete(trimmed) {
					return []sqllsp.Diagnostic{hintAt(s, i, "expected return type after RETURN")}
				}
				return []sqllsp.Diagnostic{errorAt(s, i, "expected return type after RETURN")}
			}
			i = skipWSAndComments(s, typeEnd)
		} else if matchKeywordAt(s, i, "returns") {
			// 兼容误写 RETURNS
			i = skipWSAndComments(s, i+7)
			typeEnd, ok := scanTypeName(s, i)
			if !ok {
				if looksIncomplete(trimmed) {
					return []sqllsp.Diagnostic{hintAt(s, i, "expected return type after RETURNS")}
				}
				return []sqllsp.Diagnostic{errorAt(s, i, "expected return type after RETURNS")}
			}
			i = skipWSAndComments(s, typeEnd)
		} else if !looksIncomplete(trimmed) && i < len(s) && !matchKeywordAt(s, i, "as") && !matchKeywordAt(s, i, "is") {
			return []sqllsp.Diagnostic{errorAt(s, i, "FUNCTION requires RETURN <type>")}
		} else if looksIncomplete(trimmed) && !matchKeywordAt(s, i, "as") && !matchKeywordAt(s, i, "is") {
			return []sqllsp.Diagnostic{hintAt(s, max(0, i), "FUNCTION requires RETURN <type>")}
		}
	}

	// AS / IS
	if matchKeywordAt(s, i, "as") {
		i = skipWSAndComments(s, i+2)
	} else if matchKeywordAt(s, i, "is") {
		i = skipWSAndComments(s, i+2)
	} else {
		if looksIncomplete(trimmed) || i >= len(s) {
			return []sqllsp.Diagnostic{hintAt(s, max(0, i), "expected AS or IS before routine body")}
		}
		// 半成品已写 BEGIN 则容错
		if indexKeyword(s, i, "begin") < 0 {
			return []sqllsp.Diagnostic{errorAt(s, i, "expected AS or IS before routine body")}
		}
	}

	beginAt := indexKeyword(s, i, "begin")
	if beginAt < 0 {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, max(0, i), "expected BEGIN … END body")}
		}
		return []sqllsp.Diagnostic{errorAt(s, max(0, i), "expected BEGIN … END body")}
	}
	// AS/IS … BEGIN 之间的声明区：括号/引号平衡
	var diags []sqllsp.Diagnostic
	if beginAt > i {
		declSeg := s[i:beginAt]
		for _, d := range diagnoseBalance(declSeg) {
			startOff := sqllsp.OffsetFromPosition(declSeg, d.Range.Start)
			endOff := sqllsp.OffsetFromPosition(declSeg, d.Range.End)
			diags = append(diags, sqllsp.Diagnostic{
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(s, i+startOff),
					End:   sqllsp.OffsetToPosition(s, i+endOff),
				},
				Severity: d.Severity,
				Source:   d.Source,
				Message:  "DECLARE section: " + d.Message,
			})
		}
	}
	bodyStart := skipWSAndComments(s, beginAt+5)
	endAt, ok := findMatchingEnd(s, bodyStart, 1)
	if !ok {
		if looksIncomplete(trimmed) {
			diags = append(diags, hintAt(s, beginAt, "unclosed BEGIN … END"))
		} else {
			diags = append(diags, errorAt(s, beginAt, "unclosed BEGIN … END"))
		}
		return diags
	}
	diags = append(diags, diagnoseControlPairs(s, bodyStart, endAt, looksIncomplete(trimmed))...)
	return diags
}

func diagnoseRoutineBody(text string, compat CompatMode) []sqllsp.Diagnostic {
	beginAt := findRoutineBegin(text)
	if beginAt < 0 {
		return nil
	}
	bodyStart := skipWSAndComments(text, beginAt+5)
	endAt, ok := findMatchingEnd(text, bodyStart, 1)
	if !ok || endAt <= bodyStart {
		return nil
	}
	// 整段例程已写完 END 时，体内结构错误用 Error（Monaco 红线）；半成品仍 Hint。
	routineComplete := !looksIncomplete(strings.TrimSpace(text))
	body := text[bodyStart:endAt]
	stmts := splitTopLevelStatements(body)
	var diags []sqllsp.Diagnostic
	for _, st := range stmts {
		sql := strings.TrimSpace(st.text)
		if sql == "" || shouldSkipBodyStmt(sql) {
			continue
		}
		kind := Classify(sql)
		var sub []sqllsp.Diagnostic
		switch kind {
		case StmtSelect, StmtInsert, StmtUpdate, StmtDelete, StmtMerge:
			sub = diagnoseDML(sql, kind, compat)
			if kind == StmtSelect {
				sub = append(sub, diagnoseRoutineSelect(sql, routineComplete)...)
			}
		default:
			sub = diagnoseBalance(sql)
			sub = append(sub, diagnoseTypos(sql)...)
		}
		// SELECT/DML 与下一条赋值粘在一起（缺分号）：拆句器无法切开，在 := 处报错。
		if kind == StmtSelect || kind == StmtInsert || kind == StmtUpdate || kind == StmtDelete || kind == StmtMerge {
			if off := findAssignmentOp(sql); off >= 0 {
				msg := "missing semicolon before next statement"
				if routineComplete {
					sub = append(sub, errorAt(sql, off, msg))
				} else {
					sub = append(sub, hintAt(sql, off, msg))
				}
			}
		}
		for _, d := range sub {
			startOff := sqllsp.OffsetFromPosition(st.text, d.Range.Start)
			endOff := sqllsp.OffsetFromPosition(st.text, d.Range.End)
			absStart := bodyStart + st.start + startOff
			absEnd := bodyStart + st.start + endOff
			if absEnd <= absStart {
				absEnd = absStart + 1
			}
			diags = append(diags, sqllsp.Diagnostic{
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(text, absStart),
					End:   sqllsp.OffsetToPosition(text, absEnd),
				},
				Severity: d.Severity,
				Source:   d.Source,
				Message:  d.Message,
			})
		}
	}
	return diags
}

// diagnoseRoutineSelect 过程/函数体内 SELECT 须带 INTO（游标 FOR/OPEN 已由 shouldSkip 跳过）。
func diagnoseRoutineSelect(sql string, routineComplete bool) []sqllsp.Diagnostic {
	i := skipLeadingNoise(sql)
	if !matchKeywordAt(sql, i, "select") {
		return nil
	}
	after := skipWSAndComments(sql, i+6)
	intoAt := indexKeyword(sql, after, "into")
	fromAt := indexKeyword(sql, after, "from")
	// SELECT … INTO … FROM …；或 SELECT … INTO …（无 FROM 的表达式赋值）
	if intoAt >= 0 && (fromAt < 0 || intoAt < fromAt) {
		return nil
	}
	// 已粘连下一条语句时，缺 INTO 与缺分号一并提示；优先报缺分号即可，仍补 INTO 提示。
	msg := "SELECT in routine requires INTO"
	if routineComplete {
		return []sqllsp.Diagnostic{errorAt(sql, i, msg)}
	}
	if looksIncomplete(strings.TrimSpace(sql)) {
		return []sqllsp.Diagnostic{hintAt(sql, i, msg)}
	}
	return []sqllsp.Diagnostic{errorAt(sql, i, msg)}
}

// findAssignmentOp 返回过程赋值 := 在引号/注释外的下标；无则 -1。
func findAssignmentOp(s string) int {
	n := len(s)
	for i := 0; i < n; i++ {
		c := s[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			continue
		}
		if c == '-' && i+1 < n && s[i+1] == '-' {
			i = skipLineComment(s, i) - 1
			continue
		}
		if c == '/' && i+1 < n && s[i+1] == '*' {
			i = skipBlockComment(s, i) - 1
			continue
		}
		if (c == 'q' || c == 'Q') && i+1 < n && s[i+1] == '\'' {
			i = skipQQuote(s, i) - 1
			continue
		}
		if c == '\'' {
			i = skipQuoted(s, i, '\'') - 1
			continue
		}
		if c == '"' {
			i = skipQuoted(s, i, '"') - 1
			continue
		}
		if c == ':' && i+1 < n && s[i+1] == '=' {
			return i
		}
	}
	return -1
}

type bodyStmt struct {
	start int
	text  string
}

func splitTopLevelStatements(body string) []bodyStmt {
	var out []bodyStmt
	n := len(body)
	i := 0
	stmtStart := 0
	for i < n {
		c := body[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		if c == '-' && i+1 < n && body[i+1] == '-' {
			i = skipLineComment(body, i)
			continue
		}
		if c == '/' && i+1 < n && body[i+1] == '*' {
			i = skipBlockComment(body, i)
			continue
		}
		if (c == 'q' || c == 'Q') && i+1 < n && body[i+1] == '\'' {
			i = skipQQuote(body, i)
			continue
		}
		if c == '\'' {
			i = skipQuoted(body, i, '\'')
			continue
		}
		if c == '"' {
			i = skipQuoted(body, i, '"')
			continue
		}
		if kwLen := matchControlBlockStart(body, i); kwLen > 0 {
			end, ok := skipControlBlock(body, i, kwLen)
			if !ok {
				out = append(out, bodyStmt{start: stmtStart, text: body[stmtStart:]})
				return out
			}
			j := skipWSAndComments(body, end)
			if j < n && body[j] == ';' {
				j++
			}
			out = append(out, bodyStmt{start: stmtStart, text: body[stmtStart:j]})
			stmtStart = j
			i = j
			continue
		}
		if c == ';' {
			out = append(out, bodyStmt{start: stmtStart, text: body[stmtStart:i]})
			i++
			stmtStart = i
			continue
		}
		i++
	}
	if stmtStart < n {
		rest := strings.TrimSpace(body[stmtStart:])
		if rest != "" {
			out = append(out, bodyStmt{start: stmtStart, text: body[stmtStart:]})
		}
	}
	return out
}

func shouldSkipBodyStmt(sql string) bool {
	s := strings.TrimSpace(sql)
	if s == "" {
		return true
	}
	lower := strings.ToLower(s)
	for _, kw := range []string{
		"if", "while", "loop", "for", "case", "elsif", "else",
		"declare", "exception", "raise", "goto", "null",
		"open", "fetch", "close", "exit", "continue",
		"pragma", "cursor",
	} {
		if matchKeywordAt(lower, 0, kw) {
			return true
		}
	}
	// RETURN 单独校验表达式平衡即可，走 balance/typo
	return false
}

func matchControlBlockStart(s string, i int) int {
	lower := strings.ToLower(s)
	// WHILE/FOR … LOOP 只计一次：先认 WHILE/FOR；独立 LOOP 另计。
	for _, kw := range []string{"if", "while", "for", "case", "loop"} {
		if matchKeywordAt(lower, i, kw) {
			return len(kw)
		}
	}
	return 0
}

func skipControlBlock(s string, start, kwLen int) (int, bool) {
	kw := strings.ToLower(s[start : start+kwLen])
	i := skipWSAndComments(s, start+kwLen)
	// WHILE/FOR 条件后的 LOOP 属于同一控制块头，不增加深度。
	if kw == "while" || kw == "for" {
		i = skipToLoopHeader(s, i)
	}
	depth := 1
	n := len(s)
	lower := strings.ToLower(s)
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
		if (c == 'q' || c == 'Q') && i+1 < n && s[i+1] == '\'' {
			i = skipQQuote(s, i)
			continue
		}
		if c == '\'' || c == '"' {
			i = skipQuoted(s, i, c)
			continue
		}
		if nested := matchControlBlockStart(s, i); nested > 0 {
			nestedKw := strings.ToLower(s[i : i+nested])
			i += nested
			if nestedKw == "while" || nestedKw == "for" {
				i = skipToLoopHeader(s, i)
			}
			depth++
			continue
		}
		if matchKeywordAt(lower, i, "end") {
			after := skipWSAndComments(s, i+3)
			switch {
			case matchKeywordAt(lower, after, "if"):
				after += 2
			case matchKeywordAt(lower, after, "while"):
				after += 5
			case matchKeywordAt(lower, after, "loop"):
				after += 4
			case matchKeywordAt(lower, after, "case"):
				after += 4
			case matchKeywordAt(lower, after, "for"):
				after += 3
			}
			depth--
			if depth == 0 {
				return after, true
			}
			i = after
			continue
		}
		i++
	}
	return 0, false
}

// skipToLoopHeader 跳过 WHILE/FOR 条件直到（含）LOOP，避免与 LOOP 双重入栈。
func skipToLoopHeader(s string, i int) int {
	n := len(s)
	lower := strings.ToLower(s)
	depth := 0
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
		if (c == 'q' || c == 'Q') && i+1 < n && s[i+1] == '\'' {
			i = skipQQuote(s, i)
			continue
		}
		if c == '\'' || c == '"' {
			i = skipQuoted(s, i, c)
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
		if depth == 0 && matchKeywordAt(lower, i, "loop") {
			return i + 4
		}
		i++
	}
	return i
}

// diagnoseControlPairs 检查 IF/WHILE/FOR/LOOP/CASE 与 END … 是否成对（半成品降为 Hint）。
// 扫描区间为全文 [bodyStart, bodyEnd)。
func diagnoseControlPairs(text string, bodyStart, bodyEnd int, incomplete bool) []sqllsp.Diagnostic {
	if bodyStart < 0 || bodyEnd > len(text) || bodyStart >= bodyEnd {
		return nil
	}
	type frame struct {
		kind string
		at   int
	}
	var stack []frame
	var diags []sqllsp.Diagnostic
	emit := func(off int, msg string) {
		if incomplete {
			diags = append(diags, hintAt(text, off, msg))
		} else {
			diags = append(diags, errorAt(text, off, msg))
		}
	}

	lower := strings.ToLower(text)
	i := bodyStart
	for i < bodyEnd {
		c := text[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		if c == '-' && i+1 < bodyEnd && text[i+1] == '-' {
			i = skipLineComment(text, i)
			continue
		}
		if c == '/' && i+1 < bodyEnd && text[i+1] == '*' {
			i = skipBlockComment(text, i)
			continue
		}
		if (c == 'q' || c == 'Q') && i+1 < bodyEnd && text[i+1] == '\'' {
			i = skipQQuote(text, i)
			continue
		}
		if c == '\'' || c == '"' {
			i = skipQuoted(text, i, c)
			continue
		}
		if matchKeywordAt(lower, i, "elsif") {
			i += 5
			continue
		}
		if matchKeywordAt(lower, i, "elseif") {
			i += 6
			continue
		}
		if matchKeywordAt(lower, i, "else") {
			i += 4
			continue
		}
		if matchKeywordAt(lower, i, "if") {
			stack = append(stack, frame{kind: "if", at: i})
			i += 2
			continue
		}
		if matchKeywordAt(lower, i, "while") {
			stack = append(stack, frame{kind: "loop", at: i})
			i = skipToLoopHeader(text, i+5)
			continue
		}
		if matchKeywordAt(lower, i, "for") {
			stack = append(stack, frame{kind: "loop", at: i})
			i = skipToLoopHeader(text, i+3)
			continue
		}
		if matchKeywordAt(lower, i, "loop") {
			stack = append(stack, frame{kind: "loop", at: i})
			i += 4
			continue
		}
		if matchKeywordAt(lower, i, "case") {
			stack = append(stack, frame{kind: "case", at: i})
			i += 4
			continue
		}
		if matchKeywordAt(lower, i, "end") {
			after := skipWSAndComments(text, i+3)
			closeKind := ""
			skip := 0
			switch {
			case matchKeywordAt(lower, after, "if"):
				closeKind, skip = "if", 2
			case matchKeywordAt(lower, after, "loop"):
				closeKind, skip = "loop", 4
			case matchKeywordAt(lower, after, "case"):
				closeKind, skip = "case", 4
			case matchKeywordAt(lower, after, "while"):
				closeKind, skip = "loop", 5
			case matchKeywordAt(lower, after, "for"):
				closeKind, skip = "loop", 3
			}
			if closeKind == "" {
				// 裸 END 属于外层 BEGIN
				i = after
				continue
			}
			if len(stack) == 0 {
				emit(after, "unmatched END "+strings.ToUpper(closeKind))
				i = after + skip
				continue
			}
			top := stack[len(stack)-1]
			stack = stack[:len(stack)-1]
			if top.kind != closeKind {
				emit(after, "END "+strings.ToUpper(closeKind)+" does not match "+strings.ToUpper(top.kind))
			}
			i = after + skip
			continue
		}
		i++
	}
	for _, fr := range stack {
		emit(fr.at, "unclosed "+strings.ToUpper(fr.kind)+" … END "+strings.ToUpper(fr.kind))
	}
	return diags
}

func findRoutineBegin(text string) int {
	s := text
	i := skipLeadingNoise(s)
	createAt := indexKeyword(s, i, "create")
	if createAt < 0 {
		return indexKeyword(s, 0, "begin")
	}
	return indexKeyword(s, createAt+6, "begin")
}

func findMatchingEnd(s string, bodyStart, beginDepth int) (int, bool) {
	depth := beginDepth
	i := bodyStart
	n := len(s)
	lower := strings.ToLower(s)
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
		if (c == 'q' || c == 'Q') && i+1 < n && s[i+1] == '\'' {
			i = skipQQuote(s, i)
			continue
		}
		if c == '\'' || c == '"' {
			i = skipQuoted(s, i, c)
			continue
		}
		if matchKeywordAt(lower, i, "begin") {
			depth++
			i += 5
			continue
		}
		if matchKeywordAt(lower, i, "case") {
			end, ok := skipCaseBlock(s, i)
			if ok {
				i = end
				continue
			}
			i += 4
			continue
		}
		if matchKeywordAt(lower, i, "end") {
			after := skipWSAndComments(s, i+3)
			skip := 0
			switch {
			case matchKeywordAt(lower, after, "if"):
				skip = 2
			case matchKeywordAt(lower, after, "while"):
				skip = 5
			case matchKeywordAt(lower, after, "loop"):
				skip = 4
			case matchKeywordAt(lower, after, "case"):
				skip = 4
			}
			if skip > 0 {
				i = after + skip
				continue
			}
			depth--
			if depth == 0 {
				return i, true
			}
			i = after
			continue
		}
		i++
	}
	return 0, false
}

func skipCaseBlock(s string, start int) (int, bool) {
	i := skipWSAndComments(s, start+4)
	depth := 1
	n := len(s)
	lower := strings.ToLower(s)
	for i < n {
		c := s[i]
		if c == '\'' || c == '"' {
			i = skipQuoted(s, i, c)
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
		if matchKeywordAt(lower, i, "case") {
			depth++
			i += 4
			continue
		}
		if matchKeywordAt(lower, i, "end") {
			after := skipWSAndComments(s, i+3)
			if matchKeywordAt(lower, after, "case") {
				after += 4
			}
			depth--
			if depth == 0 {
				return after, true
			}
			i = after
			continue
		}
		i++
	}
	return 0, false
}

// inRoutineBodyAt 光标是否落在 CREATE PROCEDURE/FUNCTION 的 BEGIN…END 体内。
func inRoutineBodyAt(text string, pos sqllsp.Position) bool {
	if !isRoutineDDL(text) {
		return false
	}
	offset := sqllsp.OffsetFromPosition(text, pos)
	if offset < 0 {
		offset = 0
	}
	if offset > len(text) {
		offset = len(text)
	}
	beginAt := findRoutineBegin(text)
	if beginAt < 0 || offset <= beginAt {
		return false
	}
	bodyStart := skipWSAndComments(text, beginAt+5)
	endAt, ok := findMatchingEnd(text, bodyStart, 1)
	if !ok {
		return offset >= bodyStart
	}
	return offset >= bodyStart && offset <= endAt
}
