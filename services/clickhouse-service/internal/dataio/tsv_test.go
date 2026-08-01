package dataio

import (
	"encoding/json"
	"strings"
	"testing"
	"time"
)

func TestEscapeUnescapeTSVRoundTrip(t *testing.T) {
	t.Parallel()
	cases := []string{
		"plain",
		"has\ttab",
		"has\nline",
		`path\file`,
		"a\tb\nc\\d",
		"",
	}
	for _, in := range cases {
		got := unescapeTSVField(escapeTSVField(in))
		if got != in {
			t.Fatalf("roundtrip %q -> escape -> %q", in, got)
		}
	}
}

func TestSplitTSVLine(t *testing.T) {
	t.Parallel()
	got := splitTSVLine("a\thello\\tworld\tc")
	if len(got) != 3 || got[1] != "hello\tworld" {
		t.Fatalf("got %#v", got)
	}
}

func TestWriteTSVRecordSpecialChars(t *testing.T) {
	t.Parallel()
	var b strings.Builder
	if err := writeTSVRecord(&b, []string{"id", "a,b", "x\ty", "line1\nline2"}); err != nil {
		t.Fatal(err)
	}
	line := strings.TrimSuffix(b.String(), "\n")
	parts := splitTSVLine(line)
	if parts[0] != "id" || parts[1] != "a,b" || parts[2] != "x\ty" || parts[3] != "line1\nline2" {
		t.Fatalf("got %#v from %q", parts, line)
	}
	// 不得使用 RFC CSV 引号包裹
	if strings.Contains(b.String(), `"`) {
		t.Fatalf("unexpected quotes in TSV: %q", b.String())
	}
}

func TestJSONCellValuePreservesTypes(t *testing.T) {
	t.Parallel()
	if got := jsonCellValue(int64(42), "", "Int64"); got != int64(42) {
		t.Fatalf("int %v", got)
	}
	if got := jsonCellValue(true, "", "Bool"); got != true {
		t.Fatalf("bool %v", got)
	}
	if got := jsonCellValue(3.14, "", "Float64"); got != 3.14 {
		t.Fatalf("float %v", got)
	}
	tm := time.Date(2024, 1, 2, 3, 4, 5, 0, time.UTC)
	if got := jsonCellValue(tm, "", "DateTime"); got != "2024-01-02 03:04:05" {
		t.Fatalf("time %v", got)
	}
	if got := jsonCellValue(nil, "", "String"); got != nil {
		t.Fatalf("null %v", got)
	}
	raw, err := json.Marshal(map[string]any{
		"n": jsonCellValue(int64(1), "", "Int64"),
		"s": jsonCellValue("a,b\"c", "", "String"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(raw), `"n":1`) {
		t.Fatalf("expected numeric json, got %s", raw)
	}
	if !strings.Contains(string(raw), `"a,b\"c"`) && !strings.Contains(string(raw), `a,b\\\"c`) {
		// encoding/json escapes quote as \"
		if !strings.Contains(string(raw), "a,b") {
			t.Fatalf("missing string payload: %s", raw)
		}
	}
}

func TestIsImportNullTokenTSV(t *testing.T) {
	t.Parallel()
	if !isImportNullToken(`\N`, `\N`, FormatTSV) {
		t.Fatal("default null")
	}
	if !isImportNullToken("NULL", "NULL", FormatTSV) {
		t.Fatal("custom null")
	}
	if isImportNullToken("x", `\N`, FormatTSV) {
		t.Fatal("non-null")
	}
}
