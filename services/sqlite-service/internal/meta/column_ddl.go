package meta

import (
	"context"
	"database/sql"
	"regexp"
	"strings"
)

// 从 CREATE TABLE 列定义中提取 GENERATED / 列级 CHECK（尽力而为，失败则留空）。
var (
	reGenerated = regexp.MustCompile(
		`(?is)\bGENERATED\s+ALWAYS\s+AS\s*\((.*)\)\s*(VIRTUAL|STORED)\b`,
	)
	reColCheck = regexp.MustCompile(`(?is)\bCHECK\s*\((.*)\)\s*$`)
)

type columnDDLExtras struct {
	Check         string
	GeneratedExpr string
	GeneratedType string
}

func parseColumnDDLExtras(def string) columnDDLExtras {
	out := columnDDLExtras{}
	s := strings.TrimSpace(def)
	if s == "" {
		return out
	}
	if m := reGenerated.FindStringSubmatch(s); len(m) == 3 {
		out.GeneratedExpr = strings.TrimSpace(m[1])
		out.GeneratedType = strings.ToUpper(strings.TrimSpace(m[2]))
	}
	// 去掉 GENERATED 段后再找列尾 CHECK，避免误匹配表达式内 CHECK
	withoutGen := reGenerated.ReplaceAllString(s, "")
	if m := reColCheck.FindStringSubmatch(strings.TrimSpace(withoutGen)); len(m) == 2 {
		out.Check = strings.TrimSpace(m[1])
	}
	return out
}

// splitCreateTableColumnDefs 粗拆 CREATE TABLE (...) 内的顶层逗号分隔项。
func splitCreateTableColumnDefs(ddl string) []string {
	upper := strings.ToUpper(ddl)
	idx := strings.Index(upper, "CREATE TABLE")
	if idx < 0 {
		return nil
	}
	rest := ddl[idx:]
	start := strings.Index(rest, "(")
	end := strings.LastIndex(rest, ")")
	if start < 0 || end <= start {
		return nil
	}
	body := rest[start+1 : end]
	var parts []string
	var b strings.Builder
	depth := 0
	inSingle, inDouble := false, false
	for i := 0; i < len(body); i++ {
		ch := body[i]
		switch {
		case ch == '\'' && !inDouble:
			inSingle = !inSingle
			b.WriteByte(ch)
		case ch == '"' && !inSingle:
			inDouble = !inDouble
			b.WriteByte(ch)
		case inSingle || inDouble:
			b.WriteByte(ch)
		case ch == '(':
			depth++
			b.WriteByte(ch)
		case ch == ')':
			if depth > 0 {
				depth--
			}
			b.WriteByte(ch)
		case ch == ',' && depth == 0:
			parts = append(parts, strings.TrimSpace(b.String()))
			b.Reset()
		default:
			b.WriteByte(ch)
		}
	}
	if t := strings.TrimSpace(b.String()); t != "" {
		parts = append(parts, t)
	}
	return parts
}

func columnNameFromDef(def string) string {
	s := strings.TrimSpace(def)
	if s == "" {
		return ""
	}
	upper := strings.ToUpper(s)
	for _, prefix := range []string{"CONSTRAINT ", "PRIMARY KEY", "UNIQUE", "CHECK", "FOREIGN KEY"} {
		if strings.HasPrefix(upper, prefix) {
			return ""
		}
	}
	if strings.HasPrefix(s, `"`) {
		if i := strings.Index(s[1:], `"`); i >= 0 {
			return strings.ReplaceAll(s[1:i+1], `""`, `"`)
		}
	}
	if strings.HasPrefix(s, "`") {
		if i := strings.Index(s[1:], "`"); i >= 0 {
			return s[1 : i+1]
		}
	}
	if strings.HasPrefix(s, "[") {
		if i := strings.Index(s, "]"); i > 1 {
			return s[1:i]
		}
	}
	fields := strings.Fields(s)
	if len(fields) == 0 {
		return ""
	}
	return strings.Trim(fields[0], `"'`+"`[]")
}

func loadColumnDDLExtras(ctx context.Context, db *sql.DB, schema, table string) map[string]columnDDLExtras {
	out := make(map[string]columnDDLExtras)
	ddlRes, err := GetDDL(ctx, db, schema, table, "table")
	if err != nil || ddlRes == nil || strings.TrimSpace(ddlRes.DDL) == "" {
		return out
	}
	for _, def := range splitCreateTableColumnDefs(ddlRes.DDL) {
		name := columnNameFromDef(def)
		if name == "" {
			continue
		}
		extras := parseColumnDDLExtras(def)
		if extras.Check == "" && extras.GeneratedExpr == "" {
			continue
		}
		out[strings.ToLower(name)] = extras
	}
	return out
}
