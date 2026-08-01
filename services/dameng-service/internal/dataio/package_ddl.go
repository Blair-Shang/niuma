package dataio

import (
	"regexp"
	"strings"
)

// packageBodyCreateRe 匹配独立的 CREATE [OR REPLACE] PACKAGE BODY 起头。
var packageBodyCreateRe = regexp.MustCompile(
	`(?im)(?:^|\n)[ \t]*CREATE\s+(?:OR\s+REPLACE\s+)?PACKAGE\s+BODY\b`,
)

// trimPlsqlTerminators 去掉末尾 ; 与独占行的 /（GET_DDL 常自带，转储会再补 /）。
func trimPlsqlTerminators(s string) string {
	s = strings.TrimSpace(s)
	if s == "" {
		return s
	}
	for {
		s = strings.TrimRight(s, "; \t\r\n")
		s = strings.TrimSpace(s)
		if s == "" {
			return s
		}
		lines := strings.Split(s, "\n")
		last := strings.TrimSpace(lines[len(lines)-1])
		if last != "/" {
			return s
		}
		s = strings.TrimSpace(strings.Join(lines[:len(lines)-1], "\n"))
	}
}

// splitPackageSpecBody 将 GET_DDL('PACKAGE') 可能合并的「包头+包体」拆开。
// 达梦 PACKAGE 默认常一次返回两者且中间无 /，整段 Exec 会在第二个 CREATE 处 -2007。
func splitPackageSpecBody(ddl string) (spec, body string) {
	ddl = strings.TrimSpace(ddl)
	if ddl == "" {
		return "", ""
	}
	loc := packageBodyCreateRe.FindStringIndex(ddl)
	if loc == nil {
		return trimPlsqlTerminators(ddl), ""
	}
	start := loc[0]
	// 若匹配到前导 \n，从 CREATE 起切
	for start < len(ddl) && (ddl[start] == '\n' || ddl[start] == '\r') {
		start++
	}
	for start < len(ddl) && (ddl[start] == ' ' || ddl[start] == '\t') {
		start++
	}
	spec = trimPlsqlTerminators(ddl[:loc[0]])
	body = trimPlsqlTerminators(ddl[start:])
	return spec, body
}
