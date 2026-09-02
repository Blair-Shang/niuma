package host

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
		err := AssertReadonlySQL(tc.sql)
		if tc.ok && err != nil {
			t.Fatalf("%q: %v", tc.sql, err)
		}
		if !tc.ok && err == nil {
			t.Fatalf("%q: want error", tc.sql)
		}
	}
}

func TestNamespaceForKind(t *testing.T) {
	ns, err := NamespaceForKind("postgresql")
	if err != nil || ns != "postgres" {
		t.Fatalf("postgresql → %q %v", ns, err)
	}
	if _, err := NamespaceForKind(""); err == nil {
		t.Fatal("empty kind should fail")
	}
	ns, err = NamespaceForKind("vastbase")
	if err != nil || ns != "vastbase" {
		t.Fatalf("vastbase → %q %v", ns, err)
	}
}

func TestIsSQLTool(t *testing.T) {
	if !IsSQLTool(ToolListTables) || IsSQLTool("list_tables") {
		t.Fatal("sql_* only")
	}
}
