package host

import (
	"fmt"
	"strings"
)

// IsSQLModule 判断 moduleId / connection kind 是否走官方 sql_*。
func IsSQLModule(kind string) bool {
	k := strings.ToLower(strings.TrimSpace(kind))
	switch k {
	case "vastbase", "postgres", "postgresql", "kingbase", "mysql", "mariadb",
		"sqlite", "dameng", "oracle", "clickhouse", "sqlserver", "mssql":
		return true
	default:
		return false
	}
}

// IsSSHModule 判断 moduleId / connection kind 是否走官方 ssh_*。
func IsSSHModule(kind string) bool {
	return strings.ToLower(strings.TrimSpace(kind)) == "ssh"
}

// HostToolSpecs 按当前 workspace 模块挑选官方工具。
// SSH 页签只暴露 ssh_*；数据库页签只暴露 sql_*；其它（含空）两族都给，避免无页签时丢能力。
func HostToolSpecs(moduleID string) []ToolSpec {
	if IsSSHModule(moduleID) {
		return SSHToolSpecs()
	}
	if IsSQLModule(moduleID) {
		return SQLToolSpecs()
	}
	out := append([]ToolSpec{}, SQLToolSpecs()...)
	return append(out, SSHToolSpecs()...)
}

// SpecServerID 返回工具所属官方 server_id。
func SpecServerID(spec ToolSpec) string {
	if strings.TrimSpace(spec.ServerID) != "" {
		return spec.ServerID
	}
	if IsSSHTool(spec.Name) {
		return ServerIDSSH
	}
	return ServerIDSQL
}

// NamespaceForKind 将连接 kind / moduleId 映射为 Bridge namespace。
//
// 未识别的 kind 原样返回（已是 namespace 时）；空串报错。
func NamespaceForKind(kind string) (string, error) {
	k := strings.ToLower(strings.TrimSpace(kind))
	if k == "" {
		return "", fmt.Errorf("sql host: moduleId or connection kind required (open a database tab)")
	}
	switch k {
	case "postgresql":
		return "postgres", nil
	case "mariadb":
		return "mysql", nil
	case "mssql":
		return "sqlserver", nil
	case "vastbase", "postgres", "kingbase", "mysql", "sqlite",
		"dameng", "oracle", "clickhouse", "sqlserver":
		return k, nil
	default:
		return k, nil
	}
}
