package session

import (
	"strings"
	"testing"
	"time"
)

func TestFormatMysqlTemporal_DateTime(t *testing.T) {
	tm := time.Date(2026, 7, 23, 6, 36, 55, 0, time.Local)
	got := formatMysqlTemporal(tm, "DATETIME")
	if got != "2026-07-23 06:36:55" {
		t.Fatalf("DATETIME: got %q", got)
	}
	got = formatMysqlTemporal(tm, "TIMESTAMP")
	if got != "2026-07-23 06:36:55" {
		t.Fatalf("TIMESTAMP: got %q", got)
	}
}

func TestFormatMysqlTemporal_ZeroDate(t *testing.T) {
	if got := formatMysqlTemporal(time.Time{}, "DATE"); got != "0000-00-00" {
		t.Fatalf("zero DATE: got %q", got)
	}
	if got := formatMysqlTemporal(time.Time{}, "DATETIME"); got != "0000-00-00 00:00:00" {
		t.Fatalf("zero DATETIME: got %q", got)
	}
}

func TestFormatMysqlTemporal_Date(t *testing.T) {
	tm := time.Date(2026, 7, 23, 0, 0, 0, 0, time.Local)
	got := formatMysqlTemporal(tm, "DATE")
	if got != "2026-07-23" {
		t.Fatalf("DATE: got %q", got)
	}
}

func TestFormatMysqlTemporal_Time(t *testing.T) {
	tm := time.Date(0, 1, 1, 14, 49, 43, 0, time.Local)
	got := formatMysqlTemporal(tm, "TIME")
	if got != "14:49:43" {
		t.Fatalf("TIME: got %q", got)
	}
}

func TestFormatMysqlTemporal_Fraction(t *testing.T) {
	tm := time.Date(2026, 7, 23, 6, 36, 55, 123000000, time.Local)
	got := formatMysqlTemporal(tm, "DATETIME")
	if got != "2026-07-23 06:36:55.123" {
		t.Fatalf("fraction: got %q", got)
	}
}

func TestEncodeCell_NoRFC3339(t *testing.T) {
	tm := time.Date(2026, 7, 23, 6, 36, 55, 0, time.Local)
	got := encodeCell(tm, ColumnMeta{DataType: "DATETIME"})
	s, ok := got.(string)
	if !ok {
		t.Fatalf("expected string, got %T", got)
	}
	if s != "2026-07-23 06:36:55" {
		t.Fatalf("got %q", s)
	}
	if strings.Contains(s, "T") || strings.HasSuffix(s, "Z") {
		t.Fatalf("must not emit ISO/RFC3339: %q", s)
	}
}

func TestEncodeCell_TinyIntBool(t *testing.T) {
	one := int64(1)
	col := ColumnMeta{DataType: "TINYINT", Length: &one}
	if got := encodeCell(int64(1), col); got != true {
		t.Fatalf("TINYINT(1)=1 → true, got %#v", got)
	}
	if got := encodeCell(int64(0), col); got != false {
		t.Fatalf("TINYINT(1)=0 → false, got %#v", got)
	}
	// TINYINT 非 (1) 保持整数
	col2 := ColumnMeta{DataType: "TINYINT"}
	if got := encodeCell(int64(2), col2); got != int64(2) {
		t.Fatalf("TINYINT=2 → int64, got %#v", got)
	}
}

func TestEncodeCell_Bit(t *testing.T) {
	one := int64(1)
	if got := encodeCell([]byte{0x01}, ColumnMeta{DataType: "BIT", Length: &one}); got != true {
		t.Fatalf("BIT(1)=1 → true, got %#v", got)
	}
	if got := encodeCell([]byte{0x00}, ColumnMeta{DataType: "BIT", Length: &one}); got != false {
		t.Fatalf("BIT(1)=0 → false, got %#v", got)
	}
	eight := int64(8)
	got := encodeCell([]byte{0xab}, ColumnMeta{DataType: "BIT", Length: &eight})
	if got != "0xab" {
		t.Fatalf("BIT(8) → 0xab, got %#v", got)
	}
}

func TestEncodeCell_DecimalKeepsString(t *testing.T) {
	got := encodeCell([]byte("12345678901234567890.12"), ColumnMeta{DataType: "DECIMAL"})
	if got != "12345678901234567890.12" {
		t.Fatalf("DECIMAL: got %#v", got)
	}
}

func TestEncodeCell_LargeIntAsString(t *testing.T) {
	got := encodeCell(uint64(9007199254740993), ColumnMeta{DataType: "BIGINT UNSIGNED"})
	if got != "9007199254740993" {
		t.Fatalf("large uint64: got %#v", got)
	}
	got = encodeCell(int64(9007199254740993), ColumnMeta{DataType: "BIGINT"})
	if got != "9007199254740993" {
		t.Fatalf("large int64: got %#v", got)
	}
}

func TestEncodeCell_TimeDurationBytes(t *testing.T) {
	got := encodeCell([]byte("-838:59:59"), ColumnMeta{DataType: "TIME"})
	if got != "-838:59:59" {
		t.Fatalf("TIME duration: got %#v", got)
	}
}

func TestEncodeCell_JSON(t *testing.T) {
	got := encodeCell([]byte(`{"a":1}`), ColumnMeta{DataType: "JSON"})
	if got != `{"a":1}` {
		t.Fatalf("JSON: got %#v", got)
	}
}

func TestEncodeCell_VarcharChinese(t *testing.T) {
	// 驱动对 VARCHAR 常返回 []byte；中文须按字符串，勿 $binary
	name := []byte("管理员001")
	got := encodeCell(name, ColumnMeta{DataType: "VARCHAR"})
	if got != "管理员001" {
		t.Fatalf("VARCHAR Chinese: got %#v", got)
	}
	got = encodeCell(name, ColumnMeta{DataType: "varchar(100)"})
	if got != "管理员001" {
		t.Fatalf("varchar(100) Chinese: got %#v", got)
	}
	got = encodeCell([]byte("DATAHUB"), ColumnMeta{DataType: "VARCHAR"})
	if got != "DATAHUB" {
		t.Fatalf("VARCHAR ASCII: got %#v", got)
	}
}

func TestEncodeCell_TextChinese(t *testing.T) {
	got := encodeCell([]byte("你好世界"), ColumnMeta{DataType: "TEXT"})
	if got != "你好世界" {
		t.Fatalf("TEXT Chinese: got %#v", got)
	}
}

func TestNormalizeMysqlTypeName_Unsigned(t *testing.T) {
	if got := normalizeMysqlTypeName("BIGINT UNSIGNED"); got != "BIGINT" {
		t.Fatalf("got %q", got)
	}
	if got := normalizeMysqlTypeName("DATETIME(6)"); got != "DATETIME" {
		t.Fatalf("got %q", got)
	}
}
