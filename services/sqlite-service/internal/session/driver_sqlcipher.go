//go:build sqlcipher

package session

import (
	_ "github.com/mutecomm/go-sqlcipher/v4"
)

// go-sqlcipher 注册名与 mattn/go-sqlite3 一致。
const driverName = "sqlite3"

// SupportsSQLCipher 报告当前二进制是否编译了 SQLCipher 驱动。
func SupportsSQLCipher() bool { return true }
