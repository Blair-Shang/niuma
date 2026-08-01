// Package dialect 提供 ClickHouse 方言族与会话能力集。
//
// 调用方禁止散落「if version < x」；一律通过 ServerProfile.Capabilities 开关。
// 非 ClickHouse 实例由 Probe 明确拒绝，禁止伪装为 mysql 等其它 family。
package dialect

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// 方言族（连接 kind / 产品类型）。
const (
	// FamilyClickHouse 表示 ClickHouse。
	FamilyClickHouse = "clickhouse"
)

// 能力 ID（跨端稳定字符串；新增只加常量，勿改已有取值）。
const (
	// CapBacktickIdent 标识符使用反引号。
	CapBacktickIdent = "clickhouse.backtick_ident"
	// CapDoubleQuoteIdent 标识符可使用双引号（兼容）。
	CapDoubleQuoteIdent = "clickhouse.double_quote_ident"
	// CapSettingsClause 支持语句级 SETTINGS。
	CapSettingsClause = "clickhouse.settings_clause"
	// CapFormatClause 支持 FORMAT 子句（脚本侧识别）。
	CapFormatClause = "clickhouse.format_clause"
	// CapFormatSQL 格式化走通用 sql 方言。
	CapFormatSQL = "format.sql"
	// CapEditorBuiltinSQL Monaco 使用内置 sql / genericsql（无 LSP 时回退）。
	CapEditorBuiltinSQL = "editor.builtin_sql"
	// CapEditorSqlLsp Bridge 隧道 LSP（clickhouse.lsp.* + clickhouseparser）。
	CapEditorSqlLsp = "editor.sql_lsp"
	// CapDDLIfNotExists 常用 IF NOT EXISTS。
	CapDDLIfNotExists = "ddl.if_not_exists"
	// CapCTEWindow CTE / 窗口函数常用集。
	CapCTEWindow = "cte.window"
	// CapArrayMapTuple Array / Map / Tuple 类型展示与字面量提示。
	CapArrayMapTuple = "clickhouse.array_map_tuple"
	// CapMaterializedView 物化视图对象。
	CapMaterializedView = "clickhouse.materialized_view"
	// CapDictionary 字典对象。
	CapDictionary = "clickhouse.dictionary"
	// CapLightweightDelete 轻量 DELETE（较新版本）。
	CapLightweightDelete = "clickhouse.lightweight_delete"
	// CapCluster 集群 DDL（ON CLUSTER）；需 ZooKeeper / ClickHouse Keeper 可用。
	CapCluster = "clickhouse.cluster"
	// CapIoCSV CSV 导入导出。
	CapIoCSV = "io.csv"
	// CapIoNativeFormat Native PrepareBatch / 列式旁路导入。
	CapIoNativeFormat = "io.native_format"
	// CapDDLDesign 表设计器（引擎 / ORDER BY / PARTITION BY）。
	CapDDLDesign = "ddl.design"
	// CapExplainEstimate EXPLAIN ESTIMATE（约 21.8+）。
	CapExplainEstimate = "clickhouse.explain_estimate"
	// CapExplainQueryTree EXPLAIN QUERY TREE（分析器时代，约 23.3+）。
	CapExplainQueryTree = "clickhouse.explain_query_tree"
	// CapExplainAnalyze EXPLAIN ANALYZE（实测执行注解，约 24.8+）。
	CapExplainAnalyze = "clickhouse.explain_analyze"
	// CapCreateOrReplaceView CREATE OR REPLACE VIEW（Atomic/Replicated；失败可回退 DROP+CREATE）。
	CapCreateOrReplaceView = "clickhouse.create_or_replace_view"
	// CapCreateOrReplaceMaterializedView CREATE OR REPLACE MATERIALIZED VIEW。
	// 多数发行版仍不支持（语法 code 62）；矩阵默认关闭，待稳定版本再开。
	CapCreateOrReplaceMaterializedView = "clickhouse.create_or_replace_materialized_view"
	// CapCreateOrReplaceDictionary CREATE OR REPLACE DICTIONARY。
	// 不少版本仍报已存在（code 387）；矩阵默认关闭，保存走 DROP+CREATE。
	CapCreateOrReplaceDictionary = "clickhouse.create_or_replace_dictionary"
)

// ErrNotClickHouse 表示目标实例不是 ClickHouse，须改用对应连接类型。
var ErrNotClickHouse = errors.New("clickhouse: server is not ClickHouse; use the matching connection kind")

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

// DefaultProfile 返回产品默认能力（探测失败时的保守回退）。
func DefaultProfile() ServerProfile {
	return ResolveCapabilities("", false)
}

var (
	// ClickHouse 常见 "24.8.4.13" 或 "22.8.15.25"。
	versionCoreRe = regexp.MustCompile(`(?i)(\d+)\.(\d+)\.(\d+)(?:\.(\d+))?`)
	// 明确排除其它产品特征串。
	foreignHintRe = regexp.MustCompile(`(?i)(mariadb|mysql|postgres|oracle database|microsoft sql)`)
)

// ParseVersionNum 将 "24.8.4.13" 解析为 "24080413"；失败返回空串。
func ParseVersionNum(version string) string {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) < 4 {
		return ""
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	build := 0
	if len(m) > 4 && m[4] != "" {
		build, _ = strconv.Atoi(m[4])
	}
	return fmt.Sprintf("%d%02d%02d%02d", major, minor, patch, build)
}

// MajorMinor 返回主、次版本号；解析失败返回 0,0。
func MajorMinor(version string) (major, minor int) {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) < 3 {
		return 0, 0
	}
	major, _ = strconv.Atoi(m[1])
	minor, _ = strconv.Atoi(m[2])
	return major, minor
}

// IsLikelyClickHouseVersion 判断版本串是否像 ClickHouse（排除明显其它产品）。
func IsLikelyClickHouseVersion(version string) bool {
	v := strings.TrimSpace(version)
	if v == "" {
		return false
	}
	if foreignHintRe.MatchString(v) {
		return false
	}
	return versionCoreRe.MatchString(v)
}

// ResolveCapabilities 按版本与集群标志纯函数解析能力集（单测覆盖）。
func ResolveCapabilities(version string, hasCluster bool) ServerProfile {
	caps := []string{
		CapBacktickIdent,
		CapDoubleQuoteIdent,
		CapSettingsClause,
		CapFormatClause,
		CapFormatSQL,
		CapEditorBuiltinSQL,
		CapEditorSqlLsp,
		CapDDLIfNotExists,
		CapCTEWindow,
		CapArrayMapTuple,
		CapMaterializedView,
		CapDictionary,
		CapIoCSV,
		CapIoNativeFormat,
		CapDDLDesign,
	}
	major, minor := MajorMinor(version)
	// ESTIMATE 自 21.8 起；版本未知时仍开启（该能力已普及）。
	if version == "" || major > 21 || (major == 21 && minor >= 8) {
		caps = append(caps, CapExplainEstimate)
	}
	// 普通视图 OR REPLACE 已普及；版本未知时仍开启（Apply 遇 RENAME EXCHANGE 再回退）。
	if version == "" || major >= 20 {
		caps = append(caps, CapCreateOrReplaceView)
	}
	// 轻量删除约自 22.8+ 逐步完善；保守在 23.3+ 默认开启。
	if major > 23 || (major == 23 && minor >= 3) {
		caps = append(caps, CapLightweightDelete)
		caps = append(caps, CapExplainQueryTree)
	}
	// EXPLAIN ANALYZE（计划注解类型）约自 26.7 起；更早版本会把 ANALYZE 当成 setting 名而语法失败。
	if major > 26 || (major == 26 && minor >= 7) {
		caps = append(caps, CapExplainAnalyze)
	}
	// MV / 字典 OR REPLACE：默认不开启（见常量注释）；后续按实证版本抬升矩阵。
	if hasCluster {
		caps = append(caps, CapCluster)
	}
	return ServerProfile{
		Family:       FamilyClickHouse,
		Version:      strings.TrimSpace(version),
		VersionNum:   ParseVersionNum(version),
		Capabilities: caps,
	}
}

// Probe 读取 version() 等信息并解析能力；非 ClickHouse 返回 ErrNotClickHouse。
func Probe(ctx context.Context, db *sql.DB) (*ServerProfile, error) {
	if db == nil {
		return nil, fmt.Errorf("clickhouse: dialect probe: nil db")
	}
	version, err := queryScalar(ctx, db, "SELECT version()")
	if err != nil {
		return nil, fmt.Errorf("clickhouse: select version: %w", err)
	}
	if !IsLikelyClickHouseVersion(version) {
		return nil, ErrNotClickHouse
	}
	// 二次确认 system 库存在，避免误连其它协议兼容层。
	if _, err := queryScalar(ctx, db, "SELECT name FROM system.databases WHERE name = 'system' LIMIT 1"); err != nil {
		return nil, fmt.Errorf("clickhouse: system.databases unavailable: %w", err)
	}
	// ON CLUSTER / 分布式 DDL 依赖 ZooKeeper 或 ClickHouse Keeper。
	// 仅看 system.clusters 不够：单机也常有 default 行，但无 Keeper 时会报 code 139。
	hasCluster := false
	if _, qerr := queryInt64(ctx, db, "SELECT count() FROM system.zookeeper WHERE path = '/'"); qerr == nil {
		hasCluster = true
	}
	p := ResolveCapabilities(version, hasCluster)
	return &p, nil
}

func queryScalar(ctx context.Context, db *sql.DB, q string) (string, error) {
	var s sql.NullString
	if err := db.QueryRowContext(ctx, q).Scan(&s); err != nil {
		return "", err
	}
	if !s.Valid {
		return "", nil
	}
	return strings.TrimSpace(s.String), nil
}

func queryInt64(ctx context.Context, db *sql.DB, q string) (int64, error) {
	var n sql.NullInt64
	if err := db.QueryRowContext(ctx, q).Scan(&n); err != nil {
		return 0, err
	}
	if !n.Valid {
		return 0, nil
	}
	return n.Int64, nil
}
