// Package dialect 提供产品方言族与会话能力集（对齐 DBeaver / Navicat：类型定族，能力定行为）。
//
// 调用方禁止再写「if vastbase then …」散落补丁；一律通过 ServerProfile.Capabilities 开关。
package dialect

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// 方言族（连接 kind / 产品类型）。
const (
	FamilyVastbase   = "vastbase"
	FamilyPostgreSQL = "postgresql"
	FamilyMySQL      = "mysql"
	FamilyOracle     = "oracle"
	FamilyGeneric    = "generic"
)

// 能力 ID（跨端稳定字符串；新增只加常量，勿改已有取值）。
const (
	// CapProcPlsqlBare 过程体为 AS|IS … BEGIN … END（openGauss / Vastbase 标准）。
	CapProcPlsqlBare = "proc.plsql_bare"
	// CapProcPlpgsqlDollar 过程可用 LANGUAGE plpgsql AS $$…$$（PG 风格；默认关，探测到再开）。
	CapProcPlpgsqlDollar = "proc.plpgsql_dollar"
	// CapFuncPlpgsqlDollar 函数可用 LANGUAGE plpgsql AS $$…$$。
	CapFuncPlpgsqlDollar = "func.plpgsql_dollar"
	// CapScriptOracleSlash 脚本可含独立行 /；提交 query 协议前须剥离。
	CapScriptOracleSlash = "script.oracle_slash"
	// CapSplitPlsqlBlocks 拆句识别裸 PL/SQL 块（体内 ; 不拆）。
	CapSplitPlsqlBlocks = "split.plsql_blocks"
	// CapEditorSuppressPgDiag 屏蔽 Monaco pgsql Worker 对 PL/SQL 的误报。
	CapEditorSuppressPgDiag = "editor.suppress_pg_diagnostics"
	// CapFormatPlsql 格式化走 plsql 方言。
	CapFormatPlsql = "format.plsql"
)

// ServerProfile 是一次连接探测后的方言档案（随 session.open 返回并缓存）。
type ServerProfile struct {
	Family           string   `json:"family"`
	Version          string   `json:"version,omitempty"`
	VersionNum       string   `json:"versionNum,omitempty"`
	SQLCompatibility string   `json:"sqlCompatibility,omitempty"`
	Capabilities     []string `json:"capabilities"`
}

// Has 判断能力是否开启。
func Has(p *ServerProfile, cap string) bool {
	if p == nil || cap == "" {
		return false
	}
	for _, c := range p.Capabilities {
		if c == cap {
			return true
		}
	}
	return false
}

// DefaultVastbase 返回当前产品默认能力（Navicat/Data Studio 对齐：过程 PL/SQL）。
// 未来若某版本原生支持 PG 过程语法，由 Probe 追加 CapProcPlpgsqlDollar，而不是改散落 if。
func DefaultVastbase() ServerProfile {
	return ServerProfile{
		Family: FamilyVastbase,
		Capabilities: []string{
			CapProcPlsqlBare,
			CapFuncPlpgsqlDollar,
			CapScriptOracleSlash,
			CapSplitPlsqlBlocks,
			CapEditorSuppressPgDiag,
			CapFormatPlsql,
		},
	}
}

// DefaultPostgreSQL 纯 PG 能力集（供对照 / 后续原生 PG kind）。
func DefaultPostgreSQL() ServerProfile {
	return ServerProfile{
		Family: FamilyPostgreSQL,
		Capabilities: []string{
			CapProcPlpgsqlDollar,
			CapFuncPlpgsqlDollar,
		},
	}
}

// Probe 读取 version / server_version / sql_compatibility，并以 SAVEPOINT 试探过程语法能力。
func Probe(ctx context.Context, pool *pgxpool.Pool) (*ServerProfile, error) {
	p := DefaultVastbase()
	var version, versionNum string
	_ = pool.QueryRow(ctx, `SELECT version(), current_setting('server_version'::text)`).Scan(&version, &versionNum)
	p.Version = strings.TrimSpace(version)
	p.VersionNum = strings.TrimSpace(versionNum)

	var compat string
	if err := pool.QueryRow(ctx, `SELECT current_setting('sql_compatibility'::text)`).Scan(&compat); err == nil {
		p.SQLCompatibility = strings.TrimSpace(compat)
	}

	caps := append([]string(nil), DefaultVastbase().Capabilities...)
	if ProbePlpgsqlProcedureSupport(ctx, beginFromPool(pool)) {
		caps = appendUnique(caps, CapProcPlpgsqlDollar)
	}
	p.Capabilities = caps
	return &p, nil
}

func appendUnique(caps []string, add string) []string {
	for _, c := range caps {
		if c == add {
			return caps
		}
	}
	return append(caps, add)
}
