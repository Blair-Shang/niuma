//go:build !sqlcipher

package session

import (
	_ "modernc.org/sqlite"
)

const driverName = "sqlite"

// SupportsSQLCipher 报告当前二进制是否编译了 SQLCipher 驱动。
func SupportsSQLCipher() bool { return false }
