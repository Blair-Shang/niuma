// Package dialect 提供 KingbaseES 方言族与会话能力集。
//
// 调用方禁止散落「if kingbase」；一律通过 ServerProfile.Capabilities 开关。
// 非金仓实例由 Probe 明确拒绝，禁止伪装为 vastbase / postgresql。
package dialect

import (
	"context"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5/pgxpool"
)

// 方言族（连接 kind / 产品类型）。
const (
	// FamilyKingbase 表示人大金仓 KingbaseES。
	FamilyKingbase = "kingbase"
)

// 能力 ID（跨端稳定字符串；新增只加常量，勿改已有取值）。
const (
	// CapDoubleQuoteIdent 标识符双引号。
	CapDoubleQuoteIdent = "kingbase.double_quote_ident"
	// CapDollarQuote $tag$…$tag$ 字符串。
	CapDollarQuote = "kingbase.dollar_quote"
	// CapProcPlsqlBare 过程体为 AS|IS … BEGIN … END。
	CapProcPlsqlBare = "proc.plsql_bare"
	// CapFuncPlpgsqlDollar 函数可用 LANGUAGE plpgsql AS $$…$$。
	CapFuncPlpgsqlDollar = "func.plpgsql_dollar"
	// CapScriptOracleSlash 脚本可含独立行 /。
	CapScriptOracleSlash = "script.oracle_slash"
	// CapSplitPlsqlBlocks 拆句识别裸 PL/SQL 块。
	CapSplitPlsqlBlocks = "split.plsql_blocks"
	// CapEditorSuppressPgDiag 屏蔽 Monaco pgsql Worker 对 PL/SQL 的误报。
	CapEditorSuppressPgDiag = "editor.suppress_pg_diagnostics"
	// CapEditorSqlLsp 表示 service 提供 SQL Language Server Protocol 桥接。
	CapEditorSqlLsp = "editor.sql_lsp"
	// CapFormatPlsql 格式化走 plsql 方言。
	CapFormatPlsql = "format.plsql"
	// CapCTEWindow CTE / 窗口函数。
	CapCTEWindow = "cte.window"
	// CapSequenceNative 序列对象。
	CapSequenceNative = "sequence.native"
	// CapCompatOracle Oracle 兼容模式提示。
	CapCompatOracle = "compat.oracle"
	// CapCompatMysql MySQL 兼容模式提示。
	CapCompatMysql = "compat.mysql"
	// CapCompatSQLServer SQL Server 兼容模式提示。
	CapCompatSQLServer = "compat.sqlserver"
)

// ErrNotKingbase 表示目标实例不是金仓，须改用对应连接类型。
var ErrNotKingbase = errors.New("kingbase: server is not KingbaseES; use the matching connection kind")

// ServerProfile 是一次连接探测后的方言档案（随 session.open 返回并缓存）。
type ServerProfile struct {
	Family           string   `json:"family"`
	Version          string   `json:"version,omitempty"`
	VersionNum       string   `json:"versionNum,omitempty"`
	SQLCompatibility string   `json:"sqlCompatibility,omitempty"`
	Capabilities     []string `json:"capabilities"`
}

// Has 判断能力是否开启。
func Has(p *ServerProfile, capability string) bool {
	if p == nil || capability == "" {
		return false
	}
	for _, c := range p.Capabilities {
		if c == capability {
			return true
		}
	}
	return false
}

// DefaultProfile 返回产品默认能力（无兼容模式信息时的保守默认）。
func DefaultProfile() ServerProfile {
	return ResolveCapabilities("", "pg")
}

var (
	// 金仓版本串常见 "V008R006C008B0020" 或带 Kingbase 字样。
	kingbaseHintRe = regexp.MustCompile(`(?i)kingbase`)
	// 明确排除其它产品主特征（不含 kingbase 时）。
	foreignHintRe = regexp.MustCompile(`(?i)\b(clickhouse|mariadb|mysql|oracle database|microsoft sql server|vastbase)\b`)
	versionVRCBRe = regexp.MustCompile(`(?i)V(\d+)R(\d+)C(\d+)(?:B(\d+))?`)
	versionCoreRe = regexp.MustCompile(`(\d+)\.(\d+)(?:\.(\d+))?`)
)

// IsLikelyKingbaseVersion 判断版本串是否像金仓（须含 Kingbase 厂商标识）。
func IsLikelyKingbaseVersion(version string) bool {
	v := strings.TrimSpace(version)
	if v == "" {
		return false
	}
	if foreignHintRe.MatchString(v) && !kingbaseHintRe.MatchString(v) {
		return false
	}
	return kingbaseHintRe.MatchString(v)
}

// ParseVersionNum 将 VRCB 或 x.y.z 解析为可比较数字串；失败返回空串。
func ParseVersionNum(version string) string {
	if m := versionVRCBRe.FindStringSubmatch(version); len(m) >= 4 {
		major, _ := strconv.Atoi(m[1])
		release, _ := strconv.Atoi(m[2])
		change, _ := strconv.Atoi(m[3])
		build := 0
		if len(m) > 4 && m[4] != "" {
			build, _ = strconv.Atoi(m[4])
		}
		return fmt.Sprintf("%d%03d%03d%04d", major, release, change, build)
	}
	if m := versionCoreRe.FindStringSubmatch(version); len(m) >= 3 {
		major, _ := strconv.Atoi(m[1])
		minor, _ := strconv.Atoi(m[2])
		patch := 0
		if len(m) > 3 && m[3] != "" {
			patch, _ = strconv.Atoi(m[3])
		}
		return fmt.Sprintf("%d%02d%02d", major, minor, patch)
	}
	return ""
}

// NormalizeCompatibility 归一化兼容模式标识。
func NormalizeCompatibility(raw string) string {
	s := strings.ToLower(strings.TrimSpace(raw))
	switch s {
	case "", "pg", "postgres", "postgresql", "kingbase":
		return "pg"
	case "oracle", "ora":
		return "oracle"
	case "mysql":
		return "mysql"
	case "sqlserver", "mssql", "sql server":
		return "sqlserver"
	default:
		return s
	}
}

// ResolveCapabilities 按版本与兼容模式纯函数解析能力集（单测覆盖）。
func ResolveCapabilities(version, sqlCompatibility string) ServerProfile {
	compat := NormalizeCompatibility(sqlCompatibility)
	caps := []string{
		CapDoubleQuoteIdent,
		CapDollarQuote,
		CapFuncPlpgsqlDollar,
		CapEditorSuppressPgDiag,
		CapEditorSqlLsp,
		CapFormatPlsql,
		CapCTEWindow,
		CapSequenceNative,
	}
	switch compat {
	case "oracle":
		caps = append(caps, CapProcPlsqlBare, CapSplitPlsqlBlocks, CapScriptOracleSlash, CapCompatOracle)
	case "mysql":
		caps = append(caps, CapCompatMysql)
	case "sqlserver":
		caps = append(caps, CapCompatSQLServer)
	default:
		// PG 兼容：过程默认裸 PL/SQL 块（金仓常见）+ 拆句。
		caps = append(caps, CapProcPlsqlBare, CapSplitPlsqlBlocks)
	}
	return ServerProfile{
		Family:           FamilyKingbase,
		Version:          strings.TrimSpace(version),
		VersionNum:       ParseVersionNum(version),
		SQLCompatibility: compat,
		Capabilities:     caps,
	}
}

// Probe 读取 version / 兼容模式并解析能力；非金仓返回 ErrNotKingbase。
func Probe(ctx context.Context, pool *pgxpool.Pool) (*ServerProfile, error) {
	if pool == nil {
		return nil, fmt.Errorf("kingbase: dialect probe: nil pool")
	}
	var version string
	if err := pool.QueryRow(ctx, "SELECT version()").Scan(&version); err != nil {
		return nil, fmt.Errorf("kingbase: select version: %w", err)
	}
	version = strings.TrimSpace(version)
	if !IsLikelyKingbaseVersion(version) {
		return nil, ErrNotKingbase
	}

	var versionNum string
	_ = pool.QueryRow(ctx, `SELECT current_setting('server_version'::text)`).Scan(&versionNum)

	compat := "pg"
	var rawCompat string
	if err := pool.QueryRow(ctx, `SELECT current_setting('sql_compatibility'::text)`).Scan(&rawCompat); err == nil {
		compat = NormalizeCompatibility(rawCompat)
	}

	p := ResolveCapabilities(version, compat)
	if n := strings.TrimSpace(versionNum); n != "" && p.VersionNum == "" {
		p.VersionNum = n
	}
	return &p, nil
}
