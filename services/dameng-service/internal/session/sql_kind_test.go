package session

import "testing"

func TestSqlKindSkipsLeadingComments(t *testing.T) {
	t.Parallel()

	// 调试辅助函数调用：首行是 -- Call function …，其后才是 SELECT
	callFn := "-- Call function \"WMS_DEV\".\"F_PINYIN\" → VARCHAR2\n" +
		"SELECT \"WMS_DEV\".\"F_PINYIN\"('张三' /* P_NAME VARCHAR2(32767) */) AS \"result\" FROM DUAL"
	if got := sqlKind(callFn); got != "SELECT" {
		t.Fatalf("sqlKind(callFn)=%q, want SELECT", got)
	}
	if !returnsRows(callFn) {
		t.Fatal("returnsRows(callFn)=false, want true")
	}

	cases := []struct {
		sql  string
		kind string
		rows bool
	}{
		{"SELECT 1 FROM DUAL", "SELECT", true},
		{"/* ahead */\nSELECT 1 FROM DUAL", "SELECT", true},
		{"-- a\n-- b\nWITH x AS (SELECT 1 AS n) SELECT * FROM x", "WITH", true},
		{"BEGIN NULL; END;", "BEGIN", false},
		{"-- only comment", "", false},
		{"/* unclosed", "", false},
	}
	for _, tc := range cases {
		if got := sqlKind(tc.sql); got != tc.kind {
			t.Fatalf("sqlKind(%q)=%q, want %q", tc.sql, got, tc.kind)
		}
		if got := returnsRows(tc.sql); got != tc.rows {
			t.Fatalf("returnsRows(%q)=%v, want %v", tc.sql, got, tc.rows)
		}
	}
}
