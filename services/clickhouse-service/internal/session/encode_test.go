package session

import (
	"math"
	"testing"
	"time"
)

func TestEncodeCellLargeInt(t *testing.T) {
	t.Parallel()
	col := ColumnMeta{DataType: "UInt64"}
	got := encodeCell(uint64(math.MaxUint64), col)
	s, ok := got.(string)
	if !ok || s == "" {
		t.Fatalf("expected string for oversized uint64, got %#v", got)
	}
}

func TestEncodeCellTemporal(t *testing.T) {
	t.Parallel()
	ts := time.Date(2024, 7, 26, 15, 4, 5, 0, time.UTC)
	got := encodeCell(ts, ColumnMeta{DataType: "DateTime"})
	if got != "2024-07-26 15:04:05" {
		t.Fatalf("got %v", got)
	}
	got = encodeCell(ts, ColumnMeta{DataType: "Date"})
	if got != "2024-07-26" {
		t.Fatalf("got %v", got)
	}
}

func TestEncodeCellNil(t *testing.T) {
	t.Parallel()
	if encodeCell(nil, ColumnMeta{}) != nil {
		t.Fatal("nil")
	}
}
