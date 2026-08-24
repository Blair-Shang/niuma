// Package dialect 提供原生 PostgreSQL 方言族与会话能力集。
//
// 调用方禁止散落「if postgresql」；一律通过 ServerProfile.Capabilities 开关。
// 非官方 PostgreSQL（金仓 / Vastbase / openGauss 等）由 Probe 明确拒绝。
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

// 方言族（连接 kind 为 postgres；产品 family 为 postgresql）。
const (
	// FamilyPostgreSQL 表示官方 PostgreSQL 及以其名义发布的托管实例（RDS / Cloud SQL 等）。
	FamilyPostgreSQL = "postgresql"
)

// 能力 ID（跨端稳定字符串；新增只加常量，勿改已有取值）。
const (
	// CapDoubleQuoteIdent 标识符双引号。
	CapDoubleQuoteIdent = "postgres.double_quote_ident"
	// CapDollarQuote $tag$…$tag$ 字符串。
	CapDollarQuote = "postgres.dollar_quote"
	// CapProcPlpgsqlDollar 过程可用 LANGUAGE plpgsql AS $$…$$。
	CapProcPlpgsqlDollar = "proc.plpgsql_dollar"
	// CapFuncPlpgsqlDollar 函数可用 LANGUAGE plpgsql AS $$…$$。
	CapFuncPlpgsqlDollar = "func.plpgsql_dollar"
	// CapEditorSqlLsp 表示 service 提供 SQL Language Server Protocol 桥接。
	CapEditorSqlLsp = "editor.sql_lsp"
	// CapFormatPostgresql 格式化走 postgresql 方言。
	CapFormatPostgresql = "format.postgresql"
	// CapCTEWindow CTE / 窗口函数。
	CapCTEWindow = "cte.window"
	// CapSequenceNative 序列对象。
	CapSequenceNative = "sequence.native"
	// CapJSONNative JSON / JSONB 类型。
	CapJSONNative = "json.native_type"
	// CapGeneratedIdentity GENERATED {ALWAYS|BY DEFAULT} AS IDENTITY。
	CapGeneratedIdentity = "postgres.generated_identity"
	// CapDdlIfNotExists CREATE/DROP IF [NOT] EXISTS。
	CapDdlIfNotExists = "ddl.if_not_exists"
	// CapDdlDesign 表设计器 Preview / Apply。
	CapDdlDesign = "ddl.design"
	// CapIoCsv CSV 导入导出。
	CapIoCsv = "io.csv"
	// CapIoSqlFile SQL 文件执行 / dump。
	CapIoSqlFile = "io.sql_file"
	// CapListenNotify LISTEN / NOTIFY。
	CapListenNotify = "postgres.listen_notify"
)

// ErrNotPostgreSQL 表示目标实例不是官方 PostgreSQL，须改用对应连接类型。
var ErrNotPostgreSQL = errors.New("postgres: server is not PostgreSQL; use the matching connection kind")

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

// DefaultProfile 返回产品默认能力（探测失败 / 无会话回退）。
func DefaultProfile() ServerProfile {
	return ResolveCapabilities("")
}

var (
	postgresqlHintRe = regexp.MustCompile(`(?i)\bpostgresql\b`)
	// 厂商 / 发行版伪装成 PG wire 的产品：必须改用对应 kind。
	foreignHintRe = regexp.MustCompile(`(?i)(kingbase|vastbase|opengauss|gaussdb|\bcockroach|yugabyte|\byb-|polardb|ivorysql|highgo)`)
	versionCoreRe = regexp.MustCompile(`(\d+)\.(\d+)(?:\.(\d+))?`)
	// PostgreSQL 10+ 主版本为两段或一段（16.2 / 16）。
	serverVersionRe = regexp.MustCompile(`^(\d+)(?:\.(\d+))?(?:\.(\d+))?`)
)

// IsLikelyPostgreSQLVersion 判断 version() 是否为官方 PostgreSQL（须含 PostgreSQL 且无厂商分叉标识）。
func IsLikelyPostgreSQLVersion(version string) bool {
	v := strings.TrimSpace(version)
	if v == "" {
		return false
	}
	if foreignHintRe.MatchString(v) {
		return false
	}
	return postgresqlHintRe.MatchString(v)
}

// ParseVersionNum 将 x.y.z / server_version 解析为可比较数字串；失败返回空串。
func ParseVersionNum(version string) string {
	v := strings.TrimSpace(version)
	if m := serverVersionRe.FindStringSubmatch(v); len(m) >= 2 && !strings.Contains(strings.ToLower(v), "postgresql") {
		// current_setting('server_version') 形如 16.2。
		major, _ := strconv.Atoi(m[1])
		minor := 0
		patch := 0
		if len(m) > 2 && m[2] != "" {
			minor, _ = strconv.Atoi(m[2])
		}
		if len(m) > 3 && m[3] != "" {
			patch, _ = strconv.Atoi(m[3])
		}
		return fmt.Sprintf("%d%02d%02d", major, minor, patch)
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

// ResolveCapabilities 按版本纯函数解析能力集（单测覆盖）。
func ResolveCapabilities(version string) ServerProfile {
	caps := []string{
		CapDoubleQuoteIdent,
		CapDollarQuote,
		CapProcPlpgsqlDollar,
		CapFuncPlpgsqlDollar,
		CapEditorSqlLsp,
		CapFormatPostgresql,
		CapCTEWindow,
		CapSequenceNative,
		CapJSONNative,
		CapDdlIfNotExists,
		CapDdlDesign,
		CapIoCsv,
		CapIoSqlFile,
		CapListenNotify,
	}
	if major := parseMajor(version); major == 0 || major >= 10 {
		caps = append(caps, CapGeneratedIdentity)
	}
	return ServerProfile{
		Family:           FamilyPostgreSQL,
		Version:          strings.TrimSpace(version),
		VersionNum:       ParseVersionNum(version),
		SQLCompatibility: "pg",
		Capabilities:     caps,
	}
}

func parseMajor(version string) int {
	n := ParseVersionNum(version)
	if len(n) < 3 {
		return 0
	}
	major, err := strconv.Atoi(n[:len(n)-4])
	if err != nil {
		return 0
	}
	return major
}

// Probe 读取 version 并解析能力；非官方 PostgreSQL 返回 ErrNotPostgreSQL。
func Probe(ctx context.Context, pool *pgxpool.Pool) (*ServerProfile, error) {
	if pool == nil {
		return nil, fmt.Errorf("postgres: dialect probe: nil pool")
	}
	var version string
	if err := pool.QueryRow(ctx, "SELECT version()").Scan(&version); err != nil {
		return nil, fmt.Errorf("postgres: select version: %w", err)
	}
	version = strings.TrimSpace(version)
	if !IsLikelyPostgreSQLVersion(version) {
		return nil, ErrNotPostgreSQL
	}

	// 金仓等分叉常提供 sql_compatibility GUC；官方 PostgreSQL 无此参数。
	var rawCompat string
	if err := pool.QueryRow(ctx, `SELECT current_setting('sql_compatibility'::text)`).Scan(&rawCompat); err == nil {
		return nil, ErrNotPostgreSQL
	}

	var serverVersion string
	_ = pool.QueryRow(ctx, `SELECT current_setting('server_version'::text)`).Scan(&serverVersion)

	p := ResolveCapabilities(version)
	if n := ParseVersionNum(serverVersion); n != "" {
		p.VersionNum = n
	}
	return &p, nil
}
