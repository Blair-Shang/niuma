// Package dataio 提供 Vastbase 旁路落盘导入/导出任务（COPY / Dump SQL / Execute SQL File）。
package dataio

import "strings"

func quoteIdent(name string) string {
	return `"` + strings.ReplaceAll(name, `"`, `""`) + `"`
}

func qualified(schema, name string) string {
	return quoteIdent(schema) + "." + quoteIdent(name)
}

func requirePath(path string) error {
	if strings.TrimSpace(path) == "" {
		return errPathRequired
	}
	return nil
}

func requireRelation(schema, table string) error {
	if strings.TrimSpace(schema) == "" || strings.TrimSpace(table) == "" {
		return errRelationRequired
	}
	return nil
}
