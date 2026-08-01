package dataio

import (
	"strings"
	"testing"
	"time"
)

func TestFormatCsvCell_DatetimeNoGoLocation(t *testing.T) {
	t.Parallel()
	tm := time.Date(2026, 7, 23, 23, 39, 42, 0, time.FixedZone("CST", 8*3600))
	got := formatCsvCell(tm, "\\N", "TIMESTAMP")
	if got != "2026-07-23 23:39:42" {
		t.Fatalf("TIMESTAMP: got %q", got)
	}
	if strings.Contains(got, "CST") || strings.Contains(got, "+0800") {
		t.Fatalf("must not emit Go location: %q", got)
	}
}

func TestFormatCsvCell_DateIncludesTime(t *testing.T) {
	t.Parallel()
	// 达梦 DATE 含时分秒，勿截成仅日期
	tm := time.Date(2026, 7, 23, 14, 49, 43, 0, time.Local)
	got := formatCsvCell(tm, "\\N", "DATE")
	if got != "2026-07-23 14:49:43" {
		t.Fatalf("DATE: got %q", got)
	}
}

func TestFormatCsvCell_TimeAndFraction(t *testing.T) {
	t.Parallel()
	tm := time.Date(2026, 7, 23, 6, 36, 55, 123000000, time.Local)
	if got := formatCsvCell(tm, "\\N", "TIME"); got != "06:36:55.123" {
		t.Fatalf("TIME: got %q", got)
	}
	if got := formatCsvCell(tm, "\\N", "TIMESTAMP"); got != "2026-07-23 06:36:55.123" {
		t.Fatalf("fraction: got %q", got)
	}
}

func TestNormalizeCsvImportCell_StripsGoLocation(t *testing.T) {
	t.Parallel()
	in := "2026-07-23 23:39:42 +0800 CST"
	got := normalizeCsvImportCell(in)
	if got != "2026-07-23 23:39:42" {
		t.Fatalf("got %q", got)
	}
	if strings.Contains(got, "CST") || strings.Contains(got, "+0800") {
		t.Fatalf("must strip Go location: %q", got)
	}
}

func TestNormalizeCsvImportCell_LeavesNormal(t *testing.T) {
	t.Parallel()
	for _, in := range []string{
		"2026-07-23 23:39:42",
		"plain text",
		"2026-07-23",
	} {
		if got := normalizeCsvImportCell(in); got != in {
			t.Fatalf("%q -> %q", in, got)
		}
	}
}
