package session

import (
	"testing"
)

func TestReturnsResultSet(t *testing.T) {
	cases := []struct {
		sql  string
		want bool
	}{
		{"SELECT 1", true},
		{"  show tables", true},
		{"EXPLAIN SELECT 1", true},
		{"WITH cte AS (SELECT 1) SELECT * FROM cte", true},
		{"WITH cte AS (SELECT 1) UPDATE t SET a=1", false},
		{"UPDATE bas_sku SET addTime=NOW()", false},
		{"INSERT INTO t VALUES (1)", false},
		{"DELETE FROM t", false},
		{"/* c */ UPDATE t SET a=1", false},
		{"-- c\nSELECT 1", true},
	}
	for _, tc := range cases {
		if got := returnsResultSet(tc.sql); got != tc.want {
			t.Fatalf("returnsResultSet(%q)=%v want %v", tc.sql, got, tc.want)
		}
	}
}

func TestCommandTagForSQL(t *testing.T) {
	if got := commandTagForSQL("update bas_sku SET a=1"); got != "UPDATE" {
		t.Fatalf("got %q", got)
	}
	if got := commandTagForSQL("SELECT 1"); got != "SELECT" {
		t.Fatalf("got %q", got)
	}
}
