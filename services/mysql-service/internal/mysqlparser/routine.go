package mysqlparser

import (
	"strconv"
	"strings"
	"unicode"

	"github.com/pingcap/tidb/pkg/parser"

	"niuma/pkg/sqllsp"
)

// isRoutineDDL 判断预处理后的文本是否为 CREATE PROCEDURE/FUNCTION（含 DEFINER）。
// 半成品也尽量识别，以便走例程诊断通道、避免 FUNCTION 假阳性。
func isRoutineDDL(text string) bool {
	s := text
	i := skipLeadingNoise(s)
	if !matchKeywordAt(s, i, "create") {
		return false
	}
	i = skipWSAndComments(s, i+6)
	// CREATE OR REPLACE（部分客户端方言；MySQL 官方无，容错）
	if matchKeywordAt(s, i, "or") {
		i = skipWSAndComments(s, i+2)
		if !matchKeywordAt(s, i, "replace") {
			return false
		}
		i = skipWSAndComments(s, i+7)
	}
	i = skipDefinerClause(s, i)
	i = skipWSAndComments(s, i)
	return matchKeywordAt(s, i, "procedure") || matchKeywordAt(s, i, "function")
}

// inRoutineBodyAt 光标是否落在 CREATE PROCEDURE/FUNCTION 的 BEGIN…END 体内。
func inRoutineBodyAt(text string, pos sqllsp.Position) bool {
	normalized := preprocessDelimiter(text)
	if !isRoutineDDL(normalized) {
		return false
	}
	offset := sqllsp.OffsetFromPosition(normalized, pos)
	if offset < 0 {
		offset = 0
	}
	if offset > len(normalized) {
		offset = len(normalized)
	}
	beginAt := findRoutineBegin(normalized)
	if beginAt < 0 || offset <= beginAt {
		return false
	}
	bodyStart := skipWSAndComments(normalized, beginAt+5)
	endAt, ok := findMatchingEnd(normalized, bodyStart, 1)
	if !ok {
		// 半成品未写完 END：BEGIN 之后都算体内
		return offset >= bodyStart
	}
	return offset >= bodyStart && offset <= endAt
}

// diagnoseRoutine 对外壳做启发式校验，对 BEGIN…END 体内顶层语句走 TiDB Parse。
func diagnoseRoutine(text string) []sqllsp.Diagnostic {
	var diags []sqllsp.Diagnostic
	diags = append(diags, diagnoseRoutineShell(text)...)
	diags = append(diags, diagnoseRoutineBody(text)...)
	return diags
}

func diagnoseRoutineShell(text string) []sqllsp.Diagnostic {
	s := text
	start := skipLeadingNoise(s)
	if start >= len(s) {
		return nil
	}
	// 定位 CREATE
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
	i = skipDefinerClause(s, i)
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
	// 半成品：仅敲到 CREATE FUNCTION 尚无名字/括号 → Hint
	if i >= len(s) || isAtEOFNoise(s, i) {
		return []sqllsp.Diagnostic{hintAt(s, kindPos, "incomplete "+kind+" definition")}
	}

	// 例程名（支持 db.name / `db`.`name`）
	nameEnd, ok := scanQualifiedIdent(s, i)
	if !ok {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, i, "expected "+kind+" name")}
		}
		return []sqllsp.Diagnostic{errorAt(s, i, "expected "+kind+" name")}
	}
	i = skipWSAndComments(s, nameEnd)

	// 参数列表 (...)
	if i >= len(s) || s[i] != '(' {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, i, "expected parameter list")}
		}
		return []sqllsp.Diagnostic{errorAt(s, max(0, i), "expected parameter list '('")}
	}
	closeParen, ok := skipBalanced(s, i, '(', ')')
	if !ok {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, i, "unclosed parameter list")}
		}
		return []sqllsp.Diagnostic{errorAt(s, i, "unclosed parameter list")}
	}
	i = skipWSAndComments(s, closeParen)

	if kind == "function" {
		if !matchKeywordAt(s, i, "returns") {
			if looksIncomplete(trimmed) || i >= len(s) {
				return []sqllsp.Diagnostic{hintAt(s, max(0, i), "FUNCTION requires RETURNS <type>")}
			}
			return []sqllsp.Diagnostic{errorAt(s, i, "FUNCTION requires RETURNS <type>")}
		}
		i = skipWSAndComments(s, i+7)
		typeEnd, ok := scanTypeName(s, i)
		if !ok {
			if looksIncomplete(trimmed) {
				return []sqllsp.Diagnostic{hintAt(s, i, "expected return type after RETURNS")}
			}
			return []sqllsp.Diagnostic{errorAt(s, i, "expected return type after RETURNS")}
		}
		i = skipWSAndComments(s, typeEnd)
		// 跳过特性子句：DETERMINISTIC / [NOT] DETERMINISTIC / NO SQL / READS SQL DATA / ...
		i = skipRoutineCharacteristics(s, i)
	} else {
		i = skipRoutineCharacteristics(s, i)
	}

	// BEGIN … END 配对
	beginAt := indexKeyword(s, i, "begin")
	if beginAt < 0 {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, max(0, i), "expected BEGIN … END body")}
		}
		// 允许无 BEGIN 的单语句体（MySQL 允许）；无进一步外壳错误
		return nil
	}
	bodyStart := skipWSAndComments(s, beginAt+5)
	endAt, ok := findMatchingEnd(s, bodyStart, 1)
	if !ok {
		if looksIncomplete(trimmed) {
			return []sqllsp.Diagnostic{hintAt(s, beginAt, "unclosed BEGIN … END")}
		}
		return []sqllsp.Diagnostic{errorAt(s, beginAt, "unclosed BEGIN … END")}
	}
	_ = endAt
	return nil
}

func diagnoseRoutineBody(text string) []sqllsp.Diagnostic {
	beginAt := findRoutineBegin(text)
	if beginAt < 0 {
		return nil
	}
	bodyStart := skipWSAndComments(text, beginAt+5)
	endAt, ok := findMatchingEnd(text, bodyStart, 1)
	if !ok || endAt <= bodyStart {
		return nil
	}
	body := text[bodyStart:endAt]
	stmts := splitTopLevelStatements(body)
	var diags []sqllsp.Diagnostic
	pr := parser.New()
	for _, st := range stmts {
		sql := strings.TrimSpace(st.text)
		if sql == "" {
			continue
		}
		if shouldSkipBodyStmt(sql) {
			continue
		}
		parseSQL := rewriteBodyStmtForTiDB(sql)
		_, _, err := pr.Parse(parseSQL, "", "")
		if err == nil {
			continue
		}
		msg := err.Error()
		severity := 1
		lower := strings.ToLower(msg)
		trimSQL := strings.TrimSpace(sql)
		if strings.Contains(lower, "near \"\"") ||
			(strings.Contains(lower, "expects") && strings.HasSuffix(trimSQL, ",")) ||
			strings.HasSuffix(trimSQL, "(") {
			severity = 4
		}
		relLine, relCol := 0, 0
		if m := lineColRe.FindStringSubmatch(msg); len(m) == 3 {
			if l, e := strconv.Atoi(m[1]); e == nil && l > 0 {
				relLine = l - 1
			}
			if c, e := strconv.Atoi(m[2]); e == nil && c > 0 {
				relCol = c - 1
			}
		}
		absOff := offsetFromLineCol(st.text, relLine, relCol)
		absPos := offsetToPosition(text, bodyStart+st.start+absOff)
		diags = append(diags, sqllsp.Diagnostic{
			Range: sqllsp.Range{
				Start: absPos,
				End:   sqllsp.Position{Line: absPos.Line, Character: absPos.Character + 1},
			},
			Severity: severity,
			Source:   "mysql-lsp",
			Message:  msg,
		})
	}
	return diags
}

type bodyStmt struct {
	start int // relative to body slice
	text  string
}

// splitTopLevelStatements 按顶层 ';' 分句；感知字符串/注释/括号，以及 IF/WHILE/LOOP/REPEAT/CASE 控制块。
func splitTopLevelStatements(body string) []bodyStmt {
	var out []bodyStmt
	n := len(body)
	i := 0
	stmtStart := 0
	for i < n {
		// 跳过空白，不推进 stmtStart（保留前导空白在切片内，便于偏移）
		c := body[i]
		if c == ' ' || c == '\t' || c == '\n' || c == '\r' {
			i++
			continue
		}
		// 注释
		if c == '-' && i+1 < n && body[i+1] == '-' {
			i = skipLineComment(body, i)
			continue
		}
		if c == '#' {
			i = skipLineComment(body, i)
			continue
		}
		if c == '/' && i+1 < n && body[i+1] == '*' {
			i = skipBlockComment(body, i)
			continue
		}
		// 字符串
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(body, i, c)
			continue
		}
		// 控制结构整块跳过（作为一条“语句”，后续 shouldSkip 会丢弃）
		if kwLen := matchControlBlockStart(body, i); kwLen > 0 {
			end, ok := skipControlBlock(body, i, kwLen)
			if !ok {
				// 半成品控制块：吞到末尾
				out = append(out, bodyStmt{start: stmtStart, text: body[stmtStart:]})
				return out
			}
			// 控制块后可能有 ';'
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
	// 控制块整体 / PL 专用（TiDB 无法解析）
	for _, kw := range []string{
		"if", "while", "loop", "repeat", "case",
		"declare", "leave", "iterate", "open", "fetch", "close",
		"handler", "resignal", "signal", "get",
	} {
		if matchKeywordAt(lower, 0, kw) {
			return true
		}
	}
	return false
}

// rewriteBodyStmtForTiDB 将 RETURN expr 改写为 SELECT expr，以便用 TiDB 校验表达式。
func rewriteBodyStmtForTiDB(sql string) string {
	s := strings.TrimSpace(sql)
	if matchKeywordAt(strings.ToLower(s), 0, "return") {
		rest := strings.TrimSpace(s[6:])
		if rest == "" {
			return "SELECT 1"
		}
		return "SELECT " + rest
	}
	return sql
}

func matchControlBlockStart(s string, i int) int {
	lower := strings.ToLower(s)
	for _, kw := range []string{"if", "while", "loop", "repeat", "case"} {
		if matchKeywordAt(lower, i, kw) {
			return len(kw)
		}
	}
	return 0
}

// skipControlBlock 从控制关键字起，找到匹配的 END IF / END WHILE / END LOOP / END REPEAT / END CASE / END。
func skipControlBlock(s string, start, kwLen int) (int, bool) {
	kw := strings.ToLower(s[start : start+kwLen])
	i := skipWSAndComments(s, start+kwLen)
	depth := 1
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
		if c == '#' {
			i = skipLineComment(s, i)
			continue
		}
		if c == '/' && i+1 < n && s[i+1] == '*' {
			i = skipBlockComment(s, i)
			continue
		}
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(s, i, c)
			continue
		}
		lower := strings.ToLower(s)
		// 嵌套同名控制块
		if nested := matchControlBlockStart(s, i); nested > 0 {
			nestedKw := lower[i : i+nested]
			// CASE 表达式内的 END 由 end 处理；嵌套 IF/WHILE 等加深
			if nestedKw == "if" || nestedKw == "while" || nestedKw == "loop" || nestedKw == "repeat" || nestedKw == "case" {
				depth++
				i += nested
				continue
			}
		}
		if matchKeywordAt(lower, i, "end") {
			after := skipWSAndComments(s, i+3)
			closer := ""
			switch {
			case matchKeywordAt(lower, after, "if"):
				closer = "if"
				after += 2
			case matchKeywordAt(lower, after, "while"):
				closer = "while"
				after += 5
			case matchKeywordAt(lower, after, "loop"):
				closer = "loop"
				after += 4
			case matchKeywordAt(lower, after, "repeat"):
				closer = "repeat"
				after += 6
			case matchKeywordAt(lower, after, "case"):
				closer = "case"
				after += 4
			}
			// END 或 END <kw> 都减深度；不强制 closer 与 opener 完全一致（容错）
			_ = closer
			_ = kw
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

func findRoutineBegin(text string) int {
	// 跳过外壳，找第一个顶层 BEGIN（在 CREATE … 之后）
	s := text
	i := skipLeadingNoise(s)
	createAt := indexKeyword(s, i, "create")
	if createAt < 0 {
		return indexKeyword(s, 0, "begin")
	}
	return indexKeyword(s, createAt+6, "begin")
}

// findMatchingEnd 从 bodyStart 起找与 beginDepth 匹配的 END（不含 BEGIN 关键字本身）。
func findMatchingEnd(s string, bodyStart, beginDepth int) (int, bool) {
	depth := beginDepth
	i := bodyStart
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
		if c == '#' {
			i = skipLineComment(s, i)
			continue
		}
		if c == '/' && i+1 < n && s[i+1] == '*' {
			i = skipBlockComment(s, i)
			continue
		}
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(s, i, c)
			continue
		}
		lower := strings.ToLower(s)
		if matchKeywordAt(lower, i, "begin") {
			depth++
			i += 5
			continue
		}
		if matchKeywordAt(lower, i, "case") {
			// CASE … END 不增减 beginDepth（由 END 后是否带 IF/WHILE 等区分太复杂）；
			// 简化：CASE 后的 END / END CASE 不减 beginDepth，仅当 END 后非控制后缀且无标识时减。
			// 这里用 caseDepth 局部处理。
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
			// END IF / END WHILE / END LOOP / END REPEAT / END CASE → 不减 beginDepth
			skip := 0
			switch {
			case matchKeywordAt(lower, after, "if"):
				skip = 2
			case matchKeywordAt(lower, after, "while"):
				skip = 5
			case matchKeywordAt(lower, after, "loop"):
				skip = 4
			case matchKeywordAt(lower, after, "repeat"):
				skip = 6
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
	// start 指向 CASE；找匹配 END [CASE]
	i := skipWSAndComments(s, start+4)
	depth := 1
	n := len(s)
	lower := strings.ToLower(s)
	for i < n {
		c := s[i]
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(s, i, c)
			continue
		}
		if c == '-' && i+1 < n && s[i+1] == '-' {
			i = skipLineComment(s, i)
			continue
		}
		if c == '#' {
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

// --- 扫描辅助 ---

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
		if c == '#' {
			i = skipLineComment(s, i)
			continue
		}
		if c == '/' && i+1 < n && s[i+1] == '*' {
			i = skipBlockComment(s, i)
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
	n := len(s)
	i += 2
	for i+1 < n {
		if s[i] == '*' && s[i+1] == '/' {
			return i + 2
		}
		i++
	}
	return n
}

func skipQuoted(s string, i int, quote byte) int {
	n := len(s)
	i++
	for i < n {
		c := s[i]
		if c == '\\' && quote != '`' {
			i += 2
			continue
		}
		if c == quote {
			// '' 转义
			if i+1 < n && s[i+1] == quote {
				i += 2
				continue
			}
			return i + 1
		}
		i++
	}
	return n
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
		if c == '\'' || c == '"' || c == '`' {
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

func skipDefinerClause(s string, i int) int {
	i = skipWSAndComments(s, i)
	if !matchKeywordAt(s, i, "definer") {
		return i
	}
	j := skipWSAndComments(s, i+7)
	if j >= len(s) || s[j] != '=' {
		return i
	}
	j = skipWSAndComments(s, j+1)
	// user@host
	end, ok := scanAccountPart(s, j)
	if !ok {
		return i
	}
	j = skipWSAndComments(s, end)
	if j >= len(s) || s[j] != '@' {
		return i
	}
	j = skipWSAndComments(s, j+1)
	end, ok = scanAccountPart(s, j)
	if !ok {
		return i
	}
	return end
}

func scanAccountPart(s string, i int) (int, bool) {
	if i >= len(s) {
		return 0, false
	}
	c := s[i]
	if c == '`' || c == '\'' || c == '"' {
		return skipQuoted(s, i, c), true
	}
	return scanIdent(s, i)
}

func scanIdent(s string, i int) (int, bool) {
	if i >= len(s) {
		return 0, false
	}
	if s[i] == '`' {
		return skipQuoted(s, i, '`'), true
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

// scanQualifiedIdent 扫描 name 或 schema.name（反引号均可）。
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
			return end, true // 半成品 schema. → 仍算扫到了第一段
		}
		return end2, true
	}
	return end, true
}

func scanTypeName(s string, i int) (int, bool) {
	// INT / VARCHAR(255) / DECIMAL(10,2) / DOUBLE PRECISION 等简化扫描
	end, ok := scanIdent(s, i)
	if !ok {
		return 0, false
	}
	j := skipWSAndComments(s, end)
	// 可选 (precision)
	if j < len(s) && s[j] == '(' {
		closeParen, ok := skipBalanced(s, j, '(', ')')
		if !ok {
			return end, true // 半成品类型也算扫到了名字
		}
		end = closeParen
		j = skipWSAndComments(s, end)
	}
	// UNSIGNED / ZEROFILL / CHARSET …
	for {
		j = skipWSAndComments(s, end)
		if matchKeywordAt(s, j, "unsigned") {
			end = j + 8
			continue
		}
		if matchKeywordAt(s, j, "zerofill") {
			end = j + 8
			continue
		}
		if matchKeywordAt(s, j, "precision") { // DOUBLE PRECISION
			end = j + 9
			continue
		}
		if matchKeywordAt(s, j, "character") {
			k := skipWSAndComments(s, j+9)
			if matchKeywordAt(s, k, "set") {
				k = skipWSAndComments(s, k+3)
				if e, ok := scanIdent(s, k); ok {
					end = e
					continue
				}
			}
		}
		if matchKeywordAt(s, j, "charset") {
			k := skipWSAndComments(s, j+7)
			if e, ok := scanIdent(s, k); ok {
				end = e
				continue
			}
		}
		if matchKeywordAt(s, j, "collate") {
			k := skipWSAndComments(s, j+7)
			if e, ok := scanIdent(s, k); ok {
				end = e
				continue
			}
		}
		break
	}
	return end, true
}

func skipRoutineCharacteristics(s string, i int) int {
	for {
		i = skipWSAndComments(s, i)
		if i >= len(s) {
			return i
		}
		lower := strings.ToLower(s)
		switch {
		case matchKeywordAt(lower, i, "language"):
			i = skipWSAndComments(s, i+8)
			if matchKeywordAt(lower, i, "sql") {
				i += 3
			}
		case matchKeywordAt(lower, i, "not"):
			j := skipWSAndComments(s, i+3)
			if matchKeywordAt(lower, j, "deterministic") {
				i = j + 13
			} else {
				return i
			}
		case matchKeywordAt(lower, i, "deterministic"):
			i += 13
		case matchKeywordAt(lower, i, "no"):
			j := skipWSAndComments(s, i+2)
			if matchKeywordAt(lower, j, "sql") {
				i = j + 3
			} else {
				return i
			}
		case matchKeywordAt(lower, i, "contains"):
			j := skipWSAndComments(s, i+8)
			if matchKeywordAt(lower, j, "sql") {
				i = j + 3
			} else {
				return i
			}
		case matchKeywordAt(lower, i, "reads"):
			j := skipWSAndComments(s, i+5)
			if matchKeywordAt(lower, j, "sql") {
				j = skipWSAndComments(s, j+3)
				if matchKeywordAt(lower, j, "data") {
					i = j + 4
				} else {
					return i
				}
			} else {
				return i
			}
		case matchKeywordAt(lower, i, "modifies"):
			j := skipWSAndComments(s, i+8)
			if matchKeywordAt(lower, j, "sql") {
				j = skipWSAndComments(s, j+3)
				if matchKeywordAt(lower, j, "data") {
					i = j + 4
				} else {
					return i
				}
			} else {
				return i
			}
		case matchKeywordAt(lower, i, "sql"):
			j := skipWSAndComments(s, i+3)
			if matchKeywordAt(lower, j, "security") {
				j = skipWSAndComments(s, j+8)
				if matchKeywordAt(lower, j, "definer") {
					i = j + 7
				} else if matchKeywordAt(lower, j, "invoker") {
					i = j + 7
				} else {
					return i
				}
			} else {
				return i
			}
		case matchKeywordAt(lower, i, "comment"):
			j := skipWSAndComments(s, i+7)
			if j < len(s) && (s[j] == '\'' || s[j] == '"') {
				i = skipQuoted(s, j, s[j])
			} else {
				return i
			}
		default:
			return i
		}
	}
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
	// 边界：后接非标识符字符
	if i+n < len(s) {
		r := rune(s[i+n])
		if isIdentCont(r) {
			return false
		}
	}
	// 前边界由调用方保证（从 token 起点匹配）
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
		if c == '\'' || c == '"' || c == '`' {
			i = skipQuoted(s, i, c)
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

func looksIncomplete(trimmed string) bool {
	if trimmed == "" {
		return true
	}
	// 未以 END / END$$ / ; 收尾的半成品
	lower := strings.ToLower(strings.TrimRight(trimmed, " \t\r\n"))
	if strings.HasSuffix(lower, ",") || strings.HasSuffix(lower, "(") {
		return true
	}
	if !strings.Contains(lower, "end") {
		return true
	}
	return false
}

func isAtEOFNoise(s string, i int) bool {
	return skipWSAndComments(s, i) >= len(s)
}

func errorAt(s string, offset int, msg string) sqllsp.Diagnostic {
	pos := offsetToPosition(s, offset)
	return sqllsp.Diagnostic{
		Range: sqllsp.Range{
			Start: pos,
			End:   sqllsp.Position{Line: pos.Line, Character: pos.Character + 1},
		},
		Severity: 1,
		Source:   "mysql-lsp",
		Message:  msg,
	}
}

func hintAt(s string, offset int, msg string) sqllsp.Diagnostic {
	d := errorAt(s, offset, msg)
	d.Severity = 4
	return d
}

func offsetToPosition(s string, offset int) sqllsp.Position {
	if offset < 0 {
		offset = 0
	}
	if offset > len(s) {
		offset = len(s)
	}
	line, col := 0, 0
	for i := 0; i < offset; i++ {
		if s[i] == '\n' {
			line++
			col = 0
		} else {
			col++
		}
	}
	return sqllsp.Position{Line: line, Character: col}
}

func offsetFromLineCol(s string, line, col int) int {
	curLine := 0
	i := 0
	n := len(s)
	for i < n && curLine < line {
		if s[i] == '\n' {
			curLine++
		}
		i++
	}
	off := i + col
	if off > n {
		off = n
	}
	if off < 0 {
		off = 0
	}
	return off
}

func max(a, b int) int {
	if a > b {
		return a
	}
	return b
}
