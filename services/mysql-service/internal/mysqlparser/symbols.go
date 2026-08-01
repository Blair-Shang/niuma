package mysqlparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// DocumentSymbols 提取文档符号（例程 / 表 / 视图 / 顶层 DML）。
func DocumentSymbols(text string) []sqllsp.DocumentSymbol {
	normalized := preprocessDelimiter(text)
	var out []sqllsp.DocumentSymbol
	for _, sp := range splitDocumentStatements(normalized) {
		kind := classifyStmt(sp.text)
		switch kind {
		case "procedure", "function":
			info := parseRoutineScope(sp.text, sp.start)
			if info == nil || info.Name == "" {
				continue
			}
			symKind := sqllsp.SymbolFunction
			if info.Kind == "procedure" {
				symKind = sqllsp.SymbolMethod
			}
			out = append(out, sqllsp.DocumentSymbol{
				Name:   info.Name,
				Detail: strings.ToUpper(info.Kind),
				Kind:   symKind,
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, sp.start),
					End:   sqllsp.OffsetToPosition(normalized, sp.start+len(sp.text)),
				},
				SelectionRange: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, info.NameStart),
					End:   sqllsp.OffsetToPosition(normalized, info.NameEnd),
				},
			})
		case "table", "view":
			name, ns, ne := firstObjectName(sp.text)
			if name == "" {
				continue
			}
			out = append(out, sqllsp.DocumentSymbol{
				Name:   name,
				Detail: strings.ToUpper(kind),
				Kind:   sqllsp.SymbolClass,
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, sp.start),
					End:   sqllsp.OffsetToPosition(normalized, sp.start+len(sp.text)),
				},
				SelectionRange: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, sp.start+ns),
					End:   sqllsp.OffsetToPosition(normalized, sp.start+ne),
				},
			})
		case "select", "insert", "update", "delete":
			label := strings.ToUpper(kind)
			endSel := min(len(sp.text), len(label))
			out = append(out, sqllsp.DocumentSymbol{
				Name:   label,
				Detail: "statement",
				Kind:   sqllsp.SymbolEvent,
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, sp.start),
					End:   sqllsp.OffsetToPosition(normalized, sp.start+len(sp.text)),
				},
				SelectionRange: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, sp.start),
					End:   sqllsp.OffsetToPosition(normalized, sp.start+endSel),
				},
			})
		}
	}
	return out
}

func classifyStmt(text string) string {
	i := skipLeadingNoise(text)
	lower := strings.ToLower(text)
	switch {
	case matchKeywordAt(lower, i, "select"), matchKeywordAt(lower, i, "with"):
		return "select"
	case matchKeywordAt(lower, i, "insert"):
		return "insert"
	case matchKeywordAt(lower, i, "update"):
		return "update"
	case matchKeywordAt(lower, i, "delete"):
		return "delete"
	case matchKeywordAt(lower, i, "create"):
		j := skipWSAndComments(text, i+6)
		if matchKeywordAt(lower, j, "or") {
			j = skipWSAndComments(text, j+2)
			if matchKeywordAt(lower, j, "replace") {
				j = skipWSAndComments(text, j+7)
			}
		}
		j = skipDefinerClause(text, j)
		j = skipWSAndComments(text, j)
		switch {
		case matchKeywordAt(lower, j, "procedure"):
			return "procedure"
		case matchKeywordAt(lower, j, "function"):
			return "function"
		case matchKeywordAt(lower, j, "table"):
			return "table"
		case matchKeywordAt(lower, j, "view"):
			return "view"
		case matchKeywordAt(lower, j, "temporary"):
			k := skipWSAndComments(text, j+9)
			if matchKeywordAt(lower, k, "table") {
				return "table"
			}
		}
	}
	return ""
}

func firstObjectName(text string) (name string, start, end int) {
	i := skipLeadingNoise(text)
	if !matchKeywordAt(text, i, "create") {
		return "", 0, 0
	}
	i = skipWSAndComments(text, i+6)
	if matchKeywordAt(text, i, "or") {
		i = skipWSAndComments(text, i+2)
		if matchKeywordAt(text, i, "replace") {
			i = skipWSAndComments(text, i+7)
		}
	}
	i = skipDefinerClause(text, i)
	i = skipWSAndComments(text, i)
	if matchKeywordAt(text, i, "temporary") {
		i = skipWSAndComments(text, i+9)
	}
	for _, kw := range []string{"table", "view"} {
		if matchKeywordAt(text, i, kw) {
			i = skipWSAndComments(text, i+len(kw))
			break
		}
	}
	if matchKeywordAt(text, i, "if") {
		i = skipWSAndComments(text, i+2)
		if matchKeywordAt(text, i, "not") {
			i = skipWSAndComments(text, i+3)
			if matchKeywordAt(text, i, "exists") {
				i = skipWSAndComments(text, i+6)
			}
		}
	}
	start = i
	endPos, ok := scanQualifiedIdent(text, i)
	if !ok {
		return "", 0, 0
	}
	raw := text[start:endPos]
	return stripIdent(extractLastIdent(raw)), start, endPos
}

func min(a, b int) int {
	if a < b {
		return a
	}
	return b
}
