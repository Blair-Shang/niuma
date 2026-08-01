package kingbaseparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// stmtSpan 文档内一条语句的切片。
type stmtSpan struct {
	start int
	text  string
}

// splitDocumentStatements 顶层分句：';' 与 Oracle 兼容模式行首 `/`；
// 感知字符串/注释/BEGIN…END，以及 CREATE PACKAGE[ BODY]…END（包头无 BEGIN）。
func splitDocumentStatements(text string) []stmtSpan {
	var out []stmtSpan
	n := len(text)
	i := 0
	stmtStart := 0
	beginDepth := 0
	packageDepth := 0
	lower := strings.ToLower(text)
	for i < n {
		c := text[i]
		if c == ' ' || c == '\t' || c == '\r' {
			i++
			continue
		}
		if c == '\n' {
			// 检查下一有效 token 是否为独占一行的 /
			i++
			continue
		}
		if c == '-' && i+1 < n && text[i+1] == '-' {
			i = skipLineComment(text, i)
			continue
		}
		if c == '/' && i+1 < n && text[i+1] == '*' {
			i = skipBlockComment(text, i)
			continue
		}
		if (c == 'q' || c == 'Q') && i+1 < n && text[i+1] == '\'' {
			i = skipQQuote(text, i)
			continue
		}
		if c == '\'' {
			i = skipQuoted(text, i, '\'')
			continue
		}
		if c == '"' {
			i = skipQuoted(text, i, '"')
			continue
		}
		if c == '$' {
			i = skipDollarQuote(text, i)
			continue
		}
		if matchKeywordAt(lower, i, "create") && packageDepth == 0 && beginDepth == 0 {
			j := skipWSAndComments(text, i+6)
			if matchKeywordAt(lower, j, "or") {
				j = skipWSAndComments(text, j+2)
				if matchKeywordAt(lower, j, "replace") {
					j = skipWSAndComments(text, j+7)
				}
			}
			if matchKeywordAt(lower, j, "package") {
				packageDepth++
			}
			i += 6
			continue
		}
		if matchKeywordAt(lower, i, "begin") {
			beginDepth++
			i += 5
			continue
		}
		if matchKeywordAt(lower, i, "end") && (beginDepth > 0 || packageDepth > 0) {
			after := skipWSAndComments(text, i+3)
			// END IF / END LOOP / END CASE 等不减 beginDepth / packageDepth
			skip := 0
			switch {
			case matchKeywordAt(lower, after, "if"):
				skip = 2
			case matchKeywordAt(lower, after, "loop"):
				skip = 4
			case matchKeywordAt(lower, after, "while"):
				skip = 5
			case matchKeywordAt(lower, after, "case"):
				skip = 4
			}
			if skip > 0 {
				i = after + skip
				continue
			}
			if beginDepth > 0 {
				beginDepth--
			} else {
				packageDepth--
			}
			// 跳过可选的 END 标签 / 包名（含 "quoted"）
			i = after
			if end, ok := scanIdent(text, i); ok {
				i = end
			}
			continue
		}
		inBlock := beginDepth > 0 || packageDepth > 0
		// 独占行的 / 终止符（块外）
		if c == '/' && !inBlock && isSlashTerminator(text, i) {
			chunk := strings.TrimSpace(text[stmtStart:i])
			if chunk != "" {
				out = append(out, stmtSpan{start: stmtStart, text: text[stmtStart:i]})
			}
			i++
			stmtStart = i
			continue
		}
		if c == ';' && !inBlock {
			out = append(out, stmtSpan{start: stmtStart, text: text[stmtStart:i]})
			i++
			stmtStart = i
			continue
		}
		i++
	}
	if stmtStart < n {
		rest := strings.TrimSpace(text[stmtStart:])
		if rest != "" {
			out = append(out, stmtSpan{start: stmtStart, text: text[stmtStart:]})
		}
	}
	return out
}

// isSlashTerminator 判断 offset 处的 / 是否为脚本终止符（行上仅空白+/）。
func isSlashTerminator(s string, offset int) bool {
	if offset >= len(s) || s[offset] != '/' {
		return false
	}
	// 前：到行首仅空白
	j := offset - 1
	for j >= 0 && s[j] != '\n' {
		if s[j] != ' ' && s[j] != '\t' && s[j] != '\r' {
			return false
		}
		j--
	}
	// 后：到行尾仅空白
	k := offset + 1
	for k < len(s) && s[k] != '\n' {
		if s[k] != ' ' && s[k] != '\t' && s[k] != '\r' {
			return false
		}
		k++
	}
	return true
}

func diagnoseDML(text string, kind StmtKind, compat CompatMode) []sqllsp.Diagnostic {
	trimmed := strings.TrimSpace(text)
	if trimmed == "" {
		return nil
	}
	var diags []sqllsp.Diagnostic
	diags = append(diags, diagnoseBalance(text)...)
	diags = append(diags, diagnoseTypos(text)...)
	incomplete := looksIncomplete(trimmed)

	switch kind {
	case StmtSelect:
		diags = append(diags, diagnoseSelect(text, incomplete)...)
		diags = append(diags, diagnoseCompatSelect(text, compat, incomplete)...)
	case StmtInsert:
		diags = append(diags, diagnoseInsert(text, incomplete)...)
	case StmtUpdate:
		diags = append(diags, diagnoseUpdate(text, incomplete)...)
	case StmtDelete:
		diags = append(diags, diagnoseDelete(text, incomplete)...)
	case StmtMerge:
		diags = append(diags, diagnoseMerge(text, incomplete)...)
	}
	// 半成品尾部（WHERE x= / AND / SET …）：Warning 黄线，避免敲字时大红，也避免完全静默
	diags = append(diags, diagnoseIncompleteTail(text)...)
	return diags
}

// diagnoseIncompleteTail 检测语句尾部明显未写完的运算符/子句关键字。
// 使用 Warning（非 Error），兼顾「能看见」与「输入中不刺眼」。
func diagnoseIncompleteTail(text string) []sqllsp.Diagnostic {
	end := contentEndBeforeTerminators(text)
	if end <= 0 {
		return nil
	}
	body := text[:end]

	// 尾部比较/算术运算符（长的优先）
	for _, op := range []string{"<>", "!=", "<=", ">=", "||", "=", "<", ">", "+", "-", "*", "/", "%"} {
		if !strings.HasSuffix(body, op) {
			continue
		}
		off := end - len(op)
		if op == "-" || op == "/" || op == "*" || op == "+" {
			// 避免把 `--` 注释、`/*`、单独 `-1` 前缀误判：仅当运算符前有非空白表达式字符
			if off == 0 || isSpaceByte(body[off-1]) {
				continue
			}
		}
		if op == "/" && off > 0 && body[off-1] == '*' {
			continue
		}
		return []sqllsp.Diagnostic{
			warningAt(text, off, "incomplete expression after '"+op+"'"),
		}
	}

	// 尾部子句关键字
	for _, kw := range []string{
		"where", "and", "or", "from", "join", "on", "using", "set", "values",
		"into", "having", "when", "then", "else", "select", "by", "as", "is",
		"like", "in", "between", "exists",
	} {
		if !hasTrailingKeyword(body, kw) {
			continue
		}
		off := end - len(kw)
		return []sqllsp.Diagnostic{
			warningAt(text, off, "incomplete clause after "+strings.ToUpper(kw)),
		}
	}
	return nil
}

func contentEndBeforeTerminators(text string) int {
	end := len(text)
	for end > 0 {
		end = len(strings.TrimRight(text[:end], " \t\r\n"))
		if end == 0 {
			return 0
		}
		c := text[end-1]
		if c == ';' {
			end--
			continue
		}
		// 独占行的脚本终止符 /
		if c == '/' && isSlashTerminator(text, end-1) {
			end--
			continue
		}
		break
	}
	return end
}

func hasTrailingKeyword(body, kw string) bool {
	if len(body) < len(kw) {
		return false
	}
	tail := body[len(body)-len(kw):]
	if !strings.EqualFold(tail, kw) {
		return false
	}
	if len(body) == len(kw) {
		return true
	}
	prev := body[len(body)-len(kw)-1]
	// 关键字边界：前接空白或开括号等，避免 activeflag 命中 flag
	return isSpaceByte(prev) || prev == '(' || prev == ','
}

func isSpaceByte(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}

func diagnoseBalance(text string) []sqllsp.Diagnostic {
	var diags []sqllsp.Diagnostic
	incomplete := looksIncomplete(strings.TrimSpace(text))
	emit := func(off int, msg string) {
		if incomplete {
			diags = append(diags, hintAt(text, off, msg))
		} else {
			diags = append(diags, errorAt(text, off, msg))
		}
	}

	paren := 0
	n := len(text)
	for i := 0; i < n; {
		c := text[i]
		if c == '-' && i+1 < n && text[i+1] == '-' {
			i = skipLineComment(text, i)
			continue
		}
		if c == '/' && i+1 < n && text[i+1] == '*' {
			start := i
			end, closed := skipBlockCommentChecked(text, i)
			if !closed {
				emit(start, "unclosed block comment")
			}
			i = end
			continue
		}
		if (c == 'q' || c == 'Q') && i+1 < n && text[i+1] == '\'' {
			start := i
			end, closed := skipQQuoteChecked(text, i)
			if !closed {
				emit(start, "unclosed Q-quoted string")
			}
			i = end
			continue
		}
		if c == '\'' {
			start := i
			end, closed := skipQuotedChecked(text, i, '\'')
			if !closed {
				emit(start, "unclosed string literal")
			}
			i = end
			continue
		}
		if c == '"' {
			start := i
			end, closed := skipQuotedChecked(text, i, '"')
			if !closed {
				emit(start, "unclosed quoted identifier")
			}
			i = end
			continue
		}
		if c == '(' {
			paren++
			i++
			continue
		}
		if c == ')' {
			paren--
			if paren < 0 {
				emit(i, "unmatched ')'")
				paren = 0
			}
			i++
			continue
		}
		i++
	}
	if paren > 0 {
		emit(max(0, len(text)-1), "unclosed '('")
	}
	return diags
}

var typoMap = map[string]string{
	"form":      "FROM",
	"fro":       "FROM",
	"whre":      "WHERE",
	"wher":      "WHERE",
	"gruop":     "GROUP",
	"grup":      "GROUP",
	"oreder":    "ORDER",
	"oder":      "ORDER",
	"havin":     "HAVING",
	"havng":     "HAVING",
	"inset":     "INSERT",
	"inser":     "INSERT",
	"udpate":    "UPDATE",
	"updte":     "UPDATE",
	"updat":     "UPDATE",
	"updae":     "UPDATE",
	"delelte":   "DELETE",
	"delet":     "DELETE",
	"slect":     "SELECT",
	"selet":     "SELECT",
	"selct":     "SELECT",
	"vallues":   "VALUES",
	"valeus":    "VALUES",
	"tabel":     "TABLE",
	"procedrue": "PROCEDURE",
	"fucntion":  "FUNCTION",
}

// diagnoseUnknownLead 未识别语句的首词：结合后续子句或关键字前缀，提示可能的 DML 动词。
// 仅扫首标识符，避免把列名 up / form 等误报成 Error（列名仍可由 typoMap 在全文路径误伤，保持既有策略）。
func diagnoseUnknownLead(text string) []sqllsp.Diagnostic {
	i := skipLeadingNoise(text)
	if i >= len(text) || !isIdentStart(rune(text[i])) {
		return nil
	}
	start := i
	i++
	for i < len(text) && isIdentCont(rune(text[i])) {
		i++
	}
	word := text[start:i]
	lower := strings.ToLower(word)
	if _, ok := typoMap[lower]; ok {
		return nil
	}

	rest := text[i:]
	suggest := ""
	switch {
	case indexKeyword(rest, 0, "set") >= 0:
		suggest = "UPDATE"
	case indexKeyword(rest, 0, "into") >= 0 || indexKeyword(rest, 0, "values") >= 0:
		suggest = "INSERT"
	case indexKeyword(rest, 0, "from") >= 0 && indexKeyword(rest, 0, "select") < 0:
		switch {
		case strings.HasPrefix("delete", lower) && lower != "delete":
			suggest = "DELETE"
		case strings.HasPrefix("select", lower) && lower != "select":
			suggest = "SELECT"
		case strings.HasPrefix("truncate", lower) && lower != "truncate":
			suggest = "TRUNCATE"
		}
	}
	if suggest == "" {
		for _, cand := range []string{"update", "delete", "select", "insert", "merge", "truncate"} {
			if len(lower) >= 2 && len(lower) < len(cand) && strings.HasPrefix(cand, lower) {
				suggest = strings.ToUpper(cand)
				break
			}
		}
	}
	if suggest == "" {
		return nil
	}
	return []sqllsp.Diagnostic{
		errorAt(text, start, "unknown keyword '"+word+"'; did you mean "+suggest+"?"),
	}
}

func diagnoseTypos(text string) []sqllsp.Diagnostic {
	var diags []sqllsp.Diagnostic
	n := len(text)
	for i := 0; i < n; {
		i = skipWSAndComments(text, i)
		if i >= n {
			break
		}
		c := text[i]
		if (c == 'q' || c == 'Q') && i+1 < n && text[i+1] == '\'' {
			i = skipQQuote(text, i)
			continue
		}
		if c == '\'' {
			i = skipQuoted(text, i, '\'')
			continue
		}
		if c == '"' {
			i = skipQuoted(text, i, '"')
			continue
		}
		if isIdentStart(rune(c)) {
			start := i
			i++
			for i < n && isIdentCont(rune(text[i])) {
				i++
			}
			word := strings.ToLower(text[start:i])
			if right, ok := typoMap[word]; ok {
				diags = append(diags, errorAt(text, start, "unknown keyword '"+text[start:i]+"'; did you mean "+right+"?"))
			}
			continue
		}
		i++
	}
	return diags
}

func diagnoseSelect(text string, incomplete bool) []sqllsp.Diagnostic {
	i := skipLeadingNoise(text)
	if matchKeywordAt(text, i, "with") {
		// CTE：至少要有后续 SELECT；半成品不报
		if indexKeyword(text, i+4, "select") < 0 {
			if incomplete {
				return []sqllsp.Diagnostic{hintAt(text, i, "incomplete WITH … SELECT")}
			}
			return []sqllsp.Diagnostic{errorAt(text, i, "WITH requires SELECT")}
		}
		return nil
	}
	if !matchKeywordAt(text, i, "select") {
		return nil
	}
	// SELECT 后不能立刻结束（除非半成品）
	after := skipWSAndComments(text, i+6)
	if after >= len(text) || isAtEOFNoise(text, after) {
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, i, "incomplete SELECT")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "SELECT requires select list")}
	}
	var diags []sqllsp.Diagnostic
	// 明显子句乱序：WHERE 出现在 FROM 之前（顶层）
	lower := strings.ToLower(text)
	fromAt := indexKeyword(lower, after, "from")
	whereAt := indexKeyword(lower, after, "where")
	if fromAt >= 0 && whereAt >= 0 && whereAt < fromAt && !incomplete {
		diags = append(diags, errorAt(text, whereAt, "WHERE appears before FROM"))
	}
	if fromAt >= 0 {
		diags = append(diags, diagnoseFromClause(text, fromAt, incomplete)...)
	}
	return diags
}

// diagnoseFromClause 检查 FROM 表引用后是否多出标识符（如 FROM t a ew）。
// 只做轻量表因子扫描，不解析完整 JOIN 树；JOIN/WHERE 等关键字视为合法后继。
func diagnoseFromClause(text string, fromAt int, incomplete bool) []sqllsp.Diagnostic {
	i := skipWSAndComments(text, fromAt+4)
	if i >= len(text) || isAtEOFNoise(text, i) {
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, fromAt, "incomplete FROM")}
		}
		return []sqllsp.Diagnostic{errorAt(text, fromAt, "FROM requires table reference")}
	}
	for {
		next, errOff, ok := skipFromTableFactor(text, i)
		if !ok {
			if incomplete {
				return []sqllsp.Diagnostic{hintAt(text, errOff, "incomplete table reference")}
			}
			return []sqllsp.Diagnostic{errorAt(text, errOff, "expected table reference after FROM")}
		}
		i = skipWSAndComments(text, next)
		if i >= len(text) || isAtEOFNoise(text, i) || text[i] == ';' {
			return nil
		}
		if text[i] == ',' {
			i = skipWSAndComments(text, i+1)
			continue
		}
		if isFromClauseFollower(text, i) {
			return nil
		}
		// 表名+可选别名之后又出现标识符/符号 → 与服务端语法错误同类
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, i, "unexpected token after table reference")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "unexpected token after table reference")}
	}
}

// skipFromTableFactor 消费 table [AS] alias；返回消费后下标。
func skipFromTableFactor(text string, i int) (next int, errAt int, ok bool) {
	i = skipWSAndComments(text, i)
	if i >= len(text) {
		return i, i, false
	}
	if text[i] == '(' {
		closeParen, balanced := skipBalanced(text, i, '(', ')')
		if !balanced {
			return i, i, false
		}
		i = skipWSAndComments(text, closeParen)
	} else {
		end, scanned := scanQualifiedIdent(text, i)
		if !scanned {
			return i, i, false
		}
		i = skipWSAndComments(text, end)
	}
	// 可选别名：AS alias | alias（非后继关键字）
	if matchKeywordAt(text, i, "as") {
		j := skipWSAndComments(text, i+2)
		end, scanned := scanIdent(text, j)
		if !scanned {
			return i, j, false
		}
		return end, i, true
	}
	if end, scanned := scanIdent(text, i); scanned && !isFromClauseFollower(text, i) {
		return end, i, true
	}
	return i, i, true
}

func isFromClauseFollower(text string, i int) bool {
	for _, kw := range []string{
		"where", "group", "order", "having", "union", "intersect", "minus", "except",
		"fetch", "limit", "offset", "for", "start", "connect",
		"join", "inner", "left", "right", "full", "cross", "natural", "outer",
		"on", "using", "partition",
	} {
		if matchKeywordAt(text, i, kw) {
			return true
		}
	}
	return false
}

func diagnoseInsert(text string, incomplete bool) []sqllsp.Diagnostic {
	i := skipLeadingNoise(text)
	if !matchKeywordAt(text, i, "insert") {
		return nil
	}
	i = skipWSAndComments(text, i+6)
	if !matchKeywordAt(text, i, "into") {
		if incomplete || i >= len(text) {
			return []sqllsp.Diagnostic{hintAt(text, max(0, i), "INSERT requires INTO")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "INSERT requires INTO")}
	}
	i = skipWSAndComments(text, i+4)
	nameEnd, ok := scanQualifiedIdent(text, i)
	if !ok {
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, i, "expected table name after INSERT INTO")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "expected table name after INSERT INTO")}
	}
	i = skipWSAndComments(text, nameEnd)
	if i < len(text) && text[i] == '(' {
		closeParen, ok := skipBalanced(text, i, '(', ')')
		if !ok {
			if incomplete {
				return []sqllsp.Diagnostic{hintAt(text, i, "unclosed column list")}
			}
			return []sqllsp.Diagnostic{errorAt(text, i, "unclosed column list")}
		}
		i = skipWSAndComments(text, closeParen)
	}
	if matchKeywordAt(text, i, "values") || matchKeywordAt(text, i, "select") || matchKeywordAt(text, i, "with") {
		return nil
	}
	if incomplete || i >= len(text) {
		return []sqllsp.Diagnostic{hintAt(text, max(0, i), "INSERT requires VALUES or SELECT")}
	}
	return []sqllsp.Diagnostic{errorAt(text, i, "INSERT requires VALUES or SELECT")}
}

func diagnoseUpdate(text string, incomplete bool) []sqllsp.Diagnostic {
	i := skipLeadingNoise(text)
	if !matchKeywordAt(text, i, "update") {
		return nil
	}
	i = skipWSAndComments(text, i+6)
	nameEnd, ok := scanQualifiedIdent(text, i)
	if !ok {
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, i, "expected table name after UPDATE")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "expected table name after UPDATE")}
	}
	i = skipWSAndComments(text, nameEnd)
	// 可选别名
	if end, ok := scanIdent(text, i); ok && !matchKeywordAt(text, i, "set") {
		i = skipWSAndComments(text, end)
	}
	if !matchKeywordAt(text, i, "set") {
		if incomplete || i >= len(text) {
			return []sqllsp.Diagnostic{hintAt(text, max(0, i), "UPDATE requires SET")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "UPDATE requires SET")}
	}
	return nil
}

func diagnoseDelete(text string, incomplete bool) []sqllsp.Diagnostic {
	i := skipLeadingNoise(text)
	if !matchKeywordAt(text, i, "delete") {
		return nil
	}
	i = skipWSAndComments(text, i+6)
	// DELETE FROM t 或 DELETE t（Oracle/Kingbase）
	if matchKeywordAt(text, i, "from") {
		i = skipWSAndComments(text, i+4)
	}
	if _, ok := scanQualifiedIdent(text, i); !ok {
		if incomplete || i >= len(text) {
			return []sqllsp.Diagnostic{hintAt(text, max(0, i), "DELETE requires table name")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "DELETE requires table name")}
	}
	return nil
}

func diagnoseMerge(text string, incomplete bool) []sqllsp.Diagnostic {
	i := skipLeadingNoise(text)
	if !matchKeywordAt(text, i, "merge") {
		return nil
	}
	i = skipWSAndComments(text, i+5)
	if !matchKeywordAt(text, i, "into") {
		if incomplete || i >= len(text) {
			return []sqllsp.Diagnostic{hintAt(text, max(0, i), "MERGE requires INTO")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "MERGE requires INTO")}
	}
	if indexKeyword(text, i, "using") < 0 {
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, i, "MERGE requires USING")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "MERGE requires USING")}
	}
	whenAt := indexKeyword(text, i, "when")
	if whenAt < 0 {
		if incomplete {
			return []sqllsp.Diagnostic{hintAt(text, i, "MERGE requires WHEN matched/not matched clause")}
		}
		return []sqllsp.Diagnostic{errorAt(text, i, "MERGE requires WHEN matched/not matched clause")}
	}
	lower := strings.ToLower(text)
	hasMatched := strings.Contains(lower[whenAt:], "matched")
	if !hasMatched && !incomplete {
		return []sqllsp.Diagnostic{errorAt(text, whenAt, "MERGE WHEN clause requires MATCHED or NOT MATCHED")}
	}
	return nil
}

// diagnoseDDLLight 轻量 DDL：括号/引号平衡 + CREATE 后关键字。
func diagnoseDDLLight(text string, kind StmtKind, compat CompatMode) []sqllsp.Diagnostic {
	trimmed := strings.TrimSpace(text)
	incomplete := looksIncomplete(trimmed)
	diags := diagnoseBalance(text)
	diags = append(diags, diagnoseTypos(text)...)
	diags = append(diags, diagnoseCompatSelect(text, compat, incomplete)...)
	i := skipLeadingNoise(text)
	if !matchKeywordAt(text, i, "create") {
		return diags
	}
	i = skipWSAndComments(text, i+6)
	if matchKeywordAt(text, i, "or") {
		i = skipWSAndComments(text, i+2)
		if matchKeywordAt(text, i, "replace") {
			i = skipWSAndComments(text, i+7)
		}
	}
	need := ""
	switch kind {
	case StmtCreateTable:
		need = "table"
	case StmtCreateView:
		need = "view"
	case StmtCreateSequence:
		need = "sequence"
	}
	if need != "" && !matchKeywordAt(text, i, need) {
		if incomplete {
			diags = append(diags, hintAt(text, i, "expected "+strings.ToUpper(need)))
		} else {
			diags = append(diags, errorAt(text, i, "expected "+strings.ToUpper(need)))
		}
	}
	return diags
}
