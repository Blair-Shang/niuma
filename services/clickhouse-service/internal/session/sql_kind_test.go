package session

import "testing"

func TestSQLKindSkipsComments(t *testing.T) {
	t.Parallel()
	q := "-- note\nSELECT 1"
	if got := sqlKind(q); got != "SELECT" {
		t.Fatalf("got %q", got)
	}
	q = "/* block */\nWITH x AS (SELECT 1) SELECT * FROM x"
	if got := sqlKind(q); got != "WITH" {
		t.Fatalf("got %q", got)
	}
	q = "# hash\nSHOW TABLES"
	if got := sqlKind(q); got != "SHOW" {
		t.Fatalf("got %q", got)
	}
}

func TestReturnsResultSet(t *testing.T) {
	t.Parallel()
	if !returnsResultSet("SELECT 1") {
		t.Fatal("SELECT")
	}
	if !returnsResultSet("EXPLAIN SELECT 1") {
		t.Fatal("EXPLAIN")
	}
	if returnsResultSet("INSERT INTO t VALUES (1)") {
		t.Fatal("INSERT must not be result set")
	}
	if returnsResultSet("DROP TABLE t") {
		t.Fatal("DROP must not be result set")
	}
}
