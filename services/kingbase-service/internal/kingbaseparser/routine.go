package kingbaseparser

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

	sawReturn := false
	sawBody := false
	var diags []sqllsp.Diagnostic

	// PG：RETURNS / LANGUAGE / VOLATILE / SECURITY … 与 AS $$…$$ 可交错出现；
	// Oracle：RETURN <type> AS/IS BEGIN…END。
	for i < len(s) {
		i = skipWSAndComments(s, i)
		if i >= len(s) {
			break
		}

		// AS / IS → 例程体（$$ 美元引用 或 BEGIN…END）
		if matchKeywordAt(s, i, "as") || matchKeywordAt(s, i, "is") {
			kwLen := 2
			i = skipWSAndComments(s, i+kwLen)
			if i < len(s) && s[i] == '$' {
				end, closed := skipDollarQuoteChecked(s, i)
				if !closed {
					if looksIncomplete(trimmed) {
						diags = append(diags, hintAt(s, i, "unclosed dollar-quoted routine body"))
					} else {
						diags = append(diags, errorAt(s, i, "unclosed dollar-quoted routine body"))
					}
					return diags
				}
				i = skipWSAndComments(s, end)
				sawBody = true
				continue
			}
			if i < len(s) && s[i] == '\'' {
				i = skipQuoted(s, i, '\'')
				i = skipWSAndComments(s, i)
				// AS 'obj', 'link_symbol'（C 语言函数）
				if i < len(s) && s[i] == ',' {
					i = skipWSAndComments(s, i+1)
					if i < len(s) && s[i] == '\'' {
						i = skipQuoted(s, i, '\'')
						i = skipWSAndComments(s, i)
					}
				}
				sawBody = true
				continue
			}
			// Oracle / 裸 PL：AS BEGIN … END
			beginAt := indexKeyword(s, i, "begin")
			if beginAt < 0 {
				if looksIncomplete(trimmed) {
					return []sqllsp.Diagnostic{hintAt(s, max(0, i), "expected BEGIN … END body")}
				}
				return []sqllsp.Diagnostic{errorAt(s, max(0, i), "expected BEGIN … END body")}
			}
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
			sawBody = true
			i = skipWSAndComments(s, endAt+3)
			continue
		}

		// 无 AS 直接 BEGIN（半成品容错）
		if matchKeywordAt(s, i, "begin") {
			bodyStart := skipWSAndComments(s, i+5)
			endAt, ok := findMatchingEnd(s, bodyStart, 1)
			if !ok {
				if looksIncomplete(trimmed) {
					return []sqllsp.Diagnostic{hintAt(s, i, "unclosed BEGIN … END")}
				}
				return []sqllsp.Diagnostic{errorAt(s, i, "unclosed BEGIN … END")}
			}
			diags = append(diags, diagnoseControlPairs(s, bodyStart, endAt, looksIncomplete(trimmed))...)
			sawBody = true
			i = skipWSAndComments(s, endAt+3)
			continue
		}

		next, skipped, ret := skipPGRoutineOption(s, i)
		if skipped {
			if ret {
				sawReturn = true
			}
			i = next
			continue
		}

		// 未识别且尚未写完
		if looksIncomplete(trimmed) {
			if kind == "function" && !sawReturn && !sawBody {
				return []sqllsp.Diagnostic{hintAt(s, max(0, i), "FUNCTION requires RETURN/RETURNS <type>")}
			}
			if !sawBody {
				return []sqllsp.Diagnostic{hintAt(s, max(0, i), "expected AS or IS before routine body")}
			}
			break
		}
		if kind == "function" && !sawReturn && !sawBody {
			return []sqllsp.Diagnostic{errorAt(s, i, "FUNCTION requires RETURN/RETURNS <type>")}
		}
		if !sawBody {
			return []sqllsp.Diagnostic{errorAt(s, i, "expected AS or IS before routine body")}
		}
		break
	}

	if !sawBody {
		if looksIncomplete(trimmed) {
			if kind == "function" && !sawReturn {
				return []sqllsp.Diagnostic{hintAt(s, max(0, i), "FUNCTION requires RETURN/RETURNS <type>")}
			}
			return []sqllsp.Diagnostic{hintAt(s, max(0, i), "expected AS or IS before routine body")}
		}
		if kind == "function" && !sawReturn {
			return []sqllsp.Diagnostic{errorAt(s, max(0, i), "FUNCTION requires RETURN/RETURNS <type>")}
		}
		return []sqllsp.Diagnostic{errorAt(s, max(0, i), "expected AS or IS before routine body")}
	}
	return diags
}

// skipPGRoutineOption 跳过 PG/Kingbase CREATE FUNCTION/PROCEDURE 的属性子句。
// retSeen 表示本子句提供了返回类型（RETURN / RETURNS <type> / RETURNS TABLE）。
func skipPGRoutineOption(s string, i int) (next int, skipped bool, retSeen bool) {
	i = skipWSAndComments(s, i)
	if i >= len(s) {
		return i, false, false
	}

	// RETURNS NULL ON NULL INPUT（须先于 RETURNS <type>）
	if matchKeywordAt(s, i, "returns") {
		j := skipWSAndComments(s, i+7)
		if matchKeywordAt(s, j, "null") {
			j = skipWSAndComments(s, j+4)
			if matchKeywordAt(s, j, "on") {
				j = skipWSAndComments(s, j+2)
				if matchKeywordAt(s, j, "null") {
					j = skipWSAndComments(s, j+4)
					if matchKeywordAt(s, j, "input") {
						return skipWSAndComments(s, j+5), true, false
					}
				}
			}
		}
		// RETURNS TABLE ( ... ) 或 RETURNS <type>
		if matchKeywordAt(s, j, "table") {
			j = skipWSAndComments(s, j+5)
			if j < len(s) && s[j] == '(' {
				closeParen, ok := skipBalanced(s, j, '(', ')')
				if !ok {
					return i, false, false
				}
				return skipWSAndComments(s, closeParen), true, true
			}
			return i, false, false
		}
		typeEnd, ok := scanTypeName(s, j)
		if !ok {
			return i, false, false
		}
		return skipWSAndComments(s, typeEnd), true, true
	}

	// Oracle：RETURN <type>
	if matchKeywordAt(s, i, "return") {
		j := skipWSAndComments(s, i+6)
		typeEnd, ok := scanTypeName(s, j)
		if !ok {
			return i, false, false
		}
		return skipWSAndComments(s, typeEnd), true, true
	}

	if matchKeywordAt(s, i, "language") {
		j := skipWSAndComments(s, i+8)
		end, ok := scanIdent(s, j)
		if !ok {
			return i, false, false
		}
		return skipWSAndComments(s, end), true, false
	}

	for _, kw := range []string{"volatile", "stable", "immutable", "leakproof", "window", "strict"} {
		if matchKeywordAt(s, i, kw) {
			return skipWSAndComments(s, i+len(kw)), true, false
		}
	}
	if matchKeywordAt(s, i, "not") {
		j := skipWSAndComments(s, i+3)
		if matchKeywordAt(s, j, "leakproof") {
			return skipWSAndComments(s, j+8), true, false
		}
	}

	// [ EXTERNAL ] SECURITY { INVOKER | DEFINER }
	if matchKeywordAt(s, i, "external") {
		j := skipWSAndComments(s, i+8)
		if matchKeywordAt(s, j, "security") {
			i = j
		} else {
			return i, false, false
		}
	}
	if matchKeywordAt(s, i, "security") {
		j := skipWSAndComments(s, i+8)
		if matchKeywordAt(s, j, "invoker") || matchKeywordAt(s, j, "definer") {
			return skipWSAndComments(s, j+7), true, false
		}
		return i, false, false
	}

	if matchKeywordAt(s, i, "parallel") {
		j := skipWSAndComments(s, i+8)
		for _, kw := range []string{"unsafe", "restricted", "safe"} {
			if matchKeywordAt(s, j, kw) {
				return skipWSAndComments(s, j+len(kw)), true, false
			}
		}
		return i, false, false
	}

	if matchKeywordAt(s, i, "cost") || matchKeywordAt(s, i, "rows") {
		kwLen := 4
		j := skipWSAndComments(s, i+kwLen)
		for j < len(s) && s[j] >= '0' && s[j] <= '9' {
			j++
		}
		if j == skipWSAndComments(s, i+kwLen) {
			return i, false, false
		}
		return skipWSAndComments(s, j), true, false
	}

	if matchKeywordAt(s, i, "support") {
		j := skipWSAndComments(s, i+7)
		end, ok := scanQualifiedIdent(s, j)
		if !ok {
			return i, false, false
		}
		return skipWSAndComments(s, end), true, false
	}

	// CALLED ON NULL INPUT
	if matchKeywordAt(s, i, "called") {
		j := skipWSAndComments(s, i+6)
		if matchKeywordAt(s, j, "on") {
			j = skipWSAndComments(s, j+2)
			if matchKeywordAt(s, j, "null") {
				j = skipWSAndComments(s, j+4)
				if matchKeywordAt(s, j, "input") {
					return skipWSAndComments(s, j+5), true, false
				}
			}
		}
		return i, false, false
	}

	// SET configuration_parameter { TO | = } { value | FROM CURRENT }
	if matchKeywordAt(s, i, "set") {
		j := skipWSAndComments(s, i+3)
		end, ok := scanIdent(s, j)
		if !ok {
			return i, false, false
		}
		j = skipWSAndComments(s, end)
		if matchKeywordAt(s, j, "to") {
			j = skipWSAndComments(s, j+2)
		} else if j < len(s) && s[j] == '=' {
			j = skipWSAndComments(s, j+1)
		} else {
			return i, false, false
		}
		if matchKeywordAt(s, j, "from") {
			j = skipWSAndComments(s, j+4)
			if matchKeywordAt(s, j, "current") {
				return skipWSAndComments(s, j+7), true, false
			}
			return i, false, false
		}
		// 简单值：标识符 / 数字 / 字符串
		if j < len(s) && (s[j] == '\'' || s[j] == '"') {
			j = skipQuoted(s, j, s[j])
			return skipWSAndComments(s, j), true, false
		}
		end, ok = scanIdent(s, j)
		if ok {
			return skipWSAndComments(s, end), true, false
		}
		startNum := j
		for j < len(s) && ((s[j] >= '0' && s[j] <= '9') || s[j] == '.' || s[j] == '-') {
			j++
		}
		if j > startNum {
			return skipWSAndComments(s, j), true, false
		}
		return i, false, false
	}

	// TRANSFORM FOR TYPE type [, ...]
	if matchKeywordAt(s, i, "transform") {
		j := skipWSAndComments(s, i+9)
		for {
			if !matchKeywordAt(s, j, "for") {
				return i, false, false
			}
			j = skipWSAndComments(s, j+3)
			if !matchKeywordAt(s, j, "type") {
				return i, false, false
			}
			j = skipWSAndComments(s, j+4)
			end, ok := scanTypeName(s, j)
			if !ok {
				return i, false, false
			}
			j = skipWSAndComments(s, end)
			if j < len(s) && s[j] == ',' {
				j = skipWSAndComments(s, j+1)
				continue
			}
			return j, true, false
		}
	}

	return i, false, false
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
