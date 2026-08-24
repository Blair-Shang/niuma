package sqllsp

import "strings"

// CTEDef 是 WITH 子句中的一个 CTE 定义。
type CTEDef struct {
	Name    string
	Columns []string // 显式列清单或从 AS (SELECT …) 推断；可空
}

// ExtractCTEDefs 提取 WITH 子句中的 CTE 名与投影列。
// 支持：WITH cte(a,b) AS (SELECT …) / WITH cte AS (SELECT x AS a, y …)。
func ExtractCTEDefs(stmt string) []CTEDef {
	tokens := tokenizeSQL(stmt)
	if len(tokens) == 0 || !strings.EqualFold(tokens[0].raw, "with") {
		return nil
	}
	var defs []CTEDef
	i := 1
	if i < len(tokens) && strings.EqualFold(tokens[i].raw, "recursive") {
		i++
	}
	for i < len(tokens) {
		if strings.EqualFold(tokens[i].raw, "select") ||
			strings.EqualFold(tokens[i].raw, "insert") ||
			strings.EqualFold(tokens[i].raw, "update") ||
			strings.EqualFold(tokens[i].raw, "delete") ||
			strings.EqualFold(tokens[i].raw, "merge") {
			break
		}
		if !isIdentLike(tokens[i].raw) {
			i++
			continue
		}
		def := CTEDef{Name: stripIdent(tokens[i].raw)}
		i++
		// WITH cte (c1, c2) AS (...)
		if i < len(tokens) && tokens[i].raw == "(" {
			open := i
			close := skipBalanced(tokens, i)
			def.Columns = extractIdentList(tokens, open+1, close-1)
			i = close
		}
		if i < len(tokens) && strings.EqualFold(tokens[i].raw, "as") {
			i++
		}
		if i < len(tokens) && tokens[i].raw == "(" {
			open := i
			close := skipBalanced(tokens, i)
			if len(def.Columns) == 0 {
				def.Columns = extractSelectListColumns(tokens, open+1, close-1)
			}
			i = close
		}
		if def.Name != "" {
			defs = append(defs, def)
		}
		if i < len(tokens) && tokens[i].raw == "," {
			i++
			continue
		}
		break
	}
	return defs
}

// ExtractCTENames 提取 WITH 子句中的 CTE 名（不含子查询内部）。
func ExtractCTENames(stmt string) []string {
	defs := ExtractCTEDefs(stmt)
	if len(defs) == 0 {
		return nil
	}
	out := make([]string, 0, len(defs))
	for _, d := range defs {
		out = append(out, d.Name)
	}
	return out
}

// ExtractSelectListColumns 从一段 SQL（通常是子查询或 CTE 体）提取 SELECT 投影列名。
func ExtractSelectListColumns(sql string) []string {
	tokens := tokenizeSQL(sql)
	return extractSelectListColumns(tokens, 0, len(tokens))
}

func extractIdentList(tokens []sqlTok, start, end int) []string {
	if start < 0 {
		start = 0
	}
	if end > len(tokens) {
		end = len(tokens)
	}
	var out []string
	for i := start; i < end; i++ {
		t := tokens[i]
		if t.raw == "," {
			continue
		}
		if isIdentLike(t.raw) {
			out = append(out, stripIdent(t.raw))
		}
	}
	return out
}

func extractSelectListColumns(tokens []sqlTok, start, end int) []string {
	if start < 0 {
		start = 0
	}
	if end > len(tokens) {
		end = len(tokens)
	}
	// 定位顶层 SELECT
	sel := -1
	depth := 0
	for i := start; i < end; i++ {
		raw := tokens[i].raw
		switch raw {
		case "(":
			depth++
		case ")":
			if depth > 0 {
				depth--
			}
		default:
			if depth == 0 && strings.EqualFold(raw, "select") {
				sel = i
				break
			}
		}
		if sel >= 0 {
			break
		}
	}
	if sel < 0 {
		return nil
	}
	// SELECT 后到顶层 FROM / 其它子句
	from := end
	depth = 0
	for i := sel + 1; i < end; i++ {
		raw := tokens[i].raw
		switch raw {
		case "(":
			depth++
		case ")":
			if depth > 0 {
				depth--
			}
		default:
			if depth != 0 {
				continue
			}
			low := strings.ToLower(raw)
			if low == "from" || low == "into" || low == "where" || low == "group" ||
				low == "order" || low == "having" || low == "limit" || low == "union" ||
				low == "intersect" || low == "minus" || low == "except" || low == "window" {
				from = i
				break
			}
		}
	}
	return splitSelectItems(tokens, sel+1, from)
}

func splitSelectItems(tokens []sqlTok, start, end int) []string {
	var out []string
	depth := 0
	itemStart := start
	flush := func(itemEnd int) {
		if name := selectItemColumnName(tokens, itemStart, itemEnd); name != "" {
			out = append(out, name)
		}
		itemStart = itemEnd + 1
	}
	for i := start; i < end; i++ {
		raw := tokens[i].raw
		switch raw {
		case "(":
			depth++
		case ")":
			if depth > 0 {
				depth--
			}
		case ",":
			if depth == 0 {
				flush(i)
			}
		}
	}
	if itemStart < end {
		flush(end)
	}
	return out
}

func selectItemColumnName(tokens []sqlTok, start, end int) string {
	// 跳过 DISTINCT / ALL / TOP n
	i := start
	for i < end {
		low := strings.ToLower(tokens[i].raw)
		if low == "distinct" || low == "all" {
			i++
			continue
		}
		if low == "top" {
			i++
			if i < end && isNumericTok(tokens[i].raw) {
				i++
			}
			continue
		}
		break
	}
	if i >= end {
		return ""
	}
	// * 或 t.* → 无法静态得名
	if tokens[i].raw == "*" {
		return ""
	}
	if i+2 < end && tokens[i+1].raw == "." && tokens[i+2].raw == "*" {
		return ""
	}
	// … AS alias
	for j := end - 1; j > i; j-- {
		if strings.EqualFold(tokens[j].raw, "as") && j+1 < end && isIdentLike(tokens[j+1].raw) {
			return stripIdent(tokens[j+1].raw)
		}
	}
	// 尾部裸别名：expr alias（倒数第二不是 .）
	if end-i >= 2 {
		last := tokens[end-1]
		prev := tokens[end-2]
		if isIdentLike(last.raw) && prev.raw != "." && prev.raw != "(" {
			low := strings.ToLower(last.raw)
			if _, stop := statementClauseKeywords[low]; !stop &&
				low != "asc" && low != "desc" && low != "nulls" &&
				low != "first" && low != "last" {
				// 单标识符项：id → id；多 token 表达式尾别名：COUNT(*) c → c
				if end-i == 1 || !isOnlyQualifiedIdent(tokens, i, end) {
					if end-i > 1 {
						return stripIdent(last.raw)
					}
				}
			}
		}
	}
	// 单列或 schema.table.col / table.col / col
	if name, ok := trailingIdent(tokens, i, end); ok {
		return name
	}
	return ""
}

func isOnlyQualifiedIdent(tokens []sqlTok, start, end int) bool {
	// a / a.b / a.b.c
	if start >= end {
		return false
	}
	expectIdent := true
	for i := start; i < end; i++ {
		if expectIdent {
			if !isIdentLike(tokens[i].raw) {
				return false
			}
			expectIdent = false
			continue
		}
		if tokens[i].raw == "." {
			expectIdent = true
			continue
		}
		return false
	}
	return !expectIdent
}

func trailingIdent(tokens []sqlTok, start, end int) (string, bool) {
	if start >= end {
		return "", false
	}
	if isOnlyQualifiedIdent(tokens, start, end) {
		return stripIdent(tokens[end-1].raw), true
	}
	return "", false
}

func isNumericTok(s string) bool {
	if s == "" {
		return false
	}
	for _, r := range s {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// FindTableRef 按别名或表名查找（优先别名）。
func FindTableRef(refs []TableRef, name string) *TableRef {
	name = stripIdent(strings.TrimSpace(name))
	if name == "" {
		return nil
	}
	lower := strings.ToLower(name)
	for i := range refs {
		if strings.TrimSpace(refs[i].Alias) != "" && strings.ToLower(refs[i].Alias) == lower {
			return &refs[i]
		}
	}
	for i := range refs {
		if strings.ToLower(refs[i].Name) == lower {
			return &refs[i]
		}
	}
	return nil
}
