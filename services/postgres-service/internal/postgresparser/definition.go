package postgresparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// FormatDocument 轻量格式化：折叠多余空行；不重排子句、不强制补分号。
func FormatDocument(text string) (string, bool) {
	if text == "" {
		return text, true
	}
	lines := strings.Split(text, "\n")
	var out []string
	blank := 0
	for _, line := range lines {
		trimRight := strings.TrimRight(line, " \t\r")
		if strings.TrimSpace(trimRight) == "" {
			blank++
			if blank <= 1 {
				out = append(out, "")
			}
			continue
		}
		blank = 0
		out = append(out, trimRight)
	}
	// 去掉文首空行
	for len(out) > 0 && out[0] == "" {
		out = out[1:]
	}
	// 文末保留至多一个换行语义：若原文以 \n 结尾则保留
	formatted := strings.Join(out, "\n")
	if strings.HasSuffix(text, "\n") && !strings.HasSuffix(formatted, "\n") {
		formatted += "\n"
	}
	return formatted, true
}

// DefinitionTarget 光标处可跳转目标（由表/列解析，catalog 由 Server 解析位置）。
type DefinitionTarget struct {
	Kind   string // table | column | routine | local
	Schema string
	Table  string
	Name   string
	Range  sqllsp.Range
}

// DefinitionAt 根据工作 AST + 标识符解析跳转目标。
func DefinitionAt(text string, pos sqllsp.Position) *DefinitionTarget {
	ast := ParseWorkAST(text, pos)
	offset := sqllsp.OffsetFromPosition(text, pos)
	left, right, start, end, ok := sqllsp.QualifiedIdentAt(text, offset)
	if !ok {
		return nil
	}
	rng := sqllsp.Range{
		Start: sqllsp.OffsetToPosition(text, start),
		End:   sqllsp.OffsetToPosition(text, end),
	}

	name := right
	if left == "" {
		for _, v := range append(append([]DeclareVar{}, ast.Params...), ast.Declares...) {
			if strings.EqualFold(v.Name, name) {
				return &DefinitionTarget{
					Kind: "local",
					Name: v.Name,
					Range: sqllsp.Range{
						Start: sqllsp.OffsetToPosition(text, v.Start),
						End:   sqllsp.OffsetToPosition(text, v.End),
					},
				}
			}
		}
		if ast.Routine != nil && strings.EqualFold(ast.Routine.Name, name) {
			return &DefinitionTarget{
				Kind: "routine",
				Name: ast.Routine.Name,
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(text, ast.Routine.NameStart),
					End:   sqllsp.OffsetToPosition(text, ast.Routine.NameEnd),
				},
			}
		}
	}

	defaultSchema := ""
	if left != "" && right != "" {
		if sch, tbl, resolved := sqllsp.ResolveDotQualifier(ast.Tables, left, defaultSchema); resolved {
			return &DefinitionTarget{
				Kind:   "column",
				Schema: sch,
				Table:  tbl,
				Name:   right,
				Range:  rng,
			}
		}
		return &DefinitionTarget{
			Kind:   "table",
			Schema: left,
			Table:  right,
			Name:   right,
			Range:  rng,
		}
	}

	if sch, tbl, resolved := sqllsp.ResolveDotQualifier(ast.Tables, name, defaultSchema); resolved {
		return &DefinitionTarget{
			Kind:   "table",
			Schema: sch,
			Table:  tbl,
			Name:   tbl,
			Range:  rng,
		}
	}
	return &DefinitionTarget{
		Kind:  "table",
		Table: name,
		Name:  name,
		Range: rng,
	}
}
