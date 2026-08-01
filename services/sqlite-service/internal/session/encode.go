package session

import (
	"encoding/base64"
	"math"
	"time"
	"unicode/utf8"
)

func encodeCell(v any) any {
	if v == nil {
		return nil
	}
	switch t := v.(type) {
	case bool, string:
		return t
	case int64:
		return t
	case int32:
		return int64(t)
	case int:
		return int64(t)
	case float64:
		if math.IsNaN(t) || math.IsInf(t, 0) {
			return nil
		}
		return t
	case float32:
		f := float64(t)
		if math.IsNaN(f) || math.IsInf(f, 0) {
			return nil
		}
		return f
	case []byte:
		if utf8.Valid(t) {
			return string(t)
		}
		return map[string]any{
			"$bin": base64.StdEncoding.EncodeToString(t),
		}
	case time.Time:
		return t.UTC().Format(time.RFC3339Nano)
	default:
		return t
	}
}
