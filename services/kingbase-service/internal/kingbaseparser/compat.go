package kingbaseparser

import (
	"strings"

	"niuma/pkg/sqllsp"
)

// CompatMode Kingbase SQL 兼容模式（影响关键字提示、内置函数与轻量诊断）。
// 禁止 Auto 并集混推各兼容方言，避免提示当前模式不可执行的写法。
type CompatMode int

const (
	// CompatPG 是 Kingbase 默认 PostgreSQL 兼容模式。
	CompatPG CompatMode = iota
	CompatOracle
	CompatMysql
	CompatSQLServer
	// CompatAuto 保留给未知兼容模式；使用纯 PG 基线，不合并其它方言。
	CompatAuto
)

// ParseCompat 解析 Probe 返回的 sqlCompatibility。
func ParseCompat(s string) CompatMode {
	s = strings.ToLower(strings.TrimSpace(s))
	switch {
	case strings.Contains(s, "oracle"):
		return CompatOracle
	case strings.Contains(s, "mysql"):
		return CompatMysql
	case strings.Contains(s, "sqlserver"), strings.Contains(s, "sql server"), strings.Contains(s, "mssql"):
		return CompatSQLServer
	default:
		return CompatPG
	}
}

func (m CompatMode) String() string {
	switch m {
	case CompatPG:
		return "pg"
	case CompatOracle:
		return "oracle"
	case CompatMysql:
		return "mysql"
	case CompatSQLServer:
		return "sqlserver"
	default:
		return "auto"
	}
}

func keywordsForCompat(base []string, mode CompatMode) []string {
	var extra []string
	switch mode {
	case CompatOracle:
		extra = oracleExtraKeywords
	case CompatMysql:
		extra = mysqlExtraKeywords
	case CompatSQLServer:
		extra = sqlserverExtraKeywords
	default:
		// PG / Auto：不加其它方言专属词，避免混推。
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

// oracleExtraKeywords 仅在 CompatOracle 下追加。
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

var sqlserverExtraKeywords = []string{
	"TOP", "GO", "IDENTITY_INSERT", "NVARCHAR", "UNIQUEIDENTIFIER", "TRY_CONVERT",
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
	case CompatSQLServer:
		warnMysqlOnly("limit", "SQL Server compatibility: use TOP or OFFSET/FETCH instead of LIMIT")
		warnOracleOnly("rownum", "SQL Server compatibility: ROWNUM is Oracle-specific")
	default:
		// PG / Auto: LIMIT is native; only flag non-PG compatibility syntax.
		warnMysqlOnly("auto_increment", "PostgreSQL compatibility: AUTO_INCREMENT is MySQL-specific; use GENERATED AS IDENTITY")
		warnMysqlOnly("engine", "PostgreSQL compatibility: ENGINE clause is MySQL-specific")
		warnMysqlOnly("show", "PostgreSQL compatibility: SHOW may not be portable; use catalog views")
		warnOracleOnly("connect", "PostgreSQL compatibility: CONNECT BY requires Oracle compatibility")
	}
	return diags
}
