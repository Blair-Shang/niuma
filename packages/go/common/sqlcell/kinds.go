package sqlcell

import "strings"

// IsMysqlTextKind 判断规范化后的 MySQL 类型名是否为文本列。
// kind 应为已去掉长度/UNSIGNED 的大写基名（如 VARCHAR、TEXT）。
func IsMysqlTextKind(kind string) bool {
	switch strings.ToUpper(strings.TrimSpace(kind)) {
	case "CHAR", "VARCHAR", "TINYTEXT", "TEXT", "MEDIUMTEXT", "LONGTEXT", "ENUM", "SET":
		return true
	default:
		return false
	}
}
