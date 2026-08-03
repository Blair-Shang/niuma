//go:build !sqlcipher

package dialect

// BuildSupportsSQLCipher 默认构建（modernc）不支持 SQLCipher。
func BuildSupportsSQLCipher() bool { return false }
