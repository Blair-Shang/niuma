//go:build sqlcipher

package dialect

// BuildSupportsSQLCipher 可选 -tags sqlcipher 构建启用加密驱动。
func BuildSupportsSQLCipher() bool { return true }
