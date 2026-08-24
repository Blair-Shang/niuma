package dataio

import (
	"strings"
	"testing"
)

func TestSplitGoBatches(t *testing.T) {
	got := splitGoBatches("SELECT 1\nGO\nSELECT 2\nGO\nSELECT 3")
	if len(got) != 3 || got[0] != "SELECT 1" || got[2] != "SELECT 3" {
		t.Fatalf("got %#v", got)
	}

	got = splitGoBatches("SELECT 'GO'\nGO\nSELECT [GO]\nGO")
	if len(got) != 2 || got[0] != "SELECT 'GO'" || got[1] != "SELECT [GO]" {
		t.Fatalf("literal GO split: %#v", got)
	}

	got = splitGoBatches("SELECT 1 -- GO\nGO\nSELECT 2")
	if len(got) != 2 || got[0] != "SELECT 1" || got[1] != "SELECT 2" {
		t.Fatalf("comment GO split: %#v", got)
	}

	got = splitGoBatches("SELECT 1\nGO 2\n")
	if len(got) != 2 || got[0] != "SELECT 1" || got[1] != "SELECT 1" {
		t.Fatalf("GO 2 repeat: %#v", got)
	}
}

func TestBuildBatchInsertPlaceholders(t *testing.T) {
	sql, args := buildBatchInsert("[dbo].[t]", []string{"a", "b"}, [][]string{{"1", "\\N"}, {"x", "y"}}, "\\N")
	if args[0] != "1" || args[1] != nil {
		t.Fatalf("args: %#v", args)
	}
	for _, p := range []string{"@p1", "@p2", "@p3", "@p4"} {
		if !strings.Contains(sql, p) {
			t.Fatalf("missing %s in %s", p, sql)
		}
	}
	if strings.Contains(sql, "?") {
		t.Fatalf("must not use ?: %s", sql)
	}
}
