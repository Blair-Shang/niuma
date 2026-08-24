package sqllsp

import (
	"strings"
	"unicode"
)

// HeuristicCompletionContext 通用 SQL 补全槽位启发式（半成品语句友好）。
// 方言可在此基础上覆盖 Schema/Table 语义；会注入 ExtractTableRefs 绑定表。
// 仅分析光标所在当前语句，避免上一句 UPDATE…SET 等污染本句 FROM/JOIN 补全。
func HeuristicCompletionContext(text string, pos Position, keywords []string) CompletionContext {
	offset := OffsetFromPosition(text, pos)
	prefix := IdentPrefixAt(text, offset)
	stmtStart, stmt := currentStatementSpan(text, offset)
	rel := offset - stmtStart
	if rel < 0 {
		rel = 0
	}
	if rel > len(stmt) {
		rel = len(stmt)
	}
	before := stmt[:rel]
	lower := strings.ToLower(before)

	cc := CompletionContext{
		Prefix:   prefix,
		Keywords: keywords,
		Tables:   ExtractTableRefs(text, offset),
	}

	defaultDB := "" // 调用方/Server 再填；绑定解析别名时 schema 可空

	// schema.table 或 db.table. 或 alias.col；CALL db.| → 例程
	if dotSchema, rest, ok := splitTrailingDotIdent(before); ok {
		if schema, table, ok2 := splitTrailingDotIdent(before[:len(before)-len(rest)-1]); ok2 {
			// a.b.|c  → column in table b of schema a
			cc.Schema = stripIdent(schema)
			cc.Table = stripIdent(table)
			cc.Prefix = stripIdent(rest)
			if cc.Prefix == "" {
				cc.Prefix = prefix
			}
			cc.Expect = []CompletionKind{KindColumn}
			return cc
		}
		// x.| → 优先别名/表名 → 仅列；否则 schema 下表 + 列双义
		name := stripIdent(dotSchema)
		if inCallClause(lower) {
			cc.Schema = name
			cc.Expect = []CompletionKind{KindRoutine}
			cc.RoutineFilter = ""
			return cc
		}
		if sch, tbl, ok := ResolveDotQualifier(cc.Tables, name, defaultDB); ok {
			cc.Schema = sch
			cc.Table = tbl
			cc.Expect = []CompletionKind{KindColumn}
			return cc
		}
		cc.Schema = name
		cc.Table = name
		cc.Expect = []CompletionKind{KindTable, KindColumn}
		return cc
	}

	// CALL proc|
	if inCallClause(lower) {
		cc.Expect = []CompletionKind{KindRoutine, KindSchema, KindKeyword}
		cc.RoutineFilter = ""
		return cc
	}

	// UPDATE t SET | / SET col
	if idx := lastIndexKeyword(lower, " set "); idx >= 0 {
		head := strings.TrimSpace(before[:idx])
		table := lastIdent(head)
		if table != "" {
			cc.Table = table
			if sch, tbl, ok := splitQual(table); ok {
				cc.Schema = sch
				cc.Table = tbl
			} else if sch, tbl, ok := ResolveDotQualifier(cc.Tables, table, defaultDB); ok {
				cc.Schema = sch
				cc.Table = tbl
			}
			cc.Expect = []CompletionKind{KindColumn, KindFunction, KindRoutine, KindKeyword}
			cc.RoutineFilter = "function"
			return cc
		}
	}

	// WHERE / ON / AND / OR / HAVING → 绑定表列并集 + 函数 + keywords（不再只猜第一张表）
	if hasTrailingClause(lower, []string{" where ", " having ", " on ", " and ", " or "}) {
		cc.Expect = []CompletionKind{KindColumn, KindFunction, KindRoutine, KindKeyword, KindSchema}
		cc.RoutineFilter = "function"
		return cc
	}

	// FROM / JOIN / INTO / UPDATE / TABLE → tables (+ schemas)
	if hasTrailingClause(lower, []string{
		" from ", " join ", " into ", " update ", " table ", " tables ",
	}) {
		cc.Expect = []CompletionKind{KindTable, KindSchema, KindKeyword}
		return cc
	}

	// SELECT 列表：允许逗号/表达式；直到顶层 FROM/WHERE…（CREATE VIEW … AS SELECT 同样适用）
	if inSelectList(lower) {
		cc.Expect = []CompletionKind{KindColumn, KindFunction, KindRoutine, KindKeyword, KindSchema, KindTable}
		cc.RoutineFilter = "function"
		return cc
	}

	cc.Expect = []CompletionKind{KindKeyword, KindFunction, KindSchema, KindTable}
	return cc
}

// inCallClause 光标前是否仍处于 CALL 过程名位置（尚未进入参数列表）。
func inCallClause(lower string) bool {
	idx := findLastKeyword(lower, "call")
	if idx < 0 {
		return false
	}
	rest := strings.TrimSpace(lower[idx+len("call"):])
	if rest == "" {
		return true
	}
	// CALL db.proc 或 CALL proc；进入 ( 则离开过程名槽
	for _, r := range rest {
		if r == '(' {
			return false
		}
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' || r == '`' || r == '"' || r == '[' || r == ']' || r == '.' || unicode.IsSpace(r) {
			continue
		}
		return false
	}
	return true
}

func splitTrailingDotIdent(before string) (left, right string, ok bool) {
	i := skipIdentBackward(before, len(before)-1)
	right = before[i+1:]
	if i < 0 || before[i] != '.' {
		return "", "", false
	}
	j := skipIdentBackward(before, i-1)
	left = before[j+1 : i]
	if left == "" {
		return "", "", false
	}
	return left, right, true
}

// skipIdentBackward 从 i 向左跳过一个标识符（含 [bracket] / `backtick` / "quote"），返回标识符前一字节下标。
func skipIdentBackward(s string, i int) int {
	if i < 0 || i >= len(s) {
		return i
	}
	if s[i] == ']' {
		for j := i - 1; j >= 0; j-- {
			if s[j] == '[' {
				return j - 1
			}
		}
		return -1
	}
	for i >= 0 {
		r := rune(s[i])
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' || r == '`' || r == '"' {
			i--
			continue
		}
		break
	}
	return i
}

func splitQual(name string) (schema, table string, ok bool) {
	name = strings.TrimSpace(name)
	if i := strings.LastIndex(name, "."); i > 0 {
		return stripIdent(name[:i]), stripIdent(name[i+1:]), true
	}
	return "", stripIdent(name), false
}

func lastIdent(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return ""
	}
	i := skipIdentBackward(s, len(s)-1)
	if i >= 0 && s[i] == '.' {
		j := skipIdentBackward(s, i-1)
		left := stripIdent(s[j+1 : i])
		right := stripIdent(s[i+1:])
		if left != "" && right != "" {
			return left + "." + right
		}
		return right
	}
	return stripIdent(s[i+1:])
}

func lastIndexKeyword(lower, kw string) int {
	return strings.LastIndex(lower, kw)
}

func hasTrailingClause(lower string, markers []string) bool {
	trimmed := strings.TrimRightFunc(lower, unicode.IsSpace)
	for _, m := range markers {
		m = strings.TrimSpace(m)
		if m == "" {
			continue
		}
		// 允许 "from" 结尾或 "from xxx" 部分
		idx := strings.LastIndex(trimmed, m)
		if idx < 0 {
			// 也试带空格形式
			idx = strings.LastIndex(trimmed, " "+m+" ")
			if idx < 0 && strings.HasSuffix(trimmed, " "+m) {
				return true
			}
			if idx < 0 && strings.HasSuffix(trimmed, m) {
				return true
			}
			continue
		}
		// 关键字后主要是空白或标识符前缀
		after := strings.TrimSpace(trimmed[idx+len(m):])
		if after == "" || isIdentOnly(after) {
			return true
		}
	}
	return false
}

func isIdentOnly(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$' || r == '`' || r == '"' || r == '[' || r == ']' || r == '.' {
			continue
		}
		if unicode.IsSpace(r) {
			continue
		}
		return false
	}
	return true
}

// selectListEnders 出现在 SELECT 后顶层时，表示已离开 select list。
var selectListEnders = []string{
	"from", "into", "where", "group", "order", "having", "limit", "union", "for", "window",
}

// inSelectList 判断光标前是否仍处于 SELECT 投影列表（含多列逗号、*、简单表达式）。
// 子查询括号内的 FROM 不计入，避免 `SELECT (SELECT a FROM t), b|` 误判。
func inSelectList(lower string) bool {
	idx := findLastKeyword(lower, "select")
	if idx < 0 {
		return false
	}
	rest := lower[idx+len("select"):]
	return !hasTopLevelKeyword(rest, selectListEnders)
}

func findLastKeyword(lower, kw string) int {
	if kw == "" || len(lower) < len(kw) {
		return -1
	}
	for i := len(lower); i >= len(kw); i-- {
		start := i - len(kw)
		if lower[start:i] != kw {
			continue
		}
		if start > 0 && isWordChar(rune(lower[start-1])) {
			continue
		}
		if i < len(lower) && isWordChar(rune(lower[i])) {
			continue
		}
		return start
	}
	return -1
}

func hasTopLevelKeyword(s string, kws []string) bool {
	depth := 0
	for i := 0; i < len(s); {
		c := s[i]
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
		if depth == 0 {
			for _, kw := range kws {
				n := len(kw)
				if i+n > len(s) || s[i:i+n] != kw {
					continue
				}
				if i > 0 && isWordChar(rune(s[i-1])) {
					continue
				}
				if i+n < len(s) && isWordChar(rune(s[i+n])) {
					continue
				}
				return true
			}
		}
		i++
	}
	return false
}

func isWordChar(r rune) bool {
	return unicode.IsLetter(r) || unicode.IsDigit(r) || r == '_' || r == '$'
}
