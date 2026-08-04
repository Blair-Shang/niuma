package session

import (
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
	kind := normalizeTypeName(col.DataType)

	switch t := v.(type) {
	case bool:
		return t
	case string:
		return t
	case int64:
		return encodeSignedInt(t)
	case int32:
		return encodeSignedInt(int64(t))
	case int16:
		return encodeSignedInt(int64(t))
	case int8:
		return encodeSignedInt(int64(t))
	case int:
		return encodeSignedInt(int64(t))
	case uint64:
		return encodeUnsignedInt(t)
	case uint32:
		return encodeUnsignedInt(uint64(t))
	case uint16:
		return encodeUnsignedInt(uint64(t))
	case uint8:
		return encodeUnsignedInt(uint64(t))
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
		return encodeBytesCell(t, kind)
	case time.Time:
		return formatTemporal(t, kind)
	default:
		return fmt.Sprintf("%v", t)
	}
}

func encodeSignedInt(n int64) any {
	if n > jsMaxSafeInt || n < -jsMaxSafeInt {
		return strconv.FormatInt(n, 10)
	}
	return n
}

func encodeUnsignedInt(n uint64) any {
	if n > uint64(jsMaxSafeInt) {
		return strconv.FormatUint(n, 10)
	}
	return n
}

func encodeBytesCell(b []byte, kind string) any {
	switch kind {
	case "DECIMAL", "NUMERIC", "MONEY", "SMALLMONEY":
		return string(b)
	case "UNIQUEIDENTIFIER", "UNIQUEIDENTIFIERCHAR":
		return sqlcell.EncodeTextColumnBytes(b)
	case "XML", "NVARCHAR", "VARCHAR", "NCHAR", "CHAR", "TEXT", "NTEXT", "SYSNAME":
		return sqlcell.EncodeTextColumnBytes(b)
	case "VARBINARY", "BINARY", "IMAGE", "TIMESTAMP", "ROWVERSION":
		return sqlcell.BinaryEnvelope(b)
	default:
		return sqlcell.EncodeBytesAsTextOrBinary(b)
	}
}

func formatTemporal(t time.Time, kind string) string {
	if t.IsZero() {
		switch kind {
		case "DATE":
			return "0001-01-01"
		case "TIME":
			return "00:00:00"
		default:
			return "0001-01-01 00:00:00"
		}
	}
	switch kind {
	case "DATE":
		return t.Format("2006-01-02")
	case "TIME":
		if t.Nanosecond() == 0 {
			return t.Format("15:04:05")
		}
		return strings.TrimRight(strings.TrimRight(t.Format("15:04:05.0000000"), "0"), ".")
	case "DATETIMEOFFSET":
		return t.Format(time.RFC3339Nano)
	default:
		if t.Nanosecond() == 0 {
			return t.Format("2006-01-02 15:04:05")
		}
		return strings.TrimRight(strings.TrimRight(t.Format("2006-01-02 15:04:05.0000000"), "0"), ".")
	}
}

func normalizeTypeName(dataType string) string {
	s := strings.ToUpper(strings.TrimSpace(dataType))
	if i := strings.IndexByte(s, '('); i >= 0 {
		s = s[:i]
	}
	if i := strings.IndexByte(s, ' '); i >= 0 {
		s = s[:i]
	}
	return s
}
