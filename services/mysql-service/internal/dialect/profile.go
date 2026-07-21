// Package dialect 提供 Oracle MySQL 方言族与会话能力集。
//
// 调用方禁止散落「if version < 8」；一律通过 ServerProfile.Capabilities 开关。
// MariaDB 不在本包兼容范围内：探测到特征则返回 ErrMariaDBRejected。
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
	// FamilyMySQL 表示 Oracle MySQL。
	FamilyMySQL = "mysql"
)

// 能力 ID（跨端稳定字符串；新增只加常量，勿改已有取值）。
const (
	// CapBacktickIdent 标识符使用反引号。
	CapBacktickIdent = "mysql.backtick_ident"
	// CapHashComment 支持 # 行注释。
	CapHashComment = "mysql.hash_comment"
	// CapBackslashEscape 字符串支持反斜杠转义。
	CapBackslashEscape = "mysql.backslash_escape"
	// CapFormatMySQL 格式化走 mysql 方言。
	CapFormatMySQL = "format.mysql"
	// CapEditorBuiltinSQL Monaco 使用内置 sql（P0 默认）。
	CapEditorBuiltinSQL = "editor.builtin_sql"
	// CapEditorMySQLMonaco Monaco 使用 mysql + sql-languages（语言包就绪后）。
	CapEditorMySQLMonaco = "editor.mysql_monaco"
	// CapSplitDelimiterBlocks 拆句识别 MySQL 客户端 DELIMITER 指令。
	CapSplitDelimiterBlocks = "split.delimiter_blocks"
	// CapRoutineCreateProcedure 支持 CREATE PROCEDURE 模板。
	CapRoutineCreateProcedure = "routine.create_procedure"
	// CapRoutineCreateFunction 支持 CREATE FUNCTION 模板。
	CapRoutineCreateFunction = "routine.create_function"
	// CapDDLIfNotExists 常用 IF NOT EXISTS。
	CapDDLIfNotExists = "ddl.if_not_exists"
	// CapJSONNativeType JSON 类型 / 函数较完整。
	CapJSONNativeType = "json.native_type"
	// CapCTEWindow CTE / 窗口函数常用集。
	CapCTEWindow = "cte.window"
	// CapRoleGrant 角色与 GRANT 模型（8.0+）。
	CapRoleGrant = "role.grant"
	// CapAuthCachingSHA2 默认认证插件提示（8.0+）。
	CapAuthCachingSHA2 = "auth.caching_sha2"
)

// ErrMariaDBRejected 表示目标实例为 MariaDB，须改用 mariadb 连接类型。
var ErrMariaDBRejected = errors.New("mysql: server is MariaDB; use mariadb connection kind instead")

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

// DefaultMySQL57 返回 MySQL 5.7 产品默认能力（探测失败时的保守回退之一）。
func DefaultMySQL57() ServerProfile {
	return ServerProfile{
		Family: FamilyMySQL,
		Capabilities: []string{
			CapBacktickIdent,
			CapHashComment,
			CapBackslashEscape,
			CapFormatMySQL,
			CapEditorBuiltinSQL,
			CapRoutineCreateProcedure,
			CapRoutineCreateFunction,
			CapDDLIfNotExists,
			CapSplitDelimiterBlocks,
		},
	}
}

// DefaultMySQL8 返回 MySQL 8.0+ 产品默认能力。
func DefaultMySQL8() ServerProfile {
	return ServerProfile{
		Family: FamilyMySQL,
		Capabilities: []string{
			CapBacktickIdent,
			CapHashComment,
			CapBackslashEscape,
			CapFormatMySQL,
			CapEditorBuiltinSQL,
			CapRoutineCreateProcedure,
			CapRoutineCreateFunction,
			CapDDLIfNotExists,
			CapSplitDelimiterBlocks,
			CapJSONNativeType,
			CapCTEWindow,
			CapRoleGrant,
			CapAuthCachingSHA2,
		},
	}
}

var (
	versionCoreRe = regexp.MustCompile(`(?i)(\d+)\.(\d+)\.(\d+)`)
	mariaDBHintRe = regexp.MustCompile(`(?i)mariadb`)
)

// IsMariaDB 根据 VERSION() / version_comment 判断是否为 MariaDB。
func IsMariaDB(version, versionComment string) bool {
	return mariaDBHintRe.MatchString(version) || mariaDBHintRe.MatchString(versionComment)
}

// ParseVersionNum 将 "8.0.36" 类版本解析为 "80036"；失败返回空串。
func ParseVersionNum(version string) string {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) != 4 {
		return ""
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	return fmt.Sprintf("%d%02d%02d", major, minor, patch)
}

// MajorMinor 返回主、次版本号；解析失败返回 0,0。
func MajorMinor(version string) (major, minor int) {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) != 4 {
		return 0, 0
	}
	major, _ = strconv.Atoi(m[1])
	minor, _ = strconv.Atoi(m[2])
	return major, minor
}

// ResolveCapabilities 按 MySQL 版本纯函数解析能力集（单测覆盖；不含 MariaDB）。
func ResolveCapabilities(version, versionComment, authPlugin string) ServerProfile {
	major, minor := MajorMinor(version)
	is8Plus := major > 8 || (major == 8 && minor >= 0) || major >= 9
	// 5.7 及更早走 57 集；无法解析时按 8.0 产品默认（桌面工具常见目标）。
	var p ServerProfile
	if major > 0 && major < 8 {
		p = DefaultMySQL57()
	} else {
		p = DefaultMySQL8()
		is8Plus = true
	}
	p.Version = strings.TrimSpace(version)
	p.VersionNum = ParseVersionNum(version)
	if c := strings.TrimSpace(versionComment); c != "" {
		p.SQLCompatibility = c
	}

	// 5.7 弱 JSON：不默认开 CapJSONNativeType（已在 DefaultMySQL57 省略）。
	// 8.0+ 若探测到非 caching_sha2 默认插件，仍保留 Cap 作 UI 提示可选；插件串写入兼容字段即可。
	_ = authPlugin
	_ = is8Plus
	return p
}

// Probe 读取 VERSION 等信息并解析能力；MariaDB 返回 ErrMariaDBRejected。
func Probe(ctx context.Context, db *sql.DB) (*ServerProfile, error) {
	if db == nil {
		return nil, fmt.Errorf("mysql: dialect probe: nil db")
	}
	version, err := queryScalar(ctx, db, "SELECT VERSION()")
	if err != nil {
		return nil, fmt.Errorf("mysql: select version: %w", err)
	}
	comment, _ := queryScalar(ctx, db, "SELECT @@version_comment")
	if IsMariaDB(version, comment) {
		return nil, ErrMariaDBRejected
	}
	authPlugin, _ := queryScalar(ctx, db, "SELECT @@default_authentication_plugin")
	p := ResolveCapabilities(version, comment, authPlugin)
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
