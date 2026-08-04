// Package dialect 提供 SQL Server 方言族与会话能力集。
//
// 调用方禁止散落「if version < x」；一律通过 ServerProfile.Capabilities 开关。
// 非 SQL Server / Azure SQL 实例由 Probe 明确拒绝。
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
	// FamilySQLServer 表示 Microsoft SQL Server / Azure SQL。
	FamilySQLServer = "sqlserver"
)

// 能力 ID（跨端稳定字符串；新增只加常量，勿改已有取值）。
const (
	// CapBracketIdent 标识符使用方括号 [ident]。
	CapBracketIdent = "sqlserver.bracket_ident"
	// CapAtVariable 支持 @local / @@global 变量。
	CapAtVariable = "sqlserver.at_variable"
	// CapSplitGoBatches 拆句识别独立行 GO 批边界。
	CapSplitGoBatches = "split.go_batches"
	// CapFormatTransactSQL 格式化走 transactsql 方言。
	CapFormatTransactSQL = "format.transactsql"
	// CapEditorBuiltinSQL Monaco 使用内置 sql（无 LSP 时回退）。
	CapEditorBuiltinSQL = "editor.builtin_sql"
	// CapEditorSqlLsp Monaco 经 Bridge 隧道对接本服务嵌入的 SQL Language Server。
	CapEditorSqlLsp = "editor.sql_lsp"
	// CapRoutineCreateProcedure 支持 CREATE PROCEDURE 模板。
	CapRoutineCreateProcedure = "routine.create_procedure"
	// CapRoutineCreateFunction 支持 CREATE FUNCTION 模板。
	CapRoutineCreateFunction = "routine.create_function"
	// CapDDLIfNotExists 条件 DDL 习惯提示。
	CapDDLIfNotExists = "ddl.if_not_exists"
	// CapSequence SEQUENCE 对象（2012+）。
	CapSequence = "sqlserver.sequence"
	// CapJSON JSON 函数（2016+）。
	CapJSON = "sqlserver.json"
)

// ErrNotSQLServer 表示目标实例不是 SQL Server / Azure SQL。
var ErrNotSQLServer = errors.New("sqlserver: server is not Microsoft SQL Server or Azure SQL; use the matching connection kind")

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
	return ResolveCapabilities("16.0.0", false)
}

var (
	// ProductVersion 常见 "16.0.1000.6" / "15.0.2000.5"。
	versionCoreRe = regexp.MustCompile(`(?i)(\d+)\.(\d+)(?:\.(\d+))?`)
	sqlServerHintRe = regexp.MustCompile(`(?i)(microsoft\s+sql\s+server|azure\s+sql|sql\s+azure)`)
	foreignHintRe   = regexp.MustCompile(`(?i)(mariadb|mysql|postgres|postgreSQL|oracle database|kingbase|clickhouse|dameng)`)
)

// IsSQLServerFamily 根据 @@VERSION 判断是否为本引擎族。
func IsSQLServerFamily(versionText string) bool {
	v := strings.TrimSpace(versionText)
	if v == "" {
		return false
	}
	if foreignHintRe.MatchString(v) && !sqlServerHintRe.MatchString(v) {
		return false
	}
	return sqlServerHintRe.MatchString(v)
}

// IsAzureSQL 粗判 Azure SQL（Database / MI）。
func IsAzureSQL(versionText, edition string) bool {
	blob := versionText + " " + edition
	return regexp.MustCompile(`(?i)(azure|sql\s+azure)`).MatchString(blob)
}

// ParseVersionNum 将 "16.0.1000.6" 解析为 "1600"；失败返回空串。
func ParseVersionNum(version string) string {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) < 3 {
		return ""
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	return fmt.Sprintf("%d%02d", major, minor)
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

// ResolveCapabilities 按版本纯函数解析能力集（单测覆盖）。
func ResolveCapabilities(productVersion string, isAzure bool) ServerProfile {
	major, _ := MajorMinor(productVersion)
	caps := []string{
		CapBracketIdent,
		CapAtVariable,
		CapSplitGoBatches,
		CapFormatTransactSQL,
		CapEditorBuiltinSQL,
		CapEditorSqlLsp,
		CapRoutineCreateProcedure,
		CapRoutineCreateFunction,
		CapDDLIfNotExists,
	}
	// SEQUENCE：2012 (11)+；无法解析时按现代默认开启。
	if major == 0 || major >= 11 {
		caps = append(caps, CapSequence)
	}
	// JSON：2016 (13)+。
	if major == 0 || major >= 13 {
		caps = append(caps, CapJSON)
	}

	p := ServerProfile{
		Family:       FamilySQLServer,
		Version:      strings.TrimSpace(productVersion),
		VersionNum:   ParseVersionNum(productVersion),
		Capabilities: caps,
	}
	if isAzure {
		p.SQLCompatibility = "azure"
	}
	return p
}

// Probe 读取版本信息并解析能力；非本引擎返回 ErrNotSQLServer。
func Probe(ctx context.Context, db *sql.DB) (*ServerProfile, error) {
	if db == nil {
		return nil, fmt.Errorf("sqlserver: dialect probe: nil db")
	}
	versionText, err := queryScalar(ctx, db, "SELECT @@VERSION")
	if err != nil {
		return nil, fmt.Errorf("sqlserver: select @@version: %w", err)
	}
	if !IsSQLServerFamily(versionText) {
		return nil, ErrNotSQLServer
	}
	productVersion, _ := queryScalar(ctx, db, "SELECT CAST(SERVERPROPERTY('ProductVersion') AS nvarchar(128))")
	edition, _ := queryScalar(ctx, db, "SELECT CAST(SERVERPROPERTY('Edition') AS nvarchar(128))")
	if productVersion == "" {
		productVersion = extractProductVersionFromBanner(versionText)
	}
	isAzure := IsAzureSQL(versionText, edition)
	p := ResolveCapabilities(productVersion, isAzure)
	if p.Version == "" {
		p.Version = strings.TrimSpace(versionText)
	}
	return &p, nil
}

func extractProductVersionFromBanner(banner string) string {
	// "... - 16.0.1000.6 (X64) ..."
	re := regexp.MustCompile(`(?i)-\s*(\d+\.\d+(?:\.\d+){0,2})\s`)
	if m := re.FindStringSubmatch(banner); len(m) == 2 {
		return m[1]
	}
	return ""
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
