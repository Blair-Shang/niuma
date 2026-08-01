// Package dialect 提供 SQLite 方言族与会话能力集。
//
// 调用方禁止散落版本 if；一律通过 ServerProfile.Capabilities 开关。
// 契约见 docs/27-sqlite-module.md。
package dialect

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// FamilySQLite 是方言族（连接 kind）。
const FamilySQLite = "sqlite"

// 能力 ID（跨端稳定；新增只加常量，勿改已有取值）。
const (
	CapDoubleQuoteIdent = "sqlite.double_quote_ident"
	CapBracketIdent     = "sqlite.bracket_ident"
	CapPragma           = "sqlite.pragma"
	CapFormatSQLite          = "format.sqlite"
	CapEditorGenericSQLMonaco = "editor.genericsql_monaco"
	CapDDLIfNotExists        = "ddl.if_not_exists"
	CapJSONFunctions    = "json.functions"
	CapCTEWindow        = "cte.window"
	CapWAL              = "sqlite.wal"
	CapReadonly         = "sqlite.readonly"
	CapAttach           = "sqlite.attach"
	CapIOCsv            = "io.csv"
	CapIOSqlFile        = "io.sql_file"
	CapIOBackupAPI      = "io.backup_api"
	CapDDLDesign        = "ddl.design"
)

// ServerProfile 是一次连接探测后的方言档案。
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

// DefaultProfile 返回 SQLite 产品默认能力（探测失败时的回退）。
func DefaultProfile() ServerProfile {
	return ServerProfile{
		Family: FamilySQLite,
		Capabilities: []string{
			CapDoubleQuoteIdent,
			CapBracketIdent,
			CapPragma,
			CapFormatSQLite,
			CapEditorGenericSQLMonaco,
			CapDDLIfNotExists,
			CapCTEWindow,
			CapAttach,
			CapIOCsv,
			CapIOSqlFile,
			CapIOBackupAPI,
			CapDDLDesign,
		},
	}
}

var versionCoreRe = regexp.MustCompile(`(?i)(\d+)\.(\d+)\.(\d+)`)

// ParseVersionNum 将 "3.45.1" 解析为 "3045001"；失败返回空串。
func ParseVersionNum(version string) string {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) != 4 {
		return ""
	}
	major, _ := strconv.Atoi(m[1])
	minor, _ := strconv.Atoi(m[2])
	patch, _ := strconv.Atoi(m[3])
	// 3.45.1 → 3045001（与 docs/27 示例及可比对排序一致）
	return fmt.Sprintf("%d%03d%03d", major, minor, patch)
}

// MajorMinor 返回主、次版本号。
func MajorMinor(version string) (major, minor int) {
	m := versionCoreRe.FindStringSubmatch(version)
	if len(m) != 4 {
		return 0, 0
	}
	major, _ = strconv.Atoi(m[1])
	minor, _ = strconv.Atoi(m[2])
	return major, minor
}

// ResolveCapabilities 按版本与打开选项解析能力集（纯函数，便于单测）。
func ResolveCapabilities(version string, readOnly bool, journalMode string, hasJSON bool) ServerProfile {
	p := DefaultProfile()
	p.Version = strings.TrimSpace(version)
	p.VersionNum = ParseVersionNum(p.Version)

	caps := append([]string{}, p.Capabilities...)
	if hasJSON {
		caps = append(caps, CapJSONFunctions)
	}
	if readOnly {
		caps = append(caps, CapReadonly)
	}
	if strings.EqualFold(strings.TrimSpace(journalMode), "wal") {
		caps = append(caps, CapWAL)
	}
	// 现代 SQLite（3.8+）普遍具备 CTE/窗口；极老版本去掉窗口相关提示。
	major, minor := MajorMinor(p.Version)
	if major > 0 && (major < 3 || (major == 3 && minor < 8)) {
		caps = filterOut(caps, CapCTEWindow)
	}
	p.Capabilities = uniqueCaps(caps)
	return p
}

func filterOut(caps []string, drop string) []string {
	out := make([]string, 0, len(caps))
	for _, c := range caps {
		if c != drop {
			out = append(out, c)
		}
	}
	return out
}

func uniqueCaps(caps []string) []string {
	seen := make(map[string]struct{}, len(caps))
	out := make([]string, 0, len(caps))
	for _, c := range caps {
		if c == "" {
			continue
		}
		if _, ok := seen[c]; ok {
			continue
		}
		seen[c] = struct{}{}
		out = append(out, c)
	}
	return out
}
