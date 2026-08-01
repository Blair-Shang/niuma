package dmparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// DocumentSymbols 提取文档符号（例程名、顶层语句标签）。
func DocumentSymbols(text string) []sqllsp.DocumentSymbol {
	var out []sqllsp.DocumentSymbol
	for _, sp := range splitDocumentStatements(text) {
		kind := Classify(sp.text)
		switch kind {
		case StmtCreateProc, StmtCreateFunc:
			ast := parseRoutineAST(sp.text, sp.start)
			if ast.Routine != nil && ast.Routine.Name != "" {
				symKind := sqllsp.SymbolFunction
				if ast.Routine.Kind == "procedure" {
					symKind = sqllsp.SymbolMethod
				}
				out = append(out, sqllsp.DocumentSymbol{
					Name: ast.Routine.Name,
					Detail: strings.ToUpper(ast.Routine.Kind),
					Kind:   symKind,
					Range: sqllsp.Range{
						Start: sqllsp.OffsetToPosition(text, sp.start),
						End:   sqllsp.OffsetToPosition(text, sp.start+len(sp.text)),
					},
					SelectionRange: sqllsp.Range{
						Start: sqllsp.OffsetToPosition(text, ast.Routine.NameStart),
						End:   sqllsp.OffsetToPosition(text, ast.Routine.NameEnd),
					},
				})
			}
		case StmtCreateTable, StmtCreateView, StmtCreateSequence:
			name, ns, ne := firstObjectName(sp.text)
			if name != "" {
				out = append(out, sqllsp.DocumentSymbol{
					Name:   name,
					Detail: kind.String(),
					Kind:   sqllsp.SymbolClass,
					Range: sqllsp.Range{
						Start: sqllsp.OffsetToPosition(text, sp.start),
						End:   sqllsp.OffsetToPosition(text, sp.start+len(sp.text)),
					},
					SelectionRange: sqllsp.Range{
						Start: sqllsp.OffsetToPosition(text, sp.start+ns),
						End:   sqllsp.OffsetToPosition(text, sp.start+ne),
					},
				})
			}
		case StmtSelect, StmtInsert, StmtUpdate, StmtDelete, StmtMerge:
			label := strings.ToUpper(kind.String())
			out = append(out, sqllsp.DocumentSymbol{
				Name:   label,
				Detail: "statement",
				Kind:   sqllsp.SymbolEvent,
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(text, sp.start),
					End:   sqllsp.OffsetToPosition(text, sp.start+len(sp.text)),
				},
				SelectionRange: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(text, sp.start),
					End:   sqllsp.OffsetToPosition(text, sp.start+min(len(sp.text), 8)),
				},
			})
		}
	}
	return out
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
	for _, kw := range []string{"table", "view", "sequence", "index", "unique"} {
		if matchKeywordAt(text, i, kw) {
			i = skipWSAndComments(text, i+len(kw))
			break
		}
	}
	if matchKeywordAt(text, i, "index") {
		i = skipWSAndComments(text, i+5)
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
