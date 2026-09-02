package host

import (
	"fmt"
	"strings"
)

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
