package meta

import (
	"regexp"
	"strings"
)

var packageBodyCreateRe = regexp.MustCompile(
	`(?im)(?:^|\n)[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?PACKAGE\s+BODY\b`,
)

// splitPackageSpecBodyMeta 将 GET_DDL('PACKAGE') 可能合并的「包头+包体」拆开。
func splitPackageSpecBodyMeta(ddl string) (spec, body string) {
	ddl = strings.TrimSpace(ddl)
	if ddl == "" {
		return "", ""
	}
	loc := packageBodyCreateRe.FindStringIndex(ddl)
	if loc == nil {
		return trimPlsqlSlash(ddl), ""
	}
	start := loc[0]
	for start < len(ddl) && (ddl[start] == '\n' || ddl[start] == '\r') {
		start++
	}
	for start < len(ddl) && (ddl[start] == ' ' || ddl[start] == '\t') {
		start++
	}
	return trimPlsqlSlash(ddl[:loc[0]]), trimPlsqlSlash(ddl[start:])
}

func trimPlsqlSlash(s string) string {
	s = strings.TrimSpace(s)
	for {
		s = strings.TrimRight(s, "; \t\r\n")
		s = strings.TrimSpace(s)
		if s == "" {
			return s
		}
		lines := strings.Split(s, "\n")
		if strings.TrimSpace(lines[len(lines)-1]) != "/" {
			return s
		}
		s = strings.TrimSpace(strings.Join(lines[:len(lines)-1], "\n"))
	}
}
