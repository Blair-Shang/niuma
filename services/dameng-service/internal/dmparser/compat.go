package dmparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// CompatMode 达梦 SQL 兼容模式（影响关键字提示、内置函数与轻量诊断）。
// 禁止 Auto 并集混推 Oracle+MySQL，避免提示出当前模式不可执行的写法。
type CompatMode int

const (
	// CompatAuto 表示未探测到专用兼容模式：仅达梦原生关键字/函数。
	CompatAuto CompatMode = iota
	CompatOracle
	CompatMysql
)

// ParseCompat 解析 Probe 返回的 sqlCompatibility。
func ParseCompat(s string) CompatMode {
	s = strings.ToLower(strings.TrimSpace(s))
	switch {
	case strings.Contains(s, "oracle"):
		return CompatOracle
	case strings.Contains(s, "mysql"):
		return CompatMysql
	default:
		return CompatAuto
	}
}

func (m CompatMode) String() string {
	switch m {
	case CompatOracle:
		return "oracle"
	case CompatMysql:
		return "mysql"
	default:
		return ""
	}
}

func keywordsForCompat(base []string, mode CompatMode) []string {
	var extra []string
	switch mode {
	case CompatOracle:
		extra = oracleExtraKeywords
	case CompatMysql:
		extra = mysqlExtraKeywords
	default:
		// CompatAuto / native：不加 Oracle/MySQL 专属词，避免混推。
		return append([]string(nil), base...)
	}
	seen := map[string]struct{}{}
	out := make([]string, 0, len(base)+len(extra))
	for _, k := range base {
		seen[k] = struct{}{}
		out = append(out, k)
	}
	for _, k := range extra {
		if _, ok := seen[k]; !ok {
			out = append(out, k)
		}
	}
	return out
}

// oracleExtraKeywords 仅在 CompatOracle 下追加（达梦基线已含部分通用词则去重）。
var oracleExtraKeywords = []string{
	"NOCYCLE", "SIBLINGS", "PRIOR", "LEVEL",
	"NVL", "NVL2", "DECODE", "SYSDATE", "SYSTIMESTAMP", "DUAL",
	"ROWID", "PLS_INTEGER", "BINARY_INTEGER", "PRAGMA", "AUTONOMOUS_TRANSACTION",
	"BULK", "COLLECT", "FORALL", "PIPELINED", "DETERMINISTIC",
}

// mysqlExtraKeywords 仅在 CompatMysql 下追加。
var mysqlExtraKeywords = []string{
	"AUTO_INCREMENT", "SHOW", "USE", "DATABASE",
	"ENGINE", "CHARSET", "COLLATE", "UNSIGNED", "ZEROFILL", "ENUM",
	"DELIMITER", "ELSEIF", "INOUT", "OUT", "SIGNAL", "RESIGNAL",
}

// diagnoseCompatSelect 兼容模式相关 Hint（不阻断编辑）；按当前模式互斥提示，禁止混用误导。
func diagnoseCompatSelect(text string, compat CompatMode, incomplete bool) []sqllsp.Diagnostic {
	if incomplete {
		return nil
	}
	lower := strings.ToLower(text)
	var diags []sqllsp.Diagnostic

	warnMysqlOnly := func(kw, msg string) {
		if idx := indexKeyword(lower, 0, kw); idx >= 0 {
			diags = append(diags, hintAt(text, idx, msg))
		}
	}
	warnOracleOnly := func(kw, msg string) {
		if idx := indexKeyword(lower, 0, kw); idx >= 0 {
			diags = append(diags, hintAt(text, idx, msg))
		}
	}

	switch compat {
	case CompatOracle:
		warnMysqlOnly("limit", "Oracle compatibility: prefer ROWNUM / FETCH FIRST instead of LIMIT")
		warnMysqlOnly("auto_increment", "Oracle compatibility: AUTO_INCREMENT may be unavailable; use IDENTITY")
		warnMysqlOnly("engine", "Oracle compatibility: ENGINE clause is MySQL-specific")
	case CompatMysql:
		warnOracleOnly("rownum", "MySQL compatibility: prefer LIMIT instead of ROWNUM")
		warnOracleOnly("minus", "MySQL compatibility: MINUS may be unavailable; use EXCEPT if supported")
		warnOracleOnly("connect", "MySQL compatibility: CONNECT BY may be unavailable")
		warnOracleOnly("sysdate", "MySQL compatibility: prefer NOW()/CURRENT_TIMESTAMP instead of SYSDATE bare ident")
	default:
		// native：两侧专属写法都提示可能失败，避免混用执行异常
		warnMysqlOnly("limit", "Dameng native mode: LIMIT may require MySQL compatibility; prefer ROWNUM / FETCH FIRST")
		warnMysqlOnly("auto_increment", "Dameng native mode: AUTO_INCREMENT is MySQL-specific; use IDENTITY")
		warnMysqlOnly("engine", "Dameng native mode: ENGINE is MySQL-specific and may fail")
		warnMysqlOnly("show", "Dameng native mode: SHOW is MySQL-specific; use dictionary views")
		warnOracleOnly("connect", "Dameng native mode: CONNECT BY is Oracle-compat hierarchical syntax; confirm session compatibility")
	}
	return diags
}
