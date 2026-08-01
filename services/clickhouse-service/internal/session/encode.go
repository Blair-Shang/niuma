package session

import (
	"fmt"
	"math"
	"math/big"
	"reflect"
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
	case *big.Int:
		if t == nil {
			return nil
		}
		return t.String()
	case *big.Float:
		if t == nil {
			return nil
		}
		return t.Text('f', -1)
	case []byte:
		return encodeBytesCell(t, kind)
	case time.Time:
		return formatTemporal(t, kind)
	default:
		rv := reflect.ValueOf(v)
		switch rv.Kind() {
		case reflect.Slice, reflect.Map, reflect.Array:
			// Array / Map / Tuple：以字符串展示，避免前端无法序列化专有类型。
			return fmt.Sprint(v)
		default:
			return fmt.Sprintf("%v", t)
		}
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
	switch {
	case strings.Contains(kind, "STRING"), strings.Contains(kind, "FIXEDSTRING"), kind == "UUID", kind == "IPV4", kind == "IPV6":
		return sqlcell.EncodeTextColumnBytes(b)
	case strings.Contains(kind, "DECIMAL"):
		return string(b)
	default:
		return sqlcell.EncodeBytesAsTextOrBinary(b)
	}
}

func formatTemporal(t time.Time, kind string) string {
	if t.IsZero() {
		switch {
		case strings.Contains(kind, "DATE") && !strings.Contains(kind, "TIME"):
			return "1970-01-01"
		default:
			return "1970-01-01 00:00:00"
		}
	}
	switch {
	case kind == "DATE" || strings.HasPrefix(kind, "DATE32"):
		return t.Format("2006-01-02")
	case strings.Contains(kind, "DATETIME64"), strings.Contains(kind, "DATETIME"):
		if t.Nanosecond() == 0 {
			return t.Format("2006-01-02 15:04:05")
		}
		return strings.TrimRight(strings.TrimRight(t.Format("2006-01-02 15:04:05.000000000"), "0"), ".")
	default:
		if t.Nanosecond() == 0 {
			return t.Format("2006-01-02 15:04:05")
		}
		return t.Format(time.RFC3339Nano)
	}
}

func normalizeTypeName(dataType string) string {
	s := strings.ToUpper(strings.TrimSpace(dataType))
	// Nullable(Int64) / Array(String) → 保留完整以便 Array/Map 分支识别。
	return s
}
