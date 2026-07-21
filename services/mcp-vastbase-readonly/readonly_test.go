package main

import "testing"

func TestAssertReadonlySQL(t *testing.T) {
	cases := []struct {
		sql string
		ok  bool
	}{
		{"SELECT 1", true},
		{"WITH a AS (SELECT 1) SELECT * FROM a", true},
		{"INSERT INTO t VALUES (1)", false},
		{"SELECT 1; DROP TABLE t", false},
		{"SELECT * FROM t WHERE x = 1", true},
		{"update t set x=1", false},
	}
	for _, tc := range cases {
		err := assertReadonlySQL(tc.sql)
		if tc.ok && err != nil {
			t.Fatalf("%q: %v", tc.sql, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%q: want error", tc.sql)
		}
	}
}
