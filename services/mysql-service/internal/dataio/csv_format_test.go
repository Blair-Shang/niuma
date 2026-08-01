package dataio

import (
	"strings"
	"testing"
	"time"
)

func TestCsvCellString_DatetimeNoGoLocation(t *testing.T) {
	t.Parallel()
	tm := time.Date(2026, 7, 23, 23, 39, 42, 0, time.FixedZone("CST", 8*3600))
	got := csvCellString(tm, "", "DATETIME")
	if got != "2026-07-23 23:39:42" {
		t.Fatalf("DATETIME: got %q", got)
	}
	if strings.Contains(got, "CST") || strings.Contains(got, "+0800") {
		t.Fatalf("must not emit Go location: %q", got)
	}
}

func TestCsvCellString_DateAndTime(t *testing.T) {
	t.Parallel()
	tm := time.Date(2026, 7, 23, 14, 49, 43, 0, time.Local)
	if got := csvCellString(tm, "", "DATE"); got != "2026-07-23" {
		t.Fatalf("DATE: got %q", got)
	}
	if got := csvCellString(tm, "", "TIME"); got != "14:49:43" {
		t.Fatalf("TIME: got %q", got)
	}
}

func TestCsvCellString_Fraction(t *testing.T) {
	t.Parallel()
	tm := time.Date(2026, 7, 23, 6, 36, 55, 123000000, time.Local)
	got := csvCellString(tm, "", "TIMESTAMP")
	if got != "2026-07-23 06:36:55.123" {
		t.Fatalf("fraction: got %q", got)
	}
}

func TestNormalizeCsvHeader(t *testing.T) {
	t.Parallel()
	got := normalizeCsvHeader([]string{"  id ", "", " name"})
	want := []string{"id", "col2", "name"}
	if len(got) != len(want) {
		t.Fatalf("len=%d want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("[%d]=%q want %q", i, got[i], want[i])
		}
	}
}

func TestApplyColumnMap_TrimAndCase(t *testing.T) {
	t.Parallel()
	dst, idx := applyColumnMap(
		[]string{" AddTime ", "id"},
		map[string]string{"addtime": "addTime", "id": "id"},
	)
	if len(dst) != 2 || dst[0] != "addTime" || dst[1] != "id" {
		t.Fatalf("dst=%v idx=%v", dst, idx)
	}
	if len(idx) != 2 || idx[0] != 0 || idx[1] != 1 {
		t.Fatalf("idx=%v", idx)
	}
}
