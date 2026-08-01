package mysqlparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// DefinitionAt 解析光标处跳转目标（local / routine / table / column）。
func DefinitionAt(text string, pos sqllsp.Position) *sqllsp.DefinitionTarget {
	normalized := preprocessDelimiter(text)
	offset := sqllsp.OffsetFromPosition(normalized, pos)
	left, right, start, end, ok := sqllsp.QualifiedIdentAt(normalized, offset)
	if !ok {
		return nil
	}
	rng := sqllsp.Range{
		Start: sqllsp.OffsetToPosition(normalized, start),
		End:   sqllsp.OffsetToPosition(normalized, end),
	}

	name := right
	info := parseRoutineScope(normalized, 0)
	if left == "" && info != nil {
		for _, v := range info.allLocals() {
			if strings.EqualFold(v.Name, name) {
				return &sqllsp.DefinitionTarget{
					Kind: "local",
					Name: v.Name,
					Range: sqllsp.Range{
						Start: sqllsp.OffsetToPosition(normalized, v.Start),
						End:   sqllsp.OffsetToPosition(normalized, v.End),
					},
				}
			}
		}
		if info.Name != "" && strings.EqualFold(info.Name, name) {
			return &sqllsp.DefinitionTarget{
				Kind: "routine",
				Name: info.Name,
				Range: sqllsp.Range{
					Start: sqllsp.OffsetToPosition(normalized, info.NameStart),
					End:   sqllsp.OffsetToPosition(normalized, info.NameEnd),
				},
			}
		}
	}

	tables := sqllsp.ExtractTableRefs(normalized, offset)
	defaultSchema := ""
	if left != "" && right != "" {
		if sch, tbl, resolved := sqllsp.ResolveDotQualifier(tables, left, defaultSchema); resolved {
			return &sqllsp.DefinitionTarget{
				Kind:   "column",
				Schema: sch,
				Table:  tbl,
				Name:   right,
				Range:  rng,
			}
		}
		return &sqllsp.DefinitionTarget{
			Kind:   "table",
			Schema: left,
			Table:  right,
			Name:   right,
			Range:  rng,
		}
	}

	if sch, tbl, resolved := sqllsp.ResolveDotQualifier(tables, name, defaultSchema); resolved {
		return &sqllsp.DefinitionTarget{
			Kind:   "table",
			Schema: sch,
			Table:  tbl,
			Name:   tbl,
			Range:  rng,
		}
	}
	return &sqllsp.DefinitionTarget{
		Kind:  "table",
		Table: name,
		Name:  name,
		Range: rng,
	}
}

// FormatDocument 轻量格式化：折叠多余空行。
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
	for len(out) > 0 && out[0] == "" {
		out = out[1:]
	}
	formatted := strings.Join(out, "\n")
	if strings.HasSuffix(text, "\n") && !strings.HasSuffix(formatted, "\n") {
		formatted += "\n"
	}
	return formatted, true
}
