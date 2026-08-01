package tools

import (
	"fmt"
	"regexp"
	"strings"

	"niuma/services/clickhouse-service/internal/session"
)

// prepareNativeConnect 校验会话是否可供本机 clickhouse-client 使用。
// CLI 仅支持 Native TCP；HTTP / SSH 隧道会话应改用内置引擎。
func prepareNativeConnect(connect session.ConnectParams) (session.ConnectParams, error) {
	if connect.Options.Tunnel != nil && connect.Options.Tunnel.Enabled() {
		return connect, fmt.Errorf(
			"clickhouse-client cannot use SSH tunnel sessions; switch to the built-in engine in Backup & Restore",
		)
	}
	if connect.Options.ProtocolOrDefault() == session.ProtocolHTTP {
		return connect, fmt.Errorf(
			"clickhouse-client requires Native TCP (port 9000/9440); current session uses HTTP — switch to the built-in engine, or reconnect with protocol=native",
		)
	}
	out := connect
	out.Options.Protocol = session.ProtocolNative
	return out, nil
}

func isProtectedDatabase(name string) bool {
	switch strings.TrimSpace(name) {
	case "system", "information_schema", "INFORMATION_SCHEMA":
		return true
	default:
		return false
	}
}

func ensureStatement(sqlText string) string {
	s := strings.TrimRight(sqlText, " \t\r\n")
	if s == "" {
		return s
	}
	if strings.HasSuffix(s, ";") {
		return s + "\n"
	}
	return s + ";\n"
}

func stripDatabaseQualifier(sqlText, database string) string {
	db := strings.TrimSpace(database)
	if db == "" || sqlText == "" {
		return sqlText
	}
	out := strings.ReplaceAll(sqlText, "`"+escapeIdent(db)+"`.", "")
	re := regexp.MustCompile(`(^|[^0-9A-Za-z_])` + regexp.QuoteMeta(db) + `\.`)
	return re.ReplaceAllString(out, "${1}")
}
