package session

import (
	"encoding/hex"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"niuma/pkg/common/sqlcell"
)

// JS Number.MAX_SAFE_INTEGER：超出则改用十进制字符串，避免前端精度丢失。
const jsMaxSafeInt = int64(9007199254740991)

func encodeCell(v any, col ColumnMeta) any {
	if v == nil {
		return nil
	}
	kind := normalizeMysqlTypeName(col.DataType)

	switch t := v.(type) {
	case bool:
		return t
	case string:
		return encodeStringByKind(t, kind)
	case int64:
		return encodeSignedInt(t, col, kind)
	case int32:
		return encodeSignedInt(int64(t), col, kind)
	case int16:
		return encodeSignedInt(int64(t), col, kind)
	case int8:
		return encodeSignedInt(int64(t), col, kind)
	case int:
		return encodeSignedInt(int64(t), col, kind)
	case uint64:
		return encodeUnsignedInt(t, col, kind)
	case uint32:
		return encodeUnsignedInt(uint64(t), col, kind)
	case uint16:
		return encodeUnsignedInt(uint64(t), col, kind)
	case uint8:
		return encodeUnsignedInt(uint64(t), col, kind)
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case float32:
		f := float64(t)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return fmt.Sprintf("%v", t)
		}
		return t
	case []byte:
		return encodeBytesCell(t, col, kind)
	case time.Time:
		// 对齐 Navicat / DBeaver：MySQL 原生墙钟字面量（连接 Loc=Local），勿 RFC3339。
		return formatMysqlTemporal(t, kind)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func encodeStringByKind(s string, kind string) any {
	// 个别路径下 DATE/DATETIME 可能已是文本（含零日期）
	switch kind {
	case "DATE", "DATETIME", "TIMESTAMP", "TIME":
		return s
	default:
		return s
	}
}

func encodeSignedInt(n int64, col ColumnMeta, kind string) any {
	if isTinyIntBool(kind, col) {
		return n != 0
	}
	if kind == "YEAR" {
		return n
	}
	if n > jsMaxSafeInt || n < -jsMaxSafeInt {
		return strconv.FormatInt(n, 10)
	}
	return n
}

func encodeUnsignedInt(n uint64, col ColumnMeta, kind string) any {
	if isTinyIntBool(kind, col) {
		return n != 0
	}
	if n > uint64(jsMaxSafeInt) {
		return strconv.FormatUint(n, 10)
	}
	return n
}

// TINYINT(1) / BOOLEAN：按布尔展示（对齐 DBeaver 勾选；Navicat 亦常视作开关）。
func isTinyIntBool(kind string, col ColumnMeta) bool {
	if kind != "TINYINT" && kind != "BOOL" && kind != "BOOLEAN" {
		return false
	}
	if kind == "BOOL" || kind == "BOOLEAN" {
		return true
	}
	return col.Length != nil && *col.Length == 1
}

func encodeBytesCell(b []byte, col ColumnMeta, kind string) any {
	switch kind {
	case "BIT":
		return encodeBitValue(b, col.Length)
	case "DECIMAL", "NUMERIC", "NEWDECIMAL":
		// 保持十进制文本，避免 float 丢精度
		return string(b)
	case "TIME":
		// TIME 常为 duration 文本（可负、可 >24h），勿强行 time.Time
		return string(b)
	case "DATE", "DATETIME", "TIMESTAMP", "YEAR":
		return string(b)
	case "GEOMETRY", "POINT", "LINESTRING", "POLYGON",
		"MULTIPOINT", "MULTILINESTRING", "MULTIPOLYGON", "GEOMETRYCOLLECTION":
		return sqlcell.BinaryEnvelope(b)
	case "BINARY", "VARBINARY":
		return sqlcell.BinaryEnvelope(b)
	case "TINYBLOB", "BLOB", "MEDIUMBLOB", "LONGBLOB":
		return sqlcell.EncodeBytesAsTextOrBinary(b)
	case "JSON":
		return sqlcell.EncodeTextColumnBytes(b)
	default:
		if sqlcell.IsMysqlTextKind(kind) {
			return sqlcell.EncodeTextColumnBytes(b)
		}
		return sqlcell.EncodeBytesAsTextOrBinary(b)
	}
}

// encodeBitValue：BIT(1)→0/1；BIT(n)→0x.. 十六进制（紧凑、可回写）。
func encodeBitValue(b []byte, bitLen *int64) any {
	if len(b) == 0 {
		return nil
	}
	width := int64(len(b) * 8)
	if bitLen != nil && *bitLen > 0 {
		width = *bitLen
	}
	if width <= 1 {
		return b[len(b)-1]&1 != 0
	}
	return "0x" + strings.ToLower(hex.EncodeToString(b))
}

// formatMysqlTemporal 输出 DATE / TIME / DATETIME|TIMESTAMP 的库原生文本。
func formatMysqlTemporal(t time.Time, kind string) string {
	// ParseTime 下 MySQL 零日期 → Go zero time；对齐客户端显示 0000-00-00。
	if t.IsZero() {
		switch kind {
		case "DATE":
			return "0000-00-00"
		case "TIME":
			return "00:00:00"
		default:
			return "0000-00-00 00:00:00"
		}
	}
	switch kind {
	case "DATE":
		return t.Format("2006-01-02")
	case "TIME":
		if t.Nanosecond() == 0 {
			return t.Format("15:04:05")
		}
		return trimMysqlFraction(t.Format("15:04:05.000000000"))
	case "YEAR":
		return t.Format("2006")
	default:
		if t.Nanosecond() == 0 {
			return t.Format("2006-01-02 15:04:05")
		}
		return trimMysqlFraction(t.Format("2006-01-02 15:04:05.000000000"))
	}
}

func normalizeMysqlTypeName(dataType string) string {
	s := strings.ToUpper(strings.TrimSpace(dataType))
	// "BIGINT UNSIGNED" → "BIGINT"
	if i := strings.IndexByte(s, ' '); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	return s
}

func trimMysqlFraction(s string) string {
	s = strings.TrimRight(s, "0")
	return strings.TrimRight(s, ".")
}
