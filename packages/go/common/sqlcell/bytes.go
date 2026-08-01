// Package sqlcell 提供查询结果单元格的字节编码启发式：
// 合法 UTF-8 文本 vs {"$binary": base64}。
package sqlcell

import (
	"encoding/base64"
	"unicode"
	"unicode/utf8"
)

// BinaryEnvelope 将原始字节包装为前端可识别的二进制信封。
func BinaryEnvelope(b []byte) map[string]any {
	return map[string]any{"$binary": base64.StdEncoding.EncodeToString(b)}
}

// DecodeTextBytes 若 b 为合法 UTF-8 则返回对应字符串。
func DecodeTextBytes(b []byte) (string, bool) {
	if !utf8.Valid(b) {
		return "", false
	}
	return string(b), true
}

// EncodeBytesAsTextOrBinary：合法且「大多可打印」的 UTF-8 → 字符串，否则 → $binary。
// 适用于未知列类型 / BLOB 中可能夹带文本的场景。
func EncodeBytesAsTextOrBinary(b []byte) any {
	if s, ok := DecodeTextBytes(b); ok && IsMostlyPrintable(b) {
		return s
	}
	return BinaryEnvelope(b)
}

// EncodeTextColumnBytes：已知文本列（VARCHAR 等）——合法 UTF-8 一律当字符串。
func EncodeTextColumnBytes(b []byte) any {
	if s, ok := DecodeTextBytes(b); ok {
		return s
	}
	return BinaryEnvelope(b)
}

// IsMostlyPrintable 按 Unicode rune 判断可打印比例（≥80%）。
// 按字节只认 ASCII 会把合法 UTF-8 中文误判为二进制。
func IsMostlyPrintable(b []byte) bool {
	if len(b) == 0 {
		return true
	}
	if !utf8.Valid(b) {
		return false
	}
	printable := 0
	total := 0
	for _, r := range string(b) {
		total++
		if r == '\t' || r == '\n' || r == '\r' || unicode.IsPrint(r) {
			printable++
		}
	}
	if total == 0 {
		return true
	}
	return printable*10 >= total*8
}
